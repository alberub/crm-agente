const app = require("./app");
const { crmPort, validateEnv } = require("./config/env");

validateEnv();

app.listen(crmPort, () => {
  console.log(`CRM API escuchando en http://localhost:${crmPort}`);
});
