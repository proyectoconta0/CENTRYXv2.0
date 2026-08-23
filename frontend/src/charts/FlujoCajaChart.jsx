import React from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  Title, Tooltip, Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

export default function FlujoCajaChart({ data = [] }) {
  if (!data.length) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Cargando...</div>;

  const chartData = {
    labels: data.map((d) => d.mes),
    datasets: [
      {
        label: "Ingresos",
        data: data.map((d) => d.ingresos),
        backgroundColor: "rgba(16,185,129,0.85)",
        borderRadius: 5,
        borderSkipped: false,
      },
      {
        label: "Egresos",
        data: data.map((d) => d.egresos),
        backgroundColor: "rgba(239,68,68,0.75)",
        borderRadius: 5,
        borderSkipped: false,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "top",
        labels: { font: { size: 11 }, boxWidth: 12, padding: 12 },
      },
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
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Flujo de Caja Proyectado</h3>
      <div className="flex-1 min-h-0">
        <Bar data={chartData} options={options} />
      </div>
    </div>
  );
}
