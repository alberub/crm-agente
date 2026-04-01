const express = require("express");
const cors = require("cors");
const { corsOrigins } = require("./config/env");
const healthRouter = require("./routes/health");
const leadsRouter = require("./routes/leads");
const salesRouter = require("./routes/sales");
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
app.use(salesRouter);
app.use(leadsRouter);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
