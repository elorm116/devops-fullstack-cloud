// api/services/oauth.js
// Verifies Google ID tokens and extracts user info.
// Uses Google's tokeninfo endpoint — no extra dependencies needed.

const https = require('https');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
  console.warn('[OAuth] GOOGLE_CLIENT_ID not set — Google SSO will not work');
}

/**
 * Verifies a Google ID token and returns the user's profile.
 * @param {string} idToken — the token sent from the frontend
 * @returns {{ googleId, email, name, picture }} — verified user info
 */
async function verifyGoogleToken(idToken) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }

  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const payload = JSON.parse(data);

          // Token verification failed
          if (payload.error_description || res.statusCode !== 200) {
            return reject(new Error(`Invalid Google token: ${payload.error_description || 'unknown error'}`));
          }

          // Ensure token was issued for our app
          if (payload.aud !== GOOGLE_CLIENT_ID) {
            return reject(new Error('Token audience mismatch — wrong client ID'));
          }

          // Ensure token is not expired
          if (Date.now() / 1000 > parseInt(payload.exp)) {
            return reject(new Error('Google token has expired'));
          }

          // Ensure email is verified by Google
          if (payload.email_verified !== 'true') {
            return reject(new Error('Google email is not verified'));
          }

          resolve({
            googleId: payload.sub,
            email: payload.email,
            name: payload.name || payload.email.split('@')[0],
            picture: payload.picture || null,
          });
        } catch (e) {
          reject(new Error(`Failed to parse Google token response: ${e.message}`));
        }
      });
    }).on('error', (e) => {
      reject(new Error(`Google token verification request failed: ${e.message}`));
    });
  });
}

module.exports = { verifyGoogleToken };