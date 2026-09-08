/**
 * index.js (db)
 * ---------------------------------------------------------------------------
 * The single swap point for changing the storage backend. Everything else
 * in the app (server/services/scanStore.js) requires THIS file, not a
 * specific driver -- so moving off SQLite later means adding a new
 * repository module here (e.g. postgresRepository.js, mongoRepository.js)
 * that exports the same four functions with the same shapes, and updating
 * the switch below. No route or service code outside server/services/db/
 * needs to change.
 *
 * Selected via DB_DRIVER (see .env.example). Defaults to 'sqlite', the only
 * driver implemented for SCANS in this MVP.
 *
 * Users/sessions (server/services/userStore.js, sessionStore.js) are a
 * separate concern with their own driver choice: they use Postgres whenever
 * DATABASE_URL is configured (see server/services/db/postgresConnection.js),
 * falling back to SQLite otherwise -- this keeps every existing test working
 * unmodified (they never set DATABASE_URL, so they keep getting SQLite
 * ':memory:' exactly like scans already do) while letting production store
 * accounts in a real, persistent Postgres database instead of Render's
 * ephemeral disk. Scans stay on SQLite either way for now -- see the plan
 * this was built from for why that split is deliberate, not an oversight.
 * ---------------------------------------------------------------------------
 */

function loadScanRepository() {
  const driver = (process.env.DB_DRIVER || 'sqlite').toLowerCase();

  switch (driver) {
    case 'sqlite':
      return require('./sqliteRepository');

    // Future backends would plug in here, e.g.:
    //   case 'postgres': return require('./postgresRepository');
    //   case 'mongodb':  return require('./mongoRepository');

    default:
      throw new Error(
        `Unsupported DB_DRIVER: "${driver}". Only "sqlite" is implemented in this MVP.`
      );
  }
}

function loadAuthRepositories() {
  if (process.env.DATABASE_URL) {
    return {
      users: require('./postgresUserRepository'),
      sessions: require('./postgresSessionRepository'),
    };
  }
  return {
    users: require('./sqliteUserRepository'),
    sessions: require('./sqliteSessionRepository'),
  };
}

const repository = loadScanRepository();
const { users, sessions } = loadAuthRepositories();

module.exports = repository;
module.exports.users = users;
module.exports.sessions = sessions;
