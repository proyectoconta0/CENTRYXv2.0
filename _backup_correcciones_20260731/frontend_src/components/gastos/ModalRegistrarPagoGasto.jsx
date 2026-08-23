import React, { useEffect, useState } from "react";
import { HiX, HiExclamationCircle } from "react-icons/hi";
import { registrarPagoGasto, getCuentasBancarias } from "../../api/comercialApi";
import CamposMetodoPagoGasto from "./CamposMetodoPagoGasto";

const METODOS_PAGO = ["Efectivo", "Transferencia", "Depósito", "Cheque", "Yape o Plin"];
const TOLERANCIA_REDONDEO = 5.00; // S/ 5.00 — debe coincidir con backend/app/routers/gastos.py

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function parsearError(err) {
  if (!err?.response) return "No se pudo conectar al servidor.";
  const d = err.response?.data?.detail;
  if (!d) return `Error del servidor (${err.response.status})`;
  if (Array.isArray(d)) return "Error de validación: " + d.map(e => e.msg).join(", ");
  return String(d);
}

// Modal "Registrar Pago" compartido — mismo componente usado por Cuentas por
// Pagar (Gastos.jsx) y por el detalle de un Lote de Detracciones
// (components/gastos/DetraccionesPanel.jsx). `gasto` requiere `id` y,
// opcionalmente, `saldo_pendiente`/`monto`/`proveedor` para el resumen.
export default function ModalRegistrarPagoGasto({ gasto, onClose, onSuccess }) {
  const [form, setForm] = useState({ monto_pagado: "", fecha_pago: hoy(), metodo_pago: "Efectivo", banco: "", numero_cuenta: "", numero_cheque: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [cuentasBancarias, setCuentasBancarias] = useState([]);

  useEffect(() => {
    if (!gasto) return;
    setForm({
      monto_pagado:  String(gasto.saldo_pendiente ?? gasto.monto ?? ""),
      fecha_pago:    hoy(),
      metodo_pago:   "Efectivo",
      banco:         "",
      numero_cuenta: "",
      numero_cheque: "",
    });
    setError("");
    getCuentasBancarias().then(r => setCuentasBancarias(r || [])).catch(() => {});
  }, [gasto]);

  if (!gasto) return null;

  const handleRegistrar = async () => {
    const monto = parseFloat(form.monto_pagado);
    if (isNaN(monto) || monto <= 0) { setError("Ingrese un monto válido."); return; }
    if (!form.fecha_pago)            { setError("La fecha de pago es obligatoria."); return; }
    setSaving(true); setError("");
    try {
      await registrarPagoGasto(gasto.id, {
        monto_pagado:  monto,
        fecha_pago:    form.fecha_pago,
        metodo_pago:   form.metodo_pago,
        banco:         form.banco || null,
        numero_cuenta: form.numero_cuenta || null,
        numero_cheque: form.numero_cheque || null,
      });
      if (onSuccess) await onSuccess();
      onClose();
    } catch (err) {
      setError(parsearError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Registrar Pago</h2>
            <p className="text-sm text-gray-500 mt-0.5 truncate max-w-[260px]">{gasto.proveedor || gasto.nombre || gasto.descripcion}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <HiX className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm text-blue-800">
            Saldo pendiente: <span className="font-bold">{fmtS(gasto.saldo_pendiente ?? gasto.monto)}</span>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">Monto a Pagar (S/) *</label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
              <input type="number" step="0.01" min="0.01" value={form.monto_pagado} placeholder="0.00"
                onChange={e => setForm(f => ({ ...f, monto_pagado: e.target.value }))}
                className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {(() => {
              const montoNum = parseFloat(form.monto_pagado);
              const saldoPendiente = gasto.saldo_pendiente ?? gasto.monto ?? 0;
              if (isNaN(montoNum) || montoNum <= 0) return null;
              const diferencia = Math.round((montoNum - saldoPendiente) * 100) / 100;
              if (Math.abs(diferencia) < 0.01) return null;

              // Sobrepasa lo que el backend permite pagar (saldo + tolerancia) — se rechazará.
              if (diferencia > TOLERANCIA_REDONDEO) {
                return (
                  <p className="text-xs text-red-600 mt-1.5 font-medium">
                    ⚠️ El monto supera el saldo pendiente en más de {fmtS(TOLERANCIA_REDONDEO)} — no se puede registrar
                  </p>
                );
              }
              // Pagó de menos, más allá de la tolerancia → pago parcial normal.
              if (diferencia < -TOLERANCIA_REDONDEO) {
                return (
                  <p className="text-xs text-red-600 mt-1.5 font-medium">
                    ⚠️ Diferencia supera {fmtS(TOLERANCIA_REDONDEO)} — pago parcial
                  </p>
                );
              }
              // En Gastos el dinero sale de la empresa: pagar de MENOS que el
              // saldo es "ganancia" (nos quedamos con esa plata); pagar de MÁS
              // es "perdida" — signo opuesto al de Cobranza.
              if (diferencia < 0) {
                return (
                  <p className="text-xs text-green-600 mt-1.5 font-medium">
                    ⬆️ Redondeo ganancia: {fmtS(Math.abs(diferencia))} — el gasto se cerrará automáticamente
                  </p>
                );
              }
              return (
                <p className="text-xs text-orange-600 mt-1.5 font-medium">
                  ⬇️ Redondeo pérdida: {fmtS(diferencia)} — el gasto se cerrará automáticamente
                </p>
              );
            })()}
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">Fecha de Pago *</label>
            <input type="date" value={form.fecha_pago}
              onChange={e => setForm(f => ({ ...f, fecha_pago: e.target.value }))}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">Método de Pago</label>
            <select value={form.metodo_pago}
              onChange={e => setForm(f => ({ ...f, metodo_pago: e.target.value, banco: "", numero_cuenta: "", numero_cheque: "" }))}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {METODOS_PAGO.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <CamposMetodoPagoGasto form={form} setForm={setForm} cuentasBancarias={cuentasBancarias} />
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={handleRegistrar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? "Guardando…" : "Registrar Pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
