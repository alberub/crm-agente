const express = require("express");
const { requireRoles } = require("../middlewares/authentication");
const { listTasks, updateTask } = require("../repositories/leadRepository");
const { AppError } = require("../utils/errors");

const router = express.Router();

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

router.patch("/api/tasks/:id", requireRoles(["admin", "manager", "agent"]), async (req, res, next) => {
  try {
    const taskId = parseTaskId(req.params.id);
    const task = await updateTask({
      taskId,
      patch: {
        status: req.body.status,
        dueAt: req.body.dueAt,
      },
      actorRef: req.auth.actorRef,
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
