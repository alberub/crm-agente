const express = require("express");
const { isOwnScopeRole } = require("../auth/accessControl");
const { requireRoles } = require("../middlewares/authentication");
const {
  ensureLeadByConversationId,
  listLeads,
  findLeadById,
  findLeadByIdForOwner,
  listTags,
  createTag,
  setLeadTags,
  updateLead,
} = require("../repositories/leadRepository");
const { AppError } = require("../utils/errors");

const router = express.Router();

function parseLeadId(value) {
  const leadId = Number(value);

  if (!Number.isInteger(leadId) || leadId <= 0) {
    throw new AppError("ID de lead invalido.", 400);
  }

  return leadId;
}

function assignIfPresent(target, source, key) {
  if (Object.prototype.hasOwnProperty.call(source, key)) {
    target[key] = source[key];
  }
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

  if (error.message === "INVALID_TAG_NAME") {
    next(new AppError("El tag debe tener nombre.", 400));
    return true;
  }

  if (error.message === "INVALID_TAG_ID") {
    next(new AppError("Uno o mas tags no existen o estan inactivos.", 400));
    return true;
  }

  return false;
}

router.get("/api/tags", async (req, res, next) => {
  try {
    const tags = await listTags({
      search: String(req.query.search || ""),
      activeOnly: String(req.query.active || "true").toLowerCase() !== "false",
      marketingOnly: String(req.query.marketing || "").toLowerCase() === "true",
      limit: req.query.limit,
    });

    res.status(200).json({ tags });
  } catch (error) {
    next(error);
  }
});

router.post("/api/tags", requireRoles(["admin", "manager", "agent"]), async (req, res, next) => {
  try {
    const tag = await createTag({
      name: req.body.name,
      slug: req.body.slug,
      category: req.body.category,
      color: req.body.color,
      marketingEnabled: req.body.marketingEnabled,
    });

    res.status(201).json({ tag });
  } catch (error) {
    if (handleLeadErrors(error, next)) {
      return;
    }

    next(error);
  }
});

router.get("/api/leads", async (req, res, next) => {
  try {
    const scopedOwnerExternalRef = isOwnScopeRole(req.auth.user?.roleCode)
      ? req.auth.actorRef
      : String(req.query.owner || "").trim() || null;
    const leads = await listLeads({
      search: String(req.query.search || ""),
      stageCode: String(req.query.stageCode || "").trim() || null,
      status: String(req.query.status || "").trim() || null,
      ownerExternalRef: scopedOwnerExternalRef,
      tagSlug: String(req.query.tag || "").trim() || null,
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
    const lead = isOwnScopeRole(req.auth.user?.roleCode)
      ? await findLeadByIdForOwner(leadId, req.auth.actorRef)
      : await findLeadById(leadId);

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

    let lead = await ensureLeadByConversationId(conversationId);

    if (lead && isOwnScopeRole(req.auth.user?.roleCode) && !lead.owner?.externalRef) {
      lead = await updateLead({
        leadId: lead.id,
        patch: {
          ownerExternalRef: req.auth.actorRef,
          ownerName: req.auth.user?.fullName || req.auth.user?.email || "Asesor CRM",
        },
        actorRef: req.auth.actorRef,
      });
    }

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
    const patch = {};

    assignIfPresent(patch, req.body, "estimatedValue");
    assignIfPresent(patch, req.body, "nextAction");
    assignIfPresent(patch, req.body, "nextFollowupAt");
    assignIfPresent(patch, req.body, "lossReason");
    assignIfPresent(patch, req.body, "interestSummary");
    assignIfPresent(patch, req.body, "contactName");
    assignIfPresent(patch, req.body, "contactPhone");
    assignIfPresent(patch, req.body, "ownerExternalRef");
    assignIfPresent(patch, req.body, "ownerName");
    assignIfPresent(patch, req.body, "ownerEmail");

    const lead = await updateLead({
      leadId,
      patch,
      actorRef: req.auth.actorRef,
      ownerExternalRef: isOwnScopeRole(req.auth.user?.roleCode) ? req.auth.actorRef : null,
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
      ownerExternalRef: isOwnScopeRole(req.auth.user?.roleCode) ? req.auth.actorRef : null,
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

router.put("/api/leads/:id/tags", requireRoles(["admin", "manager", "agent"]), async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const lead = await setLeadTags({
      leadId,
      tagIds: Array.isArray(req.body.tagIds) ? req.body.tagIds : [],
      origin: String(req.body.origin || "manual").trim(),
      confidence: req.body.confidence ?? null,
      actorRef: req.auth.actorRef,
      ownerExternalRef: isOwnScopeRole(req.auth.user?.roleCode) ? req.auth.actorRef : null,
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

module.exports = router;
