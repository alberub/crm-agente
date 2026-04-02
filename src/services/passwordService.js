const crypto = require("crypto");

const SCRYPT_PARAMS = {
  cost: 16384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 64,
};

function hashPassword(password) {
  const normalizedPassword = String(password || "");
  const salt = crypto.randomBytes(16).toString("base64");
  const derivedKey = crypto.scryptSync(
    normalizedPassword,
    salt,
    SCRYPT_PARAMS.keyLength,
    {
      cost: SCRYPT_PARAMS.cost,
      blockSize: SCRYPT_PARAMS.blockSize,
      parallelization: SCRYPT_PARAMS.parallelization,
    }
  ).toString("base64");

  return [
    "scrypt",
    SCRYPT_PARAMS.cost,
    SCRYPT_PARAMS.blockSize,
    SCRYPT_PARAMS.parallelization,
    SCRYPT_PARAMS.keyLength,
    salt,
    derivedKey,
  ].join("$");
}

function verifyPassword(password, passwordHash) {
  const [algorithm, cost, blockSize, parallelization, keyLength, salt, expected] = String(
    passwordHash || ""
  ).split("$");

  if (
    algorithm !== "scrypt" ||
    !cost ||
    !blockSize ||
    !parallelization ||
    !keyLength ||
    !salt ||
    !expected
  ) {
    return false;
  }

  const derivedKey = crypto.scryptSync(
    String(password || ""),
    salt,
    Number(keyLength),
    {
      cost: Number(cost),
      blockSize: Number(blockSize),
      parallelization: Number(parallelization),
    }
  );
  const expectedKey = Buffer.from(expected, "base64");

  if (derivedKey.length !== expectedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(derivedKey, expectedKey);
}

module.exports = {
  hashPassword,
  verifyPassword,
};
