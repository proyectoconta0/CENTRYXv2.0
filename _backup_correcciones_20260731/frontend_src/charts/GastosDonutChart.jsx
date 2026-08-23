import React from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

// Categorías de activos fijos — deben coincidir con CATEGORIAS_ACTIVOS en Gastos.jsx
const SET_ACTIVOS = new Set([
  "Maquinaria y Equipos", "Vehículos", "Mobiliario y Equipo de Oficina",
  "Mejoras a Local", "Otros Activos",
]);

// Paleta fría para gastos operativos/admin/ventas
const PALETTE_OP = ["#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#14b8a6", "#8b5cf6", "#ec4899", "#0ea5e9", "#84cc16"];
const PALETTE_OP_H = ["#4f46e5", "#2563eb", "#0891b2", "#059669", "#0d9488", "#7c3aed", "#db2777", "#0284c7", "#65a30d"];
// Paleta cálida para activos fijos
const PALETTE_AC = ["#f59e0b", "#f97316", "#ef4444", "#d97706", "#b45309"];
const PALETTE_AC_H = ["#d97706", "#ea580c", "#dc2626", "#b45309", "#92400e"];

const MAX_SLICES = 7;

function colorParaSlice(categoria, opIdx, acIdx) {
  if (SET_ACTIVOS.has(categoria)) {
    return { bg: PALETTE_AC[acIdx % PALETTE_AC.length], hover: PALETTE_AC_H[acIdx % PALETTE_AC_H.length] };
  }
  return { bg: PALETTE_OP[opIdx % PALETTE_OP.length], hover: PALETTE_OP_H[opIdx % PALETTE_OP_H.length] };
}

function fmtMonto(n) {
  return `S/ ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtCenter(n) {
  return fmtMonto(n);
}

function groupData(data) {
  if (!data.length) return [];
  const total = data.reduce((s, d) => s + d.monto, 0);
  if (!total || data.length <= MAX_SLICES) return [...data].sort((a, b) => b.monto - a.monto);

  const sorted = [...data].sort((a, b) => b.monto - a.monto);
  const main = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1);
  const otrosMonto = rest.reduce((s, d) => s + d.monto, 0);

  if (otrosMonto > 0) {
    main.push({
      categoria: "Otros",
      monto: otrosMonto,
      porcentaje: +(otrosMonto / total * 100).toFixed(1),
    });
  }
  return main;
}

export default function GastosDonutChart({ data = [] }) {
  if (!data.length) return (
    <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando...</div>
  );

  const displayed = groupData(data);
  const total = data.reduce((s, d) => s + d.monto, 0);

  // Asignar colores según tipo (operativo vs activo)
  let opIdx = 0, acIdx = 0;
  const sliceColors = displayed.map((d) => {
    const c = colorParaSlice(d.categoria, opIdx, acIdx);
    SET_ACTIVOS.has(d.categoria) ? acIdx++ : opIdx++;
    return c;
  });

  const chartData = {
    labels: displayed.map((d) => d.categoria),
    datasets: [{
      data: displayed.map((d) => d.monto),
      backgroundColor: sliceColors.map((c) => c.bg),
      hoverBackgroundColor: sliceColors.map((c) => c.hover),
      borderWidth: 2,
      borderColor: "#ffffff",
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) =>
            ` S/ ${ctx.parsed.toLocaleString("es-PE")} (${displayed[ctx.dataIndex]?.porcentaje}%)`,
        },
      },
    },
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Gastos por Categoría</h3>
      <div className="flex flex-1 min-h-0 gap-5 items-center">
        {/* Donut */}
        <div className="relative flex-shrink-0" style={{ width: 210, height: 210 }}>
          <Doughnut data={chartData} options={options} />
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="text-[10px] text-gray-400 leading-tight">Total</p>
            <p className="text-base font-bold text-gray-800 leading-tight mt-0.5">
              {fmtCenter(total)}
            </p>
          </div>
        </div>

        {/* Leyenda derecha */}
        <div className="flex-1 overflow-y-auto space-y-2" style={{ maxHeight: 210 }}>
          {displayed.map((d, i) => {
            const esActivo = SET_ACTIVOS.has(d.categoria);
            return (
              <div key={d.categoria} className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
                    style={{ backgroundColor: sliceColors[i].bg }}
                  />
                  {esActivo && <span className="text-[9px] text-amber-600 flex-shrink-0">⚙</span>}
                  <span className="text-xs text-gray-600 truncate">{d.categoria}</span>
                </div>
                <div className="flex-shrink-0 text-right whitespace-nowrap">
                  <span className="text-xs font-semibold text-gray-700">{fmtMonto(d.monto)}</span>
                  <span className="text-[10px] text-gray-400 ml-1.5">{d.porcentaje}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
