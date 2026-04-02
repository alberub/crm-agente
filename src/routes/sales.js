const express = require("express");
const { isOwnScopeRole } = require("../auth/accessControl");
const { getPipelineSummary } = require("../repositories/leadRepository");
const { listSalesStages } = require("../repositories/mvpLeadRepository");

const router = express.Router();

router.get("/api/sales/stages", async (_req, res, next) => {
  try {
    const stages = await listSalesStages();
    res.status(200).json({ stages });
  } catch (error) {
    next(error);
  }
});

router.get("/api/sales/pipeline-summary", async (req, res, next) => {
  try {
    const summary = await getPipelineSummary({
      ownerExternalRef: isOwnScopeRole(req.auth.user?.roleCode) ? req.auth.actorRef : null,
    });
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
