import React from "react";

// Campos condicionales según método de pago (Banco/N° Cuenta o Banco/N° Cheque),
// compartido por los modales de pago de Gastos (CPP, Pagos Tributarios y
// Lotes de Detracciones).
export default function CamposMetodoPagoGasto({ form, setForm, cuentasBancarias }) {
  const opcionesBanco = cuentasBancarias.map(c => `${c.banco} — ${c.numero_cuenta}`);
  if (form.metodo_pago === "Transferencia" || form.metodo_pago === "Depósito") {
    return (
      <div className="space-y-3 border-t border-gray-100 pt-3">
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">Banco</label>
          {cuentasBancarias.length > 0 ? (
            <select value={form.banco}
              onChange={e => {
                const opt  = e.target.value;
                const cb   = cuentasBancarias.find(c => `${c.banco} — ${c.numero_cuenta}` === opt);
                setForm(f => ({ ...f, banco: opt, numero_cuenta: cb ? cb.numero_cuenta : f.numero_cuenta }));
              }}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Seleccionar cuenta…</option>
              {opcionesBanco.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : (
            <input type="text" value={form.banco} placeholder="Nombre del banco"
              onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
              className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          )}
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">N° de Cuenta</label>
          <input type="text" value={form.numero_cuenta} placeholder="Ej: 191-123456789-0-12"
            onChange={e => setForm(f => ({ ...f, numero_cuenta: e.target.value }))}
            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    );
  }
  if (form.metodo_pago === "Cheque") {
    return (
      <div className="space-y-3 border-t border-gray-100 pt-3">
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">Banco</label>
          <input type="text" value={form.banco} placeholder="Nombre del banco"
            onChange={e => setForm(f => ({ ...f, banco: e.target.value }))}
            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-700 uppercase">N° de Cheque</label>
          <input type="text" value={form.numero_cheque} placeholder="Ej: 0001234"
            onChange={e => setForm(f => ({ ...f, numero_cheque: e.target.value }))}
            className="w-full mt-1.5 px-3 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>
    );
  }
  return null;
}
