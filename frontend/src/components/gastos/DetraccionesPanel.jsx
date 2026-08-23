import React, { useState, useEffect, useCallback } from "react";
import { HiX, HiCurrencyDollar, HiTrash } from "react-icons/hi";
import {
  getLotesDetraccion, crearLoteDetraccion, revertirPagoLoteDetraccion,
} from "../../api/comercialApi";
import ModalPagarLoteDetraccion from "./ModalPagarLoteDetraccion";
import ModalDetalleLoteDetraccion from "./ModalDetalleLoteDetraccion";
import ConfirmDialog from "../ConfirmDialog";
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

export default function DetraccionesPanel() {
  // ── Lotes de Detracciones Por Pagar (carrito manual) ───────────────────────
  const [lotes,          setLotes]          = useState([]);
  const [loadingLotes,   setLoadingLotes]   = useState(false);
  const [crearLoteModal, setCrearLoteModal] = useState(false);
  const [creandoLote,    setCreandoLote]    = useState(false);

  // ── Modal: Ver Detalle del Lote ─────────────────────────────────────────────
  const [loteDetalleId, setLoteDetalleId] = useState(null);

  // ── Modal: Pagar Detracciones (pago consolidado del lote) ──────────────────
  const [pagarLote, setPagarLote] = useState(null);
  const [revirtiendoId, setRevirtiendoId] = useState(null);
  const [confirmarRevertir, setConfirmarRevertir] = useState(null); // lote a revertir | null
  const [toast, setToast] = useState(null);

  const cargarLotes = useCallback(async () => {
    setLoadingLotes(true);
    try { setLotes(await getLotesDetraccion()); }
    catch { setLotes([]); }
    finally { setLoadingLotes(false); }
  }, []);

  useEffect(() => { cargarLotes(); }, [cargarLotes]);

  const confirmarCrearLote = async () => {
    setCreandoLote(true);
    try {
      await crearLoteDetraccion();
      await cargarLotes();
      setCrearLoteModal(false);
    } catch {
      setToast({ message: "No se pudo crear el lote.", type: "error" });
    } finally {
      setCreandoLote(false);
    }
  };

  const revertirPago = async () => {
    if (!confirmarRevertir) return;
    const lote = confirmarRevertir;
    setRevirtiendoId(lote.id);
    try {
      await revertirPagoLoteDetraccion(lote.id);
      await cargarLotes();
      setConfirmarRevertir(null);
    } catch {
      setToast({ message: "No se pudo revertir el pago del lote.", type: "error" });
    } finally {
      setRevirtiendoId(null);
    }
  };

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex items-center">
        <h3 className="text-sm font-semibold text-gray-700">Lotes de Detracciones</h3>
        <div className="ml-auto">
          <button onClick={() => setCrearLoteModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors">
            📦 Crear Lote
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Lote</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Importe Total</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loadingLotes ? (
                <tr><td colSpan={4} className="text-center py-12 text-gray-400 text-sm">Cargando…</td></tr>
              ) : lotes.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-12 text-gray-400 text-sm">No hay lotes creados</td></tr>
              ) : lotes.map(l => (
                <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-gray-700">N° {l.numero_lote}</td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">{fmtFecha(l.fecha)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(l.importe_total)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={() => setLoteDetalleId(l.id)}
                        className="px-3 py-1.5 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors whitespace-nowrap">
                        Ver Detalle
                      </button>
                      {l.estado === "pagado" ? (
                        <>
                          <span className="px-2.5 py-1 text-xs font-semibold text-green-700 bg-green-50 rounded-lg whitespace-nowrap">
                            ✅ Pagado {fmtFecha(l.fecha_pago)}
                          </span>
                          <button onClick={() => setConfirmarRevertir(l)} disabled={revirtiendoId === l.id} title="Eliminar pago del lote"
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors disabled:opacity-40 whitespace-nowrap">
                            <HiTrash className="w-3.5 h-3.5" /> {revirtiendoId === l.id ? "…" : "Eliminar"}
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setPagarLote(l)} disabled={l.cantidad === 0}
                          title={l.cantidad === 0 ? "El lote no tiene facturas" : "Registrar Pago del Lote"}
                          className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
                          <HiCurrencyDollar className="w-3.5 h-3.5" /> Registrar Pago del Lote
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

      {/* ══ Modal: Crear Lote ═══════════════════════════════════════════════ */}
      {crearLoteModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col">
            <div className="flex items-start justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-bold text-gray-800">📦 Crear Lote</h2>
              <button onClick={() => setCrearLoteModal(false)} className="text-gray-400 hover:text-gray-600 mt-0.5">
                <HiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Número de Lote</label>
                <p className="mt-1.5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
                  Se asignará automáticamente al confirmar
                </p>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha</label>
                <p className="mt-1.5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-600">
                  {fmtFecha(new Date().toISOString().slice(0, 10))}
                </p>
              </div>
            </div>
            <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
              <button onClick={() => setCrearLoteModal(false)}
                className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
              <button onClick={confirmarCrearLote} disabled={creandoLote}
                className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">
                {creandoLote ? "Creando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Modal: Ver Detalle del Lote (mismo componente que Lista de Pagos) ═ */}
      {loteDetalleId && (
        <ModalDetalleLoteDetraccion
          loteId={loteDetalleId}
          onClose={() => setLoteDetalleId(null)}
          onChange={cargarLotes}
        />
      )}
      {pagarLote && (
        <ModalPagarLoteDetraccion
          lote={pagarLote}
          onClose={() => setPagarLote(null)}
          onSuccess={async () => { await cargarLotes(); }}
        />
      )}

      <ConfirmDialog
        open={!!confirmarRevertir}
        title="Eliminar pago del lote"
        message={confirmarRevertir ?
          `Al eliminar este pago:\n` +
          ` ✓ Se eliminará el registro LOTE-${confirmarRevertir.numero_lote}\n` +
          ` ✓ Las ${confirmarRevertir.cantidad} detracciones volverán a aparecer como pendientes de depósito`
          : ""}
        danger
        confirmLabel={revirtiendoId === confirmarRevertir?.id ? "Eliminando…" : "Eliminar"}
        onConfirm={revertirPago}
        onCancel={() => setConfirmarRevertir(null)}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
