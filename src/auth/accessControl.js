const ROLE_ALIASES = {
  seller: "agent",
  asesor: "agent",
};

const ROLE_PERMISSIONS = {
  admin: ["auth.read", "crm.read", "crm.write", "users.manage"],
  manager: ["auth.read", "crm.read", "crm.write"],
  agent: ["auth.read", "crm.read", "crm.write"],
  viewer: ["auth.read", "crm.read"],
};

function normalizeRoleCode(roleCode) {
  const normalized = String(roleCode || "")
    .trim()
    .toLowerCase();

  if (!normalized) {
    return "viewer";
  }

  return ROLE_ALIASES[normalized] || normalized;
}

function getPermissionsForRole(roleCode) {
  return ROLE_PERMISSIONS[normalizeRoleCode(roleCode)] || ROLE_PERMISSIONS.viewer;
}

function hasAnyRole(roleCode, allowedRoles = []) {
  const normalizedRole = normalizeRoleCode(roleCode);

  return allowedRoles.map(normalizeRoleCode).includes(normalizedRole);
}

function canWriteCrm(roleCode) {
  return getPermissionsForRole(roleCode).includes("crm.write");
}

function isOwnScopeRole(roleCode) {
  return normalizeRoleCode(roleCode) === "agent";
}

module.exports = {
  canWriteCrm,
  getPermissionsForRole,
  hasAnyRole,
  isOwnScopeRole,
  normalizeRoleCode,
};
