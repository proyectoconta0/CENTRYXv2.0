import React from "react";
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend } from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const COLORS = ["#3b82f6","#10b981","#f59e0b","#6366f1","#ec4899","#14b8a6","#f97316"];

export default function IngresosPorServicioChart({ data = [] }) {
  if (!data.length) return <div className="h-full flex items-center justify-center text-gray-400 text-sm">Sin datos</div>;

  const chartData = {
    labels: data.map(d => d.tipo_servicio),
    datasets: [{
      label: "Ingresos (S/)",
      data: data.map(d => d.monto),
      backgroundColor: data.map((_, i) => COLORS[i % COLORS.length]),
      borderRadius: 6,
      borderSkipped: false,
    }],
  };

  const options = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => ` S/ ${ctx.parsed.x.toLocaleString("es-PE")} (${data[ctx.dataIndex]?.porcentaje}%)`,
        },
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(0,0,0,0.05)" },
        ticks: { font: { size: 11 }, callback: v => `S/${(v/1000).toFixed(0)}K` },
      },
      y: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  };

  return <Bar data={chartData} options={options} />;
}
