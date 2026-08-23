import React, { useState, useEffect } from "react";
import { HiX, HiOfficeBuilding, HiSearch, HiCheckCircle } from "react-icons/hi";
import { createProveedor, updateProveedor, consultarRuc } from "../../api/comercialApi";
import { TIPOS_DOCUMENTO, ESTADOS, ESTADO_COLOR } from "./proveedoresCommon";

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
  tipo_documento: "RUC",
  numero_documento: "",
  razon_social: "",
  direccion: "",
  distrito: "",
  telefono: "",
  email: "",
  contacto_principal: "",
  cargo_contacto: "",
  estado: "Activo",
  observaciones: "",
  numero_cuenta: "",
};

export default function FormNuevoProveedor({ mode, proveedor, onClose, onSaved }) {
  const isCreate = mode === "create";

  const [form, setForm] = useState(FORM_DEFAULT);
  const [buscandoRuc, setBuscandoRuc] = useState(false);
  const [rucMsg, setRucMsg]           = useState("");
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState("");

  const set = (field, val) => setForm(f => ({ ...f, [field]: val }));

  useEffect(() => {
    if (proveedor) {
      setForm({
        tipo_documento:     proveedor.tipo_documento || "RUC",
        numero_documento:   proveedor.numero_documento || "",
        razon_social:       proveedor.razon_social || "",
        direccion:          proveedor.direccion || "",
        distrito:           proveedor.distrito || "",
        telefono:           proveedor.telefono || "",
        email:              proveedor.email || "",
        contacto_principal: proveedor.contacto_principal || "",
        cargo_contacto:     proveedor.cargo_contacto || "",
        estado:             proveedor.estado || "Activo",
        observaciones:      proveedor.observaciones || "",
        numero_cuenta:      proveedor.numero_cuenta || "",
      });
    }
  }, [proveedor]);

  const handleNumDocChange = async (val) => {
    set("numero_documento", val);
    setRucMsg("");
    if (form.tipo_documento === "RUC" && val.length === 11 && /^\d{11}$/.test(val)) {
      setBuscandoRuc(true);
      setRucMsg("Buscando en SUNAT...");
      try {
        const data = await consultarRuc(val);
        if (data?.razon_social) {
          setForm(f => ({ ...f, razon_social: data.razon_social }));
          setRucMsg("Razón social obtenida de SUNAT");
        } else {
          setRucMsg("RUC no encontrado — ingrese la razón social manualmente");
        }
      } catch (err) {
        const detalle = err?.response?.data?.detail || "";
        setRucMsg(detalle.includes("no encontrado")
          ? "RUC no encontrado — ingrese la razón social manualmente"
          : "Error al consultar SUNAT — ingrese la razón social manualmente");
      } finally {
        setBuscandoRuc(false);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.numero_documento.trim()) { setError("El N° de documento es requerido"); return; }
    if (!form.razon_social.trim())     { setError("La razón social / nombre es requerida"); return; }

    setSaving(true);
    try {
      const payload = {
        tipo_documento:     form.tipo_documento,
        numero_documento:   form.numero_documento.trim(),
        razon_social:       form.razon_social.trim(),
        direccion:          form.direccion.trim() || null,
        distrito:           form.distrito.trim() || null,
        telefono:           form.telefono.trim() || null,
        email:              form.email.trim() || null,
        contacto_principal: form.contacto_principal.trim() || null,
        cargo_contacto:     form.cargo_contacto.trim() || null,
        estado:             form.estado,
        observaciones:      form.observaciones.trim() || null,
        numero_cuenta:      form.numero_cuenta.trim() || null,
      };
      if (isCreate) await createProveedor(payload);
      else          await updateProveedor(proveedor.id, payload);
      onSaved();
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar el proveedor");
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
              <HiOfficeBuilding className="text-blue-600 text-lg" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800">{isCreate ? "Nuevo Proveedor" : "Editar Proveedor"}</h2>
              {proveedor && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ESTADO_COLOR[proveedor.estado] || "bg-gray-100 text-gray-600"}`}>
                  {proveedor.estado}
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <HiX className="text-lg" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-8 py-6">
          <form id="prov-form" onSubmit={handleSubmit}>
            {error && (
              <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-100 mb-5">
                {error}
              </div>
            )}

            {/* 1. Documento */}
            <Section n="1" title="Documento de Identidad">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tipo de Documento</Label>
                  <select value={form.tipo_documento} onChange={e => set("tipo_documento", e.target.value)} className={INPUT_CLS}>
                    {TIPOS_DOCUMENTO.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <Label>N° {form.tipo_documento} *</Label>
                  <div className="relative">
                    <input type="text" value={form.numero_documento}
                      onChange={e => handleNumDocChange(e.target.value)}
                      placeholder={form.tipo_documento === "RUC" ? "20100012345" : "12345678"}
                      maxLength={form.tipo_documento === "RUC" ? 11 : 15}
                      className={`${INPUT_CLS} font-mono pr-9`} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm">
                      {buscandoRuc ? <HiSearch className="text-gray-400 animate-pulse" /> :
                       rucMsg.startsWith("Razón") ? <HiCheckCircle className="text-green-500" /> : null}
                    </span>
                  </div>
                  {rucMsg && (
                    <p className={`text-xs mt-1.5 font-medium ${rucMsg.startsWith("Razón") ? "text-blue-600" : rucMsg.startsWith("Buscando") ? "text-gray-400" : "text-amber-600"}`}>
                      {rucMsg}
                    </p>
                  )}
                </div>
              </div>
            </Section>

            {/* 2. Razón Social */}
            <Section n="2" title="Datos del Proveedor">
              <div>
                <Label>Razón Social / Nombre *</Label>
                <input type="text" value={form.razon_social} onChange={e => set("razon_social", e.target.value)}
                  placeholder="Razón social o nombre completo" className={INPUT_CLS} />
              </div>
            </Section>

            {/* 3. Ubicación */}
            <Section n="3" title="Ubicación">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Dirección</Label>
                  <input type="text" value={form.direccion} onChange={e => set("direccion", e.target.value)}
                    placeholder="Av. Ejemplo 123" className={INPUT_CLS} />
                </div>
                <div>
                  <Label>Distrito</Label>
                  <input type="text" value={form.distrito} onChange={e => set("distrito", e.target.value)}
                    placeholder="San Isidro" className={INPUT_CLS} />
                </div>
              </div>
            </Section>

            {/* 4. Contacto */}
            <Section n="4" title="Contacto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Teléfono</Label>
                  <input type="text" value={form.telefono} onChange={e => set("telefono", e.target.value)}
                    placeholder="987654321" className={INPUT_CLS} />
                </div>
                <div>
                  <Label>Email</Label>
                  <input type="email" value={form.email} onChange={e => set("email", e.target.value)}
                    placeholder="contacto@proveedor.com" className={INPUT_CLS} />
                </div>
                <div>
                  <Label>N° de Cuenta (depósito de detracciones)</Label>
                  <input type="text" value={form.numero_cuenta} onChange={e => set("numero_cuenta", e.target.value)}
                    placeholder="11 dígitos" maxLength={11} className={`${INPUT_CLS} font-mono`} />
                </div>
                <div>
                  <Label>Contacto Principal</Label>
                  <input type="text" value={form.contacto_principal} onChange={e => set("contacto_principal", e.target.value)}
                    placeholder="Nombre de la persona" className={INPUT_CLS} />
                </div>
                <div>
                  <Label>Cargo del Contacto</Label>
                  <input type="text" value={form.cargo_contacto} onChange={e => set("cargo_contacto", e.target.value)}
                    placeholder="Gerente Comercial" className={INPUT_CLS} />
                </div>
              </div>
            </Section>

            {/* 5. Estado + Observaciones */}
            <Section n="5" title="Adicional" last>
              <div className="space-y-4">
                <div>
                  <Label>Estado</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {ESTADOS.map(e => (
                      <button key={e} type="button" onClick={() => set("estado", e)}
                        className={`py-2 px-3 rounded-lg text-xs font-medium border-2 transition-all ${
                          form.estado === e ? `${ESTADO_COLOR[e]} border-current shadow-sm` : "border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50"
                        }`}>
                        {e}
                      </button>
                    ))}
                  </div>
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
          <button type="submit" form="prov-form" disabled={saving}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60">
            {saving ? "Guardando..." : isCreate ? "Crear Proveedor" : "Guardar Cambios"}
          </button>
        </div>
      </div>
    </div>
  );
}
