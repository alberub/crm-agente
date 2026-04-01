const db = require("../db");
const { SALES_STAGE_CATALOG } = require("../domain/salesStages");
const { serializeDbTimestamp } = require("../utils/datetime");

const SALES_STAGE_CODES = SALES_STAGE_CATALOG.map((stage) => stage.code);

function toNumberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function normalizeText(value) {
  const normalized = String(value || "").trim();
  return normalized.length ? normalized : null;
}

function normalizeEstimatedValue(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const estimatedValue = Number(value);

  if (!Number.isFinite(estimatedValue) || estimatedValue < 0) {
    throw new Error("INVALID_ESTIMATED_VALUE");
  }

  return estimatedValue;
}

function normalizeFollowupAt(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("INVALID_NEXT_FOLLOWUP_AT");
  }

  return parsed.toISOString();
}

function validateStageCode(stageCode) {
  if (!stageCode) {
    return null;
  }

  const normalizedStageCode = String(stageCode).trim();

  if (!SALES_STAGE_CODES.includes(normalizedStageCode)) {
    throw new Error("INVALID_STAGE_CODE");
  }

  return normalizedStageCode;
}

function mapSalesStageRow(row) {
  return {
    id: row.id === null || row.id === undefined ? null : Number(row.id),
    code: row.code,
    name: row.name,
    sortOrder: Number(row.sort_order),
    isClosedWon: Boolean(row.is_closed_won),
    isClosedLost: Boolean(row.is_closed_lost),
  };
}

function mapLeadRow(row) {
  return {
    id: Number(row.lead_id),
    conversationId: Number(row.conversation_id),
    contactId: toNumberOrNull(row.contact_id),
    salesStage: row.sales_stage_id
      ? {
          id: Number(row.sales_stage_id),
          code: row.sales_stage_code,
          name: row.sales_stage_name,
          sortOrder: Number(row.sales_stage_sort_order || 0),
          isClosedWon: Boolean(row.sales_stage_closed_won),
          isClosedLost: Boolean(row.sales_stage_closed_lost),
        }
      : null,
    estimatedValue:
      row.estimated_value === null || row.estimated_value === undefined
        ? null
        : Number(row.estimated_value),
    nextAction: row.next_action || null,
    nextFollowupAt: serializeDbTimestamp(row.next_followup_at),
    lossReason: row.loss_reason || null,
    lastActivityAt: serializeDbTimestamp(row.last_activity_at),
    createdAt: serializeDbTimestamp(row.lead_created_at),
    updatedAt: serializeDbTimestamp(row.lead_updated_at),
    conversation: row.conversation_id
      ? {
          id: Number(row.conversation_id),
          nombreCliente: row.contact_name || null,
          telefonoCliente: row.contact_phone || null,
          ultimaInteraccion: serializeDbTimestamp(row.conversation_last_interaction),
          ultimoMensaje: row.last_message_body || null,
          ultimoMensajeFecha: serializeDbTimestamp(row.last_message_at),
        }
      : null,
  };
}

async function listSalesStages() {
  const result = await db.query(
    `
      SELECT
        id,
        code,
        name,
        sort_order,
        is_closed_won,
        is_closed_lost
      FROM public.sales_stage
      WHERE code = ANY($1::text[])
    `,
    [SALES_STAGE_CODES]
  );

  const stagesByCode = new Map(result.rows.map((row) => [row.code, row]));

  return SALES_STAGE_CATALOG.map((stage) => {
    const persistedStage = stagesByCode.get(stage.code);

    if (!persistedStage) {
      return {
        id: null,
        code: stage.code,
        name: stage.name,
        sortOrder: stage.sortOrder,
        isClosedWon: stage.isClosedWon,
        isClosedLost: stage.isClosedLost,
      };
    }

    return mapSalesStageRow(persistedStage);
  });
}

async function resolveSalesStageId(stageCode) {
  const validatedStageCode = validateStageCode(stageCode);

  if (!validatedStageCode) {
    return null;
  }

  const result = await db.query(
    `
      SELECT id
      FROM public.sales_stage
      WHERE code = $1
      LIMIT 1
    `,
    [validatedStageCode]
  );

  if (!result.rows.length) {
    throw new Error("INVALID_STAGE_CODE");
  }

  return Number(result.rows[0].id);
}

function buildLeadBaseQuery(whereClause = "", orderClause = "", limitClause = "") {
  return `
    SELECT
      l.id AS lead_id,
      l.conversation_id,
      l.contact_id,
      l.sales_stage_id,
      l.estimated_value,
      l.next_action,
      l.next_followup_at,
      l.loss_reason,
      l.last_activity_at,
      l.created_at AS lead_created_at,
      l.updated_at AS lead_updated_at,
      ss.code AS sales_stage_code,
      ss.name AS sales_stage_name,
      ss.sort_order AS sales_stage_sort_order,
      ss.is_closed_won AS sales_stage_closed_won,
      ss.is_closed_lost AS sales_stage_closed_lost,
      c.ultima_interaccion AS conversation_last_interaction,
      cl.nombre AS contact_name,
      cl.telefono AS contact_phone,
      lm.mensaje AS last_message_body,
      lm.fecha AS last_message_at
    FROM public.lead l
    LEFT JOIN public.sales_stage ss
      ON ss.id = l.sales_stage_id
    LEFT JOIN public.conversaciones c
      ON c.id = l.conversation_id
    LEFT JOIN public.clientes_floreria cl
      ON cl.id = l.contact_id
    LEFT JOIN LATERAL (
      SELECT m.mensaje, m.fecha
      FROM public.mensajes m
      WHERE m.conversacion_id = l.conversation_id
      ORDER BY m.fecha DESC, m.id DESC
      LIMIT 1
    ) lm ON TRUE
    ${whereClause}
    ${orderClause}
    ${limitClause}
  `;
}

async function findLeadById(leadId) {
  const result = await db.query(
    buildLeadBaseQuery("WHERE l.id = $1", "", "LIMIT 1"),
    [leadId]
  );

  if (!result.rows.length) {
    return null;
  }

  return mapLeadRow(result.rows[0]);
}

async function findLeadByConversationId(conversationId) {
  const result = await db.query(
    `
      SELECT id
      FROM public.lead
      WHERE conversation_id = $1
      LIMIT 1
    `,
    [conversationId]
  );

  if (!result.rows.length) {
    return null;
  }

  return findLeadById(Number(result.rows[0].id));
}

async function ensureLeadByConversationId(conversationId) {
  const existingLead = await findLeadByConversationId(conversationId);

  if (existingLead) {
    return existingLead;
  }

  const nuevoStageId = await resolveSalesStageId("nuevo");

  await db.query(
    `
      INSERT INTO public.lead (
        conversation_id,
        contact_id,
        sales_stage_id,
        channel,
        status,
        last_activity_at,
        created_at,
        updated_at
      )
      SELECT
        c.id,
        c.cliente_id,
        $2,
        'whatsapp',
        CASE WHEN c.activa THEN 'active' ELSE 'archived' END,
        c.ultima_interaccion,
        COALESCE(c.ultima_interaccion, NOW()),
        NOW()
      FROM public.conversaciones c
      WHERE c.id = $1
      ON CONFLICT (conversation_id) DO NOTHING
    `,
    [conversationId, nuevoStageId]
  );

  return findLeadByConversationId(conversationId);
}

async function listLeads({ search = "", stageCode = null, followupDueOnly = false, limit = 120 }) {
  const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 250);
  const params = [SALES_STAGE_CODES];
  const conditions = [
    "COALESCE(l.status, 'active') <> 'archived'",
    "ss.code = ANY($1::text[])",
  ];

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const searchParamIndex = params.length;

    conditions.push(`
      (
        cl.nombre ILIKE $${searchParamIndex}
        OR cl.telefono ILIKE $${searchParamIndex}
        OR ss.name ILIKE $${searchParamIndex}
        OR ss.code ILIKE $${searchParamIndex}
        OR COALESCE(lm.mensaje, '') ILIKE $${searchParamIndex}
      )
    `);
  }

  if (stageCode) {
    params.push(validateStageCode(stageCode));
    conditions.push(`ss.code = $${params.length}`);
  }

  if (followupDueOnly) {
    conditions.push(`l.next_followup_at IS NOT NULL AND l.next_followup_at <= NOW()`);
  }

  params.push(safeLimit);

  const result = await db.query(
    buildLeadBaseQuery(
      `WHERE ${conditions.join(" AND ")}`,
      "ORDER BY COALESCE(l.next_followup_at, l.last_activity_at, l.updated_at) DESC NULLS LAST, l.id DESC",
      `LIMIT $${params.length}`
    ),
    params
  );

  return result.rows.map(mapLeadRow);
}

async function updateLead({ leadId, patch }) {
  const currentLead = await findLeadById(leadId);

  if (!currentLead) {
    return null;
  }

  const updates = [];
  const params = [];

  const assign = (column, value) => {
    params.push(value);
    updates.push(`${column} = $${params.length}`);
  };

  if (Object.prototype.hasOwnProperty.call(patch, "stageCode")) {
    assign("sales_stage_id", await resolveSalesStageId(patch.stageCode));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "estimatedValue")) {
    assign("estimated_value", normalizeEstimatedValue(patch.estimatedValue));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "nextAction")) {
    assign("next_action", normalizeText(patch.nextAction));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "nextFollowupAt")) {
    assign("next_followup_at", normalizeFollowupAt(patch.nextFollowupAt));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "lossReason")) {
    assign("loss_reason", normalizeText(patch.lossReason));
  }

  if (!updates.length) {
    return currentLead;
  }

  params.push(leadId);

  await db.query(
    `
      UPDATE public.lead
      SET ${updates.join(", ")},
          updated_at = NOW()
      WHERE id = $${params.length}
    `,
    params
  );

  return findLeadById(leadId);
}

async function getPipelineSummary() {
  const result = await db.query(
    `
      SELECT
        ss.id,
        ss.code,
        ss.name,
        ss.sort_order,
        ss.is_closed_won,
        ss.is_closed_lost,
        COUNT(l.id)::bigint AS lead_count,
        COALESCE(SUM(l.estimated_value), 0)::numeric(14,2) AS total_estimated_value
      FROM public.sales_stage ss
      LEFT JOIN public.lead l
        ON l.sales_stage_id = ss.id
       AND COALESCE(l.status, 'active') <> 'archived'
      WHERE ss.code = ANY($1::text[])
      GROUP BY ss.id, ss.code, ss.name, ss.sort_order, ss.is_closed_won, ss.is_closed_lost
    `,
    [SALES_STAGE_CODES]
  );

  const rowsByCode = new Map(result.rows.map((row) => [row.code, row]));
  const byStage = SALES_STAGE_CATALOG.map((stage) => {
    const persistedRow = rowsByCode.get(stage.code);

    if (!persistedRow) {
      return {
        id: null,
        code: stage.code,
        name: stage.name,
        sortOrder: stage.sortOrder,
        isClosedWon: stage.isClosedWon,
        isClosedLost: stage.isClosedLost,
        leadCount: 0,
        totalEstimatedValue: 0,
      };
    }

    return {
      id: Number(persistedRow.id),
      code: persistedRow.code,
      name: persistedRow.name,
      sortOrder: Number(persistedRow.sort_order),
      isClosedWon: Boolean(persistedRow.is_closed_won),
      isClosedLost: Boolean(persistedRow.is_closed_lost),
      leadCount: Number(persistedRow.lead_count || 0),
      totalEstimatedValue: Number(persistedRow.total_estimated_value || 0),
    };
  });

  const totals = byStage.reduce(
    (accumulator, stage) => {
      accumulator.totalLeads += stage.leadCount;
      accumulator.totalEstimatedValue += stage.totalEstimatedValue;

      if (stage.isClosedWon) {
        accumulator.closedWon += stage.leadCount;
      }

      if (stage.isClosedLost) {
        accumulator.closedLost += stage.leadCount;
      }

      return accumulator;
    },
    {
      totalLeads: 0,
      totalEstimatedValue: 0,
      closedWon: 0,
      closedLost: 0,
      closedCount: 0,
    }
  );

  totals.closedCount = totals.closedWon + totals.closedLost;

  return {
    totals,
    byStage,
    conversionRate:
      totals.closedCount > 0
        ? Number(((totals.closedWon / totals.closedCount) * 100).toFixed(2))
        : 0,
  };
}

module.exports = {
  ensureLeadByConversationId,
  findLeadByConversationId,
  findLeadById,
  getPipelineSummary,
  listLeads,
  listSalesStages,
  updateLead,
};
