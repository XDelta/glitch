### Glitch

Loot tracker for the Apex Legends Deja Loot Event (3/3/2020 - 3/17/2020)

Deja Loot is an event where the normally randomized loot spread across the map stays the same every day.

On the second week, starting March 10th, the map changes to Season 2 Kings Canyon.

At the end of the event I will serve a static gh-pages site with all of the event data!

### Prerequisites

* node (tested on 9 and 13)
* mongodb
* (optional) reddit account

### Setup

1. clone repo
2. `npm i`
3. setup/start mongo server
4. copy `config.default.yml` into `config.yml` and replace default values
5. (optional) obtain [a reddit app key](https://www.reddit.com/prefs/apps/#create-app-button) and input keys into `config.yml`
6. `npm start` - starts the application
7. navigate to `127.0.0.1:3000` (default) in browser

My "production" setup involves the following:

* a debian google cloud instance
* nginx serving the `assets/` folder and `index.html`, and forwarding `/auth/` and `/api/` to `http://127.0.0.1:3000/<api or auth>/`
* letsencrypt certbot on that nginx endpoint
