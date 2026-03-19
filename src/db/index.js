const { Pool } = require("pg");
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

const pool = new Pool(poolConfig);

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
};
