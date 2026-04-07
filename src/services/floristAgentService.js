const { floristAgentBaseUrl } = require("../config/env");
const { AppError } = require("../utils/errors");

function resolveBaseUrl() {
  return String(floristAgentBaseUrl || "")
    .trim()
    .replace(/\/+$/, "");
}

async function requestBotReplyForConversation({
  conversationId,
  timeoutMs = 12000,
  forceReply = false,
}) {
  const baseUrl = resolveBaseUrl();

  if (!baseUrl) {
    return {
      ok: false,
      skipped: "missing_florist_agent_base_url",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/agent/reply-last-customer`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        deliverToCustomer: true,
        forceReply,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new AppError("No se pudo solicitar respuesta al bot de floreria.", 502, {
        provider: "florist-agent",
        response: errorText,
      });
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  requestBotReplyForConversation,
};
