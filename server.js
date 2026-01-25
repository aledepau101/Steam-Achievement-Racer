require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;

//Start Server
const app = express();

// Sessions (Creates a session cookie in browser and allows passport to remember the user that is logged in)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false
}));

// Passport setup
app.use(passport.initialize());
app.use(passport.session());

// Serve static files (Allows html, css and js files to be accessed directly)
app.use(express.static('public'));

// Serialize user
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

// Steam strategy
passport.use(new SteamStrategy(
  {
    returnURL: 'http://localhost:3000/auth/steam/return',
    realm: 'http://localhost:3000/',
    apiKey: process.env.STEAM_API_KEY
  },
  (identifier, profile, done) => {
    profile.identifier = identifier;
    return done(null, profile);
  }
));

// Routes
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/auth/steam',
  passport.authenticate('steam')
);

app.get('/auth/steam/return',
  passport.authenticate('steam', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/dashboard');
  }
);

app.get('/api/me', ensureAuthenticated, (req, res) => {
  res.json({
    username: req.user.displayName,
    steamid: req.user.id,
    avatar: req.user.photos[req.user.photos.length - 1].value

  });
});

app.get('/api/games', ensureAuthenticated, async (req, res) => {
    try {
        //Get the logged-in user's SteamID
        const steamID = req.user.id;

        //Build the Steam API URL
        const apiKey = process.env.STEAM_API_KEY;
        const url = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${apiKey}&steamid=${steamID}&include_appinfo=1&include_played_free_games=1`;

        //Fetch data from Steam API
        const response = await fetch(url);
        const data = await response.json();

        //Extract the games array
        const games = data.response.games || [];

        //Map to only the fields relevant
        const simplifiedGames = games.map(game => ({
            appid: game.appid,
            name: game.name
        }));

        //Send JSON back to frontend
        res.json(simplifiedGames);

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch games' });
    }
});

app.get('/api/friends', ensureAuthenticated, async (req, res) => {
    try {
        const steamID = req.user.id;
        const apiKey = process.env.STEAM_API_KEY;
        
        // Get friends list
        const friendsUrl = `http://api.steampowered.com/ISteamUser/GetFriendList/v1/?key=${apiKey}&steamid=${steamID}&relationship=friend`;
        const friendsResponse = await fetch(friendsUrl);
        const friendsData = await friendsResponse.json();
        
        const friends = friendsData.friendslist?.friends || [];
        
        // Get detailed info for all friends
        const steamids = friends.map(f => f.steamid).join(',');
        const summariesUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${apiKey}&steamids=${steamids}`;
        const summariesResponse = await fetch(summariesUrl);
        const summariesData = await summariesResponse.json();
        
        const friendsList = summariesData.response.players.map(player => ({
            steamid: player.steamid,
            username: player.personaname,
            avatar: player.avatarfull || player.avatarmedium || player.avatar
        }));
        
        res.json(friendsList);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch friends' });
    }
});


app.get('/dashboard', ensureAuthenticated, (req, res) => {
  res.sendFile(__dirname + '/public/dashboard.html');
});

app.get('/logout', (req, res) => {
  req.logout(() => {
    res.redirect('/');
  });
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
}

app.listen(3000, () => {
  console.log('Server running on http://localhost:3000');
});
