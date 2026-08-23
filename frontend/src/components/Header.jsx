import React, { useState, useEffect } from "react";
import { HiFilter, HiCalendar, HiBell, HiChevronLeft, HiChevronRight, HiMenu } from "react-icons/hi";
import { useAuth } from "../context/AuthContext";
import { useServerStatus } from "../context/ServerStatusContext";
import { useSidebar } from "../context/SidebarContext";
import FiltrosPanel from "./FiltrosPanel";
import NotificacionesPanel from "./NotificacionesPanel";
import BuscadorGlobal from "./BuscadorGlobal";
import { getNotificacionesResumen } from "../api/notificacionesApi";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Buenos días";
  if (h < 18) return "Buenas tardes";
  return "Buenas noches";
}

function formatDate(d) {
  return d.toLocaleDateString("es-PE", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function fmtISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Calcula el rango [desde, hasta] según el período elegido, anclado a `anchor`
// (el mes/día que el usuario está viendo, no necesariamente "hoy").
function calcularRango(periodo, anchor) {
  if (periodo === "dia") {
    return { desde: anchor, hasta: anchor };
  }
  if (periodo === "semana") {
    const dow = anchor.getDay(); // 0=domingo .. 6=sábado
    const diffLunes = dow === 0 ? 6 : dow - 1;
    const inicio = new Date(anchor);
    inicio.setDate(anchor.getDate() - diffLunes);
    const fin = new Date(inicio);
    fin.setDate(inicio.getDate() + 6);
    return { desde: inicio, hasta: fin };
  }
  if (periodo === "año") {
    return { desde: new Date(anchor.getFullYear(), 0, 1), hasta: new Date(anchor.getFullYear(), 11, 31) };
  }
  // "mes"
  const inicio = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const fin = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
  return { desde: inicio, hasta: fin };
}

function labelPeriodo(periodo, anchor) {
  if (periodo === "dia") {
    return anchor.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
  }
  if (periodo === "semana") {
    const { desde, hasta } = calcularRango(periodo, anchor);
    return `${desde.toLocaleDateString("es-PE", { day: "2-digit", month: "short" })} – ${hasta.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" })}`;
  }
  if (periodo === "año") {
    return `${anchor.getFullYear()}`;
  }
  return anchor.toLocaleDateString("es-PE", { month: "short", year: "numeric" });
}

function ServerBadge() {
  const { online, checking } = useServerStatus();
  const [showTip, setShowTip] = useState(false);

  return (
    <div className="relative">
      <button
        onMouseEnter={() => setShowTip(true)}
        onMouseLeave={() => setShowTip(false)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
          online
            ? "border-green-200 bg-green-50 text-green-700"
            : "border-red-200 bg-red-50 text-red-700 animate-pulse"
        }`}
      >
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          checking ? "bg-yellow-400 animate-pulse"
          : online  ? "bg-green-500"
                    : "bg-red-500"
        }`} />
        {checking ? "Verificando…" : online ? "En línea" : "Sin conexión"}
      </button>

      {showTip && (
        <div className="absolute right-0 top-full mt-1.5 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs">
          {online ? (
            <p className="text-green-700 font-medium">✅ Servidor operativo</p>
          ) : (
            <>
              <p className="text-red-700 font-semibold mb-1">🔴 Servidor desconectado</p>
              <p className="text-gray-600">
                Verifica que el backend esté corriendo:
              </p>
              <code className="block mt-1 bg-gray-100 rounded px-2 py-1 text-[10px] text-gray-700 font-mono">
                cd backend<br />
                uvicorn main:app --reload --port 8000
              </code>
              <p className="mt-1.5 text-gray-500">
                O ejecuta <strong>iniciar.bat</strong> en la raíz del proyecto.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

const FILTROS_VACIOS = { desde: "", hasta: "", clienteId: "", tipoServicio: "" };

export default function Header({ onFilterChange, title, mostrarPeriodo = true, deshabilitarFiltros = false }) {
  const { usuario } = useAuth();
  const { toggleMobile } = useSidebar();
  const [periodo, setPeriodo] = useState("mes");
  const [anchor, setAnchor] = useState(() => new Date());
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [filtrosExtra, setFiltrosExtra] = useState(FILTROS_VACIOS);
  const [notifAbiertas, setNotifAbiertas] = useState(false);
  const [alertas, setAlertas] = useState([]);
  const [cargandoAlertas, setCargandoAlertas] = useState(true);
  const hoy = new Date();

  useEffect(() => {
    let activo = true;
    const cargarAlertas = () => {
      getNotificacionesResumen()
        .then((r) => { if (activo) setAlertas(r.alertas || []); })
        .catch(() => { if (activo) setAlertas([]); })
        .finally(() => { if (activo) setCargandoAlertas(false); });
    };
    cargarAlertas();
    const interval = setInterval(cargarAlertas, 60000);
    return () => { activo = false; clearInterval(interval); };
  }, []);

  useEffect(() => {
    // Si el panel de Filtros define un rango de fechas personalizado, este
    // tiene prioridad sobre el selector Hoy/Semana/Mes/Año del header.
    const base = calcularRango(periodo, anchor);
    const desde = filtrosExtra.desde || fmtISO(base.desde);
    const hasta = filtrosExtra.hasta || fmtISO(base.hasta);
    onFilterChange?.({
      periodo, desde, hasta,
      cliente_id: filtrosExtra.clienteId || undefined,
      tipo_servicio: filtrosExtra.tipoServicio || undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo, anchor, filtrosExtra]);

  const filtrosActivos =
    !!filtrosExtra.desde || !!filtrosExtra.hasta || !!filtrosExtra.clienteId || !!filtrosExtra.tipoServicio;

  const irMesAnterior = () => {
    setPeriodo("mes");
    setAnchor(a => new Date(a.getFullYear(), a.getMonth() - 1, 1));
  };
  const irMesSiguiente = () => {
    setPeriodo("mes");
    setAnchor(a => new Date(a.getFullYear(), a.getMonth() + 1, 1));
  };

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        {/* Hamburguesa (móvil) + Saludo */}
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={toggleMobile}
            className="md:hidden flex-shrink-0 p-2 -ml-1 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            title="Abrir/cerrar menú"
          >
            <HiMenu className="text-xl" />
          </button>
          <div className="min-w-0">
            {title ? (
              <h1 className="text-xl font-semibold text-gray-800 truncate">{title}</h1>
            ) : (
              <h1 className="text-xl font-semibold text-gray-800 truncate">
                {getGreeting()}, <span className="text-blue-600">{usuario?.nombre?.split(" ")[0] ?? "Usuario"}</span>!
              </h1>
            )}
            <p className="text-sm text-gray-500 capitalize truncate">{formatDate(hoy)}</p>
          </div>
        </div>

        {/* Controles */}
        <div className="flex items-center gap-3 flex-wrap justify-end">
          {/* Indicador servidor */}
          <ServerBadge />

          {mostrarPeriodo && (
            <>
              {/* Selector de período */}
              <div className={`flex items-center bg-gray-100 rounded-lg p-1 gap-1 transition-opacity ${deshabilitarFiltros ? "opacity-50 pointer-events-none" : ""}`}>
                {["dia", "semana", "mes", "año"].map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPeriodo(p); setAnchor(new Date()); }}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors capitalize ${
                      periodo === p
                        ? "bg-white text-blue-600 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    {p === "dia" ? "Hoy" : p === "semana" ? "Semana" : p === "mes" ? "Mes" : "Año"}
                  </button>
                ))}
              </div>

              {/* Fecha / navegador de mes */}
              <div className={`flex items-center gap-1 px-1.5 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-600 bg-white transition-opacity ${deshabilitarFiltros ? "opacity-50 pointer-events-none" : ""}`}>
                <button
                  onClick={irMesAnterior}
                  title="Mes anterior"
                  className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <HiChevronLeft className="text-sm" />
                </button>
                <div className="flex items-center gap-1.5 px-1.5 min-w-[104px] justify-center">
                  <HiCalendar className="text-gray-400 flex-shrink-0" />
                  <span className="capitalize whitespace-nowrap">{labelPeriodo(periodo, anchor)}</span>
                </div>
                <button
                  onClick={irMesSiguiente}
                  title="Mes siguiente"
                  className="p-1 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <HiChevronRight className="text-sm" />
                </button>
              </div>

              {/* Filtros */}
              <div className={`relative transition-opacity ${deshabilitarFiltros ? "opacity-50 pointer-events-none" : ""}`}>
                <button
                  onClick={() => setFiltrosAbiertos((v) => !v)}
                  className="relative flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <HiFilter />
                  Filtros
                  {filtrosActivos && (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />
                  )}
                </button>
                <FiltrosPanel
                  open={filtrosAbiertos}
                  onClose={() => setFiltrosAbiertos(false)}
                  valores={filtrosExtra}
                  onApply={setFiltrosExtra}
                  onClear={() => setFiltrosExtra(FILTROS_VACIOS)}
                />
              </div>
            </>
          )}

          {/* Buscador global */}
          <BuscadorGlobal />

          {/* Bell */}
          <div className="relative">
            <button
              onClick={() => setNotifAbiertas((v) => !v)}
              className="relative p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <HiBell className="text-xl" />
              {alertas.length > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full">
                  {alertas.length > 99 ? "99+" : alertas.length}
                </span>
              )}
            </button>
            <NotificacionesPanel
              open={notifAbiertas}
              onClose={() => setNotifAbiertas(false)}
              alertas={alertas}
              loading={cargandoAlertas}
            />
          </div>
        </div>
      </div>
    </header>
  );
}
