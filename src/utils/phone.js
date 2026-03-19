function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function normalizeWhatsAppRecipient(phone) {
  const normalized = normalizePhone(phone);

  if (/^521\d{10}$/.test(normalized)) {
    return `52${normalized.slice(3)}`;
  }

  return normalized;
}

module.exports = {
  normalizePhone,
  normalizeWhatsAppRecipient,
};
