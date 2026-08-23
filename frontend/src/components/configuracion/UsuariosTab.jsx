import React, { useState, useEffect } from "react";
import { HiPencil, HiKey, HiTrash, HiPlus, HiX } from "react-icons/hi";
import { getUsuarios, crearUsuario, actualizarUsuario, eliminarUsuario } from "../../api/configuracionApi";
import { useAuth } from "../../context/AuthContext";
import Toast from "../Toast";
import ConfirmDialog from "../ConfirmDialog";

const VACIO = { nombre: "", email: "", password: "", rol: "Vendedor", activo: true };
const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";

function ModalUsuario({ usuario, roles, onClose, onSaved }) {
  const [form, setForm] = useState(usuario ? { ...usuario, password: "" } : VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function guardar() {
    if (!form.nombre.trim() || !form.email.trim() || (!usuario && !form.password.trim())) {
      setError("Completa nombre, email y contraseña temporal");
      return;
    }
    setGuardando(true);
    setError("");
    try {
      const payload = { nombre: form.nombre, email: form.email, rol: form.rol, activo: form.activo };
      if (form.password) payload.password = form.password;
      const saved = usuario ? await actualizarUsuario(usuario.id, payload) : await crearUsuario({ ...payload, password: form.password });
      onSaved(saved);
    } catch (e) {
      setError(e.response?.data?.detail || "No se pudo guardar el usuario");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-800">{usuario ? "Editar Usuario" : "Nuevo Usuario"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-gray-600">Nombre completo <span className="text-red-500">*</span></label>
            <input value={form.nombre} onChange={e => set("nombre", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Email <span className="text-red-500">*</span></label>
            <input value={form.email} onChange={e => set("email", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">
              {usuario ? "Nueva contraseña (opcional)" : <>Contraseña temporal <span className="text-red-500">*</span></>}
            </label>
            <input type="text" value={form.password} onChange={e => set("password", e.target.value)} className={inputCls} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-600">Rol</label>
              <select value={form.rol} onChange={e => set("rol", e.target.value)} className={inputCls}>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Estado</label>
              <select value={form.activo ? "1" : "0"} onChange={e => set("activo", e.target.value === "1")} className={inputCls}>
                <option value="1">Activo</option>
                <option value="0">Inactivo</option>
              </select>
            </div>
          </div>
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-60">
            {guardando ? "Guardando..." : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalPassword({ usuario, onClose, onSaved }) {
  const [password, setPassword] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!password.trim()) return;
    setGuardando(true);
    setError("");
    try {
      const saved = await actualizarUsuario(usuario.id, { password });
      onSaved(saved);
    } catch {
      setError("No se pudo cambiar la contraseña");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h3 className="text-base font-bold text-gray-800 mb-4">Cambiar contraseña — {usuario.nombre}</h3>
        <label className="text-xs font-medium text-gray-600">Nueva contraseña <span className="text-red-500">*</span></label>
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="Nueva contraseña" className={inputCls} />
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
          <button onClick={guardar} disabled={guardando} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium disabled:opacity-60">
            {guardando ? "Guardando..." : "Cambiar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UsuariosTab() {
  const { usuario: yo } = useAuth();
  const [data, setData] = useState([]);
  const [roles, setRoles] = useState(["Administrador", "Vendedor"]);
  const [loading, setLoading] = useState(true);
  const [modalUsuario, setModalUsuario] = useState(null); // {} = nuevo, {...} = editar
  const [modalPassword, setModalPassword] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [toast, setToast] = useState(null);

  const cargar = () => {
    setLoading(true);
    getUsuarios()
      .then(r => { setData(r.data || []); setRoles(r.roles_disponibles || roles); })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleEliminar() {
    if (!confirmDel) return;
    try {
      await eliminarUsuario(confirmDel.id);
      cargar();
    } catch (e) {
      setToast({ message: e.response?.data?.detail || "No se pudo eliminar el usuario", type: "error" });
    } finally {
      setConfirmDel(null);
    }
  }

  return (
    <div>
      <div className="flex justify-end mb-4">
        <button onClick={() => setModalUsuario({})} className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg">
          <HiPlus /> Nuevo Usuario
        </button>
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-16">Cargando...</p>
      ) : (
        <div className="overflow-x-auto bg-white rounded-xl border border-gray-100">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
                <th className="py-3 px-4">Nombre</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Rol</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.map(u => (
                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2.5 px-4 text-gray-700 font-medium">{u.nombre}</td>
                  <td className="py-2.5 px-4 text-gray-600">{u.email}</td>
                  <td className="py-2.5 px-4">
                    <span className="text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{u.rol}</span>
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${u.activo ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                      {u.activo ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setModalUsuario(u)} title="Editar" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><HiPencil /></button>
                      <button onClick={() => setModalPassword(u)} title="Cambiar contraseña" className="p-1.5 text-gray-400 hover:text-yellow-600 hover:bg-yellow-50 rounded-lg"><HiKey /></button>
                      <button
                        onClick={() => setConfirmDel(u)}
                        disabled={u.id === yo?.id}
                        title={u.id === yo?.id ? "No puedes eliminarte a ti mismo" : "Eliminar"}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-gray-400"
                      >
                        <HiTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalUsuario !== null && (
        <ModalUsuario
          usuario={modalUsuario.id ? modalUsuario : null}
          roles={roles}
          onClose={() => setModalUsuario(null)}
          onSaved={() => { setModalUsuario(null); cargar(); }}
        />
      )}
      {modalPassword && (
        <ModalPassword usuario={modalPassword} onClose={() => setModalPassword(null)} onSaved={() => { setModalPassword(null); cargar(); }} />
      )}
      <ConfirmDialog
        open={!!confirmDel}
        title="Eliminar usuario"
        message={confirmDel ? `¿Seguro que deseas eliminar a ${confirmDel.nombre}?` : ""}
        danger
        confirmLabel="Eliminar"
        onConfirm={handleEliminar}
        onCancel={() => setConfirmDel(null)}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
