import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { HiCheck, HiArrowRight, HiUpload, HiPlus, HiTrash } from "react-icons/hi";
import { consultarRuc } from "../api/comercialApi";
import { updateEmpresa, updateRubro, subirLogo, crearUsuario, getRubro } from "../api/configuracionApi";
import { useEmpresa } from "../context/EmpresaContext";

const PASOS = ["Empresa", "Rubro", "Personalizar", "Usuarios"];
const ROLES = ["Administrador", "Vendedor"];

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";

export default function Onboarding() {
  const navigate = useNavigate();
  const { recargarEmpresa } = useEmpresa();

  const [paso, setPaso] = useState(1);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState("");
  const [listo, setListo] = useState(false);

  // Paso 1 — Empresa
  const [empresaForm, setEmpresaForm] = useState({ nombre_empresa: "", ruc: "", direccion: "", telefono: "", email: "" });
  const [buscandoRuc, setBuscandoRuc] = useState(false);
  const [rucMsg, setRucMsg] = useState(null);
  const rucTimer = useRef(null);

  // Paso 2 — Rubro
  const [catalogoRubros, setCatalogoRubros] = useState({});
  const [rubro, setRubro] = useState("");

  // Paso 3 — Personalización
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [color, setColor] = useState("#1e40af");
  const [moneda, setMoneda] = useState("PEN");

  // Paso 4 — Usuarios
  const [usuarios, setUsuarios] = useState([]);
  const [nuevoUsuario, setNuevoUsuario] = useState({ nombre: "", email: "", rol: "Vendedor" });

  useEffect(() => {
    getRubro().then(r => setCatalogoRubros(r.catalogo || {})).catch(() => {});
  }, []);

  const setEmpresaCampo = (k, v) => setEmpresaForm(f => ({ ...f, [k]: v }));

  const buscarPorRuc = async (ruc) => {
    setBuscandoRuc(true);
    setRucMsg(null);
    try {
      const data = await consultarRuc(ruc);
      if (data?.razon_social) {
        setEmpresaForm(f => ({ ...f, nombre_empresa: data.razon_social, direccion: data.direccion || f.direccion }));
        setRucMsg({ tipo: "ok", texto: "Empresa encontrada en SUNAT" });
      } else {
        setRucMsg({ tipo: "warn", texto: "RUC no encontrado — completa los datos manualmente" });
      }
    } catch {
      setRucMsg({ tipo: "warn", texto: "RUC no encontrado — completa los datos manualmente" });
    } finally {
      setBuscandoRuc(false);
    }
  };

  const handleRucChange = (val) => {
    const limpio = val.replace(/\D/g, "").slice(0, 11);
    setEmpresaCampo("ruc", limpio);
    setRucMsg(null);
    clearTimeout(rucTimer.current);
    if (limpio.length === 11) rucTimer.current = setTimeout(() => buscarPorRuc(limpio), 500);
  };

  const handleLogoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { alert("El logo no debe superar 2 MB"); return; }
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  function agregarUsuario() {
    if (!nuevoUsuario.nombre.trim() || !nuevoUsuario.email.trim()) return;
    setUsuarios(u => [...u, { ...nuevoUsuario, password: Math.random().toString(36).slice(-8) }]);
    setNuevoUsuario({ nombre: "", email: "", rol: "Vendedor" });
  }
  function quitarUsuario(i) {
    setUsuarios(u => u.filter((_, idx) => idx !== i));
  }

  function puedeAvanzar() {
    if (paso === 1) return empresaForm.nombre_empresa.trim().length > 0;
    if (paso === 2) return !!rubro;
    return true;
  }

  async function finalizar() {
    setGuardando(true);
    setError("");
    try {
      if (logoFile) await subirLogo(logoFile);

      const cat = catalogoRubros[rubro] || {};
      await updateRubro({ rubro, tipos_servicio: cat.tipos_servicio || [], categorias_gastos: cat.categorias_gastos || [] });

      await updateEmpresa({
        ...empresaForm,
        color_principal: color,
        moneda_principal: moneda,
        onboarding_completado: true,
      });

      for (const u of usuarios) {
        try { await crearUsuario(u); } catch { /* continuar con los demás */ }
      }

      await recargarEmpresa();
      setListo(true);
      setTimeout(() => navigate("/"), 2200);
    } catch (e) {
      setError("No se pudo completar el onboarding. Intenta nuevamente.");
    } finally {
      setGuardando(false);
    }
  }

  if (listo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-white">
        <div className="text-center px-6">
          <div className="text-6xl mb-4">🚀</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">¡Bienvenido a Gerencial Pro!</h1>
          <p className="text-gray-500">Tu sistema está listo. Te llevamos al Dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 overflow-y-auto">
      <div className="w-full max-w-2xl">

        {/* Stepper */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {PASOS.map((label, i) => {
            const n = i + 1;
            const activo = n === paso;
            const completado = n < paso;
            return (
              <React.Fragment key={label}>
                <div className="flex flex-col items-center gap-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                    completado ? "bg-green-500 text-white" : activo ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-500"
                  }`}>
                    {completado ? <HiCheck /> : n}
                  </div>
                  <span className={`text-xs font-medium whitespace-nowrap ${activo ? "text-blue-600" : "text-gray-400"}`}>{label}</span>
                </div>
                {n < PASOS.length && <div className={`w-10 h-0.5 flex-shrink-0 ${completado ? "bg-green-500" : "bg-gray-200"}`} />}
              </React.Fragment>
            );
          })}
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">

          {paso === 1 && (
            <div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">¿Cómo se llama tu empresa?</h2>
              <p className="text-sm text-gray-500 mb-6">Estos datos aparecerán en tus reportes y comprobantes.</p>
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-600">RUC</label>
                  <input value={empresaForm.ruc} onChange={e => handleRucChange(e.target.value)}
                    placeholder="20123456789" className={inputCls} />
                  {buscandoRuc && <p className="text-xs text-gray-400 mt-1">Buscando en SUNAT...</p>}
                  {rucMsg && <p className={`text-xs mt-1 ${rucMsg.tipo === "ok" ? "text-green-600" : "text-yellow-600"}`}>{rucMsg.texto}</p>}
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Nombre de la empresa *</label>
                  <input value={empresaForm.nombre_empresa} onChange={e => setEmpresaCampo("nombre_empresa", e.target.value)} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">Dirección</label>
                  <input value={empresaForm.direccion} onChange={e => setEmpresaCampo("direccion", e.target.value)} className={inputCls} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Teléfono</label>
                    <input value={empresaForm.telefono} onChange={e => setEmpresaCampo("telefono", e.target.value)} className={inputCls} />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Email</label>
                    <input type="email" value={empresaForm.email} onChange={e => setEmpresaCampo("email", e.target.value)} className={inputCls} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {paso === 2 && (
            <div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">¿A qué rubro perteneces?</h2>
              <p className="text-sm text-gray-500 mb-6">Cargaremos automáticamente categorías y tipos de servicio sugeridos.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {Object.entries(catalogoRubros).map(([key, r]) => (
                  <button key={key} onClick={() => setRubro(key)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-colors ${
                      rubro === key ? "border-blue-600 bg-blue-50" : "border-gray-200 hover:border-gray-300"
                    }`}>
                    <span className="text-3xl">{r.icono}</span>
                    <span className="text-xs font-semibold text-gray-700 text-center leading-tight">{r.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {paso === 3 && (
            <div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">Personaliza tu sistema</h2>
              <p className="text-sm text-gray-500 mb-6">Puedes cambiar esto luego desde Configuración.</p>
              <div className="space-y-5">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-2">Logo (imagen, máx 2MB)</label>
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
                      {logoPreview ? <img src={logoPreview} alt="Logo" className="w-full h-full object-contain" /> : <span className="text-2xl">🏢</span>}
                    </div>
                    <label className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg cursor-pointer transition-colors">
                      <HiUpload /> Subir logo
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} />
                    </label>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-2">Color principal</label>
                    <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-full h-10 rounded-lg border border-gray-200 cursor-pointer" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600 block mb-2">Moneda principal</label>
                    <select value={moneda} onChange={e => setMoneda(e.target.value)} className={inputCls}>
                      <option value="PEN">S/ Soles</option>
                      <option value="USD">US$ Dólares</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {paso === 4 && (
            <div>
              <h2 className="text-xl font-bold text-gray-800 mb-1">¿Quién más usará el sistema?</h2>
              <p className="text-sm text-gray-500 mb-6">Puedes agregar usuarios ahora o después desde Configuración.</p>

              <div className="grid grid-cols-[1fr_1fr_120px_40px] gap-2 mb-3 items-end">
                <div>
                  <label className="text-xs text-gray-500">Nombre</label>
                  <input value={nuevoUsuario.nombre} onChange={e => setNuevoUsuario(u => ({ ...u, nombre: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Email</label>
                  <input value={nuevoUsuario.email} onChange={e => setNuevoUsuario(u => ({ ...u, email: e.target.value }))} className={inputCls} />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Rol</label>
                  <select value={nuevoUsuario.rol} onChange={e => setNuevoUsuario(u => ({ ...u, rol: e.target.value }))} className={inputCls}>
                    {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <button onClick={agregarUsuario} className="h-9 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  <HiPlus />
                </button>
              </div>

              {usuarios.length > 0 && (
                <div className="space-y-1.5 mt-4">
                  {usuarios.map((u, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-sm">
                      <span className="text-gray-700">{u.nombre} <span className="text-gray-400">· {u.email}</span></span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">{u.rol}</span>
                        <button onClick={() => quitarUsuario(i)} className="text-gray-400 hover:text-red-600"><HiTrash /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}

          <div className="flex justify-between mt-8">
            <button
              onClick={() => setPaso(p => Math.max(1, p - 1))}
              disabled={paso === 1}
              className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-0"
            >
              ← Atrás
            </button>
            {paso < 4 ? (
              <button
                onClick={() => puedeAvanzar() && setPaso(p => p + 1)}
                disabled={!puedeAvanzar()}
                className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-50"
              >
                Siguiente <HiArrowRight />
              </button>
            ) : (
              <button
                onClick={finalizar}
                disabled={guardando}
                className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-bold rounded-xl disabled:opacity-60"
              >
                {guardando ? "Guardando..." : "¡Empezar ahora! 🚀"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
