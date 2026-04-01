const express = require("express");
const db = require("../db");
const { SALES_STAGE_CATALOG } = require("../domain/salesStages");
const { getPipelineSummary, getDashboardSummary } = require("../repositories/leadRepository");

const router = express.Router();

router.get("/api/sales/stages", async (_req, res, next) => {
  try {
    const result = await db.query(
      `
        SELECT
          id,
          code,
          name,
          sort_order,
          is_closed_won,
          is_closed_lost
        FROM public.sales_stage
        ORDER BY sort_order ASC, id ASC
      `
    );

    if (!result.rows.length) {
      res.status(200).json({ stages: SALES_STAGE_CATALOG });
      return;
    }

    res.status(200).json({
      stages: result.rows.map((row) => ({
        id: Number(row.id),
        code: row.code,
        name: row.name,
        sortOrder: Number(row.sort_order),
        isClosedWon: Boolean(row.is_closed_won),
        isClosedLost: Boolean(row.is_closed_lost),
      })),
    });
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

router.get("/api/sales/dashboard", async (req, res, next) => {
  try {
    const rangeDays = req.query.rangeDays;
    const summary = await getDashboardSummary({ rangeDays });
    res.status(200).json(summary);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
