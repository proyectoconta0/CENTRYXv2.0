import React, { useState, useEffect, useCallback } from "react";
import { HiX, HiExclamationCircle, HiPencil } from "react-icons/hi";
import { getDetalleOrdenCobro, editarDetalleOrdenCobro } from "../../api/comercialApi";

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFecha(d) {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}
function parsearError(err) {
  const d = err?.response?.data?.detail;
  if (!d) return "Ocurrió un error inesperado.";
  if (Array.isArray(d)) return "Error de validación: " + d.map(e => e.msg).join(", ");
  return String(d);
}

// Modal "Ver Detalle" de una Orden de Cobro — mismo patrón que
// ModalDetalleOrdenPago (Gastos), con edición en línea del monto cobrado
// por documento.
export default function ModalDetalleOrdenCobro({ ordenId, onClose, onChange }) {
  const [orden,   setOrden]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const [editingId, setEditingId]   = useState(null);
  const [editValue, setEditValue]   = useState("");
  const [savingId,  setSavingId]    = useState(null);

  const cargar = useCallback(async (id) => {
    setLoading(true);
    try { setOrden(await getDetalleOrdenCobro(id)); }
    catch { setOrden(null); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!ordenId) return;
    setError("");
    cargar(ordenId);
  }, [ordenId, cargar]);

  const abrirEdicion = (d) => {
    setEditingId(d.id);
    setEditValue(String(d.monto_cobrado));
    setError("");
  };

  const guardarEdicion = async (d) => {
    const monto = parseFloat(editValue);
    if (isNaN(monto) || monto < 0) { setError("Ingrese un monto cobrado válido."); return; }
    setSavingId(d.id);
    try {
      await editarDetalleOrdenCobro(ordenId, d.id, { monto_cobrado: monto });
      setEditingId(null);
      await cargar(ordenId);
      if (onChange) await onChange();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSavingId(null);
    }
  };

  if (!ordenId) return null;

  const totalCobrado = (orden?.detalle || []).reduce((acc, d) => acc + (d.monto_cobrado || 0), 0);

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Detalle — {orden?.numero_orden ?? "…"}</h2>
            <p className="text-sm text-gray-500 mt-0.5">Orden de cobro</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <HiX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-8">Cargando…</p>
          ) : !orden ? (
            <p className="text-center text-gray-400 text-sm py-8">No se pudo cargar la orden de cobro</p>
          ) : (
            <>
              <div className="border border-green-200 bg-green-50 rounded-xl p-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Cliente</p>
                    <p className="font-medium text-gray-800">{orden.nombre_cliente || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Fecha de cobro</p>
                    <p className="font-medium text-gray-800">{fmtFecha(orden.fecha_cobro)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Monto total</p>
                    <p className="font-medium text-gray-800">{fmtS(orden.monto_total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Método</p>
                    <p className="font-medium text-gray-800">{orden.metodo_cobro || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Banco</p>
                    <p className="font-medium text-gray-800">
                      {orden.banco ? `${orden.banco}${orden.numero_cuenta ? ` — ${orden.numero_cuenta}` : ""}` : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">N° Operación</p>
                    <p className="font-medium text-gray-800">{orden.numero_operacion || "—"}</p>
                  </div>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                </div>
              )}

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">N° Doc</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Cliente</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Monto Total</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Monto Cobrado</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Saldo Restante</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Editar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(orden.detalle || []).length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-6 text-gray-400 text-sm">Esta orden no tiene documentos</td></tr>
                      ) : orden.detalle.map(d => (
                        <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{d.numero_documento || "—"}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                              {d.tipo_documento || "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-700" title={d.cliente_nombre}>{d.cliente_nombre || "—"}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap">{fmtS(d.monto)}</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            {editingId === d.id ? (
                              <input type="number" step="0.01" min="0" value={editValue}
                                onChange={e => setEditValue(e.target.value)}
                                className="w-28 px-2 py-1 border border-gray-300 rounded-lg text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500" />
                            ) : (
                              <span className="font-semibold text-gray-800">{fmtS(d.monto_cobrado)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-800 whitespace-nowrap">
                            {editingId === d.id
                              ? fmtS(d.saldo_anterior - (parseFloat(editValue) || 0))
                              : fmtS(d.saldo_restante)}
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-center gap-1.5">
                              {editingId === d.id ? (
                                <>
                                  <button onClick={() => guardarEdicion(d)} disabled={savingId === d.id}
                                    className="px-2.5 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
                                    {savingId === d.id ? "…" : "Guardar"}
                                  </button>
                                  <button onClick={() => setEditingId(null)} disabled={savingId === d.id}
                                    className="px-2.5 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <button onClick={() => abrirEdicion(d)} title="Editar monto cobrado"
                                  className="p-1.5 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                                  <HiPencil className="w-4 h-4" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {(orden.detalle || []).length > 0 && (
                      <tfoot className="bg-gray-50 border-t border-gray-200">
                        <tr>
                          <td colSpan={4} className="px-4 py-2.5 text-right font-semibold text-gray-700">Total cobrado</td>
                          <td className="px-4 py-2.5 text-right font-bold text-gray-800 whitespace-nowrap">{fmtS(totalCobrado)}</td>
                          <td colSpan={2}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
