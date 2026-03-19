const db = require("../db");
const {
  metaAccessToken,
  metaPhoneNumberId,
} = require("../config/env");

async function getDatabaseStatus() {
  try {
    const result = await db.query("SELECT NOW() AS now");

    return {
      ok: true,
      provider: "postgres",
      now: result.rows[0]?.now || null,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "postgres",
      error: error.message,
    };
  }
}

async function getMetaStatus() {
  try {
    const response = await fetch(
      `https://graph.facebook.com/v22.0/${metaPhoneNumberId}`,
      {
        headers: {
          Authorization: `Bearer ${metaAccessToken}`,
        },
      }
    );

    const body = await response.text();

    return {
      ok: response.ok,
      provider: "meta",
      status: response.status,
      body,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "meta",
      error: error.message,
    };
  }
}

async function getConnectionsStatus() {
  const [database, meta] = await Promise.all([
    getDatabaseStatus(),
    getMetaStatus(),
  ]);

  return {
    database,
    meta,
  };
}

module.exports = {
  getConnectionsStatus,
};
