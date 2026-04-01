const express = require("express");
const { getPipelineSummary, listSalesStages } = require("../repositories/mvpLeadRepository");

const router = express.Router();

router.get("/api/sales/stages", async (_req, res, next) => {
  try {
    const stages = await listSalesStages();
    res.status(200).json({ stages });
  } catch (error) {
    next(error);
  }
});

router.get("/api/sales/pipeline-summary", async (_req, res, next) => {
  try {
    const summary = await getPipelineSummary();
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
