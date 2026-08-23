import React, { useState, useEffect, useRef } from "react";
import { HiX } from "react-icons/hi";
import { createCliente, updateCliente, consultarRuc } from "../../api/comercialApi";

const DISTRITOS = ["Miraflores","San Isidro","San Borja","Surco","La Molina","San Miguel","Los Olivos","Lince","Chorrillos","Barranco","Jesús María","Pueblo Libre","Magdalena","Ate","San Juan de Lurigancho","Villa El Salvador","Comas","Independencia","Callao"];

const VACIO = { razon_social:"", ruc:"", contacto:"", cargo_contacto:"", telefono:"", email:"", direccion:"", distrito:"", activo:true };

// Componente de campo definido en el ámbito del módulo (no dentro de FormCliente)
// para que React no lo desmonte/remonte en cada render y el input no pierda el foco.
function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, type = "text", required = false, maxLength }) {
  return (
    <input
      type={type}
      value={value || ""}
      onChange={e => onChange(e.target.value)}
      required={required}
      maxLength={maxLength}
      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
    />
  );
}

export default function FormCliente({ cliente, onClose, onSaved }) {
  const [form, setForm] = useState(VACIO);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [buscandoRuc, setBuscandoRuc] = useState(false);
  const [rucMsg, setRucMsg] = useState(null); // { tipo: "ok" | "warn", texto }
  const rucTimer = useRef(null);

  useEffect(() => {
    if (cliente) setForm({ ...VACIO, ...cliente });
    else setForm(VACIO);
    setRucMsg(null);
  }, [cliente]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Autocompletar Razón Social desde SUNAT al digitar un RUC de 11 dígitos
  const buscarPorRuc = async (ruc) => {
    setBuscandoRuc(true);
    setRucMsg(null);
    try {
      const data = await consultarRuc(ruc);
      if (data?.razon_social) {
        set("razon_social", data.razon_social);
        setRucMsg({ tipo: "ok", texto: "Empresa encontrada en SUNAT" });
      } else {
        setRucMsg({ tipo: "warn", texto: "RUC no encontrado — ingrese la razón social manualmente" });
      }
    } catch {
      setRucMsg({ tipo: "warn", texto: "RUC no encontrado — ingrese la razón social manualmente" });
    } finally {
      setBuscandoRuc(false);
    }
  };

  const handleRucChange = (val) => {
    set("ruc", val);
    setRucMsg(null);
    clearTimeout(rucTimer.current);
    if (val.length === 11) {
      rucTimer.current = setTimeout(() => buscarPorRuc(val), 500);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const saved = cliente ? await updateCliente(cliente.id, form) : await createCliente(form);
      onSaved(saved);
    } catch (err) {
      setError(err.response?.data?.detail || "Error al guardar");
    } finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-lg bg-white h-full shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-800">{cliente ? "Editar Cliente" : "Nuevo Cliente"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors"><HiX className="text-xl" /></button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg px-4 py-2">{error}</div>}

          <Field label="RUC" required>
            <TextInput value={form.ruc} onChange={handleRucChange} required maxLength={11} />
            {buscandoRuc && (
              <p className="text-xs text-gray-400 mt-1.5 font-medium">Buscando...</p>
            )}
            {!buscandoRuc && rucMsg && (
              <p className={`text-xs mt-1.5 font-medium ${rucMsg.tipo === "ok" ? "text-blue-600" : "text-amber-600"}`}>
                {rucMsg.texto}
              </p>
            )}
          </Field>

          <Field label="Razón Social" required>
            <TextInput value={form.razon_social} onChange={v => set("razon_social", v)} required />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Contacto Principal">
              <TextInput value={form.contacto} onChange={v => set("contacto", v)} />
            </Field>
            <Field label="Cargo">
              <TextInput value={form.cargo_contacto} onChange={v => set("cargo_contacto", v)} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Teléfono">
              <TextInput value={form.telefono} onChange={v => set("telefono", v)} />
            </Field>
            <Field label="Email">
              <TextInput value={form.email} onChange={v => set("email", v)} type="email" />
            </Field>
          </div>

          <Field label="Dirección">
            <TextInput value={form.direccion} onChange={v => set("direccion", v)} />
          </Field>

          <Field label="Distrito">
            <select value={form.distrito || ""} onChange={e => set("distrito", e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">Seleccionar distrito</option>
              {DISTRITOS.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>

          <div className="flex items-center gap-2 pt-1">
            <input type="checkbox" id="activo" checked={form.activo} onChange={e => set("activo", e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
            <label htmlFor="activo" className="text-sm text-gray-600">Cliente activo</label>
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} type="button"
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg font-medium transition-colors">
            {loading ? "Guardando..." : cliente ? "Guardar cambios" : "Crear cliente"}
          </button>
        </div>
      </div>
    </div>
  );
}
