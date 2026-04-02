const express = require("express");
const { requireRoles } = require("../middlewares/authentication");
const {
  ensureLeadByConversationId,
  listLeads,
  findLeadById,
  updateLead,
} = require("../repositories/mvpLeadRepository");
const { AppError } = require("../utils/errors");

const router = express.Router();

function parseLeadId(value) {
  const leadId = Number(value);

  if (!Number.isInteger(leadId) || leadId <= 0) {
    throw new AppError("ID de lead invalido.", 400);
  }

  return leadId;
}

function handleLeadErrors(error, next) {
  if (error.message === "INVALID_STAGE_CODE") {
    next(new AppError("stageCode no existe en sales_stage.", 400));
    return true;
  }

  if (error.message === "INVALID_ESTIMATED_VALUE") {
    next(new AppError("estimatedValue debe ser un numero mayor o igual a 0.", 400));
    return true;
  }

  if (error.message === "INVALID_NEXT_FOLLOWUP_AT") {
    next(new AppError("nextFollowupAt debe ser una fecha valida.", 400));
    return true;
  }

  return false;
}

router.get("/api/leads", async (req, res, next) => {
  try {
    const leads = await listLeads({
      search: String(req.query.search || ""),
      stageCode: String(req.query.stageCode || "").trim() || null,
      followupDueOnly: String(req.query.followupDue || "").toLowerCase() === "true",
      limit: req.query.limit,
    });

    res.status(200).json({ leads });
  } catch (error) {
    if (handleLeadErrors(error, next)) {
      return;
    }

    next(error);
  }
});

router.get("/api/leads/:id", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const lead = await findLeadById(leadId);

    if (!lead) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(200).json({ lead });
  } catch (error) {
    if (handleLeadErrors(error, next)) {
      return;
    }

    next(error);
  }
});

router.post("/api/leads/from-conversation/:conversationId", async (req, res, next) => {
  try {
    const conversationId = Number(req.params.conversationId);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new AppError("ID de conversacion invalido.", 400);
    }

    const lead = await ensureLeadByConversationId(conversationId);

    if (!lead) {
      throw new AppError("No se pudo crear o recuperar el lead.", 500);
    }

    res.status(201).json({ lead });
  } catch (error) {
    if (handleLeadErrors(error, next)) {
      return;
    }

    next(error);
  }
});

router.patch("/api/leads/:id", requireRoles(["admin", "manager", "agent"]), async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const lead = await updateLead({
      leadId,
      patch: {
        estimatedValue: req.body.estimatedValue,
        nextAction: req.body.nextAction,
        nextFollowupAt: req.body.nextFollowupAt,
        lossReason: req.body.lossReason,
      },
      actorRef: req.auth.actorRef,
    });

    if (!lead) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(200).json({ lead });
  } catch (error) {
    if (handleLeadErrors(error, next)) {
      return;
    }

    next(error);
  }
});

router.patch(
  "/api/leads/:id/stage",
  requireRoles(["admin", "manager", "agent"]),
  async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const stageCode = String(req.body.stageCode || "").trim();

    if (!stageCode) {
      throw new AppError("Debes enviar stageCode.", 400);
    }

    const lead = await updateLead({
      leadId,
      patch: { stageCode },
      actorRef: req.auth.actorRef,
    });

    if (!lead) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(200).json({ lead });
  } catch (error) {
    if (handleLeadErrors(error, next)) {
      return;
    }

    next(error);
  }
  }
);

module.exports = router;
