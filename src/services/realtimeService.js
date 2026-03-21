const { createClient } = require("../db");

const REALTIME_CHANNEL = "conversation_events";
const HEARTBEAT_INTERVAL_MS = 15000;
const RECONNECT_DELAY_MS = 3000;

const clients = new Map();
let heartbeat = null;
let listenerClient = null;
let reconnectTimer = null;
let shuttingDown = false;

function ensureBucket(key) {
  if (!clients.has(key)) {
    clients.set(key, new Set());
  }

  return clients.get(key);
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function broadcast(key, event, data) {
  const bucket = clients.get(key);

  if (!bucket || bucket.size === 0) {
    return;
  }

  for (const res of bucket) {
    sendSse(res, event, data);
  }
}

function removeClient(targetRes) {
  for (const [key, bucket] of clients.entries()) {
    if (!bucket.delete(targetRes)) {
      continue;
    }

    if (bucket.size === 0) {
      clients.delete(key);
    }

    break;
  }
}

function addClient({ res, conversationId = null }) {
  const bucketKey = conversationId ? `conversation:${conversationId}` : "all";

  ensureBucket(bucketKey).add(res);
  sendSse(res, "ready", {
    conversationId,
    connectedAt: new Date().toISOString(),
  });

  res.on("close", () => {
    removeClient(res);
  });
}

function startHeartbeat() {
  if (heartbeat) {
    return;
  }

  heartbeat = setInterval(() => {
    for (const bucket of clients.values()) {
      for (const res of bucket) {
        res.write(": keep-alive\n\n");
      }
    }
  }, HEARTBEAT_INTERVAL_MS);

  heartbeat.unref?.();
}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const conversationId = Number(payload.conversationId ?? payload.conversacionId);

  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return null;
  }

  return {
    ...payload,
    conversationId,
    messageId: Number(payload.messageId ?? payload.id ?? 0) || null,
  };
}

function handleNotification(message) {
  if (!message || message.channel !== REALTIME_CHANNEL || !message.payload) {
    return;
  }

  let parsedPayload = null;

  try {
    parsedPayload = normalizePayload(JSON.parse(message.payload));
  } catch (error) {
    console.error("No se pudo parsear payload realtime:", error);
    return;
  }

  if (!parsedPayload) {
    return;
  }

  broadcast("all", "message.created", parsedPayload);
  broadcast(
    `conversation:${parsedPayload.conversationId}`,
    "message.created",
    parsedPayload
  );
}

async function connectListener() {
  const client = createClient({
    application_name: "crm-agente-realtime",
  });

  await client.connect();
  await client.query(`LISTEN ${REALTIME_CHANNEL}`);

  client.on("notification", handleNotification);
  client.on("error", (error) => {
    console.error("Conexion realtime de Postgres fallo:", error);
  });
  client.on("end", () => {
    listenerClient = null;

    if (!shuttingDown) {
      scheduleReconnect();
    }
  });

  listenerClient = client;
  console.log(`Realtime LISTEN activo en canal "${REALTIME_CHANNEL}".`);
}

function scheduleReconnect() {
  if (reconnectTimer || shuttingDown) {
    return;
  }

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;

    try {
      await connectListener();
    } catch (error) {
      console.error("No se pudo reconectar listener realtime:", error);
      scheduleReconnect();
    }
  }, RECONNECT_DELAY_MS);

  reconnectTimer.unref?.();
}

async function initRealtime() {
  startHeartbeat();

  try {
    await connectListener();
  } catch (error) {
    console.error("No se pudo iniciar realtime al arrancar:", error);
    scheduleReconnect();
  }
}

async function closeRealtime() {
  shuttingDown = true;

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }

  if (listenerClient) {
    await listenerClient.end().catch(() => {});
    listenerClient = null;
  }
}

module.exports = {
  addClient,
  closeRealtime,
  initRealtime,
};
