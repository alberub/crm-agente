const db = require("../db");
const { serializeDbTimestamp } = require("../utils/datetime");

function parseJsonList(value) {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

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
    leadId: row.lead_id ? Number(row.lead_id) : null,
    leadPriority: row.lead_priority || null,
    leadStatus: row.lead_status || null,
    nextFollowupAt: serializeDbTimestamp(row.lead_next_followup_at),
    ownerExternalRef: row.lead_owner_external_ref || null,
    ownerName: row.lead_owner_name || null,
    interestSummary: row.lead_interest_summary || null,
    tags: parseJsonList(row.tags_json),
    salesStageCode: row.sales_stage_code || null,
    salesStageName: row.sales_stage_name || null,
    nextAction: row.lead_next_action || null,
    estimatedValue:
      row.lead_estimated_value === null || row.lead_estimated_value === undefined
        ? null
        : Number(row.lead_estimated_value),
    aiScore:
      row.lead_ai_score === null || row.lead_ai_score === undefined
        ? null
        : Number(row.lead_ai_score),
    aiScoreReasons: Array.isArray(row.lead_ai_score_reasons_json)
      ? row.lead_ai_score_reasons_json
      : (() => {
          try {
            const parsed = JSON.parse(row.lead_ai_score_reasons_json || "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch (_error) {
            return [];
          }
        })(),
    objections: Array.isArray(row.lead_objections_json)
      ? row.lead_objections_json
      : (() => {
          try {
            const parsed = JSON.parse(row.lead_objections_json || "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch (_error) {
            return [];
          }
        })(),
  };
}

function buildFilters({
  search,
  activeOnly,
  unreadOnly = false,
  agentId = null,
  ownerExternalRef = null,
}) {
  const conditions = [];
  const params = [];

  if (typeof activeOnly === "boolean") {
    params.push(activeOnly);
    conditions.push(`c.activa = $${params.length}`);
  }

  const trimmedSearch = String(search || "").trim();

  if (trimmedSearch) {
    params.push(`%${trimmedSearch}%`);
    const index = params.length;
    const searchClauses = [
      `cl.nombre ILIKE $${index}`,
      `cl.telefono ILIKE $${index}`,
      `c.estado ILIKE $${index}`,
      `ci.nombre ILIKE $${index}`,
      `cc.tipo_categoria ILIKE $${index}`,
      `ss.name ILIKE $${index}`,
      `ss.code ILIKE $${index}`,
      `owner.full_name ILIKE $${index}`,
      `owner.external_ref ILIKE $${index}`,
      `l.status ILIKE $${index}`,
      `l.priority ILIKE $${index}`,
      `l.interest_summary ILIKE $${index}`,
      `l.next_action ILIKE $${index}`,
      `EXISTS (
        SELECT 1
        FROM public.lead_tags search_lead_tag
        JOIN public.cat_tags search_tag
          ON search_tag.id = search_lead_tag.tag_id
        WHERE search_lead_tag.lead_id = l.id
          AND (
            search_tag.nombre ILIKE $${index}
            OR search_tag.slug ILIKE $${index}
          )
      )`,
      `EXISTS (
        SELECT 1
        FROM public.mensajes search_message
        WHERE search_message.conversacion_id = c.id
          AND search_message.mensaje ILIKE $${index}
      )`,
    ];
    const numericSearch = trimmedSearch.replace(/\D/g, "");

    if (numericSearch) {
      params.push(`%${numericSearch}%`);
      const numericIndex = params.length;
      searchClauses.push(
        `regexp_replace(COALESCE(cl.telefono, ''), '\\D', '', 'g') LIKE $${numericIndex}`
      );
    }

    conditions.push(`
      (
        ${searchClauses.join("\n        OR ")}
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

  if (ownerExternalRef) {
    params.push(String(ownerExternalRef).trim());
    const ownerIndex = params.length;
    conditions.push(`
      (
        c.human_agent_id = $${ownerIndex}
        OR owner.external_ref = $${ownerIndex}
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
  ownerExternalRef = null,
}) {
  const { whereClause, params } = buildFilters({
    search,
    activeOnly,
    unreadOnly,
    agentId,
    ownerExternalRef,
  });
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
        l.id AS lead_id,
        l.priority AS lead_priority,
        l.status AS lead_status,
        l.next_followup_at AS lead_next_followup_at,
        l.next_action AS lead_next_action,
        l.interest_summary AS lead_interest_summary,
        l.estimated_value AS lead_estimated_value,
        l.ai_score AS lead_ai_score,
        l.ai_score_reasons_json AS lead_ai_score_reasons_json,
        l.objections_json AS lead_objections_json,
        ss.code AS sales_stage_code,
        ss.name AS sales_stage_name,
        owner.external_ref AS lead_owner_external_ref,
        owner.full_name AS lead_owner_name,
        tags.tags_json,
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
      LEFT JOIN public.lead l
        ON l.conversation_id = c.id
      LEFT JOIN public.sales_stage ss
        ON ss.id = l.sales_stage_id
      LEFT JOIN public.crm_user owner
        ON owner.id = l.owner_user_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'id', ct.id,
              'name', ct.nombre,
              'slug', ct.slug,
              'category', ct.categoria,
              'color', ct.color,
              'active', ct.activo,
              'marketingEnabled', ct.marketing_habilitado,
              'origin', lt.origen,
              'confidence', lt.confianza,
              'createdAt', lt.fecha_creacion
            )
            ORDER BY ct.nombre ASC
          ),
          '[]'::json
        ) AS tags_json
        FROM public.lead_tags lt
        JOIN public.cat_tags ct
          ON ct.id = lt.tag_id
        WHERE lt.lead_id = l.id
      ) AS tags ON TRUE
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

async function findConversationById(conversationId, agentId = null, ownerExternalRef = null) {
  const scopedCondition = ownerExternalRef
    ? `AND (
        c.human_agent_id = $3
        OR owner.external_ref = $3
      )`
    : "";
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
        l.id AS lead_id,
        l.priority AS lead_priority,
        l.status AS lead_status,
        l.next_followup_at AS lead_next_followup_at,
        l.next_action AS lead_next_action,
        l.interest_summary AS lead_interest_summary,
        l.estimated_value AS lead_estimated_value,
        l.ai_score AS lead_ai_score,
        l.ai_score_reasons_json AS lead_ai_score_reasons_json,
        l.objections_json AS lead_objections_json,
        ss.code AS sales_stage_code,
        ss.name AS sales_stage_name,
        owner.external_ref AS lead_owner_external_ref,
        owner.full_name AS lead_owner_name,
        tags.tags_json,
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
      LEFT JOIN public.lead l
        ON l.conversation_id = c.id
      LEFT JOIN public.sales_stage ss
        ON ss.id = l.sales_stage_id
      LEFT JOIN public.crm_user owner
        ON owner.id = l.owner_user_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          json_agg(
            json_build_object(
              'id', ct.id,
              'name', ct.nombre,
              'slug', ct.slug,
              'category', ct.categoria,
              'color', ct.color,
              'active', ct.activo,
              'marketingEnabled', ct.marketing_habilitado,
              'origin', lt.origen,
              'confidence', lt.confianza,
              'createdAt', lt.fecha_creacion
            )
            ORDER BY ct.nombre ASC
          ),
          '[]'::json
        ) AS tags_json
        FROM public.lead_tags lt
        JOIN public.cat_tags ct
          ON ct.id = lt.tag_id
        WHERE lt.lead_id = l.id
      ) AS tags ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS unread_count
        FROM public.mensajes m
        WHERE m.conversacion_id = c.id
          AND m.rol = 'user'
          AND m.id > COALESCE(cr.last_read_message_id, 0)
      ) AS unread_totals ON TRUE
      WHERE c.id = $1
      ${scopedCondition}
      LIMIT 1
    `,
    ownerExternalRef ? [conversationId, agentId, ownerExternalRef] : [conversationId, agentId]
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

async function syncConversationStateIfExists({ conversationId, stateName }) {
  if (!stateName) {
    return null;
  }

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
          estado_id = $3
      WHERE id = $1
        AND (
          COALESCE(estado, '') <> $2
          OR COALESCE(estado_id, 0) <> $3
        )
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
  syncConversationStateIfExists,
  isBotResponseEnabled,
};
