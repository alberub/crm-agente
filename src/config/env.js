const path = require("path");
const dotenv = require("dotenv");

const localEnvPath = path.resolve(process.cwd(), ".env");

dotenv.config({ path: localEnvPath, quiet: true });

function cleanEnvValue(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/^'(.*)'$/, "$1").trim();
}

function readNumber(value, fallback) {
  const parsedValue = Number(cleanEnvValue(value));
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function readBoolean(value, fallback) {
  const rawValue = cleanEnvValue(value);

  if (!rawValue) {
    return fallback;
  }

  const normalized = String(rawValue).trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function readOrigins(value) {
  const rawValue = cleanEnvValue(value);

  if (!rawValue) {
    return ["http://localhost:4200", "http://localhost:5173"];
  }

  return rawValue
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readSameSite(value, fallback) {
  const normalized = String(cleanEnvValue(value) || fallback || "")
    .trim()
    .toLowerCase();

  if (normalized === "strict" || normalized === "lax" || normalized === "none") {
    return normalized;
  }

  return fallback;
}

function validateEnv() {
  const hasDatabaseUrl = !!cleanEnvValue(process.env.DATABASE_URL);
  const hasSplitDatabaseConfig =
    !!cleanEnvValue(process.env.DB_HOST) &&
    !!cleanEnvValue(process.env.DB_USER) &&
    !!cleanEnvValue(process.env.DB_PASSWORD) &&
    !!cleanEnvValue(process.env.DB_NAME);

  if (!hasDatabaseUrl && !hasSplitDatabaseConfig) {
    throw new Error(
      "Falta configuracion de base de datos. Usa DATABASE_URL o define HOST, USER, PASSWORD y DATABASE."
    );
  }

  if (
    !cleanEnvValue(process.env.META_ACCESS_TOKEN) ||
    !cleanEnvValue(process.env.META_PHONE_NUMBER_ID)
  ) {
    throw new Error(
      "Faltan META_ACCESS_TOKEN o META_PHONE_NUMBER_ID para enviar mensajes por WhatsApp."
    );
  }
}

module.exports = {
  crmPort: readNumber(process.env.CRM_PORT, 3100),
  corsOrigins: readOrigins(process.env.CRM_CORS_ORIGIN),
  outboundMessageRole: cleanEnvValue(process.env.CRM_OUTBOUND_ROLE) || "asesor",
  authBootstrapAdminEmail: cleanEnvValue(process.env.AUTH_BOOTSTRAP_ADMIN_EMAIL),
  authBootstrapAdminPassword: cleanEnvValue(process.env.AUTH_BOOTSTRAP_ADMIN_PASSWORD),
  authBootstrapAdminName:
    cleanEnvValue(process.env.AUTH_BOOTSTRAP_ADMIN_NAME) || "Administrador CRM",
  authBootstrapAdminExternalRef:
    cleanEnvValue(process.env.AUTH_BOOTSTRAP_ADMIN_EXTERNAL_REF),
  sessionCookieName:
    cleanEnvValue(process.env.AUTH_SESSION_COOKIE_NAME) || "crm_session",
  sessionCookieSameSite:
    readSameSite(
      process.env.AUTH_SESSION_COOKIE_SAME_SITE,
      readBoolean(process.env.AUTH_SESSION_COOKIE_SECURE, process.env.NODE_ENV === "production")
        ? "none"
        : "lax"
    ),
  sessionTtlHours: readNumber(process.env.AUTH_SESSION_TTL_HOURS, 12),
  sessionCookieSecure: readBoolean(
    process.env.AUTH_SESSION_COOKIE_SECURE,
    process.env.NODE_ENV === "production"
  ),
  databaseUrl: cleanEnvValue(process.env.DATABASE_URL),
  dbHost: cleanEnvValue(process.env.DB_HOST),
  dbUser: cleanEnvValue(process.env.DB_USER),
  dbPassword: cleanEnvValue(process.env.DB_PASSWORD),
  dbName: cleanEnvValue(process.env.DB_NAME),
  dbPort: readNumber(process.env.DB_PORT, 5432),
  metaPhoneNumberId: cleanEnvValue(process.env.META_PHONE_NUMBER_ID),
  metaAccessToken: cleanEnvValue(process.env.META_ACCESS_TOKEN),
  openAiApiKey: cleanEnvValue(process.env.OPENAI_API_KEY),
  openAiModel: cleanEnvValue(process.env.OPENAI_MODEL) || "gpt-5-mini",
  floristAgentBaseUrl:
    cleanEnvValue(process.env.FLORIST_AGENT_BASE_URL) ||
    cleanEnvValue(process.env.FLOREST_AGENT_BASE_URL) ||
    "http://localhost:3000",
  localEnvPath,
  validateEnv,
};
