import React from "react";

export const TIPOS_SERVICIO = [
  "Alquiler de andamios", "Venta de andamios", "Reparación de andamios",
  "Venta de piezas", "Capacitación", "Transporte", "Montaje", "Otros",
];
export const ESTADOS = ["Pendiente", "En Proceso", "Completada", "Cancelada"];

export const ESTADO_COLOR = {
  "Pendiente":  "bg-gray-100 text-gray-600",
  "En Proceso": "bg-blue-100 text-blue-700",
  "Completada": "bg-green-100 text-green-700",
  "Cancelada":  "bg-red-100 text-red-700",
};
export const ESTADO_BAR = {
  "Pendiente":  "bg-gray-400",
  "En Proceso": "bg-blue-500",
  "Completada": "bg-green-500",
  "Cancelada":  "bg-red-400",
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

export function ProgressBar({ value, estado, big }) {
  const pct = Math.max(0, Math.min(100, value || 0));
  return (
    <div className={`flex items-center gap-2 ${big ? "w-full" : "min-w-[100px]"}`}>
      <div className={`flex-1 bg-gray-100 rounded-full overflow-hidden ${big ? "h-3.5" : "h-2"}`}>
        <div className={`h-full rounded-full transition-all ${ESTADO_BAR[estado] || "bg-gray-400"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-semibold text-gray-600 text-right ${big ? "text-sm w-12" : "text-xs w-9"}`}>{pct}%</span>
    </div>
  );
}
