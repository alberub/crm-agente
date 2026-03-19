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
  listMessagesByConversationId,
  saveMessage,
} = require("../repositories/messageRepository");
const { findLatestOrderByConversationId } = require("../repositories/orderRepository");
const { sendWhatsAppTextMessage } = require("./metaService");
const { AppError } = require("../utils/errors");

async function getInbox(filters) {
  return listConversations(filters);
}

async function getConversationDetail(conversationId, messageLimit) {
  const conversation = await findConversationById(conversationId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  const [messages, latestOrder] = await Promise.all([
    listMessagesByConversationId(conversationId, messageLimit),
    findLatestOrderByConversationId(conversationId),
  ]);

  return {
    conversation,
    botEnabled: isBotResponseEnabled(conversation),
    messages,
    latestOrder,
  };
}

async function getConversationMessages(conversationId, limit) {
  const conversation = await findConversationById(conversationId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  return listMessagesByConversationId(conversationId, limit);
}

async function sendManualReply({
  conversationId,
  body,
  humanAgentId = null,
  notifyCustomer = true,
  takeOver = true,
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
        humanAgentId,
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
  takeOverConversation,
  releaseConversation,
};
