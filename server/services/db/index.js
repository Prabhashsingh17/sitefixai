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
 * driver implemented in this MVP.
 * ---------------------------------------------------------------------------
 */

function loadRepository() {
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

module.exports = loadRepository();
