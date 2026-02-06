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
    returnURL: process.env.RETURN_URL || 'http://localhost:3000/auth/steam/return',
    realm: process.env.REALM || 'http://localhost:3000/',
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

app.get('/api/friends', ensureAuthenticated, async (req, res) => {
  const steamId = req.user.id;
  const url = `http://api.steampowered.com/ISteamUser/GetFriendList/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${steamId}&relationship=friend`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    
    // Get all friend Steam IDs
    const friendIds = data.friendslist.friends.map(f => f.steamid).join(',');
    
    // Get their info (usernames and avatars)
    const summariesUrl = `http://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/?key=${process.env.STEAM_API_KEY}&steamids=${friendIds}`;
    const summariesResponse = await fetch(summariesUrl);
    const summariesData = await summariesResponse.json();
    
    res.json(summariesData.response.players);
  } catch (error) {
    res.status(500).json({error: 'Failed to get friends'});
  }
});

app.get('/api/common-games', ensureAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const friendId = req.query.friendId;

    if(!friendId){
        return res.status(400).json({error: 'Friend ID required'});
    }
    try{
        const userGamesUrl = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${userId}&include_appinfo=1&include_played_free_games=1`;
        const userGamesResponse = await fetch(userGamesUrl);
        const userGamesData = await userGamesResponse.json();

        console.log('Users games:', userGamesData);

        const friendGamesUrl = `http://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?key=${process.env.STEAM_API_KEY}&steamid=${friendId}&include_appinfo=1&include_played_free_games=1`;
        const friendGamesResponse = await fetch(friendGamesUrl);
        const friendGamesData = await friendGamesResponse.json();

        console.log('Friends games:', friendGamesData);

        const userGames = userGamesData.response.games || [];
        const friendGames = friendGamesData.response.games || [];
        const friendGameIds = new Set(friendGames.map(game => game.appid));

        const commonGames = userGames.filter(game => friendGameIds.has(game.appid));

        // Filter games that have achievements
        const gamesWithAchievements = [];
        
        for (const game of commonGames) {
            try {
                const schemaUrl = `http://api.steampowered.com/ISteamUserStats/GetSchemaForGame/v2/?key=${process.env.STEAM_API_KEY}&appid=${game.appid}`;
                const schemaResponse = await fetch(schemaUrl);
                const schemaData = await schemaResponse.json();
                
                // Check if game has achievements
                if (schemaData.game && schemaData.game.availableGameStats && schemaData.game.availableGameStats.achievements) {
                    const achievementCount = schemaData.game.availableGameStats.achievements.length;
                    if (achievementCount > 0) {
                        gamesWithAchievements.push(game);
                    }
                }
            } catch (error) {
                console.log(`Could not fetch ${game.name} (${game.appid})`);
            }
        }

        console.log('Games with achievements: ', gamesWithAchievements);
        res.json(gamesWithAchievements);

    }
    catch(error){
        console.error('Error fetching common games:', error);
        return res.status(500).json({error: 'Failed to get common games'});
    }
});

app.get('/api/achievements', ensureAuthenticated, async (req, res) => {
    const userId = req.user.id;
    const friendId = req.query.friendId; 
    const appId = req.query.appId;

    if(!friendId || !appId){
        return res.status(400).json({error: 'Friend ID and App ID required'});
    }

    try{
        const usersAchievementUrl = `http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appId}&key=${process.env.STEAM_API_KEY}&steamid=${userId}`;
        const usersAchievementResponse = await fetch(usersAchievementUrl);
        const usersAchievementData = await usersAchievementResponse.json();

        const friendAchievementUrl = `http://api.steampowered.com/ISteamUserStats/GetPlayerAchievements/v1/?appid=${appId}&key=${process.env.STEAM_API_KEY}&steamid=${friendId}`;
        const friendAchievementResponse = await fetch(friendAchievementUrl);
        const friendAchievementData = await friendAchievementResponse.json();

        
        if(!usersAchievementData.playerstats || !usersAchievementData.playerstats.achievements) {
            return res.status(400).json({error: 'Could not fetch your achievements. Your game details may be private or you don\'t own this game'});
        }

        if(!friendAchievementData.playerstats || !friendAchievementData.playerstats.achievements) {
            return res.status(400).json({error: 'Could not fetch friend\'s achievements. Their game details may be private or your friend does not own this game.'});
        }

        const usersAchievements = usersAchievementData.playerstats.achievements || [];
        const friendsAchievements = friendAchievementData.playerstats.achievements || [];
        
        console.log('User achievements count:', usersAchievements.length);
        console.log('Friend achievements count:', friendsAchievements.length);

        const userUnlocked = usersAchievements.filter(achievement => achievement.achieved === 1).length
        const friendUnlocked = friendsAchievements.filter(achievement => achievement.achieved === 1).length
        
        const totalNumber = usersAchievements.length;

        if(totalNumber <= 0){
          return res.status(400).json({error:'This game has no achievements.'})
        }

        const userPercentage = Math.round((userUnlocked / totalNumber) * 100);
        const friendPercentage = Math.round((friendUnlocked / totalNumber) * 100);

        res.json({
          total: totalNumber,
          user: {unlocked: userUnlocked, percentage: userPercentage},
          friend: {unlocked: friendUnlocked, percentage: friendPercentage},
        })
    }
    catch(error){
        console.error('Achievement fetch error:', error);
        return res.status(500).json({error: 'Failed to get achievements'})
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
