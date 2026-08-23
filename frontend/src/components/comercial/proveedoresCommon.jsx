export const TIPOS_DOCUMENTO = ["RUC", "DNI", "Carnet de Extranjería"];
export const ESTADOS = ["Activo", "Inactivo"];

export const ESTADO_COLOR = {
  "Activo":   "bg-green-100 text-green-700",
  "Inactivo": "bg-gray-100 text-gray-600",
};

export const SEMAFORO_COLOR = {
  verde:     "bg-green-100 text-green-700",
  amarillo:  "bg-yellow-100 text-yellow-700",
  rojo:      "bg-red-100 text-red-700",
  pagado:    "bg-blue-100 text-blue-700",
  sin_fecha: "bg-gray-100 text-gray-500",
};
export const SEMAFORO_LABEL = {
  verde:     "🟢 Al día",
  amarillo:  "🟡 1-15 días",
  rojo:      "🔴 +15 días",
  pagado:    "✅ Pagado",
  sin_fecha: "⚪ Sin fecha",
};

export function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export function fmtFecha(d) {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}
