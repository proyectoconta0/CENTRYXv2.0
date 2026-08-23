import React, { useState, useEffect, useCallback } from "react";
import { HiX, HiExclamationCircle, HiCurrencyDollar, HiTrash } from "react-icons/hi";
import {
  getDetalleLoteDetraccion, agregarGastosLoteDetraccion, quitarGastoLoteDetraccion,
  generarTxtLoteDetraccion, marcarDetraccionGastoDepositada,
} from "../../api/comercialApi";
import ModalRegistrarPagoGasto from "./ModalRegistrarPagoGasto";
import Toast from "../Toast";

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtFecha(d) {
  if (!d) return "—";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

function TipoBadge() {
  // Los lotes solo contienen Gastos (Compras) — igual que el generador de TXT.
  return <span className="text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap bg-orange-100 text-orange-700">Compra</span>;
}

// Modal "Ver Detalle" de un Lote de Detracciones — único componente, usado
// tanto desde Detracciones a Depositar (lotes en edición) como desde
// Gastos → Lista de Pagos (lotes ya pagados, para ver qué facturas incluyó
// el pago consolidado). Es auto-contenido: recibe solo el loteId y carga su
// propio detalle.
export default function ModalDetalleLoteDetraccion({ loteId, onClose, onChange }) {
  const [loteDetalle,        setLoteDetalle]        = useState(null);
  const [loadingLoteDetalle, setLoadingLoteDetalle]  = useState(false);
  const [selectedDisponibles, setSelectedDisponibles] = useState(new Set());
  const [agregando,    setAgregando]    = useState(false);
  const [quitandoId,   setQuitandoId]   = useState(null);
  const [generandoTxt, setGenerandoTxt] = useState(false);
  const [errorLote,    setErrorLote]    = useState("");
  const [pagoGasto,    setPagoGasto]    = useState(null);
  const [toast,        setToast]        = useState(null);

  const cargarDetalleLote = useCallback(async (id) => {
    setLoadingLoteDetalle(true);
    try { setLoteDetalle(await getDetalleLoteDetraccion(id)); }
    catch { setLoteDetalle(null); }
    finally { setLoadingLoteDetalle(false); }
  }, []);

  useEffect(() => {
    if (!loteId) return;
    setSelectedDisponibles(new Set());
    setErrorLote("");
    cargarDetalleLote(loteId);
  }, [loteId, cargarDetalleLote]);

  const toggleDisponible = (id) => {
    setSelectedDisponibles(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleTodosDisponibles = () => {
    const disponibles = loteDetalle?.disponibles || [];
    setSelectedDisponibles(s => s.size === disponibles.length ? new Set() : new Set(disponibles.map(f => f.id)));
  };

  const agregarSeleccionadas = async () => {
    if (!loteDetalle || selectedDisponibles.size === 0) return;
    setAgregando(true); setErrorLote("");
    try {
      await agregarGastosLoteDetraccion(loteDetalle.id, [...selectedDisponibles]);
      setSelectedDisponibles(new Set());
      await cargarDetalleLote(loteDetalle.id);
      if (onChange) await onChange();
    } catch {
      setErrorLote("No se pudieron agregar las facturas seleccionadas.");
    } finally {
      setAgregando(false);
    }
  };

  const quitarDelLote = async (gastoId) => {
    if (!loteDetalle) return;
    setQuitandoId(gastoId);
    try {
      await quitarGastoLoteDetraccion(loteDetalle.id, gastoId);
      await cargarDetalleLote(loteDetalle.id);
      if (onChange) await onChange();
    } catch {
      setToast({ message: "No se pudo quitar la factura del lote.", type: "error" });
    } finally {
      setQuitandoId(null);
    }
  };

  const generarTxtDelLote = async () => {
    if (!loteDetalle) return;
    setGenerandoTxt(true); setErrorLote("");
    try {
      const res   = await generarTxtLoteDetraccion(loteDetalle.id);
      const cd    = res.headers?.["content-disposition"] || "";
      const match = cd.match(/filename=([^;]+)/i);
      const fname = match ? match[1].trim() : `Lote_${loteDetalle.numero_lote}.txt`;
      const url   = window.URL.createObjectURL(new Blob([res.data]));
      const a     = document.createElement("a");
      a.href = url;
      a.setAttribute("download", fname);
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      await cargarDetalleLote(loteDetalle.id);
      if (onChange) await onChange();
    } catch {
      setErrorLote("No se pudo generar el archivo TXT del lote.");
    } finally {
      setGenerandoTxt(false);
    }
  };

  if (!loteId) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh]">
          <div className="flex items-start justify-between p-6 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-bold text-gray-800">Lote N° {loteDetalle?.numero_lote ?? "…"}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {fmtFecha(loteDetalle?.fecha)} · Importe Total:{" "}
                <span className="font-semibold text-gray-700">{fmtS(loteDetalle?.importe_total)}</span>
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
              <HiX className="w-5 h-5" />
            </button>
          </div>

          <div className="p-6 overflow-y-auto flex-1 space-y-6">
            {errorLote && (
              <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {errorLote}
              </div>
            )}

            {loteDetalle?.estado === "pagado" && (
              <div className="border border-green-200 bg-green-50 rounded-xl p-4">
                <h3 className="text-sm font-semibold text-green-800 mb-2">✅ Pago registrado</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Fecha de pago</p>
                    <p className="font-medium text-gray-800">{fmtFecha(loteDetalle.fecha_pago)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Monto total</p>
                    <p className="font-medium text-gray-800">{fmtS(loteDetalle.importe_total)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">Método</p>
                    <p className="font-medium text-gray-800">{loteDetalle.metodo_pago || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 uppercase">N° Operación</p>
                    <p className="font-medium text-gray-800">{loteDetalle.numero_operacion || "—"}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Disponibles para agregar — un lote ya pagado queda cerrado */}
            {loteDetalle?.estado !== "pagado" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-700">Facturas disponibles para agregar</h3>
                <button onClick={agregarSeleccionadas} disabled={selectedDisponibles.size === 0 || agregando}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  ➕ {agregando ? "Agregando…" : "Agregar Seleccionadas al Lote"}
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-52 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2.5 text-center w-10">
                          <input type="checkbox"
                            checked={(loteDetalle?.disponibles || []).length > 0 && selectedDisponibles.size === loteDetalle.disponibles.length}
                            onChange={toggleTodosDisponibles}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">RUC / Proveedor</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Concepto</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Monto Det.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingLoteDetalle ? (
                        <tr><td colSpan={6} className="text-center py-6 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : (loteDetalle?.disponibles || []).length === 0 ? (
                        <tr><td colSpan={6} className="text-center py-6 text-gray-400 text-sm">No hay facturas disponibles</td></tr>
                      ) : loteDetalle.disponibles.map(f => (
                        <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2.5 text-center">
                            <input type="checkbox" checked={selectedDisponibles.has(f.id)} onChange={() => toggleDisponible(f.id)}
                              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                          </td>
                          <td className="px-4 py-2.5"><TipoBadge /></td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{fmtFecha(f.fecha)}</td>
                          <td className="px-4 py-2.5 max-w-[180px]">
                            <p className="text-xs font-mono text-gray-500">{f.ruc || "—"}</p>
                            <p className="text-sm text-gray-700 truncate" title={f.nombre}>{f.nombre || "—"}</p>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 max-w-[160px] truncate" title={f.concepto}>{f.concepto || "—"}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(f.monto_detraccion)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            )}

            {/* Ya en el lote */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Facturas en el lote</h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">RUC / Proveedor</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">N° Comprobante</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Concepto</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Importe Total</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Tasa</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Monto Det.</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Estado</th>
                        <th className="px-4 py-2.5 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingLoteDetalle ? (
                        <tr><td colSpan={10} className="text-center py-6 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : (loteDetalle?.detalle || []).length === 0 ? (
                        <tr><td colSpan={10} className="text-center py-6 text-gray-400 text-sm">Este lote no tiene facturas agregadas</td></tr>
                      ) : loteDetalle.detalle.map(f => (
                        <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-2.5"><TipoBadge /></td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{fmtFecha(f.fecha)}</td>
                          <td className="px-4 py-2.5 max-w-[180px]">
                            <p className="text-xs font-mono text-gray-500">{f.ruc || "—"}</p>
                            <p className="text-sm text-gray-700 truncate" title={f.nombre}>{f.nombre || "—"}</p>
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap font-mono text-xs">{f.numero_documento || "—"}</td>
                          <td className="px-4 py-2.5 text-gray-600 max-w-[140px] truncate" title={f.concepto}>{f.concepto || "—"}</td>
                          <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtS(f.monto)}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600 whitespace-nowrap">{f.tasa}%</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(f.monto_detraccion)}</td>
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className={`text-xs font-medium ${f.detraccion_depositada ? "text-green-600" : f.semaforo === "rojo" ? "text-red-600" : f.semaforo === "amarillo" ? "text-yellow-600" : "text-gray-600"}`}>
                              {f.detraccion_depositada ? "Depositada" : f.estado}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center justify-center gap-1.5">
                              {!f.detraccion_depositada && (
                                <button onClick={() => setPagoGasto(f)} title="Pagar"
                                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors whitespace-nowrap">
                                  <HiCurrencyDollar className="w-3.5 h-3.5" /> Pagar
                                </button>
                              )}
                              {loteDetalle.estado !== "pagado" && (
                              <button onClick={() => quitarDelLote(f.id)} disabled={quitandoId === f.id} title="Quitar del lote"
                                className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
                                <HiTrash className="w-3.5 h-3.5" /> {quitandoId === f.id ? "…" : "Quitar"}
                              </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end px-6 pb-6 pt-2 border-t border-gray-200">
            <button onClick={generarTxtDelLote} disabled={(loteDetalle?.detalle || []).length === 0 || generandoTxt}
              className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm transition-colors">
              📄 {generandoTxt ? "Generando…" : "Generar TXT Banco de la Nación"}
            </button>
          </div>
        </div>
      </div>

      {pagoGasto && (
        <ModalRegistrarPagoGasto
          gasto={pagoGasto}
          onClose={() => setPagoGasto(null)}
          onSuccess={async () => {
            await marcarDetraccionGastoDepositada(pagoGasto.id);
            await cargarDetalleLote(loteId);
            if (onChange) await onChange();
          }}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </>
  );
}
