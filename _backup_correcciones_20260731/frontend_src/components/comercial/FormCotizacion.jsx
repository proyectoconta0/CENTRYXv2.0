import React, { useState, useEffect } from "react";
import { HiX } from "react-icons/hi";
import { createCotizacion, updateCotizacion } from "../../api/comercialApi";

const SERVICIOS = ["Alquiler de andamios","Venta de andamios","Reparación de andamios","Venta de piezas","Capacitación","Transporte","Montaje"];
const ESTADOS   = ["borrador","enviada","aprobada","rechazada"];

const fmt = (d) => d ? (d instanceof Date ? d.toISOString().split("T")[0] : d) : "";
const hoyStr = () => new Date().toISOString().split("T")[0];
const en30    = () => { const d = new Date(); d.setDate(d.getDate()+30); return d.toISOString().split("T")[0]; };

const VACIO = { cliente_id:"", tipo_servicio:"Alquiler de andamios", descripcion:"", monto:"", fecha_emision: hoyStr(), fecha_vencimiento: en30(), estado:"borrador" };

export default function FormCotizacion({ cotizacion, clientes=[], onClose, onSaved }) {
  const [form, setForm] = useState(VACIO);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (cotizacion) {
      setForm({ ...cotizacion, fecha_emision: fmt(cotizacion.fecha_emision), fecha_vencimiento: fmt(cotizacion.fecha_vencimiento) });
    } else setForm(VACIO);
  }, [cotizacion]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const payload = { ...form, monto: parseFloat(form.monto), cliente_id: parseInt(form.cliente_id) };
      const saved = cotizacion ? await updateCotizacion(cotizacion.id, payload) : await createCotizacion(payload);
      onSaved(saved);
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar");
    } finally { setLoading(false); }
  };

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500";
  const Label = ({ t, req }) => <label className="block text-xs font-medium text-gray-600 mb-1">{t}{req && <span className="text-red-500 ml-0.5">*</span>}</label>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">{cotizacion ? "Editar Cotización" : "Nueva Cotización"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX className="text-xl" /></button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2">{error}</div>}

          <div>
            <Label t="Cliente" req />
            <select value={form.cliente_id} onChange={e => set("cliente_id", e.target.value)} required className={inputCls}>
              <option value="">Seleccionar cliente...</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
            </select>
          </div>

          <div>
            <Label t="Tipo de Servicio" req />
            <select value={form.tipo_servicio} onChange={e => set("tipo_servicio", e.target.value)} className={inputCls}>
              {SERVICIOS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <Label t="Descripción del Servicio" />
            <textarea value={form.descripcion} onChange={e => set("descripcion", e.target.value)} rows={3}
              className={inputCls + " resize-none"} placeholder="Detalle del servicio cotizado..." />
          </div>

          <div>
            <Label t="Monto (S/)" req />
            <input type="number" min="0" step="0.01" value={form.monto} onChange={e => set("monto", e.target.value)}
              required className={inputCls} placeholder="0.00" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label t="Fecha Emisión" req />
              <input type="date" value={form.fecha_emision} onChange={e => set("fecha_emision", e.target.value)} required className={inputCls} />
            </div>
            <div>
              <Label t="Fecha Vencimiento" req />
              <input type="date" value={form.fecha_vencimiento} onChange={e => set("fecha_vencimiento", e.target.value)} required className={inputCls} />
            </div>
          </div>

          <div>
            <Label t="Estado" />
            <select value={form.estado} onChange={e => set("estado", e.target.value)} className={inputCls}>
              {ESTADOS.map(s => <option key={s} value={s} className="capitalize">{s.charAt(0).toUpperCase()+s.slice(1)}</option>)}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} type="button" className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium transition-colors">
            {loading ? "Guardando..." : cotizacion ? "Guardar cambios" : "Crear cotización"}
          </button>
        </div>
      </div>
    </div>
  );
}
