const { outboundMessageRole } = require("../config/env");
const {
  listConversations,
  findConversationById,
  listConversationStates,
  updateConversationState,
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

async function sendManualReply({ conversationId, body }) {
  const conversation = await findConversationById(conversationId);

  if (!conversation) {
    throw new AppError("Conversacion no encontrada.", 404);
  }

  if (!conversation.telefonoCliente) {
    throw new AppError(
      "La conversacion no tiene telefono asociado para enviar un mensaje.",
      400
    );
  }

  const metaResponse = await sendWhatsAppTextMessage(
    conversation.telefonoCliente,
    body
  );

  const storedMessage = await saveMessage({
    conversationId,
    role: outboundMessageRole,
    message: body,
  });

  return {
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

module.exports = {
  getInbox,
  getConversationDetail,
  getConversationMessages,
  sendManualReply,
  changeConversationState,
  getConversationStates,
};
