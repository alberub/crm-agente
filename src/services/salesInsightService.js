const { upsertLeadSalesSignals } = require("../repositories/leadRepository");

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function resolveSalesStageCode({ conversation, latestOrder, userCorpus }) {
  const state = normalize(conversation?.estado);
  const orderState = normalize(latestOrder?.estado);

  if (
    orderState.includes("confirm") ||
    orderState.includes("pag") ||
    state.includes("pedido_confirmado") ||
    state.includes("compra_completada") ||
    state.includes("pago_confirmado")
  ) {
    return "venta_cerrada";
  }

  if (
    userCorpus.includes("ya quedo") ||
    userCorpus.includes("aqui los espero") ||
    userCorpus.includes("confirmo") ||
    userCorpus.includes("agend") ||
    userCorpus.includes("manana a las")
  ) {
    return "seguimiento";
  }

  if (
    state.includes("esperando_producto") ||
    state.includes("cotizacion") ||
    state.includes("propuesta")
  ) {
    return "cotizacion_enviada";
  }

  if (state.includes("esperando_direccion") || state.includes("seguimiento")) {
    return "seguimiento";
  }

  if (
    userCorpus.includes("precio") ||
    userCorpus.includes("costo") ||
    userCorpus.includes("disponible") ||
    userCorpus.includes("me interesa") ||
    userCorpus.includes("quiero")
  ) {
    return "interesado";
  }

  if (conversation?.totalMensajes > 2 || conversation?.controlOwner !== "bot") {
    return "contactado";
  }

  return "nuevo_lead";
}

function pushReason(reasons, value) {
  if (value && !reasons.includes(value)) {
    reasons.push(value);
  }
}

function pushObjection(objections, value) {
  if (value && !objections.includes(value)) {
    objections.push(value);
  }
}

function includesAny(source, patterns) {
  return patterns.some((pattern) => source.includes(pattern));
}

function scoreMessages({ conversation, context, latestOrder, recentMessages }) {
  const userMessages = (recentMessages || [])
    .filter((message) => normalize(message.rol) === "user")
    .map((message) => normalize(message.mensaje));
  const userCorpus = userMessages.join(" ");
  const latestUserMessage = userMessages.at(-1) || "";
  const reasons = [];
  const objections = [];
  let score = 20;

  if (latestOrder?.total) {
    score += 24;
    pushReason(reasons, "ya existe monto o pedido relacionado");
  }

  if (
    includesAny(userCorpus, [
      "quiero",
      "me interesa",
      "me gusta",
      "lo quiero",
      "mandame",
      "envialo",
      "agendo",
      "confirmo",
    ])
  ) {
    score += 16;
    pushReason(reasons, "expresa interes comercial directo");
  }

  if (
    includesAny(userCorpus, [
      "manana",
      "hoy",
      "a las",
      "para el dia",
      "para manana",
      "hora",
      "direccion",
      "entrega",
    ])
  ) {
    score += 15;
    pushReason(reasons, "ya comparte detalles de agenda o entrega");
  }

  if (
    includesAny(userCorpus, [
      "precio",
      "costo",
      "pago",
      "transferencia",
      "tarjeta",
      "deposito",
      "disponible",
      "catalogo",
    ])
  ) {
    score += 12;
    pushReason(reasons, "pregunta por pago, precio o disponibilidad");
  }

  if (
    includesAny(latestUserMessage, [
      "gracias",
      "perfecto",
      "ok",
      "si",
      "sale",
      "aqui los espero",
      "entonces",
    ])
  ) {
    score += 10;
    pushReason(reasons, "el ultimo mensaje sugiere avance positivo");
  }

  if (context?.timing?.pendingHumanReply) {
    score += 8;
    pushReason(reasons, "esta esperando respuesta del asesor");
  }

  if (conversation?.controlOwner !== "bot") {
    score += 5;
    pushReason(reasons, "ya paso a seguimiento humano");
  }

  if (conversation?.unreadCount > 0) {
    score += 6;
    pushReason(reasons, "hay mensajes pendientes de atender");
  }

  if (
    includesAny(userCorpus, [
      "caro",
      "muy caro",
      "lo voy a pensar",
      "te aviso",
      "despues",
      "luego",
      "consultarlo",
      "consultar",
      "comparar",
      "no gracias",
    ])
  ) {
    score -= 16;
    pushObjection(objections, "hay objecion o postergacion");
  }

  if (latestUserMessage.includes("gracias") && !includesAny(userCorpus, ["quiero", "confirmo", "agendo"])) {
    score -= 4;
    pushObjection(objections, "cierre conversacional ambiguo");
  }

  const salesStageCode = resolveSalesStageCode({
    conversation,
    latestOrder,
    userCorpus,
  });

  if (salesStageCode === "venta_cerrada") {
    score = 95;
    pushReason(reasons, "venta practicamente cerrada");
  } else if (salesStageCode === "seguimiento") {
    score += 10;
    pushReason(reasons, "ya esta en seguimiento comercial");
  } else if (salesStageCode === "cotizacion_enviada") {
    score += 8;
    pushReason(reasons, "ya hubo propuesta o cotizacion");
  }

  score = Math.max(0, Math.min(Math.round(score), 100));

  let band = "Bajo";

  if (score >= 70) {
    band = "Alto";
  } else if (score >= 45) {
    band = "Medio";
  }

  let nextAction = "Calificar mejor la necesidad del prospecto y proponer siguiente paso claro.";

  if (salesStageCode === "seguimiento") {
    nextAction = "Confirmar detalles pendientes y empujar cierre de la oportunidad.";
  } else if (salesStageCode === "cotizacion_enviada") {
    nextAction = "Dar seguimiento a la propuesta y resolver objeciones para cerrar.";
  } else if (salesStageCode === "venta_cerrada") {
    nextAction = "Mantener seguimiento postventa y abrir puerta a recompra.";
  } else if (objections.length) {
    nextAction = "Responder objeciones puntuales y recuperar impulso comercial.";
  }

  return {
    score,
    band,
    reasons: reasons.slice(0, 4),
    objections: objections.slice(0, 3),
    salesStageCode,
    nextAction,
  };
}

async function buildConversationSalesSnapshot({
  conversation,
  context,
  latestOrder,
  recentMessages,
  persist = true,
}) {
  const scored = scoreMessages({
    conversation,
    context,
    latestOrder,
    recentMessages,
  });

  const snapshot = {
    aiScore: scored.score,
    aiScoreBand: scored.band,
    aiScoreReasons: scored.reasons,
    salesStageCode: scored.salesStageCode,
    objections: scored.objections,
    nextAction: scored.nextAction,
    estimatedValue:
      typeof latestOrder?.total === "number" && latestOrder.total > 0 ? latestOrder.total : null,
  };

  if (persist) {
    await upsertLeadSalesSignals({
      conversationId: conversation.id,
      contactId: conversation.clienteId,
      salesStageCode: snapshot.salesStageCode,
      estimatedValue: snapshot.estimatedValue,
      aiScore: snapshot.aiScore,
      aiScoreReasons: snapshot.aiScoreReasons,
      intentLabel: conversation.intencionNombre,
      interestSummary: conversation.categoriaNombre,
      objections: snapshot.objections,
      nextAction: snapshot.nextAction,
      lastActivityAt: conversation.ultimaInteraccion,
      status: conversation.activa ? "active" : "archived",
    });
  }

  return snapshot;
}

module.exports = {
  buildConversationSalesSnapshot,
};
