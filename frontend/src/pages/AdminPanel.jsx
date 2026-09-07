import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  HiOfficeBuilding, HiUsers, HiPlus, HiPencil, HiTrash,
  HiCheckCircle, HiXCircle, HiRefresh, HiX, HiSave,
  HiShieldCheck, HiGlobe, HiClipboardCopy, HiPhotograph,
} from "react-icons/hi";
import {
  getEmpresas, crearEmpresa, actualizarEmpresa, desactivarEmpresa,
  getUsuariosAdmin, crearUsuarioAdmin, actualizarUsuarioAdmin, desactivarUsuario,
  getPlanes, subirLogoEmpresa,
} from "../api/adminApi";

import { ROLES_DISPONIBLES } from "../core/permisos";

const FRONTEND_URL = "https://adaptable-tenderness-production-c852.up.railway.app";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Badge({ activo }) {
  return activo
    ? <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700"><HiCheckCircle /> Activo</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600"><HiXCircle /> Inactivo</span>;
}

function PlanBadge({ plan }) {
  const colores = {
    basico: "bg-slate-100 text-slate-600",
    profesional: "bg-blue-100 text-blue-700",
    enterprise: "bg-purple-100 text-purple-700",
  };
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize ${colores[plan] || colores.basico}`}>
      {plan}
    </span>
  );
}

// ── Modal genérico ─────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <HiX className="text-xl" />
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ── Formulario Empresa ─────────────────────────────────────────────────────────

function FormEmpresa({ inicial, planes, onGuardar, onCancelar, cargando }) {
  const [form, setForm] = useState({
    nombre: "", ruc: "", subdominio: "", plan: "basico",
    email: "", telefono: "", logo_url: "", logo_base64: "", activo: true,
    ...inicial,
  });
  const [logoPreview, setLogoPreview] = useState(inicial?.logo_base64 || inicial?.logo_url || "");
  const fileRef = useRef(null);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const b64 = ev.target.result;
      setLogoPreview(b64);
      set("logo_base64", b64);
      set("logo_url", "");
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onGuardar(form);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Nombre de empresa *</label>
          <input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} required
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">RUC *</label>
          <input value={form.ruc} onChange={(e) => set("ruc", e.target.value)} required maxLength={11}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Subdominio *</label>
          <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
            <input value={form.subdominio} onChange={(e) => set("subdominio", e.target.value.toLowerCase())} required
              className="flex-1 px-3 py-2 text-sm outline-none" placeholder="jyd" />
            <span className="px-2 text-xs text-slate-400 bg-slate-50 border-l border-slate-300 py-2">.centryx.pe</span>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Plan</label>
          <select value={form.plan} onChange={(e) => set("plan", e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {(planes || ["basico", "profesional", "enterprise"]).map((p) => (
              <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Teléfono</label>
          <input value={form.telefono || ""} onChange={(e) => set("telefono", e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Logo de la empresa</label>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
          <div className="flex items-center gap-4">
            {logoPreview ? (
              <img src={logoPreview} alt="logo" className="w-14 h-14 object-contain rounded-lg border border-slate-200 bg-white p-1" />
            ) : (
              <div className="w-14 h-14 rounded-lg border-2 border-dashed border-slate-300 flex items-center justify-center text-slate-300">
                <HiPhotograph className="text-2xl" />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-600 transition-colors">
                <HiPhotograph /> {logoPreview ? "Cambiar imagen" : "Seleccionar imagen"}
              </button>
              {logoPreview && (
                <button type="button" onClick={() => { setLogoPreview(""); set("logo_base64", ""); set("logo_url", ""); }}
                  className="text-xs text-red-500 hover:text-red-700 text-left">
                  Quitar logo
                </button>
              )}
              <p className="text-xs text-slate-400">PNG, JPG o SVG. Se guarda como imagen.</p>
            </div>
          </div>
        </div>
        {inicial?.id && (
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="activo" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} className="rounded" />
            <label htmlFor="activo" className="text-sm text-slate-700">Empresa activa</label>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button type="button" onClick={onCancelar}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors">
          <HiSave /> {cargando ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

// ── Formulario Usuario ─────────────────────────────────────────────────────────

function FormUsuario({ inicial, empresas, onGuardar, onCancelar, cargando }) {
  const [form, setForm] = useState({
    nombre: "", email: "", password: "", rol: "Vendedor",
    empresa_id: "", activo: true,
    ...inicial,
  });

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form, empresa_id: form.empresa_id ? Number(form.empresa_id) : null };
    if (!payload.password) delete payload.password; // no enviar si está vacío en edición
    onGuardar(payload);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Nombre completo *</label>
          <input value={form.nombre} onChange={(e) => set("nombre", e.target.value)} required
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">Email *</label>
          <input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} required
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-sm font-medium text-slate-700 mb-1">
            {inicial?.id ? "Nueva contraseña (dejar vacío para no cambiar)" : "Contraseña *"}
          </label>
          <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)}
            required={!inicial?.id}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Rol *</label>
          <select value={form.rol} onChange={(e) => set("rol", e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {ROLES_DISPONIBLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Empresa</label>
          <select value={form.empresa_id || ""} onChange={(e) => set("empresa_id", e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Sin empresa —</option>
            {empresas.map((emp) => (
              <option key={emp.id} value={emp.id}>{emp.nombre}</option>
            ))}
          </select>
        </div>
        {inicial?.id && (
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="activoU" checked={form.activo} onChange={(e) => set("activo", e.target.checked)} className="rounded" />
            <label htmlFor="activoU" className="text-sm text-slate-700">Usuario activo</label>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3 pt-2 border-t border-slate-100">
        <button type="button" onClick={onCancelar}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">
          Cancelar
        </button>
        <button type="submit" disabled={cargando}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-lg transition-colors">
          <HiSave /> {cargando ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB EMPRESAS
// ══════════════════════════════════════════════════════════════════════════════

function TabEmpresas() {
  const [empresas, setEmpresas] = useState([]);
  const [planes, setPlanes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(null); // null | { tipo: "crear"|"editar", empresa?: {} }
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [filtroActivo, setFiltroActivo] = useState("");
  const [copiadoId, setCopiadoId] = useState(null);

  const copiarUrl = (subdominio) => {
    const url = `${FRONTEND_URL}/login?empresa=${subdominio}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiadoId(subdominio);
      setTimeout(() => setCopiadoId(null), 2000);
    });
  };

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = {};
      if (filtroActivo !== "") params.activo = filtroActivo === "true";
      const [emps, pls] = await Promise.all([getEmpresas(params), getPlanes()]);
      setEmpresas(emps);
      setPlanes(pls.planes || []);
    } catch {
      setError("Error al cargar empresas.");
    } finally {
      setCargando(false);
    }
  }, [filtroActivo]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleGuardar = async (form) => {
    setGuardando(true);
    setError("");
    try {
      if (modal.empresa?.id) {
        await actualizarEmpresa(modal.empresa.id, form);
      } else {
        await crearEmpresa(form);
      }
      setModal(null);
      cargar();
    } catch (e) {
      setError(e.response?.data?.detail || "Error al guardar empresa.");
    } finally {
      setGuardando(false);
    }
  };

  const handleDesactivar = async (emp) => {
    if (!window.confirm(`¿Desactivar "${emp.nombre}"? Los usuarios de esta empresa no podrán iniciar sesión.`)) return;
    try {
      await desactivarEmpresa(emp.id);
      cargar();
    } catch (e) {
      setError(e.response?.data?.detail || "Error al desactivar empresa.");
    }
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Todas</option>
            <option value="true">Activas</option>
            <option value="false">Inactivas</option>
          </select>
          <button onClick={cargar} className="p-2 text-slate-500 hover:text-blue-600 transition-colors" title="Recargar">
            <HiRefresh className={cargando ? "animate-spin" : ""} />
          </button>
        </div>
        <button onClick={() => setModal({ tipo: "crear" })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
          <HiPlus /> Nueva Empresa
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* Tabla */}
      {cargando ? (
        <div className="text-center py-12 text-slate-400 text-sm">Cargando empresas...</div>
      ) : empresas.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">No hay empresas registradas.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">RUC</th>
                <th className="px-4 py-3 text-left">Subdominio</th>
                <th className="px-4 py-3 text-left">Plan</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {empresas.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {(emp.logo_base64 || emp.logo_url) ? (
                        <img src={emp.logo_base64 || emp.logo_url} alt="" className="w-8 h-8 rounded object-contain border border-slate-200 bg-white" onError={(e) => e.target.style.display = "none"} />
                      ) : (
                        <div className="w-8 h-8 rounded bg-blue-100 flex items-center justify-center text-blue-600">
                          <HiOfficeBuilding />
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-slate-800">{emp.nombre}</p>
                        {emp.email && <p className="text-xs text-slate-400">{emp.email}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 font-mono text-xs">{emp.ruc}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <HiGlobe className="text-slate-400" />
                      {emp.subdominio}.centryx.pe
                    </span>
                  </td>
                  <td className="px-4 py-3"><PlanBadge plan={emp.plan} /></td>
                  <td className="px-4 py-3"><Badge activo={emp.activo} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => copiarUrl(emp.subdominio)}
                        className={`flex items-center gap-1 px-2 py-1.5 text-xs rounded-lg transition-colors ${
                          copiadoId === emp.subdominio
                            ? "bg-green-100 text-green-700"
                            : "text-slate-400 hover:text-blue-600 hover:bg-blue-50"
                        }`}
                        title="Copiar URL de login">
                        <HiClipboardCopy />
                        {copiadoId === emp.subdominio ? "¡Copiado!" : "URL"}
                      </button>
                      <button onClick={() => setModal({ tipo: "editar", empresa: emp })}
                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors" title="Editar">
                        <HiPencil />
                      </button>
                      {emp.activo && (
                        <button onClick={() => handleDesactivar(emp)}
                          className="p-1.5 text-slate-400 hover:text-red-600 transition-colors" title="Desactivar">
                          <HiTrash />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <Modal
          title={modal.tipo === "crear" ? "Nueva Empresa" : `Editar: ${modal.empresa?.nombre}`}
          onClose={() => setModal(null)}
        >
          <FormEmpresa
            inicial={modal.empresa}
            planes={planes}
            onGuardar={handleGuardar}
            onCancelar={() => setModal(null)}
            cargando={guardando}
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TAB USUARIOS
// ══════════════════════════════════════════════════════════════════════════════

function TabUsuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [empresas, setEmpresas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [filtroEmpresa, setFiltroEmpresa] = useState("");
  const [filtroActivo, setFiltroActivo] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const params = {};
      if (filtroEmpresa) params.empresa_id = filtroEmpresa;
      if (filtroActivo !== "") params.activo = filtroActivo === "true";
      const [usrs, emps] = await Promise.all([getUsuariosAdmin(params), getEmpresas()]);
      setUsuarios(usrs);
      setEmpresas(emps);
    } catch {
      setError("Error al cargar usuarios.");
    } finally {
      setCargando(false);
    }
  }, [filtroEmpresa, filtroActivo]);

  useEffect(() => { cargar(); }, [cargar]);

  const empresaMap = Object.fromEntries(empresas.map((e) => [e.id, e.nombre]));

  const handleGuardar = async (form) => {
    setGuardando(true);
    setError("");
    try {
      if (modal.usuario?.id) {
        await actualizarUsuarioAdmin(modal.usuario.id, form);
      } else {
        await crearUsuarioAdmin(form);
      }
      setModal(null);
      cargar();
    } catch (e) {
      setError(e.response?.data?.detail || "Error al guardar usuario.");
    } finally {
      setGuardando(false);
    }
  };

  const handleDesactivar = async (usr) => {
    if (!window.confirm(`¿Desactivar usuario "${usr.nombre}"?`)) return;
    try {
      await desactivarUsuario(usr.id);
      cargar();
    } catch (e) {
      setError(e.response?.data?.detail || "Error al desactivar usuario.");
    }
  };

  const rolColor = (rol) => {
    const r = (rol || "").toLowerCase();
    if (r === "superadmin") return "bg-purple-100 text-purple-700";
    if (r === "administrador") return "bg-blue-100 text-blue-700";
    return "bg-slate-100 text-slate-600";
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <select value={filtroEmpresa} onChange={(e) => setFiltroEmpresa(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Todas las empresas</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
          <select value={filtroActivo} onChange={(e) => setFiltroActivo(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Todos</option>
            <option value="true">Activos</option>
            <option value="false">Inactivos</option>
          </select>
          <button onClick={cargar} className="p-2 text-slate-500 hover:text-blue-600 transition-colors">
            <HiRefresh className={cargando ? "animate-spin" : ""} />
          </button>
        </div>
        <button onClick={() => setModal({ tipo: "crear" })}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
          <HiPlus /> Nuevo Usuario
        </button>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {cargando ? (
        <div className="text-center py-12 text-slate-400 text-sm">Cargando usuarios...</div>
      ) : usuarios.length === 0 ? (
        <div className="text-center py-12 text-slate-400 text-sm">No hay usuarios registrados.</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
              <tr>
                <th className="px-4 py-3 text-left">Usuario</th>
                <th className="px-4 py-3 text-left">Rol</th>
                <th className="px-4 py-3 text-left">Empresa</th>
                <th className="px-4 py-3 text-left">Estado</th>
                <th className="px-4 py-3 text-left">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {usuarios.map((usr) => (
                <tr key={usr.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">
                        {(usr.nombre || "?")[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-slate-800">{usr.nombre}</p>
                        <p className="text-xs text-slate-400">{usr.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${rolColor(usr.rol)}`}>
                      {usr.rol}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {usr.empresa_id ? (empresaMap[usr.empresa_id] || `#${usr.empresa_id}`) : <span className="text-slate-300 italic">Sin empresa</span>}
                  </td>
                  <td className="px-4 py-3"><Badge activo={usr.activo} /></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setModal({ tipo: "editar", usuario: usr })}
                        className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors" title="Editar">
                        <HiPencil />
                      </button>
                      {usr.activo && (
                        <button onClick={() => handleDesactivar(usr)}
                          className="p-1.5 text-slate-400 hover:text-red-600 transition-colors" title="Desactivar">
                          <HiTrash />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal
          title={modal.tipo === "crear" ? "Nuevo Usuario" : `Editar: ${modal.usuario?.nombre}`}
          onClose={() => setModal(null)}
        >
          <FormUsuario
            inicial={modal.usuario}
            empresas={empresas.filter((e) => e.activo)}
            onGuardar={handleGuardar}
            onCancelar={() => setModal(null)}
            cargando={guardando}
          />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// PÁGINA PRINCIPAL
// ══════════════════════════════════════════════════════════════════════════════

const TABS = [
  { id: "empresas", label: "Empresas",  icon: HiOfficeBuilding },
  { id: "usuarios", label: "Usuarios",  icon: HiUsers },
];

export default function AdminPanel() {
  const [tab, setTab] = useState("empresas");

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-100 flex items-center justify-center text-purple-600">
              <HiShieldCheck className="text-xl" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900">Panel de Administración</h1>
              <p className="text-sm text-slate-500">Gestión de empresas y usuarios del sistema</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit mb-6">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${
                tab === id
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon /> {label}
            </button>
          ))}
        </div>

        {/* Contenido */}
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm">
          {tab === "empresas" && <TabEmpresas />}
          {tab === "usuarios" && <TabUsuarios />}
        </div>
      </div>
    </div>
  );
}
