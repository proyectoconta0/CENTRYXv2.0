import React from "react";

const NIVEL_STYLE = {
  rojo:     { bg: "bg-red-50",    border: "border-red-200",    text: "text-red-800",    icono: "🔴" },
  amarillo: { bg: "bg-yellow-50", border: "border-yellow-200", text: "text-yellow-800", icono: "🟡" },
  verde:    { bg: "bg-green-50",  border: "border-green-200",  text: "text-green-800",  icono: "🟢" },
};

/**
 * Lista de alertas en lenguaje simple, ordenadas por urgencia (rojo → amarillo → verde).
 * alertas: [{ nivel: "rojo"|"amarillo"|"verde", mensaje: string }]
 */
export default function SeccionAlertas({ alertas }) {
  if (!alertas || alertas.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Cosas que debes saber</h3>
        <p className="text-sm text-gray-400">No hay alertas por el momento. Todo tranquilo por aquí 👍</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
      <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Cosas que debes saber</h3>
      <div className="space-y-2.5">
        {alertas.slice(0, 5).map((a, i) => {
          const style = NIVEL_STYLE[a.nivel] || NIVEL_STYLE.verde;
          return (
            <div key={i} className={`flex items-start gap-3 rounded-xl border p-3.5 ${style.bg} ${style.border}`}>
              <span className="text-lg leading-none flex-shrink-0">{style.icono}</span>
              <p className={`text-sm leading-snug ${style.text}`}>{a.mensaje}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
