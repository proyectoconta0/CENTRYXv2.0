import React from "react";
import { useEmpresa } from "../context/EmpresaContext";

function colorBarra(pct) {
  if (pct >= 70) return "bg-green-500";
  if (pct >= 40) return "bg-blue-500";
  return "bg-orange-400";
}

function simboloMoneda(moneda) {
  return moneda === "USD" ? "US$" : "S/";
}

function formatK(n, simbolo) {
  return `${simbolo} ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ProyectosEjecucion({ data = [], esFallback = false }) {
  const empresaCtx = useEmpresa();
  const simbolo = simboloMoneda(empresaCtx?.empresa?.moneda_principal);

  if (data.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 h-full flex flex-col items-center justify-center text-center">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Proyectos en Ejecución</h3>
        <p className="text-sm text-gray-400">Módulo de Proyectos próximamente</p>
      </div>
    );
  }
  return (
    <div className="relative bg-white rounded-xl shadow-sm border border-gray-100 p-5 h-full">
      {esFallback && (
        <span className="absolute -top-2 -right-2 flex items-center gap-1 bg-red-100 text-red-600 text-[10px] font-semibold px-2 py-0.5 rounded-full border border-red-200 shadow-sm whitespace-nowrap">
          ⚠️ Sin datos reales
        </span>
      )}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Proyectos en Ejecución</h3>
        <span className="text-xs text-blue-600 font-medium">{data.length} activos</span>
      </div>
      <div className="space-y-4">
        {data.map((p, i) => (
          <div key={i} className="border-b border-gray-50 pb-4 last:border-0 last:pb-0">
            <div className="flex justify-between items-start mb-1.5">
              <div className="min-w-0 flex-1 pr-2">
                <p className="text-xs font-semibold text-gray-700 leading-tight line-clamp-1">{p.nombre}</p>
                <p className="text-xs text-gray-400 truncate">{p.cliente}</p>
              </div>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full text-white flex-shrink-0 ${colorBarra(p.avance_fisico)}`}>
                {p.avance_fisico}%
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 bg-gray-100 rounded-full h-2">
                <div
                  className={`h-2 rounded-full ${colorBarra(p.avance_fisico)} transition-all`}
                  style={{ width: `${p.avance_fisico}%` }}
                />
              </div>
            </div>
            <div className="flex justify-between mt-1.5 text-xs text-gray-400">
              <span>Ejec.: {formatK(p.ejecutado, simbolo)}</span>
              <span>Ppto.: {formatK(p.presupuesto, simbolo)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
