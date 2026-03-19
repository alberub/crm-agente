const express = require("express");
const cors = require("cors");
const { corsOrigins } = require("./config/env");
const healthRouter = require("./routes/health");
const whatsappRouter = require("./routes/whatsapp");
const { notFound } = require("./middlewares/notFound");
const { errorHandler } = require("./middlewares/errorHandler");

const app = express();

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origen no permitido por CORS."));
    },
  })
);
app.use(express.json());

app.use(healthRouter);
app.use(whatsappRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
