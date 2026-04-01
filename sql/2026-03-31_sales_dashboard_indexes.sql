BEGIN;

CREATE INDEX IF NOT EXISTS idx_lead_created_at
  ON public.lead (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_status_followup
  ON public.lead (status, next_followup_at);

CREATE INDEX IF NOT EXISTS idx_lead_stage_status
  ON public.lead (sales_stage_id, status);

CREATE INDEX IF NOT EXISTS idx_lead_owner_stage
  ON public.lead (owner_user_id, sales_stage_id);

CREATE INDEX IF NOT EXISTS idx_mensajes_conversacion_rol_fecha
  ON public.mensajes (conversacion_id, rol, fecha);

COMMIT;

