import React, { useState, useEffect, useCallback } from "react";
import { HiX, HiExclamationCircle } from "react-icons/hi";
import { getDocumentosPendientesOrdenPago, crearOrdenPago } from "../../api/comercialApi";
import CamposMetodoPagoGasto from "./CamposMetodoPagoGasto";

const METODOS_PAGO_OP = ["Efectivo", "Transferencia", "Depósito", "Cheque", "Yape o Plin"];
const TIPOS_DOCUMENTO_OP = ["Todos", "Factura", "Recibo Interno", "Boleta", "Otros"];

const TIPO_LABEL = {
  "Recibo de Servicios Públicos": "Rec. SSPP",
  "Anticipo de Proveedor":        "Anticipo Proveedor",
};

function hoy() { return new Date().toISOString().slice(0, 10); }

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

const FORM_PAGO_DEFAULT = {
  metodo_pago: "Efectivo", banco: "", numero_cuenta: "", numero_cheque: "", numero_operacion: "",
};

// Modal de 2 pasos: elegir documentos pendientes de TODO el sistema (con
// filtros de período, RUC/proveedor y tipo de documento, en vivo) con un
// monto a pagar editable POR documento → método de pago y confirmación.
// Genera UN solo registro (OrdenPago) que consolida el pago de uno o varios
// documentos, incluso de distintos proveedores.
export default function ModalCrearOrdenPago({ cuentasBancarias, onClose, onSuccess }) {
  const [step, setStep] = useState(1);

  // ── Paso 1: Documentos pendientes + filtros + monto a pagar ────────────
  const [filterDesde,  setFilterDesde]  = useState("");
  const [filterHasta,  setFilterHasta]  = useState("");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterTipo,   setFilterTipo]   = useState("Todos");
  const [documentos,   setDocumentos]   = useState([]);
  const [loadingDocs,  setLoadingDocs]  = useState(false);
  // `montos` solo contiene entradas para los documentos marcados: { [gastoId]: "texto del input" }
  const [montos,       setMontos]       = useState({});

  // ── Paso 2: Método de pago ──────────────────────────────────────────────
  const [fechaPago, setFechaPago] = useState(hoy());
  const [form,      setForm]      = useState(FORM_PAGO_DEFAULT);
  const [error,     setError]     = useState("");
  const [saving,    setSaving]    = useState(false);

  const cargarDocumentos = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const params = {};
      if (filterDesde)  params.desde  = filterDesde;
      if (filterHasta)  params.hasta  = filterHasta;
      if (filterSearch) params.search = filterSearch;
      if (filterTipo && filterTipo !== "Todos") params.tipo_comprobante = filterTipo;
      const r = await getDocumentosPendientesOrdenPago(params);
      setDocumentos(r.data || []);
    } catch { setDocumentos([]); }
    finally { setLoadingDocs(false); }
  }, [filterDesde, filterHasta, filterSearch, filterTipo]);

  // Filtros en tiempo real (con un pequeño debounce para no disparar una
  // petición por cada tecla escrita en el buscador).
  useEffect(() => {
    const t = setTimeout(() => { cargarDocumentos(); }, 300);
    return () => clearTimeout(t);
  }, [cargarDocumentos]);

  const toggleDocumento = (doc) => {
    setMontos(m => {
      const next = { ...m };
      if (doc.id in next) delete next[doc.id];
      else next[doc.id] = doc.saldo_pendiente.toFixed(2);
      return next;
    });
  };
  const toggleTodos = () => {
    setMontos(m =>
      Object.keys(m).length === documentos.length
        ? {}
        : Object.fromEntries(documentos.map(d => [d.id, d.saldo_pendiente.toFixed(2)]))
    );
  };
  const cambiarMonto = (id, valor) => {
    setMontos(m => ({ ...m, [id]: valor }));
  };

  const seleccionados = documentos.filter(d => d.id in montos);
  const importeTotalAPagar = seleccionados.reduce((acc, d) => acc + (parseFloat(montos[d.id]) || 0), 0);

  const erroresPorFila = {};
  seleccionados.forEach(d => {
    const v = parseFloat(montos[d.id]);
    if (isNaN(v) || v < 0.01) erroresPorFila[d.id] = "Mínimo S/ 0.01";
    else if (v > d.saldo_pendiente + 0.01) erroresPorFila[d.id] = "Excede el saldo pendiente";
  });
  const paso1Valido = seleccionados.length > 0 && Object.keys(erroresPorFila).length === 0;

  const irAPaso2 = () => {
    if (!paso1Valido) return;
    setError("");
    setStep(2);
  };

  const handleGenerar = async () => {
    if (!fechaPago) { setError("La fecha de pago es obligatoria."); return; }
    if ((form.metodo_pago === "Transferencia" || form.metodo_pago === "Depósito") && !form.numero_cuenta.trim()) {
      setError("Ingrese el N° de cuenta para el pago por transferencia o depósito.");
      return;
    }
    setSaving(true); setError("");
    try {
      await crearOrdenPago({
        documentos:       seleccionados.map(d => ({ gasto_id: d.id, monto_pagado: parseFloat(montos[d.id]) })),
        fecha_pago:       fechaPago,
        metodo_pago:      form.metodo_pago,
        banco:            form.banco || null,
        numero_cuenta:    form.numero_cuenta || null,
        numero_cheque:    form.numero_cheque || null,
        numero_operacion: form.numero_operacion || null,
      });
      if (onSuccess) await onSuccess();
      onClose();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  };

  // Nombre a mostrar en el resumen: el único proveedor si todos los
  // documentos seleccionados son suyos, o "Varios proveedores" si no.
  const nombresSeleccionados = [...new Set(seleccionados.map(d => d.proveedor || "—"))];
  const proveedorResumen = nombresSeleccionados.length === 1 ? nombresSeleccionados[0] : "Varios proveedores";

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Crear Orden de Pago</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Paso {step} de 2 — {step === 1 ? "Seleccionar documentos" : "Método de pago"}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <HiX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* ── Paso 1 ─────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-3">
              {/* Filtros */}
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 flex flex-wrap gap-3 items-center">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-semibold text-gray-600 uppercase">Desde</label>
                  <input type="date" value={filterDesde} onChange={e => setFilterDesde(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <label className="text-xs font-semibold text-gray-600 uppercase">Hasta</label>
                  <input type="date" value={filterHasta} onChange={e => setFilterHasta(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <input type="text" value={filterSearch} placeholder="RUC o nombre del proveedor…"
                  onChange={e => setFilterSearch(e.target.value)}
                  className="flex-1 min-w-[180px] px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <select value={filterTipo} onChange={e => setFilterTipo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {TIPOS_DOCUMENTO_OP.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-80 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
                      <tr>
                        <th className="px-3 py-2.5 text-center w-10">
                          <input type="checkbox"
                            checked={documentos.length > 0 && Object.keys(montos).length === documentos.length}
                            onChange={toggleTodos}
                            className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                        </th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Tipo</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">N° Documento</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Proveedor</th>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase">Fecha</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Monto Total</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Saldo Pendiente</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase">Monto a Pagar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {loadingDocs ? (
                        <tr><td colSpan={8} className="text-center py-8 text-gray-400 text-sm">Cargando…</td></tr>
                      ) : documentos.length === 0 ? (
                        <tr><td colSpan={8} className="text-center py-8 text-gray-400 text-sm">No hay documentos pendientes para los filtros seleccionados</td></tr>
                      ) : documentos.map(d => {
                        const marcado = d.id in montos;
                        return (
                          <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-3 py-2.5 text-center">
                              <input type="checkbox" checked={marcado} onChange={() => toggleDocumento(d)}
                                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                                {TIPO_LABEL[d.tipo_comprobante] || d.tipo_comprobante || "—"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{d.numero_comprobante || "—"}</td>
                            <td className="px-4 py-2.5 max-w-[160px] truncate text-gray-700" title={d.proveedor}>{d.proveedor || "—"}</td>
                            <td className="px-4 py-2.5 text-gray-600 whitespace-nowrap">{fmtFecha(d.fecha)}</td>
                            <td className="px-4 py-2.5 text-right text-gray-700 whitespace-nowrap">{fmtS(d.monto)}</td>
                            <td className="px-4 py-2.5 text-right font-semibold text-gray-800 whitespace-nowrap">{fmtS(d.saldo_pendiente)}</td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              {marcado ? (
                                <div>
                                  <input type="number" step="0.01" min="0.01" max={d.saldo_pendiente}
                                    value={montos[d.id]} onChange={e => cambiarMonto(d.id, e.target.value)}
                                    className={`w-28 px-2 py-1.5 border rounded-lg text-sm text-right focus:outline-none focus:ring-2 ${
                                      erroresPorFila[d.id] ? "border-red-300 focus:ring-red-400" : "border-gray-300 focus:ring-blue-500"
                                    }`} />
                                  {erroresPorFila[d.id] && (
                                    <p className="text-xs text-red-600 mt-0.5">{erroresPorFila[d.id]}</p>
                                  )}
                                </div>
                              ) : <span className="text-gray-300">—</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex justify-end">
                <p className="text-sm font-semibold text-gray-800">
                  IMPORTE TOTAL A PAGAR: <span className="text-blue-700">{fmtS(importeTotalAPagar)}</span>
                </p>
              </div>
            </div>
          )}

          {/* ── Paso 2 ─────────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Pago *</label>
                <input type="date" value={fechaPago} onChange={e => setFechaPago(e.target.value)}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">Método de Pago</label>
                <select value={form.metodo_pago}
                  onChange={e => setForm(() => ({ ...FORM_PAGO_DEFAULT, metodo_pago: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {METODOS_PAGO_OP.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <CamposMetodoPagoGasto form={form} setForm={setForm} cuentasBancarias={cuentasBancarias} />

              <div>
                <label className="text-xs font-semibold text-gray-700 uppercase">N° de Operación <span className="text-gray-400 normal-case font-normal">(opcional)</span></label>
                <input type="text" value={form.numero_operacion} placeholder="Ej: 123456"
                  onChange={e => setForm(f => ({ ...f, numero_operacion: e.target.value }))}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>

              <div className="border border-gray-200 bg-gray-50 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Proveedor</span><span className="font-medium text-gray-800">{proveedorResumen}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Documentos</span><span className="font-medium text-gray-800">{seleccionados.length} seleccionado{seleccionados.length === 1 ? "" : "s"}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Método</span><span className="font-medium text-gray-800">{form.metodo_pago}</span></div>
                {form.banco && (
                  <div className="flex justify-between"><span className="text-gray-500">Banco</span><span className="font-medium text-gray-800">{form.banco}{form.numero_cuenta ? ` — ${form.numero_cuenta}` : ""}</span></div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-gray-200">
                  <span className="text-gray-600 font-semibold">IMPORTE TOTAL</span>
                  <span className="font-bold text-gray-800">{fmtS(importeTotalAPagar)}</span>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
                  <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
          {step > 1 && (
            <button onClick={() => setStep(s => s - 1)}
              className="px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Atrás</button>
          )}
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          {step === 1 && (
            <button onClick={irAPaso2} disabled={!paso1Valido}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
              Siguiente ({seleccionados.length} documento{seleccionados.length === 1 ? "" : "s"})
            </button>
          )}
          {step === 2 && (
            <button onClick={handleGenerar} disabled={saving}
              className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
              {saving ? "Generando…" : "Generar Orden de Pago"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
