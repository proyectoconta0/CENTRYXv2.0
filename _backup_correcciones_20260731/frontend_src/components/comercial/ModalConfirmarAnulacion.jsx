import React, { useState } from "react";
import { HiExclamationCircle } from "react-icons/hi";
import { anularComprobante } from "../../api/comercialApi";

function fmtS(n) {
  return `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ModalConfirmarAnulacion({ anulacion, notaCreditoId, onResuelto }) {
  const [procesando, setProcesando] = useState(false);
  const [error, setError]           = useState("");

  const anular = async () => {
    setProcesando(true);
    setError("");
    try {
      await anularComprobante(anulacion.factura_id, notaCreditoId);
      onResuelto();
    } catch (err) {
      setError(err.response?.data?.detail || "Error al anular la factura");
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center flex-shrink-0">
            <HiExclamationCircle className="text-amber-500 text-xl" />
          </div>
          <p className="font-semibold text-gray-800">Nota de Crédito vinculada a una factura</p>
        </div>
        <p className="text-sm text-gray-600 mb-5">
          Esta Nota de Crédito anula la factura{" "}
          <span className="font-semibold">{anulacion.numero_documento}</span> por{" "}
          <span className="font-semibold">{fmtS(anulacion.monto)}</span>.
          ¿Deseas anular esa factura?
        </p>
        {error && (
          <div className="mb-4 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onResuelto}
            disabled={procesando}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            No, solo registrar NC
          </button>
          <button
            onClick={anular}
            disabled={procesando}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white font-medium rounded-lg transition-colors"
          >
            {procesando ? "Anulando..." : "Sí, anular factura"}
          </button>
        </div>
      </div>
    </div>
  );
}
