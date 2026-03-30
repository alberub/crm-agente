const db = require("../db");
const { serializeDbTimestamp } = require("../utils/datetime");

function mapConversation(row) {
  const controlOwner = row.control_owner || "bot";
  const botPaused = Boolean(row.bot_paused);

  return {
    id: Number(row.id),
    clienteId: row.cliente_id ? Number(row.cliente_id) : null,
    estadoId: row.estado_id ? Number(row.estado_id) : null,
    estado: row.estado || null,
    intencionId: row.intencion_id ? Number(row.intencion_id) : null,
    intencionNombre: row.intencion_nombre || null,
    categoriaId: row.categoria_id ? Number(row.categoria_id) : null,
    categoriaNombre: row.categoria_nombre || null,
    activa: Boolean(row.activa),
    controlOwner,
    humanAgentId: row.human_agent_id || null,
    botPaused,
    botEnabled: controlOwner === "bot" && botPaused === false,
    ultimaInteraccion: serializeDbTimestamp(row.ultima_interaccion),
    nombreCliente: row.nombre_cliente || null,
    telefonoCliente: row.telefono_cliente || null,
    ultimoMensaje: row.ultimo_mensaje || null,
    ultimoMensajeFecha: serializeDbTimestamp(row.ultimo_mensaje_fecha),
    totalMensajes: Number(row.total_mensajes || 0),
    hasUnread: Boolean(row.has_unread),
    unreadCount: Number(row.unread_count || 0),
    humanTakenAt: serializeDbTimestamp(row.human_taken_at),
  };
}

function buildFilters({ search, activeOnly, unreadOnly = false, agentId = null }) {
  const conditions = [];
  const params = [];

  if (typeof activeOnly === "boolean") {
    params.push(activeOnly);
    conditions.push(`c.activa = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.trim()}%`);
    const index = params.length;

    conditions.push(`
      (
        cl.nombre ILIKE $${index}
        OR cl.telefono ILIKE $${index}
        OR c.estado ILIKE $${index}
        OR EXISTS (
          SELECT 1
          FROM public.mensajes search_message
          WHERE search_message.conversacion_id = c.id
            AND search_message.mensaje ILIKE $${index}
        )
      )
    `);
  }

  if (unreadOnly) {
    params.push(agentId);
    const agentIndex = params.length;
    conditions.push(`
      EXISTS (
        SELECT 1
        FROM public.mensajes unread_message
        LEFT JOIN public.conversation_reads unread_read
          ON unread_read.conversation_id = c.id
         AND unread_read.agent_id = $${agentIndex}
        WHERE unread_message.conversacion_id = c.id
          AND unread_message.rol = 'user'
          AND unread_message.id > COALESCE(unread_read.last_read_message_id, 0)
      )
    `);
  }

  return {
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}

async function listConversations({
  search = "",
  activeOnly,
  unreadOnly = false,
  limit = 50,
  agentId = null,
}) {
  const { whereClause, params } = buildFilters({ search, activeOnly, unreadOnly, agentId });
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);

  params.push(agentId);
  const agentIndex = params.length;
  params.push(safeLimit);

  const result = await db.query(
    `
      SELECT
        c.id,
        c.cliente_id,
        c.estado_id,
        c.estado,
        c.intencion_id,
        c.categoria_id,
        c.activa,
        c.control_owner,
        c.human_taken_at,
        c.human_agent_id,
        c.bot_paused,
        c.ultima_interaccion,
        cl.nombre AS nombre_cliente,
        cl.telefono AS telefono_cliente,
        ci.nombre AS intencion_nombre,
        cc.tipo_categoria AS categoria_nombre,
        last_message.mensaje AS ultimo_mensaje,
        last_message.fecha AS ultimo_mensaje_fecha,
        message_totals.total_mensajes,
        CASE
          WHEN $${agentIndex}::text IS NULL THEN FALSE
          ELSE COALESCE(unread_totals.unread_count, 0) > 0
        END AS has_unread,
        CASE
          WHEN $${agentIndex}::text IS NULL THEN 0
          ELSE COALESCE(unread_totals.unread_count, 0)
        END AS unread_count
      FROM public.conversaciones c
      LEFT JOIN public.clientes_floreria cl
        ON cl.id = c.cliente_id
      LEFT JOIN public.cat_intenciones ci
        ON ci.id = c.intencion_id
      LEFT JOIN public.cat_categorias cc
        ON cc.id = c.categoria_id
      LEFT JOIN LATERAL (
        SELECT m.mensaje, m.fecha
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT 1
      ) AS last_message ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_mensajes
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
      ) AS message_totals ON TRUE
      LEFT JOIN public.conversation_reads cr
        ON cr.conversation_id = c.id
       AND cr.agent_id = $${agentIndex}
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
          AND m.rol = 'user'
          AND m.id > COALESCE(cr.last_read_message_id, 0)
      ) AS unread_totals ON TRUE
      ${whereClause}
      ORDER BY c.ultima_interaccion DESC NULLS LAST, c.id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map(mapConversation);
}

async function findConversationById(conversationId, agentId = null) {
  const result = await db.query(
    `
      SELECT
        c.id,
        c.cliente_id,
        c.estado_id,
        c.estado,
        c.intencion_id,
        c.categoria_id,
        c.activa,
        c.control_owner,
        c.human_taken_at,
        c.human_agent_id,
        c.bot_paused,
        c.ultima_interaccion,
        cl.nombre AS nombre_cliente,
        cl.telefono AS telefono_cliente,
        ci.nombre AS intencion_nombre,
        cc.tipo_categoria AS categoria_nombre,
        last_message.mensaje AS ultimo_mensaje,
        last_message.fecha AS ultimo_mensaje_fecha,
        message_totals.total_mensajes,
        CASE
          WHEN $2::text IS NULL THEN FALSE
          ELSE COALESCE(unread_totals.unread_count, 0) > 0
        END AS has_unread,
        CASE
          WHEN $2::text IS NULL THEN 0
          ELSE COALESCE(unread_totals.unread_count, 0)
        END AS unread_count
      FROM public.conversaciones c
      LEFT JOIN public.clientes_floreria cl
        ON cl.id = c.cliente_id
      LEFT JOIN public.cat_intenciones ci
        ON ci.id = c.intencion_id
      LEFT JOIN public.cat_categorias cc
        ON cc.id = c.categoria_id
      LEFT JOIN LATERAL (
        SELECT m.mensaje, m.fecha
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT 1
      ) AS last_message ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total_mensajes
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
      ) AS message_totals ON TRUE
      LEFT JOIN public.conversation_reads cr
        ON cr.conversation_id = c.id
       AND cr.agent_id = $2
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
          AND m.rol = 'user'
          AND m.id > COALESCE(cr.last_read_message_id, 0)
      ) AS unread_totals ON TRUE
      WHERE c.id = $1
      LIMIT 1
    `,
    [conversationId, agentId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapConversation(result.rows[0]);
}

async function listConversationStates() {
  const result = await db.query(
    `
      SELECT id, nombre
      FROM public.cat_estados_conversacion
      ORDER BY id ASC
    `
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    nombre: row.nombre,
  }));
}

async function updateConversationState({ conversationId, stateName }) {
  const stateResult = await db.query(
    `
      SELECT id, nombre
      FROM public.cat_estados_conversacion
      WHERE nombre = $1
      LIMIT 1
    `,
    [stateName]
  );

  if (stateResult.rows.length === 0) {
    return null;
  }

  const state = stateResult.rows[0];

  await db.query(
    `
      UPDATE public.conversaciones
      SET estado = $2,
          estado_id = $3,
          ultima_interaccion = timezone('America/Monterrey', now())
      WHERE id = $1
    `,
    [conversationId, state.nombre, Number(state.id)]
  );

  return findConversationById(conversationId);
}

async function takeConversationByHuman({
  conversationId,
  humanAgentId = null,
  pauseBot = true,
}) {
  const result = await db.query(
    `
      UPDATE public.conversaciones
      SET control_owner = 'human',
          human_taken_at = timezone('America/Monterrey', now()),
          human_agent_id = $2,
          bot_paused = $3,
          ultima_interaccion = timezone('America/Monterrey', now())
      WHERE id = $1
      RETURNING id
    `,
    [conversationId, humanAgentId, pauseBot]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return findConversationById(conversationId);
}

async function resumeConversationByBot(conversationId) {
  const result = await db.query(
    `
      UPDATE public.conversaciones
      SET control_owner = 'bot',
          human_taken_at = NULL,
          human_agent_id = NULL,
          bot_paused = FALSE,
          ultima_interaccion = timezone('America/Monterrey', now())
      WHERE id = $1
      RETURNING id
    `,
    [conversationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return findConversationById(conversationId);
}

function isBotResponseEnabled(conversation) {
  return Boolean(
    conversation &&
      conversation.controlOwner === "bot" &&
      conversation.botPaused === false
  );
}

module.exports = {
  listConversations,
  findConversationById,
  listConversationStates,
  updateConversationState,
  takeConversationByHuman,
  resumeConversationByBot,
  isBotResponseEnabled,
};
