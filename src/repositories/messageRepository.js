const db = require("../db");
const { serializeDbTimestamp } = require("../utils/datetime");

function mapMessage(row) {
  return {
    id: Number(row.id),
    conversacionId: Number(row.conversacion_id),
    rol: row.rol,
    mensaje: row.mensaje,
    fecha: serializeDbTimestamp(row.fecha),
  };
}

async function listMessagesByConversationId(conversationId, limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 500);

  const result = await db.query(
    `
      SELECT id, conversacion_id, rol, mensaje, fecha
      FROM (
        SELECT id, conversacion_id, rol, mensaje, fecha
        FROM public.mensajes
        WHERE conversacion_id = $1
        ORDER BY fecha DESC, id DESC
        LIMIT $2
      ) recent_messages
      ORDER BY fecha ASC, id ASC
    `,
    [conversationId, safeLimit]
  );

  return result.rows.map(mapMessage);
}

async function saveMessage({ conversationId, role, message }) {
  const result = await db.query(
    `
      INSERT INTO public.mensajes (
        conversacion_id,
        rol,
        mensaje,
        fecha
      )
      VALUES ($1, $2, $3, timezone('America/Monterrey', now()))
      RETURNING id, conversacion_id, rol, mensaje, fecha
    `,
    [conversationId, role, message]
  );

  return mapMessage(result.rows[0]);
}

async function findLatestMessageByConversationId(conversationId) {
  const result = await db.query(
    `
      SELECT id, conversacion_id, rol, mensaje, fecha
      FROM public.mensajes
      WHERE conversacion_id = $1
      ORDER BY fecha DESC, id DESC
      LIMIT 1
    `,
    [conversationId]
  );

  if (!result.rows.length) {
    return null;
  }

  return mapMessage(result.rows[0]);
}

module.exports = {
  listMessagesByConversationId,
  findLatestMessageByConversationId,
  saveMessage,
};
