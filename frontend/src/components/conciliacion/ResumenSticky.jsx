import React from "react";
import { HiDownload, HiCheckCircle } from "react-icons/hi";

function fmtS(n) {
  if (n == null) return "—";
  const abs = Math.abs(n);
  const s = `S/ ${abs.toLocaleString("es-PE", { minimumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : s;
}

export default function ResumenSticky({ concActiva, movimientos, onGuardar, guardando = false, onExportar, onExportarConciliados }) {
  if (!concActiva) return null;

  const totalBanco   = movimientos.filter(m => m.origen === "banco").length;
  const conciliados  = movimientos.filter(m => m.conciliado && m.origen === "banco").length;
  const pct          = totalBanco > 0 ? Math.round((conciliados / totalBanco) * 100) : 0;
  const diferencia   = concActiva.diferencia ?? 0;
  const diferenciaOk = Math.abs(diferencia) < 0.01;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 shadow-2xl">
      <div className="max-w-[1600px] mx-auto px-6 py-3 flex flex-wrap items-center gap-4">

        {/* Saldo banco */}
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase text-gray-400 tracking-wide leading-none">Saldo Banco</span>
          <span className="text-sm font-bold text-gray-800 mt-0.5">{fmtS(concActiva.saldo_banco)}</span>
        </div>

        <div className="h-7 w-px bg-gray-200 hidden sm:block" />

        {/* Saldo sistema */}
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase text-gray-400 tracking-wide leading-none">Saldo Sistema</span>
          <span className="text-sm font-bold text-gray-800 mt-0.5">{fmtS(concActiva.saldo_sistema)}</span>
        </div>

        <div className="h-7 w-px bg-gray-200 hidden sm:block" />

        {/* Diferencia */}
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase text-gray-400 tracking-wide leading-none">Diferencia</span>
          <span className={`text-sm font-bold mt-0.5 ${diferenciaOk ? "text-green-600" : "text-red-600"}`}>
            {fmtS(diferencia)}
          </span>
        </div>

        <div className="h-7 w-px bg-gray-200 hidden sm:block" />

        {/* Conciliados */}
        <div className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase text-gray-400 tracking-wide leading-none">Conciliados</span>
          <span className="text-sm font-bold text-gray-800 mt-0.5">
            {conciliados}/{totalBanco}
            <span className="ml-1 text-xs font-medium text-blue-600">({pct}%)</span>
          </span>
        </div>

        {/* Acciones */}
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <button
            onClick={onExportarConciliados}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-indigo-700 border border-indigo-200 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
          >
            <HiDownload className="w-3.5 h-3.5" /> Exportar conciliados
          </button>
          <button
            onClick={onExportar}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <HiDownload className="w-3.5 h-3.5" /> Exportar todos
          </button>
          <button
            onClick={onGuardar}
            disabled={guardando}
            className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-60"
          >
            <HiCheckCircle className="w-4 h-4" /> {guardando ? "Guardando…" : "Guardar Conciliación"}
          </button>
        </div>
      </div>
    </div>
  );
}
