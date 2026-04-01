const express = require("express");
const { crmPort } = require("../config/env");

const router = express.Router();

router.get("/health", (_req, res) => {
  res.status(200).json({
    ok: true,
    service: "crm-agente-api",
    port: crmPort,
  });
});

module.exports = router;
