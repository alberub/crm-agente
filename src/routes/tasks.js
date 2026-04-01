const express = require("express");
const { listTasks, updateTask } = require("../repositories/leadRepository");
const { AppError } = require("../utils/errors");

const router = express.Router();

function readActorRef(req) {
  const headerAgentId = req.header("x-agent-id");
  const queryAgentId = req.query.agentId;
  const bodyAgentId = req.body?.agentId;

  return String(headerAgentId || queryAgentId || bodyAgentId || "").trim() || null;
}

function parseTaskId(value) {
  const taskId = Number(value);

  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw new AppError("ID de tarea invalido.", 400);
  }

  return taskId;
}

router.get("/api/tasks", async (req, res, next) => {
  try {
    const tasks = await listTasks({
      status: String(req.query.status || "").trim() || null,
      dueBucket: String(req.query.dueBucket || "").trim() || null,
      ownerExternalRef: String(req.query.owner || "").trim() || null,
      limit: req.query.limit,
    });

    res.status(200).json({ tasks });
  } catch (error) {
    next(error);
  }
});

router.patch("/api/tasks/:id", async (req, res, next) => {
  try {
    const taskId = parseTaskId(req.params.id);
    const task = await updateTask({
      taskId,
      patch: {
        status: req.body.status,
        dueAt: req.body.dueAt,
      },
      actorRef: readActorRef(req),
    });

    if (!task) {
      throw new AppError("Tarea no encontrada.", 404);
    }

    res.status(200).json({ task });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
