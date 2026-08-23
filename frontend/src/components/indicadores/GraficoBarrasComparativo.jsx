import React from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement,
  LineElement, PointElement, Title, Tooltip, Legend,
} from "chart.js";
import { Chart } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

/**
 * Ventas vs Gastos vs Utilidad — últimos N meses.
 * data: [{ mes, ventas, gastos, utilidad }, ...]
 */
export default function GraficoBarrasComparativo({ data }) {
  const chartData = {
    labels: data.map(d => d.mes),
    datasets: [
      {
        type: "bar", label: "Ventas", data: data.map(d => d.ventas),
        backgroundColor: "rgba(59,130,246,0.8)", borderRadius: 4, order: 2,
      },
      {
        type: "bar", label: "Gastos", data: data.map(d => d.gastos),
        backgroundColor: "rgba(239,68,68,0.75)", borderRadius: 4, order: 3,
      },
      {
        type: "line", label: "Utilidad", data: data.map(d => d.utilidad),
        borderColor: "rgba(34,197,94,1)", backgroundColor: "rgba(34,197,94,0.08)",
        borderWidth: 2, pointRadius: 3, fill: true, tension: 0.3, order: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } },
      tooltip: {
        callbacks: {
          label: ctx => ` ${ctx.dataset.label}: S/ ${ctx.parsed.y.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
        },
      },
    },
    scales: {
      y: {
        grid: { color: "rgba(0,0,0,0.04)" },
        ticks: { font: { size: 11 }, callback: v => `S/ ${Number(v).toLocaleString("es-PE")}` },
      },
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  };

  return (
    <div style={{ height: 280 }}>
      <Chart type="bar" data={chartData} options={options} />
    </div>
  );
}
