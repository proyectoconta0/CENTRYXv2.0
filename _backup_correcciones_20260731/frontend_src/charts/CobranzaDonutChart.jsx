import React from "react";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { Doughnut } from "react-chartjs-2";

ChartJS.register(ArcElement, Tooltip, Legend);

function formatK(n) {
  return `S/ ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function CobranzaDonutChart({ data }) {
  if (!data) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando...</div>;

  const { al_dia, por_vencer, vencida } = data;
  const total = (al_dia?.monto ?? 0) + (por_vencer?.monto ?? 0) + (vencida?.monto ?? 0);

  const chartData = {
    labels: ["Al día", "Por vencer (1-15d)", "Vencida (+15d)"],
    datasets: [{
      data: [al_dia?.monto ?? 0, por_vencer?.monto ?? 0, vencida?.monto ?? 0],
      backgroundColor: ["#10b981", "#f59e0b", "#ef4444"],
      hoverBackgroundColor: ["#059669", "#d97706", "#dc2626"],
      borderWidth: 0,
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "70%",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` S/ ${ctx.parsed.toLocaleString("es-PE")}`,
        },
      },
    },
  };

  const leyenda = [
    { label: "Al día",          color: "bg-green-500",  datos: al_dia },
    { label: "Por vencer",      color: "bg-amber-400",  datos: por_vencer },
    { label: "Vencida (+15d)",  color: "bg-red-500",    datos: vencida },
  ];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 h-full flex flex-col">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Estado de Cobranza</h3>
      <div className="relative flex-1 min-h-0 flex items-center justify-center" style={{ maxHeight: 180 }}>
        <Doughnut data={chartData} options={options} />
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <p className="text-xs text-gray-400">Total</p>
          <p className="text-lg font-bold text-gray-700">{formatK(total)}</p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {leyenda.map(({ label, color, datos }) => (
          <div key={label} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${color}`} />
              <span className="text-xs text-gray-600">{label}</span>
              <span className="text-xs text-gray-400">({datos?.cantidad ?? 0})</span>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-gray-700">{formatK(datos?.monto ?? 0)}</span>
              <span className="text-xs text-gray-400 ml-1">{datos?.porcentaje ?? 0}%</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
