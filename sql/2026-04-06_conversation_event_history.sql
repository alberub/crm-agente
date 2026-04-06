BEGIN;

CREATE TABLE IF NOT EXISTS public.conversation_event (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  event_code TEXT NOT NULL,
  actor_type TEXT NULL,
  actor_ref TEXT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_event_conversation_occurred
  ON public.conversation_event (conversation_id, occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_event_code
  ON public.conversation_event (event_code);

COMMIT;
