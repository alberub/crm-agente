const db = require("../db");

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
        NOW()
      )
      ON CONFLICT (conversation_id)
      DO UPDATE SET
        contact_id = EXCLUDED.contact_id,
        sales_stage_id = EXCLUDED.sales_stage_id,
        estimated_value = EXCLUDED.estimated_value,
        ai_score = EXCLUDED.ai_score,
        ai_score_reasons_json = EXCLUDED.ai_score_reasons_json,
        intent_label = EXCLUDED.intent_label,
        interest_summary = EXCLUDED.interest_summary,
        objections_json = EXCLUDED.objections_json,
        next_action = EXCLUDED.next_action,
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
};
