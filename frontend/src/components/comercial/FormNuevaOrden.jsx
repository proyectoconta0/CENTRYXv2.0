import React, { useState, useEffect } from "react";
import { HiX, HiClipboardList } from "react-icons/hi";
import {
  createOrden, updateOrden, getClientes, getComprobantes, getProximoCorrelativoOrden,
} from "../../api/comercialApi";
import { TIPOS_SERVICIO, ESTADOS, ESTADO_COLOR } from "./ordenesCommon";

const INPUT_CLS =
  "w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm transition-shadow " +
  "focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";

function Label({ children }) {
  return <label className="text-xs font-medium text-gray-600 mb-1.5 block">{children}</label>;
}

function Section({ n, title, children, last }) {
  return (
    <div className={`py-5 ${last ? "" : "mb-3 border-b border-gray-100"}`}>
      <div className="flex items-center gap-3 mb-4">
        <span className="w-7 h-7 rounded-full bg-blue-600 text-white text-xs font-bold flex items-center justify-center flex-shrink-0 shadow-sm">
          {n}
        </span>
        <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide leading-none">{title}</p>
      </div>
      <div className="pl-10">{children}</div>
    </div>
  );
}

const FORM_DEFAULT = {
  numero_orden: "",
  cliente_id: "",
  tipo_servicio: TIPOS_SERVICIO[0],
  descripcion: "",
  direccion_obra: "",
  distrito: "",
  fecha_inicio: "",
  fecha_fin_estimada: "",
  fecha_fin_real: "",
  presupuesto: "",
  moneda: "PEN",
  tipo_cambio: "3.75",
  avance_porcentaje: 0,
  estado: "Pendiente",
  comprobante_id: "",
  observaciones: "",
};

export default function FormNuevaOrden({ mode, orden, onClose, onSaved }) {
  const isCreate = mode === "create";
  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({ ...FORM_DEFAULT, fecha_inicio: today });
  const [clientes, setClientes] = useState([]);
  const [comprobantes, setComprobantes] = useState([]);
  const [loadingCorrelativo, setLoadingCorrelativo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  useEffect(() => {
    getClientes({ per_page: 200 }).then(r => setClientes(r.data || [])).catch(() => {});
    getComprobantes({ per_page: 200 }).then(r => setComprobantes(r.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (orden) {
      setForm({
        numero_orden:        orden.numero_orden || "",
        cliente_id:          orden.cliente_id ? String(orden.cliente_id) : "",
        tipo_servicio:        orden.tipo_servicio || TIPOS_SERVICIO[0],
        descripcion:          orden.descripcion || "",
        direccion_obra:       orden.direccion_obra || "",
        distrito:             orden.distrito || "",
        fecha_inicio:         orden.fecha_inicio || today,
        fecha_fin_estimada:   orden.fecha_fin_estimada || "",
        fecha_fin_real:       orden.fecha_fin_real || "",
        presupuesto:          String(orden.presupuesto ?? ""),
        moneda:               orden.moneda || "PEN",
        tipo_cambio:          orden.tipo_cambio != null ? String(orden.tipo_cambio) : "3.75",
        avance_porcentaje:    orden.avance_porcentaje ?? 0,
        estado:               orden.estado || "Pendiente",
        comprobante_id:       orden.comprobante_id ? String(orden.comprobante_id) : "",
        observaciones:        orden.observaciones || "",
      });
    }
  }, [orden]); // eslint-disable-line react-hooks/exhaustive-deps

  // Autogenerar correlativo OS-XXXX al crear
  useEffect(() => {
    if (isCreate && !form.numero_orden) {
      setLoadingCorrelativo(true);
      getProximoCorrelativoOrden()
        .then(r => setForm(f => ({ ...f, numero_orden: r.proximo })))
        .catch(() => {})
        .finally(() => setLoadingCorrelativo(false));
    }
  }, [isCreate]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.tipo_servicio)                 { setError("El tipo de servicio es obligatorio"); return; }
    if (!form.fecha_inicio)                  { setError("La fecha de inicio es obligatoria"); return; }
    if (!form.fecha_fin_estimada)            { setError("La fecha fin estimada es obligatoria"); return; }
    if (form.fecha_fin_estimada < form.fecha_inicio) { setError("La fecha fin estimada no puede ser anterior al inicio"); return; }
    const presupuesto = parseFloat(form.presupuesto);
    if (isNaN(presupuesto) || presupuesto <= 0) { setError("El presupuesto debe ser un número mayor a 0"); return; }
    const esUSD = form.moneda === "USD";
    const tc = esUSD ? parseFloat(form.tipo_cambio) : null;
    if (esUSD && (isNaN(tc) || tc <= 0))      { setError("El tipo de cambio debe ser un número válido"); return; }

    setSaving(true);
    try {
      const payload = {
        numero_orden:        form.numero_orden || undefined,
        cliente_id:          form.cliente_id ? parseInt(form.cliente_id) : null,
        tipo_servicio:        form.tipo_servicio,
        descripcion:          form.descripcion.trim() || null,
        direccion_obra:       form.direccion_obra.trim() || null,
        distrito:             form.distrito.trim() || null,
        fecha_inicio:         form.fecha_inicio,
        fecha_fin_estimada:   form.fecha_fin_estimada,
        fecha_fin_real:       form.fecha_fin_real || null,
        presupuesto,
        moneda:               form.moneda,
        tipo_cambio:          esUSD ? tc : null,
        avance_porcentaje:    parseInt(form.avance_porcentaje, 10) || 0,
        estado:               form.estado,
        comprobante_id:       form.comprobante_id ? parseInt(form.comprobante_id) : null,
        observaciones:        form.observaciones.trim() || null,
      };
      if (isCreate) await createOrden(payload);
      else          await updateOrden(orden.id, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar la orden de servicio");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        <div className="flex items-center justify-between px-8 py-5 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <HiClipboardList className="text-blue-600 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">{isCreate ? "Nueva Orden de Servicio" : "Editar Orden de Servicio"}</h2>
              {orden && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[orden.estado] || "bg-gray-100 text-gray-600"}`}>
                  {orden.estado}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <HiX className="text-lg" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-8 py-6">
          <form id="orden-form" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-100 mb-5">
                {error}
              </div>
            )}

            {/* 1. N° Orden + Cliente */}
            <Section n="1" title="Identificación">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>N° Orden <span className="ml-1 text-purple-600 font-normal normal-case">(auto)</span></Label>
                  <input type="text"
                    value={loadingCorrelativo ? "Generando…" : form.numero_orden}
                    readOnly
                    className={`${INPUT_CLS} font-mono font-semibold text-purple-700 bg-purple-50 border-purple-300 cursor-not-allowed`} />
                </div>
                <div>
                  <Label>Cliente</Label>
                  <select value={form.cliente_id} onChange={e => set("cliente_id", e.target.value)} className={INPUT_CLS}>
                    <option value="">— Seleccionar cliente —</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.razon_social}</option>)}
                  </select>
                </div>
              </div>
            </Section>

            {/* 2. Tipo de servicio + Descripción */}
            <Section n="2" title="Servicio">
              <div className="space-y-4">
                <div>
                  <Label>Tipo de Servicio <span className="text-red-500">*</span></Label>
                  <select value={form.tipo_servicio} onChange={e => set("tipo_servicio", e.target.value)} className={INPUT_CLS}>
                    {TIPOS_SERVICIO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label>Descripción del trabajo</Label>
                  <textarea value={form.descripcion} onChange={e => set("descripcion", e.target.value)}
                    placeholder="Detalle del trabajo a realizar..." rows={2} className={`${INPUT_CLS} resize-none`} />
                </div>
              </div>
            </Section>

            {/* 3. Ubicación */}
            <Section n="3" title="Ubicación de Obra">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Dirección de Obra</Label>
                  <input type="text" value={form.direccion_obra} onChange={e => set("direccion_obra", e.target.value)}
                    placeholder="Av. Ejemplo 123" className={INPUT_CLS} />
                </div>
                <div>
                  <Label>Distrito</Label>
                  <input type="text" value={form.distrito} onChange={e => set("distrito", e.target.value)}
                    placeholder="San Isidro" className={INPUT_CLS} />
                </div>
              </div>
            </Section>

            {/* 4. Fechas */}
            <Section n="4" title="Fechas">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label>Fecha de Inicio <span className="text-red-500">*</span></Label>
                  <input type="date" value={form.fecha_inicio} onChange={e => set("fecha_inicio", e.target.value)} className={INPUT_CLS} />
                </div>
                <div>
                  <Label>Fecha Fin Estimada <span className="text-red-500">*</span></Label>
                  <input type="date" value={form.fecha_fin_estimada} onChange={e => set("fecha_fin_estimada", e.target.value)} className={INPUT_CLS} />
                </div>
                <div>
                  <Label>Fecha Fin Real</Label>
                  <input type="date" value={form.fecha_fin_real} onChange={e => set("fecha_fin_real", e.target.value)} className={INPUT_CLS} />
                </div>
              </div>
            </Section>

            {/* 5. Presupuesto */}
            <Section n="5" title="Presupuesto">
              <div className="bg-gray-50 rounded-xl p-5 border border-gray-100 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Moneda</Label>
                    <select value={form.moneda} onChange={e => set("moneda", e.target.value)} className={`${INPUT_CLS} bg-white`}>
                      <option value="PEN">🇵🇪 Soles (S/)</option>
                      <option value="USD">🇺🇸 Dólares (US$)</option>
                    </select>
                  </div>
                  {form.moneda === "USD" && (
                    <div>
                      <Label>Tipo de Cambio</Label>
                      <div className="relative">
                        <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xs font-medium">S/</span>
                        <input type="number" step="0.0001" min="0.01" value={form.tipo_cambio} placeholder="3.75"
                          onChange={e => set("tipo_cambio", e.target.value)}
                          className="w-full pl-9 pr-3 py-2.5 border border-orange-300 rounded-lg text-sm focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-100 bg-orange-50" />
                      </div>
                      <p className="text-xs text-orange-500 mt-1">Tipo de cambio del día</p>
                    </div>
                  )}
                </div>
                <div>
                  <Label>{form.moneda === "USD" ? "Presupuesto (US$)" : "Presupuesto (S/)"} <span className="text-red-500">*</span></Label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500 text-base font-bold">
                      {form.moneda === "USD" ? "US$" : "S/"}
                    </span>
                    <input type="number" step="0.01" min="0.01" value={form.presupuesto} placeholder="0.00"
                      onChange={e => set("presupuesto", e.target.value)}
                      className="pl-10 pr-4 py-3 border border-blue-200 rounded-lg text-lg w-full bg-white text-blue-700 font-bold focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" />
                  </div>
                  {form.moneda === "USD" && parseFloat(form.presupuesto) > 0 && parseFloat(form.tipo_cambio) > 0 && (
                    <p className="text-xs text-orange-600 mt-1 font-medium">
                      ≈ S/ {(parseFloat(form.presupuesto) * parseFloat(form.tipo_cambio)).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} soles
                    </p>
                  )}
                </div>
              </div>
            </Section>

            {/* 6. Avance + Estado */}
            <Section n="6" title="Avance y Estado">
              <div className="space-y-4">
                <div>
                  <Label>Avance ({form.avance_porcentaje}%)</Label>
                  <input type="range" min="0" max="100" step="5" value={form.avance_porcentaje}
                    onChange={e => set("avance_porcentaje", e.target.value)}
                    className="w-full accent-blue-600" />
                  <div className="mt-2 h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${form.avance_porcentaje}%` }} />
                  </div>
                </div>
                <div>
                  <Label>Estado</Label>
                  <div className="grid grid-cols-4 gap-2">
                    {ESTADOS.map(e => (
                      <button key={e} type="button" onClick={() => set("estado", e)}
                        className={`py-2 px-2 rounded-lg text-xs font-medium border-2 transition-all ${
                          form.estado === e ? `${ESTADO_COLOR[e]} border-current shadow-sm` : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                        }`}>
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Section>

            {/* 7. Comprobante vinculado + Observaciones */}
            <Section n="7" title="Adicional" last>
              <div className="space-y-4">
                <div>
                  <Label>Comprobante Asociado (opcional)</Label>
                  <select value={form.comprobante_id} onChange={e => set("comprobante_id", e.target.value)} className={INPUT_CLS}>
                    <option value="">— Sin vincular —</option>
                    {comprobantes.map(c => (
                      <option key={c.id} value={c.id}>{c.numero_documento} · {c.cliente_nombre}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Observaciones</Label>
                  <textarea value={form.observaciones} onChange={e => set("observaciones", e.target.value)}
                    placeholder="Notas adicionales..." rows={2} className={`${INPUT_CLS} resize-none`} />
                </div>
              </div>
            </Section>
          </form>
        </div>

        <div className="flex justify-end gap-3 px-8 py-5 border-t border-gray-100 flex-shrink-0">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button type="submit" form="orden-form" disabled={saving || loadingCorrelativo}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60">
            {saving ? "Guardando..." : isCreate ? "Crear Orden" : "Guardar Cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
