BEGIN;

CREATE TABLE IF NOT EXISTS public.sales_stage (
  id BIGSERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  is_closed_won BOOLEAN NOT NULL DEFAULT FALSE,
  is_closed_lost BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.sales_stage (code, name, sort_order, is_closed_won, is_closed_lost)
VALUES
  ('nuevo_lead', 'Nuevo lead', 10, FALSE, FALSE),
  ('contactado', 'Contactado', 20, FALSE, FALSE),
  ('interesado', 'Interesado', 30, FALSE, FALSE),
  ('cotizacion_enviada', 'Cotizacion enviada', 40, FALSE, FALSE),
  ('seguimiento', 'Seguimiento', 50, FALSE, FALSE),
  ('negociacion', 'Negociacion', 60, FALSE, FALSE),
  ('pago_pendiente', 'Pago pendiente', 70, FALSE, FALSE),
  ('venta_cerrada', 'Venta cerrada', 80, TRUE, FALSE),
  ('perdido', 'Perdido', 90, FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_closed_won = EXCLUDED.is_closed_won,
  is_closed_lost = EXCLUDED.is_closed_lost,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS public.crm_user (
  id BIGSERIAL PRIMARY KEY,
  external_ref TEXT NULL UNIQUE,
  full_name TEXT NOT NULL,
  email TEXT NULL UNIQUE,
  role_code TEXT NOT NULL DEFAULT 'seller',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lead (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL UNIQUE REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  contact_id BIGINT NULL REFERENCES public.clientes_floreria(id) ON DELETE SET NULL,
  owner_user_id BIGINT NULL REFERENCES public.crm_user(id) ON DELETE SET NULL,
  sales_stage_id BIGINT NULL REFERENCES public.sales_stage(id) ON DELETE SET NULL,
  source TEXT NULL,
  channel TEXT NULL DEFAULT 'whatsapp',
  priority TEXT NOT NULL DEFAULT 'media',
  estimated_value NUMERIC(12,2) NULL,
  temperature TEXT NULL,
  ai_score INTEGER NULL CHECK (ai_score BETWEEN 0 AND 100),
  ai_score_reasons_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  intent_label TEXT NULL,
  sentiment TEXT NULL,
  interest_summary TEXT NULL,
  objections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  next_action TEXT NULL,
  next_followup_at TIMESTAMPTZ NULL,
  loss_reason TEXT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  last_activity_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lead_stage ON public.lead (sales_stage_id);
CREATE INDEX IF NOT EXISTS idx_lead_owner ON public.lead (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_lead_status ON public.lead (status);
CREATE INDEX IF NOT EXISTS idx_lead_score ON public.lead (ai_score DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_lead_followup ON public.lead (next_followup_at);

CREATE TABLE IF NOT EXISTS public.lead_task (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  assigned_to BIGINT NULL REFERENCES public.crm_user(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NULL,
  due_at TIMESTAMPTZ NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by BIGINT NULL REFERENCES public.crm_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.lead_tag (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  tag TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lead_id, tag)
);

CREATE TABLE IF NOT EXISTS public.conversation_note (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  lead_id BIGINT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  author_user_id BIGINT NULL REFERENCES public.crm_user(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.ai_summary (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  lead_id BIGINT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  summary_text TEXT NOT NULL,
  next_action_suggestion TEXT NULL,
  stage_suggestion_code TEXT NULL,
  detected_objections_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_name TEXT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  performed_by TEXT NULL,
  old_value_json JSONB NULL,
  new_value_json JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.audit_log (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.payment_link (
  id BIGSERIAL PRIMARY KEY,
  lead_id BIGINT NOT NULL REFERENCES public.lead(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_reference TEXT NULL,
  url TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'MXN',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by BIGINT NULL REFERENCES public.crm_user(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_link_lead ON public.payment_link (lead_id, created_at DESC);

INSERT INTO public.lead (
  conversation_id,
  contact_id,
  sales_stage_id,
  source,
  channel,
  estimated_value,
  intent_label,
  interest_summary,
  status,
  last_activity_at,
  created_at,
  updated_at
)
SELECT
  c.id AS conversation_id,
  c.cliente_id AS contact_id,
  (
    SELECT ss.id
    FROM public.sales_stage ss
    WHERE ss.code = CASE
      WHEN LOWER(COALESCE(c.estado, '')) IN ('pago_confirmado', 'compra_completada', 'cerrado_ganado', 'ganado') THEN 'venta_cerrada'
      WHEN LOWER(COALESCE(c.estado, '')) IN ('esperando_producto', 'cotizacion', 'propuesta_enviada') THEN 'cotizacion_enviada'
      WHEN LOWER(COALESCE(c.estado, '')) IN ('esperando_direccion', 'seguimiento') THEN 'seguimiento'
      WHEN LOWER(COALESCE(c.estado, '')) IN ('calificado', 'interesado') THEN 'interesado'
      WHEN LOWER(COALESCE(c.estado, '')) IN ('inicio', 'nuevo', 'lead_nuevo', 'comentario') THEN 'nuevo_lead'
      ELSE 'contactado'
    END
    LIMIT 1
  ) AS sales_stage_id,
  COALESCE(ci.nombre, 'whatsapp_inbound') AS source,
  'whatsapp' AS channel,
  (
    SELECT p.total
    FROM public.pedidos p
    WHERE p.conversacion_id = c.id
    ORDER BY p.id DESC
    LIMIT 1
  ) AS estimated_value,
  ci.nombre AS intent_label,
  cc.tipo_categoria AS interest_summary,
  CASE WHEN c.activa THEN 'active' ELSE 'archived' END AS status,
  c.ultima_interaccion AS last_activity_at,
  COALESCE(c.ultima_interaccion, NOW()) AS created_at,
  COALESCE(c.ultima_interaccion, NOW()) AS updated_at
FROM public.conversaciones c
LEFT JOIN public.cat_intenciones ci
  ON ci.id = c.intencion_id
LEFT JOIN public.cat_categorias cc
  ON cc.id = c.categoria_id
ON CONFLICT (conversation_id) DO NOTHING;

COMMIT;
