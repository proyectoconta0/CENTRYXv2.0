import React from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement, PointElement,
  Title, Tooltip, Legend,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, LineElement, PointElement, Title, Tooltip, Legend);

/**
 * Evolución mensual (últimos N meses) de: Rentabilidad Neta, % Cartera Vencida, % Gastos sobre Ventas.
 * data: [{ mes, rentabilidad_neta, cartera_vencida_pct, gastos_sobre_ventas }, ...]
 */
export default function GraficoEvolucion({ data }) {
  const chartData = {
    labels: data.map(d => d.mes),
    datasets: [
      {
        label: "Rentabilidad Neta (%)",
        data: data.map(d => d.rentabilidad_neta),
        borderColor: "rgba(34,197,94,1)",
        backgroundColor: "rgba(34,197,94,0.1)",
        borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
      },
      {
        label: "Cartera Vencida (%)",
        data: data.map(d => d.cartera_vencida_pct),
        borderColor: "rgba(239,68,68,1)",
        backgroundColor: "rgba(239,68,68,0.1)",
        borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
      },
      {
        label: "Gastos sobre Ventas (%)",
        data: data.map(d => d.gastos_sobre_ventas),
        borderColor: "rgba(249,115,22,1)",
        backgroundColor: "rgba(249,115,22,0.1)",
        borderWidth: 2, pointRadius: 3, tension: 0.3, spanGaps: true,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", labels: { font: { size: 11 }, boxWidth: 12, padding: 12 } },
      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? ctx.parsed.y.toFixed(1) : "—"}%` } },
    },
    scales: {
      y: { grid: { color: "rgba(0,0,0,0.04)" }, ticks: { font: { size: 11 }, callback: v => `${v}%` } },
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
    },
  };

  return (
    <div style={{ height: 280 }}>
      <Line data={chartData} options={options} />
    </div>
  );
}
