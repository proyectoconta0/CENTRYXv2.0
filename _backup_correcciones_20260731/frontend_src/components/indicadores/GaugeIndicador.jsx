import React from "react";

const CX = 100, CY = 100, R = 78, R_ZONE = 78, STROKE = 16;

function point(angleDeg, r = R) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CY - r * Math.sin(rad) };
}

function angleFor(value, min, max) {
  const clamped = Math.max(min, Math.min(max, value));
  return 180 - (180 * (clamped - min)) / (max - min);
}

function arcPath(startVal, endVal, min, max, r = R_ZONE) {
  const a1 = angleFor(startVal, min, max);
  const a2 = angleFor(endVal, min, max);
  const p1 = point(a1, r);
  const p2 = point(a2, r);
  const largeArc = a1 - a2 > 180 ? 1 : 0;
  return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${largeArc} 0 ${p2.x} ${p2.y}`;
}

const ZONE_COLOR = { verde: "#22c55e", amarillo: "#eab308", rojo: "#ef4444" };

/**
 * Medidor circular (gauge) tipo velocímetro.
 * zonas: [{ desde, hasta, color: "verde"|"amarillo"|"rojo" }, ...] cubriendo [min, max]
 */
export default function GaugeIndicador({ titulo, valor, min = 0, max = 100, zonas, sufijo = "" }) {
  const sinDatos = valor == null;
  const valorMostrado = sinDatos ? min : valor;
  const agujaAngulo = angleFor(valorMostrado, min, max);
  const agujaPunta = point(agujaAngulo, R - STROKE / 2 - 6);

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex flex-col items-center">
      <p className="text-xs text-gray-500 uppercase font-semibold tracking-wide mb-1">{titulo}</p>
      <svg viewBox="0 0 200 118" className="w-full max-w-[220px]">
        {zonas.map((z, i) => (
          <path
            key={i}
            d={arcPath(z.desde, z.hasta, min, max)}
            fill="none"
            stroke={ZONE_COLOR[z.color] || "#d1d5db"}
            strokeWidth={STROKE}
            strokeLinecap="butt"
            opacity={sinDatos ? 0.25 : 0.9}
          />
        ))}
        {!sinDatos && (
          <>
            <line
              x1={CX} y1={CY} x2={agujaPunta.x} y2={agujaPunta.y}
              stroke="#374151" strokeWidth={3} strokeLinecap="round"
            />
            <circle cx={CX} cy={CY} r={6} fill="#374151" />
          </>
        )}
      </svg>
      <p className={`text-xl font-bold -mt-2 ${sinDatos ? "text-gray-300" : "text-gray-800"}`}>
        {sinDatos ? "Sin datos" : `${valor.toLocaleString("es-PE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}${sufijo}`}
      </p>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
        <span>{min}{sufijo}</span>
        <span>{max}{sufijo}</span>
      </div>
    </div>
  );
}
