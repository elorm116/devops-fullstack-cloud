// scripts/mongo-init.js
// Runs once when MongoDB starts with an empty data directory.
// Creates the application database and a dedicated user (least-privilege).
//
// Mounted into the container at /docker-entrypoint-initdb.d/mongo-init.js
// by docker-compose. The MONGO_INITDB_* env vars create the root user;
// this script then creates the app-specific user.

const appDb = db.getSiblingDB('blog');

appDb.createUser({
  user: 'blogapi',
  pwd: process.env.MONGO_APP_PASSWORD,           // injected via environment variable
  roles: [{ role: 'readWrite', db: 'blog' }],
});

print('✅ Created blogapi user with readWrite on blog database');
