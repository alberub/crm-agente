const MONTERREY_OFFSET = "-06:00";
const MONTERREY_TIME_ZONE = "America/Monterrey";

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

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: MONTERREY_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(
      formatter
        .formatToParts(value)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    const millisecond = value.getMilliseconds();

    return formatDateParts({
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
      second: Number(parts.second),
      millisecond,
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
