const { outboundMessageRole } = require("../config/env");
const {
  listConversations,
  findConversationById,
  listConversationStates,
  updateConversationState,
  takeConversationByHuman,
  resumeConversationByBot,
  isBotResponseEnabled,
} = require("../repositories/conversationRepository");
const {
  upsertConversationRead,
} = require("../repositories/conversationReadRepository");
const {
  listMessagesByConversationId,
  saveMessage,
} = require("../repositories/messageRepository");
const { findLatestOrderByConversationId } = require("../repositories/orderRepository");
const { buildConversationSalesSnapshot } = require("./salesInsightService");
const { sendWhatsAppTextMessage } = require("./metaService");
const { AppError } = require("../utils/errors");
const { serializeDbTimestamp } = require("../utils/datetime");

const HUMAN_MESSAGE_ROLES = new Set(["assistant", "agent", "human", "asesor"]);
const SLA_RULES = {
  humanControlMinutes: 5,
  botControlMinutes: 10,
};

function isValidDate(value) {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return isValidDate(parsed) ? parsed : null;
}

function diffMinutes(from, to = new Date()) {
  if (!from || !isValidDate(from)) {
    return null;
  }

  return Math.max(Math.round((to.getTime() - from.getTime()) / 60000), 0);
}

function resolveMessageRole(message) {
  const role = String(message?.rol || "").trim().toLowerCase();

  if (role === "user") {
    return "customer";
  }

  if (role === "bot") {
    return "bot";
  }

  if (HUMAN_MESSAGE_ROLES.has(role) || role === outboundMessageRole) {
    return "human";
  }

  return "system";
}

function buildConversationContext({ conversation, messages, latestOrder, salesSnapshot = null }) {
  const normalizedMessages = Array.isArray(messages) ? messages : [];
  const lastCustomerMessage =
    [...normalizedMessages].reverse().find((message) => resolveMessageRole(message) === "customer") ||
    null;
  const lastHumanMessage =
    [...normalizedMessages].reverse().find((message) => resolveMessageRole(message) === "human") ||
    null;
  const lastBotMessage =
    [...normalizedMessages].reverse().find((message) => resolveMessageRole(message) === "bot") ||
    null;
  const lastCustomerMessageAt = parseDate(lastCustomerMessage?.fecha);
  const lastHumanMessageAt = parseDate(lastHumanMessage?.fecha);
  const waitingForHumanReply = Boolean(
    lastCustomerMessageAt &&
      (!lastHumanMessageAt || lastCustomerMessageAt.getTime() > lastHumanMessageAt.getTime()) &&
      conversation.controlOwner !== "bot"
  );

  const customerWaitMinutes = waitingForHumanReply
    ? diffMinutes(lastCustomerMessageAt)
    : null;

  let urgency = "low";

  if (customerWaitMinutes !== null && customerWaitMinutes >= 30) {
    urgency = "high";
  } else if (customerWaitMinutes !== null && customerWaitMinutes >= 10) {
    urgency = "medium";
  }

  const slaTargetMinutes =
    conversation.controlOwner === "bot"
      ? SLA_RULES.botControlMinutes
      : SLA_RULES.humanControlMinutes;
  const slaDueAt =
    waitingForHumanReply && lastCustomerMessageAt
      ? new Date(lastCustomerMessageAt.getTime() + slaTargetMinutes * 60000)
      : null;
  const slaRemainingMinutes =
    waitingForHumanReply && slaDueAt
      ? Math.round((slaDueAt.getTime() - Date.now()) / 60000)
      : null;
  const slaBreached =
    waitingForHumanReply && typeof customerWaitMinutes === "number"
      ? customerWaitMinutes > slaTargetMinutes
      : false;
  let slaStatus = "met";

  if (!waitingForHumanReply) {
    slaStatus = "met";
  } else if (slaBreached) {
    slaStatus = "breached";
  } else if (slaRemainingMinutes !== null && slaRemainingMinutes <= 2) {
    slaStatus = "at_risk";
  }

  const stageLabel =
    salesSnapshot?.salesStageCode ||
    conversation.categoriaNombre ||
    conversation.intencionNombre ||
    conversation.estado ||
    "seguimiento_general";

  let summaryHeadline = "Conversacion en seguimiento";

  if (latestOrder?.estado) {
    summaryHeadline = `Pedido ${latestOrder.estado}`;
  } else if (conversation.controlOwner === "bot" && conversation.botEnabled) {
    summaryHeadline = "Bot activo atendiendo el flujo";
  } else if (conversation.controlOwner !== "bot") {
    summaryHeadline = "Conversacion bajo atencion humana";
  }

  let nextSuggestedAction =
    "Mantener el contexto actualizado y confirmar el siguiente paso con el cliente.";

  if (!latestOrder) {
    nextSuggestedAction =
      conversation.controlOwner === "bot"
        ? "Validar si el bot puede seguir el flujo sin friccion o si conviene intervenir."
        : "Responder al cliente, dejar trazabilidad y decidir si el caso vuelve al bot.";
  } else if (waitingForHumanReply) {
    nextSuggestedAction =
      "El cliente espera respuesta humana. Conviene contestar antes de liberar el caso.";
  } else if (latestOrder.estado && String(latestOrder.estado).toLowerCase().includes("pend")) {
    nextSuggestedAction =
      "Confirmar pago, disponibilidad y ventana de entrega antes de continuar.";
  }

  if (salesSnapshot?.nextAction) {
    nextSuggestedAction = salesSnapshot.nextAction;
  }

  return {
    control: {
      owner: conversation.controlOwner,
      botEnabled: Boolean(conversation.botEnabled),
      botPaused: Boolean(conversation.botPaused),
      humanAgentId:
        conversation.humanAgentId === undefined ? null : conversation.humanAgentId,
      humanTakenAt: conversation.humanTakenAt || null,
    },
    timing: {
      lastCustomerMessageAt: lastCustomerMessage?.fecha || null,
      lastHumanMessageAt: lastHumanMessage?.fecha || null,
      lastBotMessageAt: lastBotMessage?.fecha || null,
      customerWaitMinutes,
      pendingHumanReply: waitingForHumanReply,
      urgency,
    },
    sla: {
      targetMinutes: slaTargetMinutes,
      dueAt: serializeDbTimestamp(slaDueAt),
      remainingMinutes: slaRemainingMinutes,
      status: slaStatus,
      breached: slaBreached,
      policyLabel:
        conversation.controlOwner === "bot"
          ? `Respuesta por bot <= ${SLA_RULES.botControlMinutes} min`
          : `Respuesta humana <= ${SLA_RULES.humanControlMinutes} min`,
    },
    summary: {
      headline: summaryHeadline,
      stageLabel,
      hasOrder: Boolean(latestOrder),
      nextSuggestedAction,
    },
  };
}

async function getInbox(filters) {
  const conversations = await listConversations(filters);

  const enrichedConversations = await Promise.all(
    conversations.map(async (conversation) => {
      const [messages, latestOrder] = await Promise.all([
        listMessagesByConversationId(conversation.id, 16),
        findLatestOrderByConversationId(conversation.id),
      ]);
      const context = buildConversationContext({
        conversation,
        messages,
        latestOrder,
      });
      const salesSnapshot = await buildConversationSalesSnapshot({
        conversation,
        context,
        latestOrder,
        recentMessages: messages,
      });

      return {
        ...conversation,
        ...salesSnapshot,
      };
    })
  );

  return enrichedConversations;
}

async function getConversationDetail(conversationId, messageLimit, agentId = null) {
  const conversation = await findConversationById(conversationId, agentId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  const [messages, latestOrder] = await Promise.all([
    listMessagesByConversationId(conversationId, messageLimit),
    findLatestOrderByConversationId(conversationId),
  ]);
  const preliminaryContext = buildConversationContext({
    conversation,
    messages,
    latestOrder,
  });
  const salesSnapshot = await buildConversationSalesSnapshot({
    conversation,
    context: preliminaryContext,
    latestOrder,
    recentMessages: messages,
  });

  return {
    conversation: {
      ...conversation,
      ...salesSnapshot,
    },
    botEnabled: isBotResponseEnabled(conversation),
    messages,
    latestOrder,
    context: buildConversationContext({
      conversation,
      messages,
      latestOrder,
      salesSnapshot,
    }),
  };
}

async function getConversationMessages(conversationId, limit) {
  const conversation = await findConversationById(conversationId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  return listMessagesByConversationId(conversationId, limit);
}

async function markConversationAsRead({
  conversationId,
  agentId,
  lastReadMessageId = null,
}) {
  if (!agentId) {
    throw new AppError("Falta agentId para registrar lectura.", 400);
  }

  const conversation = await findConversationById(conversationId, agentId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  let resolvedLastReadMessageId = lastReadMessageId ? Number(lastReadMessageId) : null;

  if (!resolvedLastReadMessageId) {
    const messages = await listMessagesByConversationId(conversationId, 1);
    resolvedLastReadMessageId = messages.at(-1)?.id ?? null;
  }

  await upsertConversationRead({
    conversationId,
    agentId,
    lastReadMessageId: resolvedLastReadMessageId,
  });

  return findConversationById(conversationId, agentId);
}

async function sendManualReply({
  conversationId,
  body,
  humanAgentId = null,
  notifyCustomer = true,
  takeOver = true,
  agentId = null,
}) {
  const existingConversation = await findConversationById(conversationId);

  if (!existingConversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  if (!existingConversation.telefonoCliente) {
    throw new AppError(
      "La conversacion no tiene telefono asociado para enviar un mensaje.",
      400
    );
  }

  const conversation = takeOver
    ? await takeConversationByHuman({
        conversationId,
        humanAgentId: humanAgentId || agentId,
      })
    : existingConversation;

  let metaResponse = null;

  if (notifyCustomer) {
    metaResponse = await sendWhatsAppTextMessage(conversation.telefonoCliente, body);
  }

  const storedMessage = await saveMessage({
    conversationId,
    role: outboundMessageRole,
    message: body,
  });

  return {
    conversation,
    botEnabled: isBotResponseEnabled(conversation),
    message: storedMessage,
    meta: metaResponse,
    delivery: {
      notifyCustomer,
      takeOver,
      effectiveHumanAgentId:
        conversation.humanAgentId || humanAgentId || agentId || null,
    },
  };
}

async function changeConversationState({ conversationId, stateName }) {
  const updatedConversation = await updateConversationState({
    conversationId,
    stateName,
  });

  if (!updatedConversation) {
    throw new AppError("Estado de conversacion no valido.", 400);
  }

  return updatedConversation;
}

async function getConversationStates() {
  return listConversationStates();
}

async function takeOverConversation({ conversationId, humanAgentId = null }) {
  const conversation = await takeConversationByHuman({
    conversationId,
    humanAgentId,
  });

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  return {
    conversation,
    botEnabled: isBotResponseEnabled(conversation),
  };
}

async function releaseConversation({ conversationId }) {
  const conversation = await resumeConversationByBot(conversationId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  return {
    conversation,
    botEnabled: isBotResponseEnabled(conversation),
  };
}

module.exports = {
  getInbox,
  getConversationDetail,
  getConversationMessages,
  sendManualReply,
  changeConversationState,
  getConversationStates,
  markConversationAsRead,
  takeOverConversation,
  releaseConversation,
};
