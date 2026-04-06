const db = require("../db");
const { serializeDbTimestamp } = require("../utils/datetime");

const EVENT_LABELS = {
  conversation_opened_by_contact: "Conversacion iniciada por el contacto",
  conversation_taken_by_human: "Conversacion tomada por un asesor",
  conversation_released_to_bot: "Conversacion devuelta al bot",
  conversation_state_changed: "Estado de la conversacion actualizado",
  manual_reply_sent: "Respuesta manual enviada",
};

function normalizePayload(value) {
  if (!value) {
    return {};
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function resolveEventLabel(eventCode) {
  return EVENT_LABELS[eventCode] || eventCode;
}

function mapConversationEvent(row) {
  return {
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    eventCode: row.event_code,
    label: resolveEventLabel(row.event_code),
    actorType: row.actor_type || null,
    actorRef: row.actor_ref || null,
    payload: normalizePayload(row.payload_json),
    occurredAt: serializeDbTimestamp(row.occurred_at),
    createdAt: serializeDbTimestamp(row.created_at),
  };
}

async function createConversationEvent({
  conversationId,
  eventCode,
  actorType = null,
  actorRef = null,
  payload = {},
  occurredAt = null,
}) {
  const result = await db.query(
    `
      INSERT INTO public.conversation_event (
        conversation_id,
        event_code,
        actor_type,
        actor_ref,
        payload_json,
        occurred_at
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, COALESCE($6::timestamptz, NOW()))
      RETURNING id, conversation_id, event_code, actor_type, actor_ref, payload_json, occurred_at, created_at
    `,
    [
      conversationId,
      eventCode,
      actorType,
      actorRef,
      JSON.stringify(payload || {}),
      occurredAt,
    ]
  );

  return mapConversationEvent(result.rows[0]);
}

async function listConversationEventsByConversationId(conversationId, limit = 200) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 1000);
  const result = await db.query(
    `
      SELECT id, conversation_id, event_code, actor_type, actor_ref, payload_json, occurred_at, created_at
      FROM public.conversation_event
      WHERE conversation_id = $1
      ORDER BY occurred_at ASC, id ASC
      LIMIT $2
    `,
    [conversationId, safeLimit]
  );

  return result.rows.map(mapConversationEvent);
}

module.exports = {
  createConversationEvent,
  listConversationEventsByConversationId,
  resolveEventLabel,
};
