const MONTERREY_OFFSET = "-06:00";

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function formatDateParts(parts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(
    parts.second
  )}.${pad(parts.millisecond, 3)}${MONTERREY_OFFSET}`;
}

function serializeDbTimestamp(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      return null;
    }

    return formatDateParts({
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
      hour: value.getUTCHours(),
      minute: value.getUTCMinutes(),
      second: value.getUTCSeconds(),
      millisecond: value.getUTCMilliseconds(),
    });
  }

  const normalized = String(value).trim().replace(" ", "T");

  if (!normalized) {
    return null;
  }

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) {
    return normalized;
  }

  return `${normalized}${MONTERREY_OFFSET}`;
}

module.exports = {
  serializeDbTimestamp,
};
