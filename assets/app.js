const $ = document.querySelector.bind(document);
const $$ = q => Array.from(document.querySelectorAll(q));

let cursor, startScroll, start, cursorPos;
let zoom = 1.00;
let focused = false;
let authed = false, authUser, admin;
let launchTime = Date.now();
const things = {};

const margin = 50;
const ringsKC = [
  .58,
  .35,
]

function setCursor(x, y) {
  cursorPos = [x, y];
  $('.cursor.center').style.left =
  $('.cursor.top').style.left = x*2048 + 'px';
  $('.cursor.center').style.top =
  $('.cursor.left').style.top = y*2048 + 'px';

  $('.preview-menu').style.display = 'none';
}

// set the zoom level of the map
function modZoom(d) {
  zoom += d;
  zoom = Math.min(Math.max(zoom, 0.3), 5);
  $('.map-child').style.zoom = (zoom * 100) + '%';
  $$('.menu').forEach(m => m.style.zoom = ((1 / zoom) * 100) + '%');
  setMarkerPos($('.preview-menu'), true)
  $$('.marker').forEach(m => setMarkerPos(m));
  $('#zoomValue').innerText = Math.round(zoom * 100) + '%';
}

function setMarkerPos(el, isPreview=false) {
  const x = parseFloat(el.getAttribute('x'));
  const y = parseFloat(el.getAttribute('y'));
  el.style.left = x * zoom * 2048 + 'px';
  el.style.top = y * zoom * 2048 + 'px';
  el.style.zoom = ((1 / zoom) * 100) + '%'
}

function addMarker(data) {
  const meta = things[data.thing];
  console.log(meta, data);
  const el = document.createElement('div');
  el.className = `marker ${meta.ammo || ''} ${data.color || ''}`;
  el.setAttribute('x', data.x);
  el.setAttribute('y', data.y);
  el.title = meta.long;
  el.setAttribute('data', JSON.stringify(data));
  setMarkerPos(el);
  el.innerText = data.thing;
  $('.overlay').appendChild(el);
  return el;
}

function clickMarker(el) {
  cancelAdd();
  const preview = $('.preview-menu');
  const data = JSON.parse(el.getAttribute('data'));
  const meta = things[data.thing];

  preview.setAttribute('x', el.getAttribute('x'));
  preview.setAttribute('y', el.getAttribute('y'));

  $('#previewLong').innerText = meta.long;
  $('#previewShort').innerText = data.thing;
  $('#goodPoints').innerText = '+' + data.good;
  $('#badPoints').innerText = '-' + data.bad;
  $('#percent').innerText = (data.good + data.bad === 0 ? '?%' : Math.round(data.good/(data.good+data.bad)*100) + '%');
  $('#redditUser').innerText = data.user;
  let agoText;
  const ago = Date.now() - launchTime + data.ago;
  if (ago < 5000)
    agoText = 'moments';
  else if (ago < 60000)
    agoText = Math.round(ago/1000) + ' seconds';
  else if (ago < 60000 * 60)
    agoText = Math.round(ago/60000) + ' minutes';
  else if (ago < 60000 * 60 * 24)
    agoText = Math.round(ago/60000/24) + ' hours';
  else
    agoText = 'days';

  $('#age').innerText = agoText;

  const vote = (id, vote) => e => {
    e.preventDefault();
  };

  $('#upvoteButton').onclick = vote(data.uuid, 1);
  $('#downvoteButton').onclick = vote(data.uuid, -1);

  $('#deleteButton').style.display = data.user === authUser || admin ? 'inline' : 'none';
  $('.preview-menu .action-items').style.display = authUser ? 'inline' : 'none';

  const className = `${meta.ammo || ''} ${data.color || ''}`.trim();
  $('#previewShort').className =
  $('#previewLong').className = className;

  preview.style.display = 'block';
  setMarkerPos(preview, true);
}

function postData(short, pos, data) {
  fetch('/api/data', {
    method: 'POST',
    headers: {
      'Content-Type':'application/json'
    },
    body: JSON.stringify({
      id: short,
      x: pos[0],
      y: pos[1],
      color: data.color,
      round: data.round,
    })
  })
    .then(r => r.json())
    .then(r => {
      clickMarker(addMarker(r));
    })
    .catch(console.error);
}

const itemInit = el => {
  const className = el.className;
  const short = el.getAttribute('data-short');
  const long = el.getAttribute('data-name');

  // add the entry to our list
  things[short] = {
    long,
    ammo: el.classList.length === 3 ? el.classList[2] : undefined,
  };

  return e => {
    e.preventDefault();
    if (authed && focused) {
      $('.state-0').style.display = 'none';
      $('.state-1').style.display = 'block';

      $('#addButton').style.display = 'inline';
      $('#addButton').onclick = e => {
        console.log('adding', short, 'at', ...cursorPos);
        postData(short, cursorPos, {
          color: el.classList.length === 2 ? el.classList[1] : undefined,
        });
      };

      $('#itemShort').innerText = short;
      $('#itemLong').innerText = long;
      $('#itemShort').className = $('#itemLong').className = className;
    } else {
      console.log('should filter by', className, short);
    }
  }
}

function cancelAdd(e) {
  if (e)
    e.preventDefault();
  focused = false;
  setCursor(-1, -1);
}

// handle zoom button clicks
const zoomHelper = v => e => {e.preventDefault();modZoom(v);}

function wheelListener(e) {
  // helper functions for getting scroll offset
  const left = () => $('.map-child').scrollLeft, top = () => $('.map-child').scrollTop;
  // calculate the mouse position after zooming
  const oldPos = [e.pageX/zoom + left(), e.pageY/zoom + top()];
  modZoom(Math.sign(e.deltaY) * (zoom > 1.5 ? -0.4 : -0.1));
  const newPos = [e.pageX/zoom + left(), e.pageY/zoom + top()];

  // offset the scrolling by the difference
  const diff = [newPos[0] - oldPos[0], newPos[1] - oldPos[1]];
  $('.map-child').scrollLeft -= diff[0];
  $('.map-child').scrollTop -= diff[1];

  // re-adjust the starting position of the cursor for this drag
  if (cursor) {
    start = [e.pageX, e.pageY];
    cursor = [e.pageX, e.pageY];
    startScroll = [left(), top()];
  }
};

function mouseDownListener(e) {
  if (e.button !== 0) return;
  if (e.target && e.target.classList.contains('marker')) {
    clickMarker(e.target);
    return;
  }
  if (!e.target || e.target.className !== 'overlay')
    return;
  cursor = [e.pageX, e.pageY];
  start = [e.pageX, e.pageY];
  startScroll = [
    $('.map-child').scrollLeft,
    $('.map-child').scrollTop
  ];
}

function mouseUpListener(e) {
  if (e.button !== 0) return;
  $('.map-child').style.cursor = 'default';
  if (!cursor)
    return;

  const diff = [e.pageX-cursor[0], e.pageY-cursor[1]];
  if (Math.hypot(e.pageX - start[0], e.pageY - start[1]) < 5) {
    const renderPos = [e.pageX/zoom + $('.map-child').scrollLeft, e.pageY/zoom + $('.map-child').scrollTop]
    if (renderPos[0] < margin || renderPos[1] < margin || renderPos[0] > 2048-margin || renderPos[1] > 2048-margin)
      return;
    const dataPos = [renderPos[0]/(2048), renderPos[1]/(2048)];

    $('.state-0').style.display = 'block';
    $('.state-1').style.display = 'none';
    $('#addButton').style.display = 'none';
    focused = true;
    setCursor(...dataPos);
  }

  cursor = null;
}

// left mouse click
function moveListener(e) {
  if (!cursor)
    return;

  // move the map based on how far the mouse moved and how zoomed in user is
  // I use a "startScroll" and "start" variable because re-calculating the scroll and mouse position
  // cause a bit of drift and I was very OCD about it.
  const diff = [(e.pageX-start[0])/zoom, (e.pageY-start[1])/zoom];
  $('.map-child').scrollLeft = startScroll[0]-diff[0];
  $('.map-child').scrollTop = startScroll[1]-diff[1];
  cursor = [e.pageX, e.pageY];

  // set the cursor to a little hand :)
  $('.map-child').style.cursor = 'grab';
}

document.addEventListener('DOMContentLoaded', e => {
  $('#zoomPlus').addEventListener('click', zoomHelper(0.1));
  $('#zoomMinus').addEventListener('click', zoomHelper(-0.1));
  $('.map-child').addEventListener('wheel', wheelListener);
  $('.map-child').addEventListener('mousedown', mouseDownListener);
  $('.map-child').addEventListener('mouseup', mouseUpListener);
  $('.map-child').addEventListener('mouseleave', mouseUpListener);
  $('.map-child').addEventListener('mousemove', moveListener);
  $('#cancelButton').addEventListener('click', cancelAdd);
  $('#closeButton').addEventListener('click', () => $('.preview-menu').style.display = 'none');

  $$('.items-list .item').forEach(i =>
    i.addEventListener('click', itemInit(i)));

  setCursor(-1, -1);
  $('.map-child').scrollLeft = 1024 - $('.map-child').clientWidth / 2;
  $('.map-child').scrollTop = 1024 - $('.map-child').clientHeight / 2;

  fetch('/auth/check')
    .then(r => r.json())
    .then(r => {
      console.log('auth:', r);
      if (r.banned) {
        alert('You were banned. Please be respectful next time.');
        throw 'rip';
        return;
      }
      if (r.isAuth) {
        $('.addition-menu.no-auth').style.display = 'none';
        $('.addition-menu.authed').style.display = 'block';
        authed = true;
        authUser = r.user;
        admin = r.admin;
      } else {
        $('.addition-menu.no-auth').style.display = 'block';
        $('.addition-menu.authed').style.display = 'none';
      }
      return fetch('/api/data')
    })
    .then(r => r.json())
    .then(r => {
      launchTime = Date.now();
      r.forEach(addMarker);
      console.log('data', r);
    })
    .catch(console.error);
});