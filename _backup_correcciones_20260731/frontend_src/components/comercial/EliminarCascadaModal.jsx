import React, { useEffect, useState } from "react";
import { HiExclamationCircle, HiCheckCircle } from "react-icons/hi";
import { getEliminarCascadaPreview, eliminarComprobanteCascada } from "../../api/comercialApi";

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function EliminarCascadaModal({ comprobanteId, onClose, onEliminado }) {
  const [preview, setPreview]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState("");
  const [eliminando, setEliminando] = useState(false);

  useEffect(() => {
    getEliminarCascadaPreview(comprobanteId)
      .then(setPreview)
      .catch(() => setError("No se pudo cargar la información del comprobante"))
      .finally(() => setLoading(false));
  }, [comprobanteId]);

  const confirmar = async () => {
    setEliminando(true);
    setError("");
    try {
      await eliminarComprobanteCascada(comprobanteId);
      onEliminado();
    } catch (err) {
      setError(err.response?.data?.detail || "Error al eliminar el proceso completo");
    } finally {
      setEliminando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={() => !eliminando && onClose()} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
          <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
            <HiExclamationCircle className="text-red-500 text-xl" />
          </div>
          <div>
            <p className="font-semibold text-gray-800">Eliminar proceso completo</p>
            <p className="text-xs text-gray-500">Esta acción no se puede deshacer</p>
          </div>
        </div>

        <div className="px-6 py-5">
          {loading ? (
            <p className="text-sm text-gray-400 text-center py-4">Analizando comprobante y datos vinculados…</p>
          ) : error && !preview ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-3">Se eliminará:</p>
              <ul className="space-y-2 text-sm">
                <li className="flex items-start gap-2">
                  <HiCheckCircle className="text-red-500 flex-shrink-0 mt-0.5" />
                  <span>
                    Comprobante <strong className="font-mono">{preview.numero_documento}</strong>
                    {" "}({preview.cliente_nombre} — {fmtS(preview.precio_venta)})
                  </span>
                </li>
                {preview.pagos.map((p) => (
                  <li key={p.id} className="flex items-start gap-2">
                    <HiCheckCircle className="text-red-500 flex-shrink-0 mt-0.5" />
                    <span>
                      Pago de {fmtS(p.monto_pagado)} del {fmtFecha(p.fecha_pago)}
                      {p.conciliado && (
                        <>
                          <br />
                          <span className="text-amber-600">
                            ⚠ Movimiento conciliado en {p.conciliacion_label} será eliminado
                          </span>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              {preview.pagos.length === 0 && (
                <p className="text-xs text-gray-400 mt-3">Este comprobante no tiene pagos registrados.</p>
              )}

              {error && (
                <div className="mt-4 bg-red-50 text-red-700 text-sm px-3 py-2 rounded-lg border border-red-100">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 pb-6">
          <button onClick={onClose} disabled={eliminando}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={confirmar} disabled={eliminando || loading || (error && !preview)}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium disabled:opacity-60">
            {eliminando ? "Eliminando..." : "Eliminar todo"}
          </button>
        </div>
      </div>
    </div>
  );
}
