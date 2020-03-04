const express = require('express');
const uuid = require('uuid').v5;
const _ = require('lodash');
const path = require('path');
const yaml = require('js-yaml');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const app = express();
const session = require('express-session');
const passport = require('passport');
const RedditStrategy = require('passport-reddit').Strategy;
const fs = require('fs');
const MongoClient = require('mongodb').MongoClient;

const config = fs.existsSync('./config.yml')
  ? yaml.safeLoad(fs.readFileSync('./config.yml', 'utf8'))
  : yaml.safeLoad(fs.readFileSync('./config.default.yml', 'utf8'));

let ensureAuthenticated, db;
const table = {};

const LOOT_UUID = 'e1d567bd-498f-4b30-9ef5-1d94b79d5b5c';

const port = process.env.PORT || config.port || 3000;

app.use(express.static(path.join(__dirname, 'assets')));
app.use(bodyParser.json());
app.use(session({
  secret: config['session-secret'],
  resave: false,
  saveUninitialized: true,
  cookie: { secure: config.https },
}));

// things that can be indexed
const THINGS = 'r99 alt prow r301 g7 flat hem hav spit star '+
  'devo long trip krab sent pk eva moz mast re45 ' +
  '2020 wing evo helm body knok pack '+
  'med phx batt ult stab 1x 10x 8x anv '+
  '2tap fire chok hamm ring care'.split(' ');

const ARMOR = 'helm body knok pack'.split(' ');

// determine if we want to authenticate input users
if (config['use-auth']) {
  passport.serializeUser((user, done) => done(null, user));
  passport.deserializeUser((obj, done) => done(null, obj));

  // setup passport
  passport.use(new RedditStrategy({
      clientID: config['reddit-key'],
      clientSecret: config['reddit-secret'],
      callbackURL: `${config['auth-host']}/auth/reddit/callback`
    },
    (accessToken, refreshToken, profile, done) => {
      console.log(profile);
      table.users.findOneAndUpdate(
        {redditId: profile.id},
        {$set: {
          redditId: profile.id,
          name: profile.name,
        }, $inc: {activity: 1}},
        {upsert: true, new: true},
        (err, user) => done(err, _.get(user, 'value'))
      );
    }
  ));

  app.use(passport.initialize());
  app.use(passport.session());

  app.get('/auth/reddit', (req, res, next) => {
    req.session.state = crypto.randomBytes(32).toString('hex');
    passport.authenticate('reddit', {
      state: req.session.state,
    })(req, res, next);
  });

  app.get('/auth/reddit/callback', (req, res, next) => {
    if (req.query.state == req.session.state){
      passport.authenticate('reddit', {
        successRedirect: '/',
        failureRedirect: '/'
      })(req, res, next);
    }
    else {
      next( new Error(403) );
    }
  });

  app.get('/auth/logout', (req, res) => {
    req.logout();
    res.redirect('/');
  });

  ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) { return next(); }
      res.status(401).json({
        message: 'Unauthorized'
      });
  }

  app.get('/auth/check', (req, res) => {
    res.json({isAuth: !!req.user, user: _.get(req, 'user.name')});
  });
} else {
  ensureAuthenticated = (req, res, next) => next();

  app.get('/auth/check', (req, res) => {
    res.json({isAuth: true, user: null});
  });
}

// input validation
function validateLoot(data) {
  if (typeof data.id !== 'string')
    return false;

  if (typeof data.x !== 'number' || typeof data.y !== 'number')
    return false;

  /// no one is sticking stuff on the edge of the map...
  if (data.x < 0.02 || data.y < 0.02 || data.x > 0.98 || data.y > 0.98)
    return false;

  if (!THINGS.includes(data.id))
    return false;

  if (data.id === 'ring' || data.id === 'care') {
    if (typeof data.round !== 'number')
      return false;

    if (data.round < 1 || data.round > 8)
      return false;
  }

  if (ARMOR.includes(data.id) && data.color !== 'gold' && data.color !== 'purple') {
    return false;
  }

  return true;
}

// automatically ban users who contribute maliciously too many times
function punish(user) {

}

// posting new data to the map
app.post('/api/data', ensureAuthenticated, (req, res) => {
  if(!validateLoot(req.body)) {
    return res.status(422).json({message: 'Invalid Arguments'});
  }

  const now = Date.now();

  // one item per minute for untrusted users
  if (!_.get(req.user, 'trusted') && req.session.dataCooldown && now - req.session.dataCooldown < 30000) {
    punish(req.user);
    return res.status(429).json({message: 'Too many requests'});
  }

  console.log('user', req.user);

  const {x, y, id, round, color} = req.body;

  const data = {
    uuid: uuid(`${id}:${x},${y}:${round||0}`, LOOT_UUID),
    user: _.get(req.user, 'name', 'guest'),
    created: now,
    thing: id,
    x: x,
    y: y,

    // round only for ring or care package
    ...(id === 'ring' || id === 'care' ? {
      round: round,
    } : {}),

    // round only for ring or care package
    ...(ARMOR.includes(id) ? {
      color: color,
    } : {}),
  }

  req.session.dataCooldown = now;

  table.things.insertOne(data, (err, doc) => {
    if (err) {
      console.error(err);
      res.status(500).json({message: 'Error inserting thing'});
      return;
    }

    res.json({ ...data, ago: 0, good: 0, bad: 0 });
  });
});

app.get('/api/data', (req, res) => {
  const handle = (err, docs) => {
    if (err) {
      console.error(err);
      res.status(500).json({
        status: 500,
        message: 'Error requesting loot table',
      });
      return;
    }
    res.status(200).json(docs);
  };

  const now = Date.now();
  table.things.aggregate([
    {$lookup: {from: 'votes', localField: 'uuid', foreignField: 'uuid', as: 'votes'}},
    {$unwind: {path: '$votes', preserveNullAndEmptyArrays: true}},
    {$group: {
      _id: '$uuid',
      uuid: {$first: '$uuid'},
      user: {$first: '$user'},
      thing: {$first: '$thing'},
      color: {$first: '$color'},
      round: {$first: '$round'},
      ago: {$first: {
        $subtract: [now, '$created'],
      }},
      x: {$first: '$x'},
      y: {$first: '$y'},
      good: {$sum: {$cond: [{$eq: ['$votes.vote', 1]}, 1, 0]}},
      bad: {$sum: {$cond: [{$eq: ['$votes.vote', -1]}, 1, 0]}},
    }},
    {$project: {_id: 0}},
    {$sort: {'y': 1}},
  ]).toArray(handle);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '/index.html'))
});


app.use((req, res) => {
    res.status(404).send('page not found');
});

// Use connect method to connect to the server
MongoClient.connect(config['db-url'], function(err, client) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log("Connected successfully to db server");

  db = client.db(config['db-name']);
  table.users = db.collection('users');
  table.things = db.collection('things');
  table.votes = db.collection('votes');
  table.reports = db.collection('reports');

  app.listen(port, () => console.log(`Started server on :${port}!`));
});
