const express = require("express");
const cors = require("cors");
const { corsOrigins } = require("./config/env");
const authRouter = require("./routes/auth");
const healthRouter = require("./routes/health");
const leadsRouter = require("./routes/leads");
const salesRouter = require("./routes/sales");
const tasksRouter = require("./routes/tasks");
const whatsappRouter = require("./routes/whatsapp");
const {
  attachAuthContext,
  requireAuth,
} = require("./middlewares/authentication");
const { notFound } = require("./middlewares/notFound");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origen no permitido por CORS."));
    },
  })
);
app.use(express.json());
app.use(attachAuthContext);

app.use(healthRouter);
app.use(authRouter);
app.use(requireAuth, salesRouter);
app.use(requireAuth, leadsRouter);
app.use(requireAuth, tasksRouter);
app.use(requireAuth, whatsappRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
