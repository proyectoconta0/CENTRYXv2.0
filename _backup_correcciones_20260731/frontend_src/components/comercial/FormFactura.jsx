import React, { useState, useEffect } from "react";
import { HiX, HiDocumentText } from "react-icons/hi";
import { createFactura, updateFactura, getClientes } from "../../api/comercialApi";

const TIPOS_SERVICIO = [
  "Alquiler de andamios", "Venta de andamios", "Reparación de andamios",
  "Venta de piezas", "Capacitación", "Transporte", "Montaje",
];

const TIPO_COLOR = {
  "Alquiler de andamios":   "bg-blue-50 text-blue-700",
  "Venta de andamios":      "bg-green-50 text-green-700",
  "Reparación de andamios": "bg-amber-50 text-amber-700",
  "Venta de piezas":        "bg-purple-50 text-purple-700",
  "Capacitación":           "bg-teal-50 text-teal-700",
  "Transporte":             "bg-orange-50 text-orange-700",
  "Montaje":                "bg-pink-50 text-pink-700",
};

function fmtFecha(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

function InfoField({ label, value, mono, highlight, span }) {
  return (
    <div className={span ? "col-span-2" : ""}>
      <p className="text-xs text-gray-400 font-medium mb-1">{label}</p>
      <p className={`text-sm ${mono ? "font-mono font-semibold text-blue-700" : ""} ${highlight ? "text-lg font-bold text-blue-700" : "text-gray-800"}`}>
        {value || "—"}
      </p>
    </div>
  );
}

export default function FormFactura({ mode, factura, onClose, onSaved }) {
  const isView   = mode === "view";
  const isEdit   = mode === "edit";
  const isCreate = mode === "create";

  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({
    numero_factura: "",
    cliente_id:     "",
    tipo_servicio:  TIPOS_SERVICIO[0],
    descripcion:    "",
    monto:          "",
    fecha:          today,
  });
  const [clientes, setClientes] = useState([]);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  useEffect(() => {
    getClientes({ per_page: 200 })
      .then(r => setClientes(r.data || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (factura) {
      setForm({
        numero_factura: factura.numero_factura || "",
        cliente_id:     String(factura.cliente_id || ""),
        tipo_servicio:  factura.tipo_servicio   || TIPOS_SERVICIO[0],
        descripcion:    factura.descripcion     || "",
        monto:          factura.monto           != null ? String(factura.monto) : "",
        fecha:          factura.fecha           || today,
      });
    }
  }, [factura]);

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.numero_factura.trim()) { setError("El N° de factura es requerido"); return; }
    if (!form.cliente_id)            { setError("Selecciona un cliente"); return; }
    if (!form.fecha)                 { setError("La fecha de emisión es requerida"); return; }
    if (!form.monto || isNaN(parseFloat(form.monto)) || parseFloat(form.monto) <= 0) {
      setError("El monto debe ser un número mayor a 0"); return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        cliente_id: parseInt(form.cliente_id),
        monto:      parseFloat(form.monto),
      };
      if (isCreate) await createFactura(payload);
      else          await updateFactura(factura.id, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar la factura");
    } finally {
      setSaving(false);
    }
  };

  const titles = { create: "Nueva Factura", edit: "Editar Factura", view: "Detalle de Factura" };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center">
              <HiDocumentText className="text-blue-600 text-lg" />
            </div>
            <h2 className="text-base font-semibold text-gray-800">{titles[mode]}</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <HiX className="text-lg" />
          </button>
        </div>

        {/* Contenido */}
        <div className="overflow-y-auto flex-1">
          {isView ? (
            /* ── Vista de detalle ── */
            <div className="p-6 space-y-5">
              <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                <InfoField label="N° Factura"      value={factura.numero_factura}                          mono />
                <InfoField label="Fecha de Emisión" value={fmtFecha(factura.fecha)} />
                <InfoField label="Cliente"          value={factura.cliente_nombre}                          span />
                <InfoField label="Tipo de Servicio" value={factura.tipo_servicio} />
                <InfoField label="Monto"            value={`S/ ${factura.monto?.toLocaleString("es-PE")}`} highlight />
                {factura.descripcion && (
                  <InfoField label="Descripción"    value={factura.descripcion}                            span />
                )}
              </div>
              {factura.tipo_servicio && (
                <div>
                  <p className="text-xs text-gray-400 font-medium mb-1.5">Categoría</p>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${TIPO_COLOR[factura.tipo_servicio] || "bg-gray-100 text-gray-600"}`}>
                    {factura.tipo_servicio}
                  </span>
                </div>
              )}
              <div className="flex justify-end pt-2 border-t border-gray-100">
                <button onClick={onClose} className="px-5 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                  Cerrar
                </button>
              </div>
            </div>
          ) : (
            /* ── Formulario crear/editar ── */
            <form id="factura-form" onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-100">
                  {error}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">N° Factura *</label>
                  <input
                    type="text"
                    value={form.numero_factura}
                    onChange={e => set("numero_factura", e.target.value)}
                    placeholder="F001-00001"
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-600">Fecha de Emisión *</label>
                  <input
                    type="date"
                    value={form.fecha}
                    onChange={e => set("fecha", e.target.value)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Cliente *</label>
                <select
                  value={form.cliente_id}
                  onChange={e => set("cliente_id", e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">— Seleccionar cliente —</option>
                  {clientes.map(c => (
                    <option key={c.id} value={c.id}>{c.razon_social}</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Tipo de Servicio *</label>
                <select
                  value={form.tipo_servicio}
                  onChange={e => set("tipo_servicio", e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Monto (S/) *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">S/</span>
                  <input
                    type="number"
                    value={form.monto}
                    onChange={e => set("monto", e.target.value)}
                    placeholder="0.00"
                    step="0.01"
                    min="0"
                    className="pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-600">Descripción</label>
                <textarea
                  value={form.descripcion}
                  onChange={e => set("descripcion", e.target.value)}
                  placeholder="Detalle del servicio prestado..."
                  rows={3}
                  className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
                />
              </div>
            </form>
          )}
        </div>

        {/* Footer formulario */}
        {!isView && (
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="factura-form"
              disabled={saving}
              className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60"
            >
              {saving ? "Guardando..." : isCreate ? "Registrar Factura" : "Guardar Cambios"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
