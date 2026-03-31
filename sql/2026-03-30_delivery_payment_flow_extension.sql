BEGIN;

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS metodo_pago TEXT NULL,
  ADD COLUMN IF NOT EXISTS estado_pago TEXT NULL,
  ADD COLUMN IF NOT EXISTS comprobante_pago_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS comprobante_pago_validado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS comprobante_pago_validado_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS direccion_validada BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS horario_confirmado BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS repartidor_nombre TEXT NULL,
  ADD COLUMN IF NOT EXISTS entrega_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS entrega_fallida_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_pedidos_estado_pago
  ON public.pedidos (estado_pago);

CREATE INDEX IF NOT EXISTS idx_pedidos_estatus_entrega
  ON public.pedidos (estatus_entrega);

UPDATE public.pedidos
SET
  estado_pago = CASE
    WHEN LOWER(COALESCE(metodo_pago, '')) IN ('contraentrega', 'contra entrega') THEN COALESCE(estado_pago, 'pendiente_contraentrega')
    WHEN LOWER(COALESCE(estado, '')) LIKE '%pag%' OR LOWER(COALESCE(estado, '')) LIKE '%confirm%' THEN COALESCE(estado_pago, 'confirmado')
    ELSE COALESCE(estado_pago, 'pendiente')
  END,
  metodo_pago = COALESCE(metodo_pago, 'transferencia')
WHERE metodo_pago IS NULL
   OR estado_pago IS NULL;

INSERT INTO public.sales_stage (code, name, sort_order, is_closed_won, is_closed_lost)
VALUES
  ('nuevo_lead', 'Nuevo lead', 10, FALSE, FALSE),
  ('contactado', 'Contactado', 20, FALSE, FALSE),
  ('interesado', 'Interesado', 30, FALSE, FALSE),
  ('cotizacion_enviada', 'Cotizacion enviada', 40, FALSE, FALSE),
  ('esperando_confirmacion', 'Esperando confirmacion', 50, FALSE, FALSE),
  ('pendiente_comprobante', 'Pendiente de comprobante', 60, FALSE, FALSE),
  ('validando_pago', 'Validando pago', 70, FALSE, FALSE),
  ('pedido_confirmado', 'Pedido confirmado', 80, FALSE, FALSE),
  ('preparando_entrega', 'Preparando entrega', 90, FALSE, FALSE),
  ('en_ruta', 'En ruta', 100, FALSE, FALSE),
  ('entregado', 'Entregado', 110, TRUE, FALSE),
  ('entrega_fallida', 'Entrega fallida', 120, FALSE, TRUE),
  ('cancelado', 'Cancelado', 130, FALSE, TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  is_closed_won = EXCLUDED.is_closed_won,
  is_closed_lost = EXCLUDED.is_closed_lost,
  updated_at = NOW();

COMMIT;
