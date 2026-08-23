import React, { useEffect, useState } from "react";
import { HiX } from "react-icons/hi";
import { getFiltrosOpciones } from "../api/dashboardApi";

export default function FiltrosPanel({ open, onClose, valores, onApply, onClear }) {
  const [opciones, setOpciones] = useState({ clientes: [], tipos_servicio: [] });
  const [draft, setDraft] = useState(valores);

  useEffect(() => {
    if (open) {
      setDraft(valores);
      getFiltrosOpciones()
        .then(setOpciones)
        .catch(() => setOpciones({ clientes: [], tipos_servicio: [] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const aplicar = () => {
    onApply(draft);
    onClose();
  };

  const limpiar = () => {
    const vacio = { desde: "", hasta: "", clienteId: "", tipoServicio: "" };
    setDraft(vacio);
    onClear();
    onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div className="absolute right-0 top-full mt-2 z-50 w-80 bg-white border border-gray-200 rounded-xl shadow-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-800">Filtros adicionales</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <HiX />
          </button>
        </div>

        {/* Rango de fechas personalizado */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">
            Rango de fechas personalizado
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={draft.desde || ""}
              onChange={(e) => setDraft((d) => ({ ...d, desde: e.target.value }))}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
            />
            <span className="text-gray-400 text-xs">a</span>
            <input
              type="date"
              value={draft.hasta || ""}
              onChange={(e) => setDraft((d) => ({ ...d, hasta: e.target.value }))}
              className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
            />
          </div>
        </div>

        {/* Cliente */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-gray-500 mb-1">Cliente</label>
          <select
            value={draft.clienteId || ""}
            onChange={(e) => setDraft((d) => ({ ...d, clienteId: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
          >
            <option value="">Todos los clientes</option>
            {opciones.clientes.map((c) => (
              <option key={c.id} value={c.id}>{c.razon_social}</option>
            ))}
          </select>
        </div>

        {/* Tipo de servicio */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de servicio</label>
          <select
            value={draft.tipoServicio || ""}
            onChange={(e) => setDraft((d) => ({ ...d, tipoServicio: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-gray-700"
          >
            <option value="">Todos los servicios</option>
            {opciones.tipos_servicio.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-2">
          <button
            onClick={limpiar}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700"
          >
            Limpiar filtros
          </button>
          <button
            onClick={aplicar}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-medium transition-colors"
          >
            Aplicar filtros
          </button>
        </div>
      </div>
    </>
  );
}
