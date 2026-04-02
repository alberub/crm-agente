const {
  sessionCookieName,
  sessionCookieSameSite,
  sessionCookieSecure,
  sessionTtlHours,
} = require("../config/env");
const { hasAnyRole } = require("../auth/accessControl");
const { resolveSession } = require("../services/authService");

function parseCookieHeader(cookieHeader) {
  return String(cookieHeader || "")
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, pair) => {
      const separatorIndex = pair.indexOf("=");

      if (separatorIndex === -1) {
        return acc;
      }

      const key = pair.slice(0, separatorIndex).trim();
      const value = pair.slice(separatorIndex + 1).trim();

      if (key) {
        acc[key] = decodeURIComponent(value);
      }

      return acc;
    }, {});
}

function getSessionCookieOptions() {
  return {
    httpOnly: true,
    maxAge: Math.max(sessionTtlHours, 1) * 60 * 60 * 1000,
    path: "/",
    sameSite: sessionCookieSameSite,
    secure: sessionCookieSecure,
  };
}

function clearSessionCookie(res) {
  res.clearCookie(sessionCookieName, {
    httpOnly: true,
    path: "/",
    sameSite: sessionCookieSameSite,
    secure: sessionCookieSecure,
  });
}

async function attachAuthContext(req, res, next) {
  try {
    const cookies = parseCookieHeader(req.headers.cookie);
    const sessionToken = cookies[sessionCookieName] || null;

    req.auth = {
      actorRef: null,
      isAuthenticated: false,
      session: null,
      user: null,
    };

    if (!sessionToken) {
      return next();
    }

    const session = await resolveSession(sessionToken);

    if (!session) {
      clearSessionCookie(res);
      return next();
    }

    req.auth = {
      actorRef: session.user.actorRef,
      isAuthenticated: true,
      session,
      sessionToken,
      user: session.user,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAuth(req, res, next) {
  if (req.auth?.isAuthenticated) {
    return next();
  }

  return res.status(401).json({
    error: "Debes iniciar sesion para continuar.",
  });
}

function requireRoles(roles = []) {
  return (req, res, next) => {
    if (!req.auth?.isAuthenticated) {
      return res.status(401).json({
        error: "Debes iniciar sesion para continuar.",
      });
    }

    if (hasAnyRole(req.auth.user?.roleCode, roles)) {
      return next();
    }

    return res.status(403).json({
      error: "No tienes permisos para realizar esta accion.",
    });
  };
}

module.exports = {
  attachAuthContext,
  clearSessionCookie,
  getSessionCookieOptions,
  requireAuth,
  requireRoles,
};
