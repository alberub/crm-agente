const db = require("../db");

async function findLatestOrderByConversationId(conversationId) {
  const result = await db.query(
    `
      SELECT
        p.id,
        p.total,
        p.estado,
        p.direccion_entrega,
        p.fecha_creacion,
        p.fecha_entrega,
        p.hora_entrega_inicio,
        p.hora_entrega_fin,
        p.estatus_entrega,
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
    direccionEntrega: row.direccion_entrega || null,
    fechaCreacion: row.fecha_creacion,
    fechaEntrega: row.fecha_entrega,
    horaEntregaInicio: row.hora_entrega_inicio,
    horaEntregaFin: row.hora_entrega_fin,
    estatusEntrega: row.estatus_entrega || null,
    productoNombre: row.producto_nombre || null,
    sucursalNombre: row.sucursal_nombre || null,
  };
}

module.exports = {
  findLatestOrderByConversationId,
};
