import React, { useState, useEffect } from "react";
import { HiUpload, HiEye, HiEyeOff, HiCheckCircle, HiXCircle } from "react-icons/hi";
import { getEmpresa, updateEmpresa, subirLogo, getLogoUrl, probarSmtp } from "../../api/configuracionApi";
import { useEmpresa } from "../../context/EmpresaContext";
import Toast from "../Toast";

const VACIO = {
  nombre_empresa: "", ruc: "", direccion: "", distrito: "", telefono: "",
  email: "", web: "", whatsapp_soporte: "", color_principal: "#1e40af", moneda_principal: "PEN",
  mensaje_comprobante: "",
  smtp_host: "smtp.gmail.com", smtp_port: 587, smtp_usuario: "", smtp_password: "", smtp_from_name: "",
};

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500 bg-white";

export default function EmpresaTab() {
  const { recargarEmpresa } = useEmpresa();
  const [form, setForm] = useState(VACIO);
  const [logoUrl, setLogoUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [msg, setMsg] = useState(null);
  const [smtpPasswordConfigurado, setSmtpPasswordConfigurado] = useState(false);
  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [probando, setProbando] = useState(false);
  const [resultadoPrueba, setResultadoPrueba] = useState(null);
  const [toast, setToast] = useState(null);

  const cargar = () => {
    setLoading(true);
    getEmpresa()
      .then(e => {
        setForm({
          nombre_empresa: e.nombre_empresa || "", ruc: e.ruc || "", direccion: e.direccion || "",
          distrito: e.distrito || "", telefono: e.telefono || "", email: e.email || "",
          web: e.web || "", whatsapp_soporte: e.whatsapp_soporte || "", color_principal: e.color_principal || "#1e40af",
          moneda_principal: e.moneda_principal || "PEN",
          mensaje_comprobante: e.mensaje_comprobante || "",
          smtp_host: e.smtp_host || "smtp.gmail.com",
          smtp_port: e.smtp_port || 587,
          smtp_usuario: e.smtp_usuario || "",
          smtp_password: "",
          smtp_from_name: e.smtp_from_name || "",
        });
        setSmtpPasswordConfigurado(!!e.smtp_password_configurado);
        setLogoUrl(getLogoUrl(e));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { cargar(); }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleLogoChange(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setToast({ message: "El logo no debe superar 2 MB", type: "error" }); return; }
    setSubiendoLogo(true);
    try {
      await subirLogo(file);
      cargar();
      recargarEmpresa();
    } catch {
      setToast({ message: "No se pudo subir el logo", type: "error" });
    } finally {
      setSubiendoLogo(false);
    }
  }

  async function handleGuardar() {
    setGuardando(true);
    setMsg(null);
    try {
      await updateEmpresa(form);
      recargarEmpresa();
      cargar();
      setMsg({ tipo: "ok", texto: "Cambios guardados correctamente" });
    } catch {
      setMsg({ tipo: "error", texto: "No se pudieron guardar los cambios" });
    } finally {
      setGuardando(false);
    }
  }

  async function handleProbarConexion() {
    setProbando(true);
    setResultadoPrueba(null);
    try {
      const res = await probarSmtp();
      setResultadoPrueba(res);
    } catch (err) {
      setResultadoPrueba({ success: false, mensaje: err.response?.data?.detail || "No se pudo probar la conexión" });
    } finally {
      setProbando(false);
    }
  }

  if (loading) return <p className="text-center text-sm text-gray-400 py-16">Cargando...</p>;

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <label className="text-xs font-medium text-gray-600 block mb-2">Logo actual</label>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-xl border border-gray-200 bg-gray-50 flex items-center justify-center overflow-hidden flex-shrink-0">
            {logoUrl ? <img src={logoUrl} alt="Logo" className="w-full h-full object-contain" /> : <span className="text-2xl">🏢</span>}
          </div>
          <label className="flex items-center gap-2 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg cursor-pointer transition-colors">
            <HiUpload /> {subiendoLogo ? "Subiendo..." : "Cambiar logo"}
            <input type="file" accept="image/*" className="hidden" onChange={handleLogoChange} disabled={subiendoLogo} />
          </label>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-medium text-gray-600">Nombre de la empresa</label>
          <input value={form.nombre_empresa} onChange={e => set("nombre_empresa", e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">RUC</label>
            <input value={form.ruc} onChange={e => set("ruc", e.target.value.replace(/\D/g, "").slice(0, 11))} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Distrito</label>
            <input value={form.distrito} onChange={e => set("distrito", e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Dirección</label>
          <input value={form.direccion} onChange={e => set("direccion", e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600">Teléfono</label>
            <input value={form.telefono} onChange={e => set("telefono", e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Email</label>
            <input type="email" value={form.email} onChange={e => set("email", e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Página web (opcional)</label>
          <input value={form.web} onChange={e => set("web", e.target.value)} className={inputCls} placeholder="https://" />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">WhatsApp de Soporte</label>
          <input
            value={form.whatsapp_soporte}
            onChange={e => set("whatsapp_soporte", e.target.value.replace(/\D/g, "").slice(0, 20))}
            className={inputCls}
            placeholder="Ej: 51999000000"
          />
          <p className="text-[11px] text-gray-400 mt-1">Número con código de país, sin + ni espacios.</p>
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600">Mensaje de agradecimiento (pie de comprobantes)</label>
          <input
            value={form.mensaje_comprobante}
            onChange={e => set("mensaje_comprobante", e.target.value)}
            className={inputCls}
            placeholder="¡MUCHAS GRACIAS POR SU PREFERENCIA!"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-2">Color principal del sistema</label>
            <input type="color" value={form.color_principal} onChange={e => set("color_principal", e.target.value)} className="w-full h-10 rounded-lg border border-gray-200 cursor-pointer" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Moneda principal</label>
            <select value={form.moneda_principal} onChange={e => set("moneda_principal", e.target.value)} className={inputCls}>
              <option value="PEN">S/ Soles</option>
              <option value="USD">US$ Dólares</option>
            </select>
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-1">Configuración de correo saliente (SMTP)</p>
        <p className="text-xs text-gray-400 mb-4">Usado para enviar comprobantes al cliente por correo desde Ventas.</p>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-600">Servidor SMTP</label>
              <input value={form.smtp_host} onChange={e => set("smtp_host", e.target.value)} className={inputCls} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Puerto</label>
              <input type="number" value={form.smtp_port} onChange={e => set("smtp_port", parseInt(e.target.value) || 587)} className={inputCls} placeholder="587" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Correo remitente</label>
            <input type="email" value={form.smtp_usuario} onChange={e => set("smtp_usuario", e.target.value)} className={inputCls} placeholder="usuario@gmail.com" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">
              Contraseña {smtpPasswordConfigurado && <span className="text-green-600 font-normal">(ya configurada — deje en blanco para no cambiarla)</span>}
            </label>
            <div className="relative">
              <input
                type={mostrarPassword ? "text" : "password"}
                value={form.smtp_password}
                onChange={e => set("smtp_password", e.target.value)}
                className={`${inputCls} pr-10`}
                placeholder={smtpPasswordConfigurado ? "••••••••••••••••" : "Contraseña de aplicación de 16 caracteres (Gmail)"}
              />
              <button type="button" onClick={() => setMostrarPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                {mostrarPassword ? <HiEyeOff /> : <HiEye />}
              </button>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600">Nombre del remitente</label>
            <input value={form.smtp_from_name} onChange={e => set("smtp_from_name", e.target.value)} className={inputCls} placeholder="J&D Andamiaje" />
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleProbarConexion}
              disabled={probando}
              className="px-4 py-2 text-sm border border-gray-200 hover:bg-gray-50 text-gray-700 font-medium rounded-lg disabled:opacity-60 flex items-center gap-2"
            >
              {probando && <span className="w-3.5 h-3.5 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />}
              {probando ? "Probando..." : "Probar conexión"}
            </button>
            {resultadoPrueba && (
              <span className={`text-sm flex items-center gap-1.5 ${resultadoPrueba.success ? "text-green-600" : "text-red-600"}`}>
                {resultadoPrueba.success ? <HiCheckCircle /> : <HiXCircle />}
                {resultadoPrueba.mensaje}
              </span>
            )}
          </div>
        </div>
      </div>

      {msg && (
        <p className={`text-sm mt-4 ${msg.tipo === "ok" ? "text-green-600" : "text-red-600"}`}>{msg.texto}</p>
      )}

      <button
        onClick={handleGuardar}
        disabled={guardando}
        className="mt-6 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl disabled:opacity-60"
      >
        {guardando ? "Guardando..." : "Guardar cambios"}
      </button>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
