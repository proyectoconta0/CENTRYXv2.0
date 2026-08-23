import React, { useState } from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement,
  LineElement, Title, Tooltip, Legend, Filler,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

export default function VentasEvolucionChart({ data }) {
  const [vista, setVista] = useState("mensual");
  if (!data) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando...</div>;

  const serie = data[vista] ?? [];

  const chartData = {
    labels: serie.map((d) => d.periodo),
    datasets: [
      {
        label: "Ventas (S/)",
        data: serie.map((d) => d.monto),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.10)",
        borderWidth: 2.5,
        pointBackgroundColor: "#3b82f6",
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
        tension: 0.4,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` S/ ${ctx.parsed.y.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: {
        grid: { color: "rgba(0,0,0,0.05)" },
        ticks: {
          font: { size: 11 },
          callback: (v) => `S/ ${v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        },
      },
    },
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Evolución de Ventas</h3>
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {["mensual", "semanal", "diario"].map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize transition-colors ${
                vista === v ? "bg-white text-blue-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              {v === "mensual" ? "Mensual" : v === "semanal" ? "Semanal" : "Diario"}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <Line data={chartData} options={options} />
      </div>
    </div>
  );
}
