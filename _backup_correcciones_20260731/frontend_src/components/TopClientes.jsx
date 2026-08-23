import React from "react";

const COLORS = ["bg-blue-600", "bg-indigo-500", "bg-violet-500", "bg-purple-500", "bg-fuchsia-500"];

function formatK(n) {
  return `S/ ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function TopClientes({ data = [] }) {
  const max = data[0]?.ventas || 1;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 h-full">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Top 5 Clientes por Ventas</h3>
      <div className="space-y-3">
        {data.map((c, i) => (
          <div key={i}>
            <div className="flex justify-between items-center mb-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-5 h-5 rounded-full ${COLORS[i]} text-white text-xs flex items-center justify-center font-bold flex-shrink-0`}>
                  {i + 1}
                </span>
                <span className="text-xs text-gray-700 font-medium truncate">{c.nombre}</span>
              </div>
              <span className="text-xs font-semibold text-gray-700 ml-2 flex-shrink-0">{formatK(c.ventas)}</span>
            </div>
            <div className="hidden sm:block w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full ${COLORS[i]}`}
                style={{ width: `${(c.ventas / max) * 100}%` }}
              />
            </div>
            <p className="hidden sm:block text-right text-xs text-gray-400 mt-0.5">{c.porcentaje}% del total</p>
          </div>
        ))}
      </div>
    </div>
  );
}
