const {
  findLeadByConversationId,
  upsertLeadSalesSignals,
} = require("../repositories/leadRepository");
const {
  findLatestSentimentByConversationId,
  saveSentimentAnalysis,
} = require("../repositories/conversationSentimentRepository");

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function hasPurchaseConfirmationText(value) {
  const normalized = normalize(value);

  return (
    normalized.includes("gracias por tu compra") ||
    normalized.includes("tu pedido ha sido registrado correctamente") ||
    normalized.includes("tu pedido ya quedo confirmado")
  );
}

function normalizePaymentMethod(value) {
  const normalized = normalize(value);

  if (
    normalized.includes("contraentrega") ||
    normalized.includes("contra entrega") ||
    normalized.includes("al recibir") ||
    normalized.includes("efectivo")
  ) {
    return "contraentrega";
  }

  if (
    normalized.includes("transferencia") ||
    normalized.includes("deposito") ||
    normalized.includes("transfer")
  ) {
    return "transferencia";
  }

  return normalized;
}

function normalizeDeliveryType(value) {
  const normalized = normalize(value);

  if (
    normalized.includes("sucursal") ||
    normalized.includes("pickup") ||
    normalized.includes("recoger") ||
    normalized.includes("recoleccion")
  ) {
    return "sucursal";
  }

  if (
    normalized.includes("domicilio") ||
    normalized.includes("entrega") ||
    normalized.includes("envio")
  ) {
    return "domicilio";
  }

  return normalized;
}

function normalizePaymentStatus(value, latestOrder) {
  const normalized = normalize(value);

  if (normalized) {
    return normalized;
  }

  return normalizePaymentMethod(latestOrder?.metodoPago) === "contraentrega"
    ? "pendiente_contraentrega"
    : "";
}

function normalizeDeliveryStatus(latestOrder) {
  return normalize(latestOrder?.estatusEntrega || latestOrder?.estado);
}

function resolveSalesStageCode({ conversation, latestOrder, userCorpus, botCorpus }) {
  const state = normalize(conversation?.estado);
  const orderState = normalize(latestOrder?.estado);
  const deliveryType = normalizeDeliveryType(latestOrder?.tipoEntrega);
  const paymentMethod = normalizePaymentMethod(latestOrder?.metodoPago);
  const paymentStatus = normalizePaymentStatus(latestOrder?.estadoPago, latestOrder);
  const deliveryStatus = normalizeDeliveryStatus(latestOrder);

  if (includesAny(deliveryStatus, ["entregado", "entrega_completada", "completado"])) {
    return "entregado";
  }

  if (includesAny(deliveryStatus, ["ruta", "camino"])) {
    return "en_ruta";
  }

  if (includesAny(deliveryStatus, ["fallida", "reprogram", "incidencia"])) {
    return "entrega_fallida";
  }

  if (includesAny(deliveryStatus, ["prepar", "alist"])) {
    return "preparando_entrega";
  }

  // Respect explicit CRM/manual conversation states before falling back
  // to softer inference from message text.
  if (includesAny(state, ["entregado", "entrega_completada", "completado", "recogido"])) {
    return "entregado";
  }

  if (includesAny(state, ["en_ruta", "en ruta", "camino"])) {
    return "en_ruta";
  }

  if (includesAny(state, ["preparando_entrega", "preparacion", "alistando", "pendiente_recoleccion", "listo_para_recoger"])) {
    return "preparando_entrega";
  }

  if (includesAny(state, ["pedido_confirmado", "pago_confirmado", "compra_completada"])) {
    return "pedido_confirmado";
  }

  if (includesAny(state, ["validando_pago", "pago_en_revision", "pago_reportado"])) {
    return "validando_pago";
  }

  if (includesAny(state, ["pendiente_comprobante", "pago_pendiente", "pendiente_pago"])) {
    return "pendiente_comprobante";
  }

  if (
    includesAny(paymentStatus, ["confirmado", "validado", "cobrado_al_entregar"]) ||
    includesAny(orderState, ["confirmado", "pagado"]) ||
    state.includes("pedido_confirmado") ||
    state.includes("pago_confirmado")
  ) {
    return "pedido_confirmado";
  }

  if (includesAny(paymentStatus, ["validando", "revision"])) {
    return "validando_pago";
  }

  if (
    paymentMethod === "transferencia" &&
    (includesAny(paymentStatus, ["pendiente", "comprobante"]) || latestOrder?.comprobantePagoUrl)
  ) {
    return "pendiente_comprobante";
  }

  if (
    userCorpus.includes("ya quedo") ||
    userCorpus.includes("aqui los espero") ||
    userCorpus.includes("confirmo") ||
    userCorpus.includes("agend") ||
    userCorpus.includes("manana a las")
  ) {
    return "esperando_confirmacion";
  }

  if (
    state.includes("esperando_producto") ||
    state.includes("cotizacion") ||
    state.includes("propuesta")
  ) {
    return "cotizacion_enviada";
  }

  if (
    state.includes("esperando_direccion") ||
    state.includes("seguimiento") ||
    state.includes("esperando_confirmacion") ||
    hasPurchaseConfirmationText(botCorpus) ||
    hasPurchaseConfirmationText(conversation?.ultimoMensaje)
  ) {
    return deliveryType === "domicilio" && paymentMethod === "contraentrega"
      ? "pedido_confirmado"
      : "esperando_confirmacion";
  }

  if (state.includes("cancelado") || state.includes("perdido")) {
    return "cancelado";
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

function hasAny(source, patterns) {
  return patterns.some((pattern) => source.includes(pattern));
}

function isCustomerMessage(message) {
  return normalize(message?.rol) === "user";
}

function isBotMessage(message) {
  return normalize(message?.rol) === "bot";
}

function normalizeCustomerMessages(messages) {
  return (messages || [])
    .map((message, index) => ({
      id: Number(message.id),
      index,
      role: normalize(message.rol),
      text: normalize(message.mensaje),
      rawText: String(message.mensaje || "").trim(),
    }))
    .filter((message) => message.role === "user" && message.text);
}

function findLatestPurchaseMilestoneIndex(messages) {
  let latestIndex = -1;

  for (const [index, message] of (messages || []).entries()) {
    if (isBotMessage(message) && hasPurchaseConfirmationText(message.mensaje)) {
      latestIndex = index;
    }
  }

  return latestIndex;
}

function buildPurchaseConfirmedSentiment(messageId = null) {
  return {
    messageId,
    polarity: "positive",
    emotion: "compra_confirmada",
    score: 0.82,
    intensity: 0.72,
    confidence: 0.84,
    suggestedBotAction: "continue",
    reason: "La compra fue confirmada y no hay mensajes negativos posteriores del cliente.",
  };
}

function analyzeCustomerSentimentWindow(customerMessages, { fallbackToPurchaseConfirmed = false } = {}) {
  const latestCustomerMessage = customerMessages.at(-1) || null;
  const activeMessages = customerMessages.slice(-5);
  const activeCorpus = activeMessages.map((message) => message.text).join(" ");

  if (!latestCustomerMessage) {
    return fallbackToPurchaseConfirmed
      ? buildPurchaseConfirmedSentiment(null)
      : {
          messageId: null,
          polarity: "neutral",
          emotion: "sin_senal",
          score: 0,
          intensity: 0,
          confidence: 0.4,
          suggestedBotAction: "continue",
          reason: "Aun no hay mensajes del cliente para inferir sentimiento.",
        };
  }

  const latestText = latestCustomerMessage.text;
  const messageId = latestCustomerMessage.id;
  const negativeStrong = [
    "no me escriban",
    "dejen de escribir",
    "no insistan",
    "no molesten",
    "ya dije que no",
    "estoy molesto",
    "estoy enojado",
    "me moleste",
    "me enoje",
    "pesimo",
    "mala atencion",
    "mal servicio",
    "queja",
    "reclamo",
    "cancelar",
    "cancela",
    "spam",
  ];
  const negativeSoft = [
    "no gracias",
    "muy caro",
    "caro",
    "lo voy a pensar",
    "te aviso",
    "despues",
    "luego",
    "no me interesa",
    "no quiero",
    "no puedo",
    "no era",
    "tarde",
    "no respondieron",
  ];
  const confused = [
    "no entiendo",
    "duda",
    "confundido",
    "como funciona",
    "cual es",
    "no se",
  ];
  const positiveStrong = [
    "perfecto",
    "excelente",
    "me encanta",
    "lo quiero",
    "confirmo",
    "agendo",
    "gracias",
    "muchas gracias",
    "sale",
    "ok",
    "si todo",
  ];

  if (hasAny(latestText, negativeStrong) || hasAny(activeCorpus, negativeStrong)) {
    return {
      messageId,
      polarity: "negative",
      emotion: "molesto",
      score: -0.85,
      intensity: 0.9,
      confidence: 0.86,
      suggestedBotAction: "human_review",
      reason: "El cliente muestra molestia, rechazo fuerte o una posible queja en los mensajes recientes.",
    };
  }

  if (hasAny(latestText, negativeSoft) || hasAny(activeCorpus, negativeSoft)) {
    const isPriceObjection = hasAny(activeCorpus, ["caro", "muy caro", "precio"]);

    return {
      messageId,
      polarity: "negative",
      emotion: isPriceObjection ? "objecion_precio" : "rechazo_suave",
      score: isPriceObjection ? -0.48 : -0.58,
      intensity: isPriceObjection ? 0.58 : 0.68,
      confidence: 0.78,
      suggestedBotAction: "soft_followup",
      reason: isPriceObjection
        ? "Hay objecion reciente de precio; el seguimiento debe ser suave y sin mas presion."
        : "El cliente muestra rechazo o postergacion en los mensajes recientes.",
    };
  }

  if (hasAny(latestText, confused)) {
    return {
      messageId,
      polarity: "neutral",
      emotion: "confundido",
      score: -0.12,
      intensity: 0.48,
      confidence: 0.72,
      suggestedBotAction: "continue",
      reason: "El cliente parece necesitar aclaracion; conviene responder la duda antes de empujar cierre.",
    };
  }

  if (hasAny(latestText, positiveStrong)) {
    return {
      messageId,
      polarity: "positive",
      emotion: "receptivo",
      score: 0.62,
      intensity: 0.58,
      confidence: 0.74,
      suggestedBotAction: "continue",
      reason: "El ultimo mensaje del cliente sugiere apertura o avance positivo.",
    };
  }

  return fallbackToPurchaseConfirmed
    ? buildPurchaseConfirmedSentiment(messageId)
    : {
        messageId,
        polarity: "neutral",
        emotion: "sin_senal_clara",
        score: 0,
        intensity: 0.28,
        confidence: 0.62,
        suggestedBotAction: "continue",
        reason: "No hay senales emocionales fuertes en los mensajes recientes del cliente.",
      };
}

function resolveCustomerSentiment({ recentMessages, salesStageCode }) {
  const normalizedMessages = Array.isArray(recentMessages) ? recentMessages : [];
  const customerMessages = normalizeCustomerMessages(normalizedMessages);
  const purchaseMilestoneIndex = findLatestPurchaseMilestoneIndex(normalizedMessages);
  const isClosedPurchase = salesStageCode === "pedido_confirmado" || salesStageCode === "entregado";

  if (purchaseMilestoneIndex >= 0) {
    const postPurchaseCustomerMessages = customerMessages.filter(
      (message) => message.index > purchaseMilestoneIndex
    );

    if (!postPurchaseCustomerMessages.length) {
      const previousCustomerMessage = customerMessages.at(-1) || null;
      return buildPurchaseConfirmedSentiment(previousCustomerMessage?.id || null);
    }

    return analyzeCustomerSentimentWindow(postPurchaseCustomerMessages, {
      fallbackToPurchaseConfirmed: true,
    });
  }

  if (isClosedPurchase) {
    return analyzeCustomerSentimentWindow(customerMessages, {
      fallbackToPurchaseConfirmed: true,
    });
  }

  return analyzeCustomerSentimentWindow(customerMessages);
}

function scoreMessages({ conversation, context, latestOrder, recentMessages }) {
  const userMessages = (recentMessages || [])
    .filter((message) => normalize(message.rol) === "user")
    .map((message) => normalize(message.mensaje));
  const botMessages = (recentMessages || [])
    .filter((message) => normalize(message.rol) === "bot")
    .map((message) => normalize(message.mensaje));
  const userCorpus = userMessages.join(" ");
  const botCorpus = botMessages.join(" ");
  const latestUserMessage = userMessages.at(-1) || "";
  const latestPreview = normalize(conversation?.ultimoMensaje);
  const deliveryType = normalizeDeliveryType(latestOrder?.tipoEntrega);
  const paymentMethod = normalizePaymentMethod(latestOrder?.metodoPago);
  const paymentStatus = normalizePaymentStatus(latestOrder?.estadoPago, latestOrder);
  const deliveryStatus = normalizeDeliveryStatus(latestOrder);
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

  if (deliveryType === "domicilio" && paymentMethod === "contraentrega") {
    score += 8;
    pushReason(reasons, "acepta pago contraentrega");
  }

  if (latestOrder?.comprobantePagoUrl) {
    score += 10;
    pushReason(reasons, "ya envio comprobante");
  }

  if (includesAny(paymentStatus, ["validando", "revision"])) {
    score += 12;
    pushReason(reasons, "pago en validacion");
  }

  if (includesAny(paymentStatus, ["confirmado", "validado", "cobrado_al_entregar"])) {
    score += 14;
    pushReason(reasons, "pago resuelto");
  }

  if (includesAny(deliveryStatus, ["prepar", "alist"])) {
    score += 8;
    pushReason(reasons, "pedido en preparacion");
  }

  if (includesAny(deliveryStatus, ["ruta", "camino"])) {
    score += 12;
    pushReason(reasons, "pedido en ruta");
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
    botCorpus,
  });

  if (salesStageCode === "entregado") {
    score = 100;
    objections.length = 0;
    pushReason(reasons, "pedido entregado");
  } else if (salesStageCode === "pedido_confirmado") {
    score = 95;
    pushReason(reasons, "pedido ya confirmado");
    objections.length = 0;
  } else if (salesStageCode === "esperando_confirmacion") {
    score += 10;
    pushReason(reasons, "ya esta en seguimiento comercial");
  } else if (salesStageCode === "cotizacion_enviada") {
    score += 8;
    pushReason(reasons, "ya hubo propuesta o cotizacion");
  } else if (salesStageCode === "entrega_fallida" || salesStageCode === "cancelado") {
    score = Math.min(score, 35);
  }

  if (
    paymentMethod === "transferencia" &&
    includesAny(paymentStatus, ["pendiente", "comprobante"]) &&
    !latestOrder?.comprobantePagoUrl
  ) {
    pushObjection(objections, "falta comprobante de pago");
  }

  if (
    deliveryType === "domicilio" &&
    paymentMethod === "contraentrega" &&
    !latestOrder?.direccionValidada
  ) {
    pushObjection(objections, "falta validar direccion para contraentrega");
  }

  score = Math.max(0, Math.min(Math.round(score), 100));

  let band = "Bajo";

  if (score >= 70) {
    band = "Alto";
  } else if (score >= 45) {
    band = "Medio";
  }

  let nextAction = "Calificar mejor la necesidad del prospecto y proponer siguiente paso claro.";

  if (salesStageCode === "esperando_confirmacion") {
    nextAction = "Confirmar datos de entrega, forma de pago y siguiente paso para cerrar.";
  } else if (salesStageCode === "pendiente_comprobante") {
    nextAction = "Solicitar comprobante y no confirmar el pedido hasta validar el pago.";
  } else if (salesStageCode === "validando_pago") {
    nextAction = "Validar el comprobante y avisar al cliente apenas el pago quede confirmado.";
  } else if (salesStageCode === "pedido_confirmado") {
    nextAction =
      deliveryType === "sucursal"
        ? "Confirmar sucursal, horario de recoleccion y pago antes de cerrar el caso."
        : paymentMethod === "contraentrega"
        ? "Confirmar direccion, horario y monto a cobrar al recibir."
        : "Pasar el pedido a preparacion y asegurar trazabilidad de entrega.";
  } else if (salesStageCode === "preparando_entrega") {
    nextAction = "Coordinar preparacion, ventana de entrega y aviso preventivo al cliente.";
  } else if (salesStageCode === "en_ruta") {
    nextAction = "Mantener seguimiento de ruta y confirmar recepcion con el cliente.";
  } else if (salesStageCode === "entregado") {
    nextAction = "Cerrar el caso, confirmar cobro final y abrir oportunidad de recompra.";
  } else if (salesStageCode === "entrega_fallida") {
    nextAction = "Resolver la incidencia de entrega y reprogramar con el cliente cuanto antes.";
  } else if (salesStageCode === "cotizacion_enviada") {
    nextAction = "Dar seguimiento a la propuesta y resolver objeciones para cerrar.";
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
  const persistedLead = conversation?.id
    ? await findLeadByConversationId(conversation.id)
    : null;
  const sentimentSnapshot = resolveCustomerSentiment({
    recentMessages,
    salesStageCode: snapshot.salesStageCode,
  });
  let currentSentiment = conversation?.sentiment || null;
  const resolvedSnapshot = {
    aiScore:
      typeof persistedLead?.aiScore === "number" ? persistedLead.aiScore : snapshot.aiScore,
    aiScoreBand: snapshot.aiScoreBand,
    aiScoreReasons:
      Array.isArray(persistedLead?.aiScoreReasons) && persistedLead.aiScoreReasons.length
        ? persistedLead.aiScoreReasons
        : snapshot.aiScoreReasons,
    salesStageCode: persistedLead?.salesStage?.code || snapshot.salesStageCode,
    objections:
      Array.isArray(persistedLead?.objections) && persistedLead.objections.length
        ? persistedLead.objections
        : snapshot.objections,
    nextAction: persistedLead?.nextAction || snapshot.nextAction,
    estimatedValue:
      typeof persistedLead?.estimatedValue === "number"
        ? persistedLead.estimatedValue
        : snapshot.estimatedValue,
    sentiment: currentSentiment || sentimentSnapshot,
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

    const leadAfterPersist = await findLeadByConversationId(conversation.id);
    currentSentiment = await saveSentimentAnalysis({
      conversationId: conversation.id,
      leadId: leadAfterPersist?.id || persistedLead?.id || null,
      ...sentimentSnapshot,
    });
    resolvedSnapshot.sentiment = currentSentiment || sentimentSnapshot;
  } else if (!currentSentiment && conversation?.id) {
    currentSentiment = await findLatestSentimentByConversationId(conversation.id);
    resolvedSnapshot.sentiment = currentSentiment || sentimentSnapshot;
  }

  return resolvedSnapshot;
}

module.exports = {
  buildConversationSalesSnapshot,
};
