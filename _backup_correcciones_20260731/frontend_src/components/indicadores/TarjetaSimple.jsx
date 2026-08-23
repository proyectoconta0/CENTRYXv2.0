import React from "react";

const COLOR_VALOR = {
  verde:   "text-green-600",
  rojo:    "text-red-600",
  neutral: "text-gray-800",
};

const PIE_COLOR = {
  verde:    "text-green-600",
  amarillo: "text-yellow-600",
  rojo:     "text-red-600",
  neutral:  "text-gray-400",
};

/**
 * Tarjeta grande y simple para la Vista Simple del Módulo 9.
 * - icono: emoji grande (ej. "💰")
 * - titulo: ej. "VENDISTE ESTE MES"
 * - valor: string ya formateado (ej. "S/ 25,430.00")
 * - colorValor: "verde" | "rojo" | "neutral" — color del número grande
 * - descripcion: frase simple explicando qué significa el número
 * - pie: { texto, tipo: "verde"|"amarillo"|"rojo"|"neutral" } — línea inferior (tendencia o alerta)
 */
export default function TarjetaSimple({ icono, titulo, valor, colorValor = "neutral", descripcion, pie, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 flex flex-col gap-2 ${onClick ? "cursor-pointer transition-shadow hover:shadow-md hover:border-gray-200" : ""}`}
    >
      <div className="flex items-center gap-2.5">
        <span className="text-3xl leading-none">{icono}</span>
        <p className="text-sm font-bold text-gray-500 uppercase tracking-wide">{titulo}</p>
      </div>
      <p className={`text-3xl font-extrabold ${COLOR_VALOR[colorValor] || COLOR_VALOR.neutral}`}>
        {valor}
      </p>
      {descripcion && <p className="text-sm text-gray-500 leading-snug">{descripcion}</p>}
      {pie && (
        <p className={`text-sm font-semibold mt-1 ${PIE_COLOR[pie.tipo] || PIE_COLOR.neutral}`}>
          {pie.texto}
        </p>
      )}
    </div>
  );
}
