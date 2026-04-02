const db = require("../db");
const {
  normalizeRoleCode,
  getPermissionsForRole,
} = require("../auth/accessControl");

function mapUser(row) {
  if (!row) {
    return null;
  }

  const roleCode = normalizeRoleCode(row.role_code);

  return {
    id: Number(row.id),
    externalRef: row.external_ref || null,
    fullName: row.full_name || null,
    email: row.email || null,
    roleCode,
    permissions: getPermissionsForRole(roleCode),
    status: row.status || "active",
    passwordHash: row.password_hash || null,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

async function ensureAuthSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.crm_user (
      id BIGSERIAL PRIMARY KEY,
      external_ref TEXT UNIQUE,
      full_name TEXT NOT NULL DEFAULT 'Usuario CRM',
      email TEXT UNIQUE,
      role_code TEXT NOT NULL DEFAULT 'viewer',
      password_hash TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TIMESTAMP WITHOUT TIME ZONE,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    ALTER TABLE public.crm_user
      ADD COLUMN IF NOT EXISTS external_ref TEXT,
      ADD COLUMN IF NOT EXISTS full_name TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS role_code TEXT NOT NULL DEFAULT 'viewer',
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active',
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITHOUT TIME ZONE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
  `);

  await db.query(`
    UPDATE public.crm_user
    SET full_name = COALESCE(NULLIF(full_name, ''), COALESCE(external_ref, email, 'Usuario CRM')),
        role_code = COALESCE(NULLIF(role_code, ''), 'viewer'),
        status = COALESCE(NULLIF(status, ''), 'active'),
        updated_at = COALESCE(updated_at, NOW()),
        created_at = COALESCE(created_at, NOW())
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS public.crm_session (
      id BIGSERIAL PRIMARY KEY,
      session_token_hash TEXT NOT NULL UNIQUE,
      user_id BIGINT NOT NULL REFERENCES public.crm_user(id) ON DELETE CASCADE,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TIMESTAMP WITHOUT TIME ZONE NOT NULL,
      last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS crm_session_user_id_idx
      ON public.crm_session (user_id)
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS crm_session_expires_at_idx
      ON public.crm_session (expires_at)
  `);
}

async function findUserByEmail(email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail) {
    return null;
  }

  const result = await db.query(
    `
      SELECT
        id,
        external_ref,
        full_name,
        email,
        role_code,
        password_hash,
        status,
        last_login_at,
        created_at,
        updated_at
      FROM public.crm_user
      WHERE LOWER(email) = $1
      LIMIT 1
    `,
    [normalizedEmail]
  );

  return mapUser(result.rows[0]);
}

async function findUserById(userId) {
  const result = await db.query(
    `
      SELECT
        id,
        external_ref,
        full_name,
        email,
        role_code,
        password_hash,
        status,
        last_login_at,
        created_at,
        updated_at
      FROM public.crm_user
      WHERE id = $1
      LIMIT 1
    `,
    [userId]
  );

  return mapUser(result.rows[0]);
}

async function upsertBootstrapAdmin({
  email,
  passwordHash,
  fullName,
  externalRef,
}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();

  if (!normalizedEmail || !passwordHash) {
    return null;
  }

  const normalizedExternalRef =
    String(externalRef || "")
      .trim()
      .toLowerCase() || null;
  const normalizedName =
    String(fullName || "").trim() || "Administrador CRM";
  const existingResult = await db.query(
    `
      SELECT id, password_hash, external_ref
      FROM public.crm_user
      WHERE LOWER(email) = $1
         OR ($2::text IS NOT NULL AND external_ref = $2)
      ORDER BY id ASC
      LIMIT 1
    `,
    [normalizedEmail, normalizedExternalRef]
  );

  if (!existingResult.rows.length) {
    const insertResult = await db.query(
      `
        INSERT INTO public.crm_user (
          external_ref,
          full_name,
          email,
          role_code,
          password_hash,
          status
        )
        VALUES ($1, $2, $3, 'admin', $4, 'active')
        RETURNING
          id,
          external_ref,
          full_name,
          email,
          role_code,
          password_hash,
          status,
          last_login_at,
          created_at,
          updated_at
      `,
      [normalizedExternalRef, normalizedName, normalizedEmail, passwordHash]
    );

    return mapUser(insertResult.rows[0]);
  }

  const existing = existingResult.rows[0];
  const updates = [];
  const params = [];

  const assign = (column, value) => {
    params.push(value);
    updates.push(`${column} = $${params.length}`);
  };

  assign("full_name", normalizedName);
  assign("email", normalizedEmail);
  assign("role_code", "admin");
  assign("status", "active");

  if (!existing.password_hash) {
    assign("password_hash", passwordHash);
  }

  if (!existing.external_ref && normalizedExternalRef) {
    assign("external_ref", normalizedExternalRef);
  }

  params.push(Number(existing.id));

  const updateResult = await db.query(
    `
      UPDATE public.crm_user
      SET ${updates.join(", ")},
          updated_at = NOW()
      WHERE id = $${params.length}
      RETURNING
        id,
        external_ref,
        full_name,
        email,
        role_code,
        password_hash,
        status,
        last_login_at,
        created_at,
        updated_at
    `,
    params
  );

  return mapUser(updateResult.rows[0]);
}

async function markUserLoggedIn(userId) {
  await db.query(
    `
      UPDATE public.crm_user
      SET last_login_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `,
    [userId]
  );
}

async function createSession({
  sessionTokenHash,
  userId,
  expiresAt,
  ipAddress = null,
  userAgent = null,
}) {
  await db.query(
    `
      INSERT INTO public.crm_session (
        session_token_hash,
        user_id,
        ip_address,
        user_agent,
        expires_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [sessionTokenHash, userId, ipAddress, userAgent, expiresAt]
  );
}

async function findSessionByTokenHash(sessionTokenHash) {
  const result = await db.query(
    `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        s.last_seen_at,
        u.id,
        u.external_ref,
        u.full_name,
        u.email,
        u.role_code,
        u.password_hash,
        u.status,
        u.last_login_at,
        u.created_at,
        u.updated_at
      FROM public.crm_session s
      INNER JOIN public.crm_user u
        ON u.id = s.user_id
      WHERE s.session_token_hash = $1
      LIMIT 1
    `,
    [sessionTokenHash]
  );

  if (!result.rows.length) {
    return null;
  }

  return {
    id: Number(result.rows[0].session_id),
    userId: Number(result.rows[0].user_id),
    expiresAt: result.rows[0].expires_at,
    lastSeenAt: result.rows[0].last_seen_at,
    user: mapUser(result.rows[0]),
  };
}

async function touchSession(sessionId) {
  await db.query(
    `
      UPDATE public.crm_session
      SET last_seen_at = NOW()
      WHERE id = $1
    `,
    [sessionId]
  );
}

async function deleteSessionByTokenHash(sessionTokenHash) {
  await db.query(
    `
      DELETE FROM public.crm_session
      WHERE session_token_hash = $1
    `,
    [sessionTokenHash]
  );
}

async function deleteExpiredSessions() {
  await db.query(`
    DELETE FROM public.crm_session
    WHERE expires_at <= NOW()
  `);
}

module.exports = {
  createSession,
  deleteExpiredSessions,
  deleteSessionByTokenHash,
  ensureAuthSchema,
  findSessionByTokenHash,
  findUserByEmail,
  findUserById,
  markUserLoggedIn,
  touchSession,
  upsertBootstrapAdmin,
};
