BEGIN;

INSERT INTO public.cat_estados_conversacion (nombre)
SELECT stage_name
FROM (
  VALUES
    ('esperando_confirmacion'),
    ('pendiente_comprobante'),
    ('validando_pago'),
    ('pedido_confirmado'),
    ('preparando_entrega'),
    ('en_ruta'),
    ('entregado'),
    ('entrega_fallida'),
    ('cancelado')
) AS staged(stage_name)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.cat_estados_conversacion existing
  WHERE existing.nombre = staged.stage_name
);

UPDATE public.conversaciones c
SET
  estado = CASE
    WHEN LOWER(COALESCE(p.estatus_entrega, '')) IN ('entregado', 'entrega_completada', 'completado', 'recogido') THEN 'entregado'
    WHEN LOWER(COALESCE(p.estatus_entrega, '')) LIKE '%ruta%' THEN 'en_ruta'
    WHEN LOWER(COALESCE(p.estatus_entrega, '')) LIKE '%prepar%' OR LOWER(COALESCE(p.estatus_entrega, '')) LIKE '%recoleccion%' THEN 'preparando_entrega'
    WHEN LOWER(COALESCE(p.estado_pago, '')) IN ('confirmado', 'validado', 'cobrado_al_entregar') THEN 'pedido_confirmado'
    WHEN LOWER(COALESCE(p.estado_pago, '')) LIKE '%valid%' THEN 'validando_pago'
    WHEN LOWER(COALESCE(p.estado_pago, '')) LIKE '%pend%' THEN 'pendiente_comprobante'
    ELSE c.estado
  END,
  estado_id = (
    SELECT ce.id
    FROM public.cat_estados_conversacion ce
    WHERE ce.nombre = CASE
      WHEN LOWER(COALESCE(p.estatus_entrega, '')) IN ('entregado', 'entrega_completada', 'completado', 'recogido') THEN 'entregado'
      WHEN LOWER(COALESCE(p.estatus_entrega, '')) LIKE '%ruta%' THEN 'en_ruta'
      WHEN LOWER(COALESCE(p.estatus_entrega, '')) LIKE '%prepar%' OR LOWER(COALESCE(p.estatus_entrega, '')) LIKE '%recoleccion%' THEN 'preparando_entrega'
      WHEN LOWER(COALESCE(p.estado_pago, '')) IN ('confirmado', 'validado', 'cobrado_al_entregar') THEN 'pedido_confirmado'
      WHEN LOWER(COALESCE(p.estado_pago, '')) LIKE '%valid%' THEN 'validando_pago'
      WHEN LOWER(COALESCE(p.estado_pago, '')) LIKE '%pend%' THEN 'pendiente_comprobante'
      ELSE c.estado
    END
    LIMIT 1
  )
FROM public.pedidos p
WHERE p.conversacion_id = c.id;

COMMIT;
