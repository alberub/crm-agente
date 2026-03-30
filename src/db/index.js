const { Client, Pool, types } = require("pg");
const {
  databaseUrl,
  dbHost,
  dbUser,
  dbPassword,
  dbName,
  dbPort,
} = require("../config/env");

const poolConfig = databaseUrl
  ? {
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    }
  : {
      host: dbHost,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      port: dbPort,
      connectionTimeoutMillis: 5000,
    };

types.setTypeParser(1114, (value) => value);

const pool = new Pool(poolConfig);

function createClient(overrides = {}) {
  return new Client({
    ...poolConfig,
    ...overrides,
  });
}

module.exports = {
  pool,
  poolConfig,
  createClient,
  query: (text, params) => pool.query(text, params),
};
