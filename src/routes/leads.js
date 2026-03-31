const express = require("express");
const {
  ensureLeadByConversationId,
  listLeads,
  findLeadById,
  updateLead,
  createLeadTask,
  listLeadTasks,
  createLeadNote,
  listLeadNotes,
  createPaymentLink,
  listPaymentLinks,
  listLeadTimeline,
} = require("../repositories/leadRepository");
const { AppError } = require("../utils/errors");

const router = express.Router();

function readActorRef(req) {
  const headerAgentId = req.header("x-agent-id");
  const queryAgentId = req.query.agentId;
  const bodyAgentId = req.body?.agentId;

  return String(headerAgentId || queryAgentId || bodyAgentId || "").trim() || null;
}

function parseLeadId(value) {
  const leadId = Number(value);

  if (!Number.isInteger(leadId) || leadId <= 0) {
    throw new AppError("ID de lead invalido.", 400);
  }

  return leadId;
}

router.get("/api/leads", async (req, res, next) => {
  try {
    const leads = await listLeads({
      search: String(req.query.search || ""),
      stageCode: String(req.query.stageCode || "").trim() || null,
      status: String(req.query.status || "").trim() || null,
      ownerExternalRef: String(req.query.owner || "").trim() || null,
      followupDueOnly: String(req.query.followupDue || "").toLowerCase() === "true",
      limit: req.query.limit,
    });

    res.status(200).json({ leads });
  } catch (error) {
    if (error.message === "INVALID_STAGE_CODE") {
      next(new AppError("stageCode no existe en sales_stage.", 400));
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

    const [tasks, notes, paymentLinks, timeline] = await Promise.all([
      listLeadTasks(leadId),
      listLeadNotes(leadId),
      listPaymentLinks(leadId),
      listLeadTimeline(leadId),
    ]);

    res.status(200).json({
      lead,
      tasks,
      notes,
      paymentLinks,
      timeline,
    });
  } catch (error) {
    if (error.message === "INVALID_STAGE_CODE") {
      next(new AppError("stageCode no existe en sales_stage.", 400));
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
    next(error);
  }
});

router.patch("/api/leads/:id", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const lead = await updateLead({
      leadId,
      patch: {
        stageCode: req.body.stageCode,
        ownerExternalRef: req.body.ownerExternalRef,
        ownerName: req.body.ownerName,
        ownerEmail: req.body.ownerEmail,
        priority: req.body.priority,
        estimatedValue: req.body.estimatedValue,
        nextAction: req.body.nextAction,
        nextFollowupAt: req.body.nextFollowupAt,
        status: req.body.status,
        lossReason: req.body.lossReason,
      },
      actorRef: readActorRef(req),
    });

    if (!lead) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(200).json({ lead });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/leads/:id/stage", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const stageCode = String(req.body.stageCode || "").trim();

    if (!stageCode) {
      throw new AppError("Debes enviar stageCode.", 400);
    }

    const lead = await updateLead({
      leadId,
      patch: { stageCode },
      actorRef: readActorRef(req),
    });

    if (!lead) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(200).json({ lead });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/leads/:id/owner", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const ownerExternalRef = String(req.body.ownerExternalRef || "").trim();

    if (!ownerExternalRef) {
      throw new AppError("Debes enviar ownerExternalRef.", 400);
    }

    const lead = await updateLead({
      leadId,
      patch: {
        ownerExternalRef,
        ownerName: req.body.ownerName,
        ownerEmail: req.body.ownerEmail,
      },
      actorRef: readActorRef(req),
    });

    if (!lead) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(200).json({ lead });
  } catch (error) {
    next(error);
  }
});

router.post("/api/leads/:id/tasks", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const title = String(req.body.title || "").trim();

    if (!title) {
      throw new AppError("Debes enviar el titulo de la tarea.", 400);
    }

    const task = await createLeadTask({
      leadId,
      title,
      description: req.body.description || null,
      dueAt: req.body.dueAt || null,
      assignedToExternalRef: req.body.assignedToExternalRef || null,
      assignedToName: req.body.assignedToName || null,
      createdByExternalRef: readActorRef(req),
      createdByName: req.body.createdByName || null,
    });

    res.status(201).json({ task });
  } catch (error) {
    next(error);
  }
});

router.get("/api/leads/:id/tasks", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const tasks = await listLeadTasks(leadId);
    res.status(200).json({ tasks });
  } catch (error) {
    next(error);
  }
});

router.post("/api/leads/:id/notes", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const body = String(req.body.body || "").trim();

    if (!body) {
      throw new AppError("Debes enviar la nota interna.", 400);
    }

    const note = await createLeadNote({
      leadId,
      body,
      authorExternalRef: readActorRef(req),
      authorName: req.body.authorName || null,
    });

    if (!note) {
      throw new AppError("Lead no encontrado.", 404);
    }

    res.status(201).json({ note });
  } catch (error) {
    next(error);
  }
});

router.get("/api/leads/:id/notes", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const notes = await listLeadNotes(leadId);
    res.status(200).json({ notes });
  } catch (error) {
    next(error);
  }
});

router.post("/api/leads/:id/payment-links", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const provider = String(req.body.provider || "").trim();
    const url = String(req.body.url || "").trim();
    const amount = Number(req.body.amount);

    if (!provider || !url || Number.isNaN(amount) || amount <= 0) {
      throw new AppError("Debes enviar provider, url y amount validos.", 400);
    }

    const paymentLink = await createPaymentLink({
      leadId,
      provider,
      url,
      amount,
      currency: String(req.body.currency || "MXN").trim() || "MXN",
      externalReference: req.body.externalReference || null,
      status: String(req.body.status || "pending").trim() || "pending",
      createdByExternalRef: readActorRef(req),
      createdByName: req.body.createdByName || null,
    });

    res.status(201).json({ paymentLink });
  } catch (error) {
    next(error);
  }
});

router.get("/api/leads/:id/payment-links", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const paymentLinks = await listPaymentLinks(leadId);
    res.status(200).json({ paymentLinks });
  } catch (error) {
    next(error);
  }
});

router.get("/api/leads/:id/timeline", async (req, res, next) => {
  try {
    const leadId = parseLeadId(req.params.id);
    const timeline = await listLeadTimeline(leadId);
    res.status(200).json({ timeline });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
