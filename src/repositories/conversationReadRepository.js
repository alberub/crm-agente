const db = require("../db");

async function upsertConversationRead({
  conversationId,
  agentId,
  lastReadMessageId = null,
}) {
  const result = await db.query(
    `
      INSERT INTO public.conversation_reads (
        conversation_id,
        agent_id,
        last_read_message_id,
        last_read_at
      )
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (conversation_id, agent_id)
      DO UPDATE SET
        last_read_message_id = GREATEST(
          COALESCE(public.conversation_reads.last_read_message_id, 0),
          COALESCE(EXCLUDED.last_read_message_id, 0)
        ),
        last_read_at = NOW()
      RETURNING
        conversation_id,
        agent_id,
        last_read_message_id,
        last_read_at
    `,
    [conversationId, agentId, lastReadMessageId]
  );

  return result.rows[0] || null;
}

async function findConversationRead({ conversationId, agentId }) {
  const result = await db.query(
    `
      SELECT
        conversation_id,
        agent_id,
        last_read_message_id,
        last_read_at
      FROM public.conversation_reads
      WHERE conversation_id = $1 AND agent_id = $2
      LIMIT 1
    `,
    [conversationId, agentId]
  );

  return result.rows[0] || null;
}

module.exports = {
  findConversationRead,
  upsertConversationRead,
};
