import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { loginApi } from "../api/dashboardApi";
import { getEmpresaPublica, getEmpresaPorSubdominio } from "../api/configuracionApi";
import { HiLightningBolt, HiLockClosed, HiMail } from "react-icons/hi";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const subdominioParam = searchParams.get("empresa");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [empresa, setEmpresa] = useState(null);

  useEffect(() => {
    if (subdominioParam) {
      getEmpresaPorSubdominio(subdominioParam)
        .then(setEmpresa)
        .catch(() => setEmpresa(null));
    } else {
      getEmpresaPublica()
        .then(setEmpresa)
        .catch(() => setEmpresa(null));
    }
  }, [subdominioParam]);

  const nombreEmpresa = empresa?.nombre_empresa || "Centryx";
  const subtitulo = empresa?.ruc ? `${nombreEmpresa} · RUC ${empresa.ruc}` : nombreEmpresa;
  const logoUrl = empresa?.logo_url || null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await loginApi(email, password);
      login(data.access_token, data.usuario);
      if (data.usuario.rol === "superadmin") {
        navigate("/admin");
      } else {
        navigate("/");
      }
    } catch {
      setError("Credenciales incorrectas. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          {logoUrl ? (
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-white mb-4 shadow-lg overflow-hidden p-1">
              <img
                src={logoUrl}
                alt={`Logo ${nombreEmpresa}`}
                className="w-full h-full object-contain"
                onError={(e) => { e.target.style.display = "none"; e.target.nextSibling.style.display = "flex"; }}
              />
              {/* Fallback si la imagen no carga */}
              <div style={{ display: "none" }} className="w-full h-full items-center justify-center bg-blue-600 rounded-xl">
                <HiLightningBolt className="text-white text-3xl" />
              </div>
            </div>
          ) : (
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4 shadow-lg">
              <HiLightningBolt className="text-white text-3xl" />
            </div>
          )}
          <h1 className="text-3xl font-bold text-white">{nombreEmpresa}</h1>
          <p className="text-slate-400 mt-1 text-sm">{subtitulo}</p>
        </div>

        {/* Card */}
        <div className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-8 shadow-2xl">
          <h2 className="text-white text-xl font-semibold mb-6">Iniciar Sesión</h2>

          {error && (
            <div className="bg-red-500/20 border border-red-500/50 text-red-300 rounded-lg px-4 py-3 mb-5 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1.5">Correo electrónico</label>
              <div className="relative">
                <HiMail className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 text-white rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-500 text-sm"
                  placeholder="usuario@empresa.pe"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1.5">Contraseña</label>
              <div className="relative">
                <HiLockClosed className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 text-white rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-slate-500 text-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold rounded-lg py-3 mt-2 transition-colors duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Ingresando...</>
              ) : "Ingresar al Sistema"}
            </button>
          </form>
        </div>

        <p className="text-slate-600 text-xs text-center mt-6">
          © 2026 {nombreEmpresa} · Lima, Perú · v1.0.0
        </p>
      </div>
    </div>
  );
}
