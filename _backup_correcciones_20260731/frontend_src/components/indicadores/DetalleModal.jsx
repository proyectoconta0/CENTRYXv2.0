import React from "react";
import { HiX } from "react-icons/hi";

/**
 * Shell genérico de modal para el detalle de una tarjeta KPI (Módulo 9 - Vista Simple).
 */
export default function DetalleModal({ titulo, subtitulo, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-bold text-gray-800">{titulo}</h2>
            {subtitulo && <p className="text-xs text-gray-500 mt-0.5">{subtitulo}</p>}
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
          >
            <HiX className="text-lg" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
