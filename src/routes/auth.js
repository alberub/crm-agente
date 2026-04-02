const express = require("express");
const { sessionCookieName } = require("../config/env");
const { AppError } = require("../utils/errors");
const {
  authenticateUser,
  logoutSession,
} = require("../services/authService");
const {
  clearSessionCookie,
  getSessionCookieOptions,
  requireAuth,
} = require("../middlewares/authentication");

const router = express.Router();

router.post("/auth/login", async (req, res, next) => {
  try {
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      throw new AppError("Debes enviar email y password.", 400);
    }

    const session = await authenticateUser({
      email,
      password,
      ipAddress: req.ip,
      userAgent: req.get("user-agent") || null,
    });

    res.cookie(
      sessionCookieName,
      session.sessionToken,
      getSessionCookieOptions()
    );

    res.status(200).json({
      user: session.user,
      expiresAt: session.expiresAt.toISOString(),
    });
  } catch (error) {
    if (error.message === "INVALID_CREDENTIALS") {
      return next(new AppError("Credenciales invalidas.", 401));
    }

    if (error.message === "TOO_MANY_ATTEMPTS") {
      res.setHeader("Retry-After", String(error.retryAfterSeconds || 60));
      return next(
        new AppError(
          "Demasiados intentos fallidos. Espera antes de volver a intentar.",
          429
        )
      );
    }

    return next(error);
  }
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.status(200).json({
    user: req.auth.user,
  });
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    const actorRef = req.auth?.actorRef || null;

    if (req.auth?.sessionToken) {
      await logoutSession(req.auth.sessionToken, actorRef);
    }

    clearSessionCookie(res);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
