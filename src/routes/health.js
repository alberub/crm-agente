const express = require("express");
const { localEnvPath, crmPort, corsOrigins } = require("../config/env");
const { getConnectionsStatus } = require("../services/connectionStatusService");

const router = express.Router();

router.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "crm-agente-api",
    port: crmPort,
    sourceEnv: localEnvPath,
    corsOrigins,
  });
});

router.get("/api/connections/status", async (_req, res, next) => {
  try {
    const status = await getConnectionsStatus();
    res.status(200).json(status);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
