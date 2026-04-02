const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const attempts = new Map();

function buildKey({ email, ipAddress }) {
  return `${String(email || "").trim().toLowerCase()}::${String(ipAddress || "unknown")}`;
}

function compactFailures(entry) {
  const now = Date.now();
  entry.failures = entry.failures.filter((timestamp) => now - timestamp < WINDOW_MS);
  return entry;
}

function assertLoginAllowed(context) {
  const key = buildKey(context);
  const entry = compactFailures(attempts.get(key) || { failures: [] });
  attempts.set(key, entry);

  if (entry.failures.length >= MAX_ATTEMPTS) {
    const oldestFailure = entry.failures[0];
    const retryAfterMs = WINDOW_MS - (Date.now() - oldestFailure);
    const retryAfterSeconds = Math.max(Math.ceil(retryAfterMs / 1000), 1);
    const error = new Error("TOO_MANY_ATTEMPTS");
    error.retryAfterSeconds = retryAfterSeconds;
    throw error;
  }
}

function recordFailure(context) {
  const key = buildKey(context);
  const entry = compactFailures(attempts.get(key) || { failures: [] });
  entry.failures.push(Date.now());
  attempts.set(key, entry);
}

function clearFailures(context) {
  attempts.delete(buildKey(context));
}

module.exports = {
  assertLoginAllowed,
  clearFailures,
  recordFailure,
};
