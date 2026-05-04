const db = require("../db");
const { serializeDbTimestamp } = require("../utils/datetime");

function toNumberOrNull(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function mapSentiment(row) {
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    leadId: row.lead_id === null || row.lead_id === undefined ? null : Number(row.lead_id),
    messageId: row.message_id === null || row.message_id === undefined ? null : Number(row.message_id),
    polarity: row.polarity,
    emotion: row.emotion || null,
    score: toNumberOrNull(row.score),
    intensity: toNumberOrNull(row.intensity),
    confidence: toNumberOrNull(row.confidence),
    suggestedBotAction: row.suggested_bot_action || null,
    reason: row.reason || null,
    source: row.source || null,
    model: row.model || null,
    createdAt: serializeDbTimestamp(row.created_at),
  };
}

async function findLatestSentimentByConversationId(conversationId) {
  const result = await db.query(
    `
      SELECT
        id,
        conversation_id,
        lead_id,
        message_id,
        polarity,
        emotion,
        score,
        intensity,
        confidence,
        suggested_bot_action,
        reason,
        source,
        model,
        created_at
      FROM public.sentimiento_conversacion
      WHERE conversation_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [conversationId]
  );

  return mapSentiment(result.rows[0]);
}

function sentimentChanged(previous, nextAnalysis) {
  if (!previous) {
    return true;
  }

  return (
    previous.messageId !== (nextAnalysis.messageId ?? null) ||
    previous.polarity !== nextAnalysis.polarity ||
    previous.emotion !== nextAnalysis.emotion ||
    previous.suggestedBotAction !== nextAnalysis.suggestedBotAction ||
    previous.reason !== nextAnalysis.reason
  );
}

async function saveSentimentAnalysis({
  conversationId,
  leadId = null,
  messageId = null,
  polarity,
  emotion = null,
  score = null,
  intensity = null,
  confidence = null,
  suggestedBotAction = null,
  reason = null,
  source = "heuristic",
  model = "salesInsightService.v1",
}) {
  const previous = await findLatestSentimentByConversationId(conversationId);
  const nextAnalysis = {
    messageId,
    polarity,
    emotion,
    suggestedBotAction,
    reason,
  };

  if (!sentimentChanged(previous, nextAnalysis)) {
    return previous;
  }

  const result = await db.query(
    `
      INSERT INTO public.sentimiento_conversacion (
        conversation_id,
        lead_id,
        message_id,
        polarity,
        emotion,
        score,
        intensity,
        confidence,
        suggested_bot_action,
        reason,
        source,
        model
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING
        id,
        conversation_id,
        lead_id,
        message_id,
        polarity,
        emotion,
        score,
        intensity,
        confidence,
        suggested_bot_action,
        reason,
        source,
        model,
        created_at
    `,
    [
      conversationId,
      leadId,
      messageId,
      polarity,
      emotion,
      score,
      intensity,
      confidence,
      suggestedBotAction,
      reason,
      source,
      model,
    ]
  );

  if (leadId) {
    await db.query(
      `
        UPDATE public.lead
        SET sentiment = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [leadId, polarity]
    );
  }

  return mapSentiment(result.rows[0]);
}

module.exports = {
  findLatestSentimentByConversationId,
  saveSentimentAnalysis,
};
