import React from "react";
import { HiX, HiDocumentText, HiOutlineArchive } from "react-icons/hi";

export default function ModalElegirImportacion({ onClose, onElegirIndividual, onElegirMasiva }) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">¿Cómo deseas importar?</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <HiX className="text-lg" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-4">
          <button
            onClick={onElegirIndividual}
            className="flex flex-col items-center gap-2 p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-colors text-center"
          >
            <HiDocumentText className="text-4xl text-blue-500" />
            <p className="text-sm font-semibold text-gray-800">Carga Individual</p>
            <p className="text-xs text-gray-500">Un PDF a la vez</p>
          </button>

          <button
            onClick={onElegirMasiva}
            className="flex flex-col items-center gap-2 p-6 border-2 border-gray-200 rounded-xl hover:border-blue-500 hover:bg-blue-50 transition-colors text-center"
          >
            <HiOutlineArchive className="text-4xl text-blue-500" />
            <p className="text-sm font-semibold text-gray-800">Carga Masiva</p>
            <p className="text-xs text-gray-500">Varios PDFs en un ZIP</p>
          </button>
        </div>
      </div>
    </div>
  );
}
