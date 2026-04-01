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

function toNumberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapLeadRow(row) {
  return {
    id: Number(row.lead_id),
    conversationId: Number(row.conversation_id),
    contactId: toNumberOrNull(row.contact_id),
    ownerUserId: toNumberOrNull(row.owner_user_id),
    owner: row.owner_user_id
      ? {
          id: Number(row.owner_user_id),
          externalRef: row.owner_external_ref || null,
          fullName: row.owner_full_name || null,
        }
      : null,
    salesStage: row.sales_stage_id
      ? {
          id: Number(row.sales_stage_id),
          code: row.sales_stage_code || null,
          name: row.sales_stage_name || null,
          sortOrder: Number(row.sales_stage_sort_order || 0),
          isClosedWon: Boolean(row.sales_stage_closed_won),
          isClosedLost: Boolean(row.sales_stage_closed_lost),
        }
      : null,
    source: row.source || null,
    channel: row.channel || null,
    priority: row.priority || "media",
    estimatedValue:
      row.estimated_value === null || row.estimated_value === undefined
        ? null
        : Number(row.estimated_value),
    temperature: row.temperature || null,
    aiScore: toNumberOrNull(row.ai_score),
    aiScoreReasons: parseJsonList(row.ai_score_reasons_json),
    intentLabel: row.intent_label || null,
    interestSummary: row.interest_summary || null,
    objections: parseJsonList(row.objections_json),
    nextAction: row.next_action || null,
    nextFollowupAt: serializeDbTimestamp(row.next_followup_at),
    lossReason: row.loss_reason || null,
    status: row.status || "active",
    lastActivityAt: serializeDbTimestamp(row.last_activity_at),
    createdAt: serializeDbTimestamp(row.lead_created_at),
    updatedAt: serializeDbTimestamp(row.lead_updated_at),
    salesStageManualOverride: Boolean(row.sales_stage_manual_override),
    nextActionManualOverride: Boolean(row.next_action_manual_override),
    conversation: row.conversation_id
      ? {
          id: Number(row.conversation_id),
          estado: row.conversation_state || null,
          activa: row.conversation_active === null ? null : Boolean(row.conversation_active),
          ultimaInteraccion: serializeDbTimestamp(row.conversation_last_interaction),
          nombreCliente: row.contact_name || null,
          telefonoCliente: row.contact_phone || null,
          ultimoMensaje: row.last_message_body || null,
          ultimoMensajeFecha: serializeDbTimestamp(row.last_message_at),
        }
      : null,
  };
}

async function resolveOrCreateCrmUser({
  externalRef = null,
  fullName = null,
  email = null,
  roleCode = "seller",
}) {
  const normalizedExternalRef = String(externalRef || "").trim() || null;
  const normalizedEmail = String(email || "").trim() || null;
  const normalizedName =
    String(fullName || "").trim() ||
    normalizedExternalRef ||
    normalizedEmail ||
    "Asesor CRM";

  if (!normalizedExternalRef && !normalizedEmail) {
    return null;
  }

  const lookupResult = await db.query(
    `
      SELECT id, external_ref, full_name
      FROM public.crm_user
      WHERE ($1::text IS NOT NULL AND external_ref = $1)
         OR ($2::text IS NOT NULL AND email = $2)
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedExternalRef, normalizedEmail]
  );

  if (lookupResult.rows.length > 0) {
    const user = lookupResult.rows[0];

    if (normalizedName && normalizedName !== user.full_name) {
      await db.query(
        `
          UPDATE public.crm_user
          SET full_name = $2,
              updated_at = NOW()
          WHERE id = $1
        `,
        [Number(user.id), normalizedName]
      );
    }

    return Number(user.id);
  }

  const insertResult = await db.query(
    `
      INSERT INTO public.crm_user (external_ref, full_name, email, role_code)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `,
    [normalizedExternalRef, normalizedName, normalizedEmail, roleCode]
  );

  return Number(insertResult.rows[0].id);
}

async function insertAuditLog({
  entityType,
  entityId,
  action,
  performedBy = null,
  oldValue = null,
  newValue = null,
}) {
  await db.query(
    `
      INSERT INTO public.audit_log (
        entity_type,
        entity_id,
        action,
        performed_by,
        old_value_json,
        new_value_json
      )
      VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    `,
    [
      entityType,
      String(entityId),
      action,
      performedBy,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null,
    ]
  );
}

async function findLeadById(leadId) {
  const result = await db.query(
    `
      SELECT
        l.id AS lead_id,
        l.conversation_id,
        l.contact_id,
        l.owner_user_id,
        l.sales_stage_id,
        l.source,
        l.channel,
        l.priority,
        l.estimated_value,
        l.temperature,
        l.ai_score,
        l.ai_score_reasons_json,
        l.intent_label,
        l.interest_summary,
        l.objections_json,
        l.next_action,
        l.next_followup_at,
        l.loss_reason,
        l.status,
        l.last_activity_at,
        l.created_at AS lead_created_at,
        l.updated_at AS lead_updated_at,
        l.sales_stage_manual_override,
        l.next_action_manual_override,
        ss.code AS sales_stage_code,
        ss.name AS sales_stage_name,
        ss.sort_order AS sales_stage_sort_order,
        ss.is_closed_won AS sales_stage_closed_won,
        ss.is_closed_lost AS sales_stage_closed_lost,
        owner.external_ref AS owner_external_ref,
        owner.full_name AS owner_full_name,
        c.estado AS conversation_state,
        c.activa AS conversation_active,
        c.ultima_interaccion AS conversation_last_interaction,
        cl.nombre AS contact_name,
        cl.telefono AS contact_phone,
        lm.mensaje AS last_message_body,
        lm.fecha AS last_message_at
      FROM public.lead l
      LEFT JOIN public.sales_stage ss
        ON ss.id = l.sales_stage_id
      LEFT JOIN public.crm_user owner
        ON owner.id = l.owner_user_id
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
      WHERE l.id = $1
      LIMIT 1
    `,
    [leadId]
  );

  if (result.rows.length === 0) {
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
  const existing = await findLeadByConversationId(conversationId);

  if (existing) {
    return existing;
  }

  await db.query(
    `
      INSERT INTO public.lead (
        conversation_id,
        contact_id,
        source,
        channel,
        status,
        last_activity_at,
        created_at,
        updated_at
      )
      SELECT
        c.id,
        c.cliente_id,
        COALESCE(ci.nombre, 'whatsapp_inbound'),
        'whatsapp',
        CASE WHEN c.activa THEN 'active' ELSE 'archived' END,
        c.ultima_interaccion,
        COALESCE(c.ultima_interaccion, NOW()),
        NOW()
      FROM public.conversaciones c
      LEFT JOIN public.cat_intenciones ci
        ON ci.id = c.intencion_id
      WHERE c.id = $1
      ON CONFLICT (conversation_id) DO NOTHING
    `,
    [conversationId]
  );

  return findLeadByConversationId(conversationId);
}

async function listLeads({
  search = "",
  stageCode = null,
  status = null,
  ownerExternalRef = null,
  followupDueOnly = false,
  limit = 120,
}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 120, 1), 250);
  const params = [];
  const conditions = [];

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);
    const index = params.length;

    conditions.push(`
      (
        cl.nombre ILIKE $${index}
        OR cl.telefono ILIKE $${index}
        OR c.estado ILIKE $${index}
        OR ss.name ILIKE $${index}
        OR ss.code ILIKE $${index}
      )
    `);
  }

  if (stageCode) {
    params.push(String(stageCode).trim());
    conditions.push(`ss.code = $${params.length}`);
  }

  if (status) {
    params.push(String(status).trim());
    conditions.push(`l.status = $${params.length}`);
  }

  if (ownerExternalRef) {
    params.push(String(ownerExternalRef).trim());
    conditions.push(`owner.external_ref = $${params.length}`);
  }

  if (followupDueOnly) {
    conditions.push(`l.next_followup_at IS NOT NULL AND l.next_followup_at <= NOW()`);
  }

  params.push(safeLimit);

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const result = await db.query(
    `
      SELECT
        l.id AS lead_id,
        l.conversation_id,
        l.contact_id,
        l.owner_user_id,
        l.sales_stage_id,
        l.source,
        l.channel,
        l.priority,
        l.estimated_value,
        l.temperature,
        l.ai_score,
        l.ai_score_reasons_json,
        l.intent_label,
        l.interest_summary,
        l.objections_json,
        l.next_action,
        l.next_followup_at,
        l.loss_reason,
        l.status,
        l.last_activity_at,
        l.created_at AS lead_created_at,
        l.updated_at AS lead_updated_at,
        l.sales_stage_manual_override,
        l.next_action_manual_override,
        ss.code AS sales_stage_code,
        ss.name AS sales_stage_name,
        ss.sort_order AS sales_stage_sort_order,
        ss.is_closed_won AS sales_stage_closed_won,
        ss.is_closed_lost AS sales_stage_closed_lost,
        owner.external_ref AS owner_external_ref,
        owner.full_name AS owner_full_name,
        c.estado AS conversation_state,
        c.activa AS conversation_active,
        c.ultima_interaccion AS conversation_last_interaction,
        cl.nombre AS contact_name,
        cl.telefono AS contact_phone,
        lm.mensaje AS last_message_body,
        lm.fecha AS last_message_at
      FROM public.lead l
      LEFT JOIN public.sales_stage ss
        ON ss.id = l.sales_stage_id
      LEFT JOIN public.crm_user owner
        ON owner.id = l.owner_user_id
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
      ORDER BY COALESCE(l.next_followup_at, l.last_activity_at, l.updated_at) DESC NULLS LAST, l.id DESC
      LIMIT $${params.length}
    `,
    params
  );

  return result.rows.map(mapLeadRow);
}

async function updateLead({
  leadId,
  patch,
  actorRef = null,
}) {
  const current = await findLeadById(leadId);

  if (!current) {
    return null;
  }

  const updates = [];
  const params = [];

  const assign = (sql, value) => {
    params.push(value);
    updates.push(`${sql} = $${params.length}`);
  };

  if (Object.prototype.hasOwnProperty.call(patch, "priority")) {
    assign("priority", patch.priority || "media");
  }

  if (Object.prototype.hasOwnProperty.call(patch, "estimatedValue")) {
    assign("estimated_value", patch.estimatedValue === null ? null : Number(patch.estimatedValue));
  }

  if (Object.prototype.hasOwnProperty.call(patch, "nextAction")) {
    assign("next_action", patch.nextAction || null);
    assign("next_action_manual_override", true);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "nextFollowupAt")) {
    assign("next_followup_at", patch.nextFollowupAt || null);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "status")) {
    assign("status", patch.status || "active");
  }

  if (Object.prototype.hasOwnProperty.call(patch, "lossReason")) {
    assign("loss_reason", patch.lossReason || null);
  }

  if (Object.prototype.hasOwnProperty.call(patch, "stageCode")) {
    if (!patch.stageCode) {
      assign("sales_stage_id", null);
      assign("sales_stage_manual_override", true);
    } else {
      const stageResult = await db.query(
        `
          SELECT id
          FROM public.sales_stage
          WHERE code = $1
          LIMIT 1
        `,
        [patch.stageCode]
      );

      if (!stageResult.rows.length) {
        throw new Error("INVALID_STAGE_CODE");
      }

      assign("sales_stage_id", Number(stageResult.rows[0].id));
      assign("sales_stage_manual_override", true);
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(patch, "ownerExternalRef") ||
    Object.prototype.hasOwnProperty.call(patch, "ownerName") ||
    Object.prototype.hasOwnProperty.call(patch, "ownerEmail")
  ) {
    const ownerUserId = await resolveOrCreateCrmUser({
      externalRef: patch.ownerExternalRef ?? current.owner?.externalRef ?? null,
      fullName: patch.ownerName ?? current.owner?.fullName ?? null,
      email: patch.ownerEmail ?? null,
    });
    assign("owner_user_id", ownerUserId);
  }

  if (!updates.length) {
    return current;
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

  if (Object.prototype.hasOwnProperty.call(patch, "stageCode") && patch.stageCode) {
    const stateResult = await db.query(
      `
        SELECT id, nombre
        FROM public.cat_estados_conversacion
        WHERE nombre = $1
        LIMIT 1
      `,
      [patch.stageCode]
    );

    if (stateResult.rows.length) {
      const state = stateResult.rows[0];
      await db.query(
        `
          UPDATE public.conversaciones
          SET estado = $2,
              estado_id = $3,
              ultima_interaccion = NOW()
          WHERE id = $1
        `,
        [current.conversationId, state.nombre, Number(state.id)]
      );
    }
  }

  const next = await findLeadById(leadId);

  await insertAuditLog({
    entityType: "lead",
    entityId: leadId,
    action: "lead.updated",
    performedBy: actorRef,
    oldValue: current,
    newValue: next,
  });

  return next;
}

async function createLeadTask({
  leadId,
  title,
  description = null,
  dueAt = null,
  assignedToExternalRef = null,
  assignedToName = null,
  createdByExternalRef = null,
  createdByName = null,
}) {
  const assignedTo = await resolveOrCreateCrmUser({
    externalRef: assignedToExternalRef,
    fullName: assignedToName,
  });
  const createdBy = await resolveOrCreateCrmUser({
    externalRef: createdByExternalRef,
    fullName: createdByName,
  });

  const result = await db.query(
    `
      INSERT INTO public.lead_task (
        lead_id,
        assigned_to,
        title,
        description,
        due_at,
        status,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, 'pending', $6)
      RETURNING id, lead_id, assigned_to, title, description, due_at, status, created_by, created_at, updated_at
    `,
    [leadId, assignedTo, title, description, dueAt, createdBy]
  );

  const task = result.rows[0];

  await insertAuditLog({
    entityType: "lead_task",
    entityId: task.id,
    action: "lead.task.created",
    performedBy: createdByExternalRef,
    newValue: task,
  });

  return {
    id: Number(task.id),
    leadId: Number(task.lead_id),
    assignedTo: task.assigned_to ? Number(task.assigned_to) : null,
    title: task.title,
    description: task.description || null,
    dueAt: serializeDbTimestamp(task.due_at),
    status: task.status,
    createdBy: task.created_by ? Number(task.created_by) : null,
    createdAt: serializeDbTimestamp(task.created_at),
    updatedAt: serializeDbTimestamp(task.updated_at),
  };
}

async function listLeadTasks(leadId) {
  const result = await db.query(
    `
      SELECT
        t.id,
        t.lead_id,
        t.assigned_to,
        t.title,
        t.description,
        t.due_at,
        t.status,
        t.created_by,
        t.created_at,
        t.updated_at,
        assignee.external_ref AS assigned_to_external_ref,
        assignee.full_name AS assigned_to_name
      FROM public.lead_task t
      LEFT JOIN public.crm_user assignee
        ON assignee.id = t.assigned_to
      WHERE t.lead_id = $1
      ORDER BY t.created_at DESC, t.id DESC
    `,
    [leadId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    leadId: Number(row.lead_id),
    assignedTo: row.assigned_to
      ? {
          id: Number(row.assigned_to),
          externalRef: row.assigned_to_external_ref || null,
          fullName: row.assigned_to_name || null,
        }
      : null,
    title: row.title,
    description: row.description || null,
    dueAt: serializeDbTimestamp(row.due_at),
    status: row.status,
    createdBy: row.created_by ? Number(row.created_by) : null,
    createdAt: serializeDbTimestamp(row.created_at),
    updatedAt: serializeDbTimestamp(row.updated_at),
  }));
}

async function createLeadNote({
  leadId,
  body,
  authorExternalRef = null,
  authorName = null,
}) {
  const lead = await findLeadById(leadId);

  if (!lead) {
    return null;
  }

  const authorUserId = await resolveOrCreateCrmUser({
    externalRef: authorExternalRef,
    fullName: authorName,
  });

  const result = await db.query(
    `
      INSERT INTO public.conversation_note (
        conversation_id,
        lead_id,
        author_user_id,
        body,
        is_internal
      )
      VALUES ($1, $2, $3, $4, TRUE)
      RETURNING id, conversation_id, lead_id, author_user_id, body, is_internal, created_at
    `,
    [lead.conversationId, leadId, authorUserId, body]
  );

  const note = result.rows[0];

  await insertAuditLog({
    entityType: "lead_note",
    entityId: note.id,
    action: "lead.note.created",
    performedBy: authorExternalRef,
    newValue: note,
  });

  return {
    id: Number(note.id),
    conversationId: Number(note.conversation_id),
    leadId: Number(note.lead_id),
    authorUserId: note.author_user_id ? Number(note.author_user_id) : null,
    body: note.body,
    isInternal: Boolean(note.is_internal),
    createdAt: serializeDbTimestamp(note.created_at),
  };
}

async function listLeadNotes(leadId) {
  const result = await db.query(
    `
      SELECT
        n.id,
        n.conversation_id,
        n.lead_id,
        n.author_user_id,
        n.body,
        n.is_internal,
        n.created_at,
        author.external_ref AS author_external_ref,
        author.full_name AS author_full_name
      FROM public.conversation_note n
      LEFT JOIN public.crm_user author
        ON author.id = n.author_user_id
      WHERE n.lead_id = $1
      ORDER BY n.created_at DESC, n.id DESC
    `,
    [leadId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    conversationId: Number(row.conversation_id),
    leadId: Number(row.lead_id),
    body: row.body,
    isInternal: Boolean(row.is_internal),
    author: row.author_user_id
      ? {
          id: Number(row.author_user_id),
          externalRef: row.author_external_ref || null,
          fullName: row.author_full_name || null,
        }
      : null,
    createdAt: serializeDbTimestamp(row.created_at),
  }));
}

async function createPaymentLink({
  leadId,
  provider,
  url,
  amount,
  currency = "MXN",
  externalReference = null,
  status = "pending",
  createdByExternalRef = null,
  createdByName = null,
}) {
  const createdBy = await resolveOrCreateCrmUser({
    externalRef: createdByExternalRef,
    fullName: createdByName,
  });

  const result = await db.query(
    `
      INSERT INTO public.payment_link (
        lead_id,
        provider,
        external_reference,
        url,
        amount,
        currency,
        status,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, lead_id, provider, external_reference, url, amount, currency, status, created_by, created_at
    `,
    [leadId, provider, externalReference, url, amount, currency, status, createdBy]
  );

  const paymentLink = result.rows[0];

  await insertAuditLog({
    entityType: "payment_link",
    entityId: paymentLink.id,
    action: "lead.payment_link.created",
    performedBy: createdByExternalRef,
    newValue: paymentLink,
  });

  return {
    id: Number(paymentLink.id),
    leadId: Number(paymentLink.lead_id),
    provider: paymentLink.provider,
    externalReference: paymentLink.external_reference || null,
    url: paymentLink.url,
    amount: Number(paymentLink.amount),
    currency: paymentLink.currency,
    status: paymentLink.status,
    createdBy: paymentLink.created_by ? Number(paymentLink.created_by) : null,
    createdAt: serializeDbTimestamp(paymentLink.created_at),
  };
}

async function listPaymentLinks(leadId) {
  const result = await db.query(
    `
      SELECT id, lead_id, provider, external_reference, url, amount, currency, status, created_by, created_at
      FROM public.payment_link
      WHERE lead_id = $1
      ORDER BY created_at DESC, id DESC
    `,
    [leadId]
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    leadId: Number(row.lead_id),
    provider: row.provider,
    externalReference: row.external_reference || null,
    url: row.url,
    amount: Number(row.amount),
    currency: row.currency,
    status: row.status,
    createdBy: row.created_by ? Number(row.created_by) : null,
    createdAt: serializeDbTimestamp(row.created_at),
  }));
}

async function listLeadTimeline(leadId) {
  const [messages, notes, tasks, payments, audits] = await Promise.all([
    db.query(
      `
        SELECT m.id, m.conversacion_id, m.rol, m.mensaje, m.fecha
        FROM public.mensajes m
        INNER JOIN public.lead l
          ON l.conversation_id = m.conversacion_id
        WHERE l.id = $1
        ORDER BY m.fecha DESC, m.id DESC
        LIMIT 120
      `,
      [leadId]
    ),
    db.query(
      `
        SELECT id, lead_id, body, created_at
        FROM public.conversation_note
        WHERE lead_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 120
      `,
      [leadId]
    ),
    db.query(
      `
        SELECT id, lead_id, title, status, due_at, created_at
        FROM public.lead_task
        WHERE lead_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 120
      `,
      [leadId]
    ),
    db.query(
      `
        SELECT id, lead_id, provider, amount, status, url, created_at
        FROM public.payment_link
        WHERE lead_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 120
      `,
      [leadId]
    ),
    db.query(
      `
        SELECT id, entity_type, entity_id, action, performed_by, old_value_json, new_value_json, created_at
        FROM public.audit_log
        WHERE (entity_type = 'lead' AND entity_id = $1::text)
           OR (entity_type IN ('lead_task', 'lead_note', 'payment_link')
               AND COALESCE((new_value_json->>'lead_id')::bigint, 0) = $1)
        ORDER BY created_at DESC, id DESC
        LIMIT 180
      `,
      [leadId]
    ),
  ]);

  const events = [];

  for (const row of messages.rows) {
    events.push({
      type: "message",
      occurredAt: serializeDbTimestamp(row.fecha),
      payload: {
        id: Number(row.id),
        conversationId: Number(row.conversacion_id),
        role: row.rol,
        body: row.mensaje,
      },
    });
  }

  for (const row of notes.rows) {
    events.push({
      type: "note",
      occurredAt: serializeDbTimestamp(row.created_at),
      payload: {
        id: Number(row.id),
        leadId: Number(row.lead_id),
        body: row.body,
      },
    });
  }

  for (const row of tasks.rows) {
    events.push({
      type: "task",
      occurredAt: serializeDbTimestamp(row.created_at),
      payload: {
        id: Number(row.id),
        leadId: Number(row.lead_id),
        title: row.title,
        status: row.status,
        dueAt: serializeDbTimestamp(row.due_at),
      },
    });
  }

  for (const row of payments.rows) {
    events.push({
      type: "payment_link",
      occurredAt: serializeDbTimestamp(row.created_at),
      payload: {
        id: Number(row.id),
        leadId: Number(row.lead_id),
        provider: row.provider,
        amount: Number(row.amount),
        status: row.status,
        url: row.url,
      },
    });
  }

  for (const row of audits.rows) {
    events.push({
      type: "audit",
      occurredAt: serializeDbTimestamp(row.created_at),
      payload: {
        id: Number(row.id),
        entityType: row.entity_type,
        entityId: row.entity_id,
        action: row.action,
        performedBy: row.performed_by || null,
        oldValue: row.old_value_json || null,
        newValue: row.new_value_json || null,
      },
    });
  }

  return events.sort((left, right) =>
    String(right.occurredAt || "").localeCompare(String(left.occurredAt || ""))
  );
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
      GROUP BY ss.id, ss.code, ss.name, ss.sort_order, ss.is_closed_won, ss.is_closed_lost
      ORDER BY ss.sort_order ASC, ss.id ASC
    `
  );

  const byStage = result.rows.map((row) => ({
    id: Number(row.id),
    code: row.code,
    name: row.name,
    sortOrder: Number(row.sort_order),
    isClosedWon: Boolean(row.is_closed_won),
    isClosedLost: Boolean(row.is_closed_lost),
    leadCount: Number(row.lead_count || 0),
    totalEstimatedValue: Number(row.total_estimated_value || 0),
  }));

  const totals = byStage.reduce(
    (acc, stage) => {
      acc.totalLeads += stage.leadCount;
      acc.totalEstimatedValue += stage.totalEstimatedValue;

      if (stage.isClosedWon) {
        acc.closedWon += stage.leadCount;
      }

      if (stage.isClosedLost) {
        acc.closedLost += stage.leadCount;
      }

      return acc;
    },
    {
      totalLeads: 0,
      totalEstimatedValue: 0,
      closedWon: 0,
      closedLost: 0,
    }
  );

  return {
    totals,
    byStage,
  };
}

async function getDashboardSummary({ rangeDays = 30 } = {}) {
  const safeRangeDays = Math.min(Math.max(Number(rangeDays) || 30, 1), 365);

  const [baseResult, ownerResult, firstResponseResult] = await Promise.all([
    db.query(
      `
        WITH stage_map AS (
          SELECT id, is_closed_won, is_closed_lost
          FROM public.sales_stage
        )
        SELECT
          COUNT(*) FILTER (
            WHERE l.created_at >= NOW() - ($1::int || ' days')::interval
          )::bigint AS leads_new,
          COUNT(*) FILTER (
            WHERE COALESCE(l.status, 'active') = 'active'
          )::bigint AS leads_active,
          COUNT(*) FILTER (
            WHERE l.next_followup_at IS NOT NULL
              AND l.next_followup_at <= NOW()
              AND COALESCE(l.status, 'active') = 'active'
          )::bigint AS leads_followup_overdue,
          COALESCE(SUM(l.estimated_value) FILTER (
            WHERE sm.is_closed_won IS NOT TRUE
              AND sm.is_closed_lost IS NOT TRUE
              AND COALESCE(l.status, 'active') <> 'archived'
          ), 0)::numeric(14,2) AS open_value,
          COALESCE(SUM(l.estimated_value) FILTER (
            WHERE sm.is_closed_won IS TRUE
          ), 0)::numeric(14,2) AS won_value,
          COALESCE(SUM(l.estimated_value) FILTER (
            WHERE sm.is_closed_lost IS TRUE
          ), 0)::numeric(14,2) AS lost_value,
          COUNT(*) FILTER (WHERE sm.is_closed_won IS TRUE)::bigint AS won_count,
          COUNT(*) FILTER (
            WHERE sm.is_closed_won IS TRUE OR sm.is_closed_lost IS TRUE
          )::bigint AS closed_count
        FROM public.lead l
        LEFT JOIN stage_map sm
          ON sm.id = l.sales_stage_id
      `,
      [safeRangeDays]
    ),
    db.query(
      `
        SELECT
          COALESCE(owner.full_name, owner.external_ref, 'Sin responsable') AS owner_name,
          COUNT(*)::bigint AS lead_count,
          COALESCE(SUM(l.estimated_value), 0)::numeric(14,2) AS estimated_total,
          COUNT(*) FILTER (WHERE ss.is_closed_won IS TRUE)::bigint AS won_count
        FROM public.lead l
        LEFT JOIN public.crm_user owner
          ON owner.id = l.owner_user_id
        LEFT JOIN public.sales_stage ss
          ON ss.id = l.sales_stage_id
        WHERE COALESCE(l.status, 'active') <> 'archived'
        GROUP BY COALESCE(owner.full_name, owner.external_ref, 'Sin responsable')
        ORDER BY won_count DESC, estimated_total DESC, owner_name ASC
        LIMIT 20
      `
    ),
    db.query(
      `
        WITH lead_window AS (
          SELECT
            l.id AS lead_id,
            l.conversation_id
          FROM public.lead l
          WHERE l.created_at >= NOW() - ($1::int || ' days')::interval
        ),
        first_incoming AS (
          SELECT
            lw.lead_id,
            MIN(m.fecha) AS first_incoming_at
          FROM lead_window lw
          INNER JOIN public.mensajes m
            ON m.conversacion_id = lw.conversation_id
          WHERE LOWER(COALESCE(m.rol, '')) = 'user'
          GROUP BY lw.lead_id
        ),
        first_reply AS (
          SELECT
            fi.lead_id,
            MIN(m.fecha) AS first_reply_at
          FROM first_incoming fi
          INNER JOIN lead_window lw
            ON lw.lead_id = fi.lead_id
          INNER JOIN public.mensajes m
            ON m.conversacion_id = lw.conversation_id
          WHERE m.fecha >= fi.first_incoming_at
            AND LOWER(COALESCE(m.rol, '')) <> 'user'
          GROUP BY fi.lead_id
        )
        SELECT
          ROUND(AVG(EXTRACT(EPOCH FROM (fr.first_reply_at - fi.first_incoming_at)) / 60.0)::numeric, 2)
            AS avg_first_response_minutes
        FROM first_incoming fi
        INNER JOIN first_reply fr
          ON fr.lead_id = fi.lead_id
      `,
      [safeRangeDays]
    ),
  ]);

  const base = baseResult.rows[0] || {};
  const conversionRate =
    Number(base.closed_count || 0) > 0
      ? (Number(base.won_count || 0) / Number(base.closed_count || 0)) * 100
      : 0;

  return {
    rangeDays: safeRangeDays,
    leads: {
      new: Number(base.leads_new || 0),
      active: Number(base.leads_active || 0),
      followupOverdue: Number(base.leads_followup_overdue || 0),
    },
    value: {
      open: Number(base.open_value || 0),
      won: Number(base.won_value || 0),
      lost: Number(base.lost_value || 0),
    },
    conversion: {
      wonCount: Number(base.won_count || 0),
      closedCount: Number(base.closed_count || 0),
      rate: Number(conversionRate.toFixed(2)),
    },
    salesByOwner: ownerResult.rows.map((row) => ({
      ownerName: row.owner_name,
      leadCount: Number(row.lead_count || 0),
      estimatedTotal: Number(row.estimated_total || 0),
      wonCount: Number(row.won_count || 0),
    })),
    firstResponse: {
      averageMinutes: Number(firstResponseResult.rows[0]?.avg_first_response_minutes || 0),
    },
  };
}

async function upsertLeadSalesSignals({
  conversationId,
  contactId = null,
  salesStageCode = null,
  estimatedValue = null,
  aiScore = null,
  aiScoreReasons = [],
  intentLabel = null,
  interestSummary = null,
  objections = [],
  nextAction = null,
  lastActivityAt = null,
  status = "active",
}) {
  await db.query(
    `
      INSERT INTO public.lead (
        conversation_id,
        contact_id,
        sales_stage_id,
        estimated_value,
        ai_score,
        ai_score_reasons_json,
        intent_label,
        interest_summary,
        objections_json,
        next_action,
        last_activity_at,
        status,
        sales_stage_manual_override,
        next_action_manual_override,
        updated_at
      )
      VALUES (
        $1,
        $2,
        (
          SELECT id
          FROM public.sales_stage
          WHERE code = $3
          LIMIT 1
        ),
        $4,
        $5,
        $6::jsonb,
        $7,
        $8,
        $9::jsonb,
        $10,
        $11,
        $12,
        FALSE,
        FALSE,
        NOW()
      )
      ON CONFLICT (conversation_id)
      DO UPDATE SET
        contact_id = EXCLUDED.contact_id,
        sales_stage_id = CASE
          WHEN public.lead.sales_stage_manual_override THEN public.lead.sales_stage_id
          ELSE EXCLUDED.sales_stage_id
        END,
        estimated_value = EXCLUDED.estimated_value,
        ai_score = EXCLUDED.ai_score,
        ai_score_reasons_json = EXCLUDED.ai_score_reasons_json,
        intent_label = EXCLUDED.intent_label,
        interest_summary = EXCLUDED.interest_summary,
        objections_json = EXCLUDED.objections_json,
        next_action = CASE
          WHEN public.lead.next_action_manual_override THEN public.lead.next_action
          ELSE EXCLUDED.next_action
        END,
        last_activity_at = EXCLUDED.last_activity_at,
        status = EXCLUDED.status,
        updated_at = NOW()
    `,
    [
      conversationId,
      contactId,
      salesStageCode,
      estimatedValue,
      aiScore,
      JSON.stringify(aiScoreReasons || []),
      intentLabel,
      interestSummary,
      JSON.stringify(objections || []),
      nextAction,
      lastActivityAt,
      status,
    ]
  );
}

module.exports = {
  upsertLeadSalesSignals,
  resolveOrCreateCrmUser,
  insertAuditLog,
  findLeadById,
  findLeadByConversationId,
  ensureLeadByConversationId,
  listLeads,
  updateLead,
  createLeadTask,
  listLeadTasks,
  createLeadNote,
  listLeadNotes,
  createPaymentLink,
  listPaymentLinks,
  listLeadTimeline,
  getPipelineSummary,
  getDashboardSummary,
};
