import React, { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { getIndicadoresResumen } from "../api/comercialApi";

const LS_KEY = "ultima_bienvenida";

function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 18) return "Buenas tardes";
  return "Buenas noches";
}

function fmtFechaLarga() {
  return new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function fmtS(n) {
  return `S/ ${Number(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const NIVEL_ESTILO = {
  rojo:     "bg-red-50 border-red-200 text-red-700",
  amarillo: "bg-amber-50 border-amber-200 text-amber-700",
};

function Tarjeta({ emoji, label, valor, sub, colorValor }) {
  return (
    <div className="bg-gray-50 rounded-xl border border-gray-100 p-4">
      <p className="text-xs text-gray-500 font-medium">{emoji} {label}</p>
      <p className={`text-lg font-bold mt-1 ${colorValor || "text-gray-800"}`}>{valor}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function ModalBienvenida() {
  const { isAuth, usuario } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [resumen, setResumen] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isAuth || location.pathname === "/login") return;
    if (localStorage.getItem(LS_KEY) === hoyISO()) return;

    let activo = true;
    getIndicadoresResumen("mes")
      .then((r) => { if (activo) { setResumen(r); setVisible(true); } })
      .catch(() => {});
    return () => { activo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  const cerrar = () => {
    localStorage.setItem(LS_KEY, hoyISO());
    setVisible(false);
  };

  const verDetalles = () => {
    cerrar();
    navigate("/indicadores");
  };

  if (!visible || !resumen) return null;

  const alertasUrgentes = (resumen.alertas || []).filter(a => a.nivel === "rojo" || a.nivel === "amarillo").slice(0, 3);

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-8 py-6 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-800">
            {getGreeting()}, {usuario?.nombre?.split(" ")[0] ?? "Usuario"}! 👋
          </h2>
          <p className="text-sm text-gray-500 mt-1 capitalize">Aquí está el resumen de hoy — {fmtFechaLarga()}</p>
        </div>

        <div className="px-8 py-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-5">
            <Tarjeta emoji="💰" label="Vendiste este mes" valor={fmtS(resumen.vendiste.valor)} />
            <Tarjeta emoji="💸" label="Gastaste este mes" valor={fmtS(resumen.gastaste.valor)} />
            <Tarjeta emoji="🎉" label="Tu ganancia" valor={fmtS(resumen.ganaste.valor)}
              colorValor={resumen.ganaste.es_positivo ? "text-green-600" : "text-red-600"} />
            <Tarjeta emoji="📋" label="Te deben" valor={fmtS(resumen.te_deben.valor)}
              sub={`${resumen.te_deben.facturas_pendientes} factura${resumen.te_deben.facturas_pendientes === 1 ? "" : "s"}`} />
            <Tarjeta emoji="🔴" label="Vencidas hoy" valor={fmtS(resumen.vencidas_hoy.valor)}
              sub={`${resumen.vencidas_hoy.facturas} factura${resumen.vencidas_hoy.facturas === 1 ? "" : "s"}`}
              colorValor={resumen.vencidas_hoy.facturas > 0 ? "text-red-600" : "text-gray-800"} />
            <Tarjeta emoji="🟡" label="Por vencer esta semana" valor={`${resumen.por_vencer_semana.facturas} factura${resumen.por_vencer_semana.facturas === 1 ? "" : "s"}`} />
          </div>

          {alertasUrgentes.length > 0 && (
            <div className="space-y-2 mb-2">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Alertas urgentes</p>
              {alertasUrgentes.map((a, i) => (
                <div key={i} className={`text-sm px-4 py-2.5 rounded-lg border ${NIVEL_ESTILO[a.nivel] || "bg-gray-50 border-gray-200 text-gray-700"}`}>
                  ⚠️ {a.mensaje}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-8 py-5 border-t border-gray-100">
          <button onClick={verDetalles}
            className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            Ver más detalles
          </button>
          <button onClick={cerrar}
            className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
            Entrar al sistema
          </button>
        </div>
      </div>
    </div>
  );
}
