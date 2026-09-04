// Espejo del mapeo de permisos por rol en app/core/security.py (backend).
// Mantener ambos sincronizados si se agregan módulos o roles nuevos.

const MODULOS_POR_ROL = {
  superadmin:    null, // null = acceso a todos los módulos
  administrador: null,
  vendedor: new Set(["dashboard", "ventas", "clientes"]),
};

export const ROLES_DISPONIBLES = ["Superadmin", "Administrador", "Vendedor"];

export function normalizarRol(rol) {
  const r = (rol || "").trim().toLowerCase();
  if (r === "superadmin") return "superadmin";
  if (r === "administrador" || r === "admin" || r === "gerente" || r === "contador") return "administrador";
  if (r === "vendedor") return "vendedor";
  return "vendedor";
}

export function tienePermiso(rol, modulo) {
  const permitidos = MODULOS_POR_ROL[normalizarRol(rol)];
  return permitidos === null || permitidos === undefined || permitidos.has(modulo);
}

export function esSuperadmin(rol) {
  return normalizarRol(rol) === "superadmin";
}
