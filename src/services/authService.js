const crypto = require("crypto");
const {
  authBootstrapAdminEmail,
  authBootstrapAdminExternalRef,
  authBootstrapAdminName,
  authBootstrapAdminPassword,
  sessionTtlHours,
} = require("../config/env");
const { insertAuditLog } = require("../repositories/leadRepository");
const {
  createSession,
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  ensureAuthSchema,
  findSessionByTokenHash,
  findUserByEmail,
  markUserLoggedIn,
  touchSession,
  upsertBootstrapAdmin,
} = require("../repositories/authRepository");
const { hashPassword, verifyPassword } = require("./passwordService");
const {
  assertLoginAllowed,
  clearFailures,
  recordFailure,
} = require("./loginAttemptService");

const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function buildActorRef(user) {
  return (
    String(user?.externalRef || "").trim() ||
    String(user?.email || "").trim().toLowerCase() ||
    `crm-user-${user?.id || "anon"}`
  );
}

function sanitizeUser(user) {
  if (!user) {
    return null;
  }

  return {
    id: user.id,
    externalRef: user.externalRef,
    actorRef: buildActorRef(user),
    fullName: user.fullName,
    email: user.email,
    roleCode: user.roleCode,
    permissions: user.permissions,
    status: user.status,
    lastLoginAt: user.lastLoginAt,
  };
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashSessionToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

async function initializeAuth() {
  await ensureAuthSchema();
  await deleteExpiredSessions();

  if (authBootstrapAdminEmail && authBootstrapAdminPassword) {
    await upsertBootstrapAdmin({
      email: authBootstrapAdminEmail,
      passwordHash: hashPassword(authBootstrapAdminPassword),
      fullName: authBootstrapAdminName,
      externalRef:
        authBootstrapAdminExternalRef ||
        authBootstrapAdminEmail.split("@")[0].trim().toLowerCase(),
    });
  } else {
    console.warn(
      "Auth bootstrap incompleto: define AUTH_BOOTSTRAP_ADMIN_EMAIL y AUTH_BOOTSTRAP_ADMIN_PASSWORD para crear el administrador inicial."
    );
  }
}

async function authenticateUser({ email, password, ipAddress, userAgent }) {
  const context = { email, ipAddress };
  await deleteExpiredSessions();
  assertLoginAllowed(context);

  const user = await findUserByEmail(email);

  if (
    !user ||
    user.status !== "active" ||
    !user.passwordHash ||
    !verifyPassword(password, user.passwordHash)
  ) {
    recordFailure(context);
    throw new Error("INVALID_CREDENTIALS");
  }

  clearFailures(context);

  const sessionToken = createSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const expiresAt = new Date(Date.now() + Math.max(sessionTtlHours, 1) * 60 * 60 * 1000);

  await createSession({
    sessionTokenHash,
    userId: user.id,
    expiresAt,
    ipAddress,
    userAgent,
  });
  await markUserLoggedIn(user.id);

  try {
    await insertAuditLog({
      entityType: "auth_session",
      entityId: `${user.id}:${sessionTokenHash.slice(0, 12)}`,
      action: "auth.login.succeeded",
      performedBy: buildActorRef(user),
      newValue: {
        userId: user.id,
        email: user.email,
        roleCode: user.roleCode,
      },
    });
  } catch (_error) {
    // Ignore audit failures so auth stays available.
  }

  return {
    sessionToken,
    expiresAt,
    user: sanitizeUser(user),
  };
}

async function resolveSession(sessionToken) {
  if (!sessionToken) {
    return null;
  }

  const session = await findSessionByTokenHash(hashSessionToken(sessionToken));

  if (!session || !session.user || session.user.status !== "active") {
    return null;
  }

  const expiresAt = new Date(session.expiresAt);

  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    await deleteSessionByTokenHash(hashSessionToken(sessionToken));
    return null;
  }

  const lastSeenAt = new Date(session.lastSeenAt || 0);

  if (
    Number.isNaN(lastSeenAt.getTime()) ||
    Date.now() - lastSeenAt.getTime() >= SESSION_TOUCH_INTERVAL_MS
  ) {
    await touchSession(session.id);
  }

  return {
    id: session.id,
    expiresAt: session.expiresAt,
    user: sanitizeUser(session.user),
  };
}

async function logoutSession(sessionToken, actorRef = null) {
  if (!sessionToken) {
    return;
  }

  const sessionTokenHash = hashSessionToken(sessionToken);

  await deleteSessionByTokenHash(sessionTokenHash);

  try {
    await insertAuditLog({
      entityType: "auth_session",
      entityId: sessionTokenHash.slice(0, 12),
      action: "auth.logout",
      performedBy: actorRef,
    });
  } catch (_error) {
    // Ignore audit failures so logout stays available.
  }
}

module.exports = {
  authenticateUser,
  buildActorRef,
  initializeAuth,
  logoutSession,
  resolveSession,
  sanitizeUser,
};
