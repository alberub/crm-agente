const db = require("../db");
const { serializeDbTimestamp } = require("../utils/datetime");

async function findLatestOrderByConversationId(conversationId) {
  const result = await db.query(
    `
      SELECT
        p.id,
        p.total,
        p.estado,
        p.tipo_entrega,
        p.metodo_pago,
        p.estado_pago,
        p.comprobante_pago_url,
        p.comprobante_pago_validado,
        p.comprobante_pago_validado_at,
        p.direccion_entrega,
        p.direccion_validada,
        p.fecha_creacion,
        p.fecha_entrega,
        p.hora_entrega_inicio,
        p.hora_entrega_fin,
        p.estatus_entrega,
        p.horario_confirmado,
        p.repartidor_nombre,
        p.entrega_at,
        p.entrega_fallida_at,
        pr.nombre AS producto_nombre,
        s.nombre AS sucursal_nombre
      FROM public.pedidos p
      LEFT JOIN public.productos pr
        ON pr.id = p.producto_id
      LEFT JOIN public.sucursales s
        ON s.id = p.sucursal_id
      WHERE p.conversacion_id = $1
      ORDER BY p.id DESC
      LIMIT 1
    `,
    [conversationId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];

  return {
    id: Number(row.id),
    total: Number(row.total || 0),
    estado: row.estado || null,
    tipoEntrega: row.tipo_entrega || null,
    metodoPago: row.metodo_pago || null,
    estadoPago: row.estado_pago || null,
    comprobantePagoUrl: row.comprobante_pago_url || null,
    comprobantePagoValidado: Boolean(row.comprobante_pago_validado),
    comprobantePagoValidadoAt: serializeDbTimestamp(row.comprobante_pago_validado_at),
    direccionEntrega: row.direccion_entrega || null,
    direccionValidada: Boolean(row.direccion_validada),
    fechaCreacion: serializeDbTimestamp(row.fecha_creacion),
    fechaEntrega: serializeDbTimestamp(row.fecha_entrega),
    horaEntregaInicio: row.hora_entrega_inicio,
    horaEntregaFin: row.hora_entrega_fin,
    estatusEntrega: row.estatus_entrega || null,
    horarioConfirmado: Boolean(row.horario_confirmado),
    repartidorNombre: row.repartidor_nombre || null,
    entregaAt: serializeDbTimestamp(row.entrega_at),
    entregaFallidaAt: serializeDbTimestamp(row.entrega_fallida_at),
    productoNombre: row.producto_nombre || null,
    sucursalNombre: row.sucursal_nombre || null,
  };
}

module.exports = {
  findLatestOrderByConversationId,
};
