const express = require("express");
const { SALES_STAGE_CATALOG } = require("../domain/salesStages");

const router = express.Router();

router.get("/api/sales/stages", (_req, res) => {
  res.status(200).json({
    stages: SALES_STAGE_CATALOG,
  });
});

module.exports = router;
