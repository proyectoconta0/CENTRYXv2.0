import React, { useEffect, useState } from "react";
import { HiX, HiExclamationCircle } from "react-icons/hi";
import { marcarLoteDetraccionPagado, getCuentasBancarias } from "../../api/comercialApi";

const METODOS_PAGO_LOTE = ["Efectivo", "Transferencia", "Cheque"];

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

function fmtS(n) {
  if (n == null) return "—";
  return `S/ ${Math.abs(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Pago consolidado del lote: UN solo registro (los campos de pago quedan en
// el propio LoteDetraccion), no un pago por cada factura. El backend marca
// detraccion_depositada=True en todas las facturas del lote de una vez.
export default function ModalPagarLoteDetraccion({ lote, onClose, onSuccess }) {
  const [fechaPago,        setFechaPago]        = useState(hoy());
  const [metodoPago,       setMetodoPago]       = useState("Efectivo");
  const [numeroOperacion,  setNumeroOperacion]  = useState("");
  const [numeroCuenta,     setNumeroCuenta]     = useState("");
  const [bancoSeleccionado, setBancoSeleccionado] = useState("");
  const [cuentas, setCuentas] = useState([]);
  const [error,  setError]  = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!lote) return;
    setFechaPago(hoy());
    setMetodoPago("Efectivo");
    setNumeroOperacion("");
    setNumeroCuenta("");
    setBancoSeleccionado("");
    setError("");
  }, [lote]);

  // Cuentas bancarias ya registradas en Conciliación Bancaria, para elegir a
  // cuál se depositó cuando el tipo de pago es Transferencia.
  useEffect(() => {
    if (metodoPago !== "Transferencia") return;
    getCuentasBancarias().then(r => setCuentas(r || [])).catch(() => setCuentas([]));
  }, [metodoPago]);

  const handleSeleccionarCuenta = (numeroCuentaSeleccionado) => {
    const cuenta = cuentas.find(c => c.numero_cuenta === numeroCuentaSeleccionado);
    setNumeroCuenta(numeroCuentaSeleccionado);
    setBancoSeleccionado(cuenta ? cuenta.banco : "");
  };

  if (!lote) return null;

  const handleConfirmar = async () => {
    if (!fechaPago) { setError("La fecha de pago es obligatoria."); return; }
    if (metodoPago === "Transferencia" && !numeroCuenta.trim()) {
      setError("Ingrese el N° de cuenta para el pago por transferencia.");
      return;
    }

    setSaving(true); setError("");
    try {
      await marcarLoteDetraccionPagado(lote.id, {
        fecha_pago:       fechaPago,
        metodo_pago:      metodoPago,
        numero_operacion: numeroOperacion.trim() || null,
        banco:            metodoPago === "Transferencia" ? bancoSeleccionado : null,
        numero_cuenta:    metodoPago === "Transferencia" ? numeroCuenta : null,
      });
      if (onSuccess) await onSuccess();
      onClose();
    } catch {
      setError("No se pudo registrar el pago del lote.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between p-6 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Pagar Detracciones</h2>
            <p className="text-sm text-gray-500 mt-0.5">Lote N° {lote.numero_lote}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 mt-0.5">
            <HiX className="w-5 h-5" />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">Monto Total</label>
            <p className="mt-1.5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700">
              {fmtS(lote.importe_total)} <span className="text-gray-400 font-normal">({lote.cantidad} factura{lote.cantidad === 1 ? "" : "s"})</span>
            </p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">Fecha *</label>
            <input type="date" value={fechaPago}
              onChange={e => setFechaPago(e.target.value)}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">Tipo de Pago</label>
            <select value={metodoPago}
              onChange={e => { setMetodoPago(e.target.value); setNumeroCuenta(""); setBancoSeleccionado(""); }}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {METODOS_PAGO_LOTE.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          {metodoPago === "Transferencia" && (
            <div>
              <label className="text-xs font-semibold text-gray-700 uppercase">N° de Cuenta</label>
              {cuentas.length > 0 ? (
                <select value={numeroCuenta} onChange={e => handleSeleccionarCuenta(e.target.value)}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">Seleccionar cuenta...</option>
                  {cuentas.map(c => (
                    <option key={c.id} value={c.numero_cuenta}>
                      {c.banco} — {c.numero_cuenta} {c.tipo_cuenta ? `(${c.tipo_cuenta})` : ""}
                    </option>
                  ))}
                </select>
              ) : (
                <input type="text" value={numeroCuenta} placeholder="Ej: 191-123456789-0-12"
                  onChange={e => setNumeroCuenta(e.target.value)}
                  className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              )}
            </div>
          )}
          <div>
            <label className="text-xs font-semibold text-gray-700 uppercase">N° de Operación <span className="text-gray-400 normal-case font-normal">(opcional)</span></label>
            <input type="text" value={numeroOperacion} placeholder="Ej: 123456"
              onChange={e => setNumeroOperacion(e.target.value)}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 px-3 py-2.5 rounded-lg text-sm">
              <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {error}
            </div>
          )}
        </div>
        <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
          <button onClick={onClose}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50">Cancelar</button>
          <button onClick={handleConfirmar} disabled={saving}
            className="flex-1 px-4 py-2.5 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-50 transition-colors">
            {saving ? "Guardando…" : "Confirmar Pago"}
          </button>
        </div>
      </div>
    </div>
  );
}
