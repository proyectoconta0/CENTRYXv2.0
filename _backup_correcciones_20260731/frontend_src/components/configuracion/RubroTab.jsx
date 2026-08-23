import React, { useState, useEffect } from "react";
import { HiX, HiPlus, HiExclamationCircle, HiPencil, HiTrash } from "react-icons/hi";
import {
  getRubro, updateRubro,
  getAreasGasto, crearAreaGasto, actualizarAreaGasto, eliminarAreaGasto,
} from "../../api/configuracionApi";

const inputClsArea = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";

function ModalArea({ area, onClose, onGuardar }) {
  const [nombre, setNombre] = useState(area?.nombre || "");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");

  async function guardar() {
    if (!nombre.trim()) { setError("El nombre es obligatorio"); return; }
    setGuardando(true);
    setError("");
    try {
      await onGuardar(nombre.trim());
    } catch (e) {
      setError(e.response?.data?.detail || "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-gray-800">{area ? "Editar Área" : "Nueva Área"}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><HiX /></button>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Nombre</label>
          <input value={nombre} onChange={e => setNombre(e.target.value)} className={inputClsArea} autoFocus />
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

function SeccionAreas() {
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalArea, setModalArea] = useState(null); // {} = nueva, {...} = editar
  const [confirmDel, setConfirmDel] = useState(null);

  const cargar = () => {
    setLoading(true);
    getAreasGasto()
      .then(r => setAreas((r || []).filter(a => a.activo)))
      .catch(() => setAreas([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { cargar(); }, []);

  async function handleEliminar() {
    if (!confirmDel) return;
    try {
      await eliminarAreaGasto(confirmDel.id);
      cargar();
    } catch (e) {
      alert(e.response?.data?.detail || "No se pudo eliminar el área");
    } finally {
      setConfirmDel(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-wide">Áreas</p>
        <button onClick={() => setModalArea({})} className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-xs font-medium text-gray-700">
          <HiPlus /> Nueva Área
        </button>
      </div>

      {loading ? (
        <p className="text-center text-sm text-gray-400 py-6">Cargando...</p>
      ) : (
        <div className="overflow-x-auto border border-gray-100 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-100">
                <th className="py-2 px-3">Nombre</th>
                <th className="py-2 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {areas.length === 0 ? (
                <tr><td colSpan={2} className="py-4 px-3 text-center text-gray-400">Sin áreas registradas</td></tr>
              ) : areas.map(a => (
                <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                  <td className="py-2 px-3 text-gray-700 font-medium">{a.nombre}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setModalArea(a)} title="Editar" className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><HiPencil /></button>
                      <button onClick={() => setConfirmDel(a)} title="Eliminar" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><HiTrash /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalArea !== null && (
        <ModalArea
          area={modalArea.id ? modalArea : null}
          onClose={() => setModalArea(null)}
          onGuardar={async (nombre) => {
            if (modalArea.id) await actualizarAreaGasto(modalArea.id, { nombre });
            else await crearAreaGasto({ nombre });
            setModalArea(null);
            cargar();
          }}
        />
      )}

      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDel(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <p className="font-semibold text-gray-800 mb-1">Eliminar área</p>
            <p className="text-sm text-gray-500 mb-4">¿Seguro que deseas eliminar "{confirmDel.nombre}"? Dejará de aparecer como opción al registrar gastos.</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDel(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={handleEliminar} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ListaEditable({ titulo, items, onChange }) {
  const [nuevo, setNuevo] = useState("");

  function agregar() {
    const v = nuevo.trim();
    if (!v || items.includes(v)) return;
    onChange([...items, v]);
    setNuevo("");
  }
  function quitar(i) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  return (
    <div>
      <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">{titulo}</p>
      <div className="flex flex-wrap gap-2 mb-2">
        {items.map((it, i) => (
          <span key={i} className="flex items-center gap-1.5 bg-blue-50 text-blue-700 text-xs font-medium px-2.5 py-1 rounded-full">
            {it}
            <button onClick={() => quitar(i)} className="text-blue-400 hover:text-blue-700"><HiX className="w-3 h-3" /></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-gray-400">Sin elementos — agrega los tuyos abajo</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={nuevo} onChange={e => setNuevo(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), agregar())}
          placeholder="Agregar..." className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button onClick={agregar} className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded-lg text-gray-600"><HiPlus /></button>
      </div>
    </div>
  );
}

export default function RubroTab() {
  const [catalogo, setCatalogo] = useState({});
  const [rubroActual, setRubroActual] = useState("");
  const [rubroSel, setRubroSel] = useState("");
  const [tiposServicio, setTiposServicio] = useState([]);
  const [categoriasGastos, setCategoriasGastos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    getRubro().then(r => {
      setCatalogo(r.catalogo || {});
      setRubroActual(r.rubro_actual || "");
      setRubroSel(r.rubro_actual || "");
      setTiposServicio(r.tipos_servicio || []);
      setCategoriasGastos(r.categorias_gastos || []);
    }).finally(() => setLoading(false));
  }, []);

  function seleccionarRubro(key) {
    setRubroSel(key);
    const def = catalogo[key];
    if (def) {
      setTiposServicio(def.tipos_servicio || []);
      setCategoriasGastos(def.categorias_gastos || []);
    }
  }

  async function aplicarCambios() {
    setGuardando(true);
    setMsg(null);
    try {
      await updateRubro({ rubro: rubroSel, tipos_servicio: tiposServicio, categorias_gastos: categoriasGastos });
      setRubroActual(rubroSel);
      setMsg({ tipo: "ok", texto: "Rubro y categorías actualizados correctamente" });
    } catch {
      setMsg({ tipo: "error", texto: "No se pudo actualizar el rubro" });
    } finally {
      setGuardando(false);
    }
  }

  if (loading) return <p className="text-center text-sm text-gray-400 py-16">Cargando...</p>;

  return (
    <div className="max-w-3xl">
      <p className="text-sm text-gray-500 mb-4">
        Rubro actual: <span className="font-semibold text-gray-700">{catalogo[rubroActual]?.label || "Sin definir"}</span>
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-8">
        {Object.entries(catalogo).map(([key, r]) => (
          <button key={key} onClick={() => seleccionarRubro(key)}
            className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
              rubroSel === key ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"
            }`}>
            <span className="text-3xl">{r.icono}</span>
            <span className="text-xs font-semibold text-gray-700 text-center leading-tight">{r.label}</span>
          </button>
        ))}
      </div>

      <div className="space-y-6 mb-6">
        <ListaEditable titulo="Tipos de servicio" items={tiposServicio} onChange={setTiposServicio} />
        <ListaEditable titulo="Categorías de gastos" items={categoriasGastos} onChange={setCategoriasGastos} />
        <SeccionAreas />
      </div>

      <div className="flex items-start gap-2 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2.5 text-sm text-yellow-800 mb-4">
        <HiExclamationCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Esto actualizará los tipos de servicio y categorías del sistema.</span>
      </div>

      {msg && <p className={`text-sm mb-3 ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>}

      <button
        onClick={aplicarCambios}
        disabled={guardando || !rubroSel}
        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
      >
        {guardando ? "Aplicando..." : "Aplicar cambios de rubro"}
      </button>
    </div>
  );
}
