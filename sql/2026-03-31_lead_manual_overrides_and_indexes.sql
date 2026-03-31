BEGIN;

ALTER TABLE public.lead
  ADD COLUMN IF NOT EXISTS sales_stage_manual_override BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.lead
  ADD COLUMN IF NOT EXISTS next_action_manual_override BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_lead_manual_override
  ON public.lead (sales_stage_manual_override, next_action_manual_override);

CREATE INDEX IF NOT EXISTS idx_lead_task_due_status
  ON public.lead_task (lead_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_conversation_note_lead_created
  ON public.conversation_note (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_link_status_created
  ON public.payment_link (lead_id, status, created_at DESC);

COMMIT;
