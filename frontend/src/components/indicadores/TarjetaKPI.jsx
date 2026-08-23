import React from "react";
import { HiArrowUp, HiArrowDown } from "react-icons/hi";

const SEMAFORO_STYLE = {
  verde:    { border: "border-green-500",  text: "text-green-700",  dot: "bg-green-500" },
  amarillo: { border: "border-yellow-400", text: "text-yellow-600", dot: "bg-yellow-400" },
  rojo:     { border: "border-red-500",    text: "text-red-700",    dot: "bg-red-500" },
};
const SIN_DATOS_STYLE = { border: "border-gray-200", text: "text-gray-400", dot: "bg-gray-300" };

/**
 * Tarjeta KPI reutilizable.
 * - valor: string ya formateado (ej. "18.5%", "S/ 4,500.00") o null → muestra "Sin datos"
 * - semaforo: "verde" | "amarillo" | "rojo" | null
 * - variacionPct: número o null — variación vs período anterior
 * - invertido: true si un valor MENOR es mejor (ej. % gastos, cartera vencida) → invierte el color de la flecha
 */
export default function TarjetaKPI({ titulo, valor, sub, semaforo, variacionPct, invertido = false }) {
  const style = semaforo ? (SEMAFORO_STYLE[semaforo] || SIN_DATOS_STYLE) : SIN_DATOS_STYLE;
  const sinDatos = valor == null;

  let varColor = "text-gray-400";
  let VarIcon = null;
  if (variacionPct != null && !sinDatos) {
    const subio = variacionPct > 0;
    const esBueno = invertido ? !subio : subio;
    varColor = variacionPct === 0 ? "text-gray-400" : esBueno ? "text-green-600" : "text-red-600";
    VarIcon = subio ? HiArrowUp : HiArrowDown;
  }

  return (
    <div className={`bg-white rounded-xl border-l-4 p-4 shadow-sm ${style.border}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide">{titulo}</p>
        {semaforo && <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />}
      </div>
      <p className={`text-2xl font-bold mt-1.5 ${sinDatos ? "text-gray-300" : style.text}`}>
        {sinDatos ? "Sin datos" : valor}
      </p>
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
        {variacionPct != null && !sinDatos && (
          <span className={`flex items-center gap-0.5 text-xs font-semibold ${varColor}`}>
            {VarIcon && <VarIcon className="w-3 h-3" />}
            {Math.abs(variacionPct).toFixed(1)}%
          </span>
        )}
      </div>
    </div>
  );
}
