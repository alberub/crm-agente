const express = require("express");
const { requireRoles } = require("../middlewares/authentication");
const {
  getInbox,
  getConversationDetail,
  getConversationMessages,
  sendManualReply,
  changeConversationState,
  getConversationStates,
  markConversationAsRead,
  takeOverConversation,
  releaseConversation,
} = require("../services/whatsappInboxService");
const { addClient } = require("../services/realtimeService");
const { AppError } = require("../utils/errors");

const router = express.Router();

router.get("/api/whatsapp/stream", (req, res, next) => {
  try {
    const rawConversationId = req.query.conversationId;
    const conversationId =
      rawConversationId === undefined ? null : Number(rawConversationId);

    if (
      rawConversationId !== undefined &&
      (!Number.isInteger(conversationId) || conversationId <= 0)
    ) {
      throw new AppError("ID de conversacion invalido.", 400);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    addClient({ res, conversationId });
  } catch (error) {
    next(error);
  }
});

router.get("/api/whatsapp/conversations", async (req, res, next) => {
  try {
    const activeOnly =
      req.query.active === undefined
        ? undefined
        : String(req.query.active).toLowerCase() === "true";
    const unreadOnly = String(req.query.unread || "").toLowerCase() === "true";

    const conversations = await getInbox({
      agentId: req.auth.actorRef,
      search: String(req.query.search || ""),
      activeOnly,
      unreadOnly,
      limit: req.query.limit,
    });

    res.status(200).json({ conversations });
  } catch (error) {
    next(error);
  }
});

router.get("/api/whatsapp/conversations/:id", async (req, res, next) => {
  try {
    const conversationId = Number(req.params.id);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new AppError("ID de conversacion invalido.", 400);
    }

    const detail = await getConversationDetail(
      conversationId,
      req.query.messageLimit,
      req.auth.actorRef
    );
    res.status(200).json(detail);
  } catch (error) {
    next(error);
  }
});

router.post("/api/whatsapp/conversations/:id/read", async (req, res, next) => {
  try {
    const conversationId = Number(req.params.id);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new AppError("ID de conversacion invalido.", 400);
    }

    const conversation = await markConversationAsRead({
      conversationId,
      agentId: req.auth.actorRef,
      lastReadMessageId: req.body.lastReadMessageId ?? null,
    });

    res.status(200).json({ conversation });
  } catch (error) {
    next(error);
  }
});

router.get("/api/whatsapp/conversations/:id/messages", async (req, res, next) => {
  try {
    const conversationId = Number(req.params.id);

    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      throw new AppError("ID de conversacion invalido.", 400);
    }

    const messages = await getConversationMessages(conversationId, req.query.limit);
    res.status(200).json({ messages });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/api/whatsapp/conversations/:id/state",
  requireRoles(["admin", "manager", "agent"]),
  async (req, res, next) => {
    try {
      const conversationId = Number(req.params.id);
      const stateName = String(req.body.state || "").trim();

      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        throw new AppError("ID de conversacion invalido.", 400);
      }

      if (!stateName) {
        throw new AppError("Debes enviar un estado de conversacion.", 400);
      }

      const conversation = await changeConversationState({
        conversationId,
        stateName,
      });

      res.status(200).json({ conversation });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/whatsapp/conversations/:id/takeover",
  requireRoles(["admin", "manager", "agent"]),
  async (req, res, next) => {
    try {
      const conversationId = Number(req.params.id);

      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        throw new AppError("ID de conversacion invalido.", 400);
      }

      const response = await takeOverConversation({
        conversationId,
        humanAgentId: req.body.humanAgentId ?? req.auth.actorRef,
      });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/whatsapp/conversations/:id/release",
  requireRoles(["admin", "manager", "agent"]),
  async (req, res, next) => {
    try {
      const conversationId = Number(req.params.id);

      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        throw new AppError("ID de conversacion invalido.", 400);
      }

      const response = await releaseConversation({ conversationId });

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/api/whatsapp/conversations/:id/messages",
  requireRoles(["admin", "manager", "agent"]),
  async (req, res, next) => {
    try {
      const conversationId = Number(req.params.id);
      const body = String(req.body.body || "").trim();
      const agentId = req.auth.actorRef;

      if (!Number.isInteger(conversationId) || conversationId <= 0) {
        throw new AppError("ID de conversacion invalido.", 400);
      }

      if (!body) {
        throw new AppError("Debes enviar el texto del mensaje.", 400);
      }

      const response = await sendManualReply({
        conversationId,
        body,
        humanAgentId: req.body.humanAgentId ?? agentId,
        notifyCustomer: req.body.notifyCustomer !== false,
        takeOver: req.body.takeOver !== false,
        agentId,
      });

      res.status(201).json(response);
    } catch (error) {
      next(error);
    }
  }
);

router.get("/api/whatsapp/states", async (_req, res, next) => {
  try {
    const states = await getConversationStates();
    res.status(200).json({ states });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
