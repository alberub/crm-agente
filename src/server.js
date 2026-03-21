const app = require("./app");
const { crmPort, validateEnv } = require("./config/env");
const { closeRealtime, initRealtime } = require("./services/realtimeService");

validateEnv();

async function startServer() {
  await initRealtime();

  const server = app.listen(crmPort, () => {
    console.log(`CRM API escuchando en http://localhost:${crmPort}`);
  });

  const shutdown = async () => {
    await closeRealtime();

    server.close(() => {
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("No se pudo iniciar CRM API:", error);
  process.exit(1);
});
