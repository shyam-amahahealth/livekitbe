// livekit-be/config.js
require('dotenv').config();

module.exports = {
  livekitHost: process.env.LIVEKIT_HOST,
  livekitApiKey: process.env.LIVEKIT_API_KEY,
  livekitApiSecret: process.env.LIVEKIT_API_SECRET,
  port: process.env.PORT || 5001,
};
