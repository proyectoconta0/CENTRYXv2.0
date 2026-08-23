import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEmpresa } from "../context/EmpresaContext";
import { useSidebar } from "../context/SidebarContext";
import { tienePermiso } from "../core/permisos";
import { FaWhatsapp } from "react-icons/fa";
import {
  HiChartBar, HiCurrencyDollar, HiCollection, HiCreditCard, HiClipboardList,
  HiTrendingUp, HiUsers, HiOfficeBuilding, HiLibrary,
  HiPresentationChartLine, HiDocumentReport,
  HiCog, HiLogout, HiChevronLeft, HiChevronRight,
} from "react-icons/hi";

// Orden pensado para un usuario nuevo: primero a quién le vendo/compro
// (Clientes, Proveedores), luego el ciclo de ventas y gastos, y al final
// las herramientas de análisis/administración.
const NAV_ITEMS = [
  { icon: HiChartBar,              label: "Dashboard",          path: "/",              modulo: "dashboard" },
  { icon: HiUsers,                 label: "Clientes",           path: "/clientes",      modulo: "clientes" },
  { icon: HiOfficeBuilding,        label: "Proveedores",        path: "/proveedores",   modulo: "proveedores" },
  { icon: HiCurrencyDollar,        label: "Ventas",             path: "/ventas",        modulo: "ventas" },
  { icon: HiCollection,            label: "Cobranza",           path: "/cobranza",      modulo: "cobranza" },
  { icon: HiClipboardList,         label: "Gastos",             path: "/gastos",        modulo: "gastos" },
  { icon: HiCreditCard,            label: "Pagos",              path: "/pagos",         modulo: "gastos" },
  { icon: HiLibrary,               label: "Préstamos",          path: "/prestamos",     modulo: "prestamos" },
  { icon: HiTrendingUp,            label: "Flujo de Caja",      path: "/flujo-caja",    modulo: "flujo_caja" },
  { icon: HiPresentationChartLine, label: "Indicadores",        path: "/indicadores",   modulo: "indicadores" },
  { icon: HiDocumentReport,        label: "Reportes",           path: "/reportes",      modulo: "reportes" },
  { icon: HiCog,                   label: "Configuración",      path: "/configuracion", modulo: "configuracion" },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [toastSoporte, setToastSoporte] = useState(null);
  const { logout, usuario } = useAuth();
  const { empresa, logoUrl } = useEmpresa();
  const { mobileOpen, closeMobile } = useSidebar();
  const navigate = useNavigate();
  const location = useLocation();

  const color = empresa?.color_principal || "#1e40af";
  const nombreEmpresa = empresa?.nombre_empresa || "Mi Empresa";
  // Iniciales de las primeras 2 palabras "significativas" del nombre: se
  // separa también por "&"/"/" (para que "J&D Soluciones" dé "JD", no "JS")
  // y se ignoran conectores cortos (para que "Soluciones DE Andamiaje" dé
  // "SA", no "SD").
  const CONECTORES = new Set(["de", "del", "la", "el", "los", "las", "y", "e"]);
  const palabrasIniciales = nombreEmpresa
    .split(/[\s&/]+/)
    .map(p => p.trim())
    .filter(Boolean)
    .filter(p => !CONECTORES.has(p.toLowerCase()));
  const iniciales = palabrasIniciales.slice(0, 2).map(p => p[0].toUpperCase()).join("") || "E";
  const itemsVisibles = NAV_ITEMS.filter(item => tienePermiso(usuario?.rol, item.modulo));

  const handleSoporteClick = () => {
    const numero = empresa?.whatsapp_soporte;
    if (!numero) {
      setToastSoporte("Configure el número de soporte en Configuración → Empresa");
      setTimeout(() => setToastSoporte(null), 4000);
      return;
    }
    window.open(`https://wa.me/${numero}`, "_blank");
  };

  return (
    <>
      {/* Overlay móvil: oscurece el contenido detrás del sidebar abierto */}
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={closeMobile} />
      )}

      {/* Spacer: el <aside> real es position:fixed (ya no "sticky"), por lo
          tanto no participa del layout flex de cada página
          (<div className="flex h-screen ..."><Sidebar/><div className="flex-1..."/></div>).
          Este div invisible reserva el mismo ancho para que el contenido
          principal no quede tapado detrás del sidebar fijo en escritorio.
          Oculto en mobile porque ahí el sidebar es un drawer superpuesto
          (no debe reservar espacio, igual que antes). */}
      <div
        aria-hidden="true"
        className={`hidden md:block shrink-0 transition-all duration-300 ease-in-out ${collapsed ? "md:w-16" : "md:w-52"}`}
      />

      <aside
        className={`flex flex-col h-screen overflow-hidden fixed top-0 left-0 z-50 bg-[#0f172a] transition-all duration-300 ease-in-out shrink-0 w-64 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        } md:translate-x-0 ${collapsed ? "md:w-16" : "md:w-52"}`}
      >
      {/* Logo */}
      {/* px-2 (no px-3/px-4): con el sidebar colapsado el ancho útil es
          64px (md:w-16) — el círculo de 48px + 2×8px de padding llena
          exactamente ese ancho sin desbordar. */}
      <div className="relative px-2 py-5 border-b border-white/10">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute top-2 right-2 text-slate-500 hover:text-white transition-colors"
        >
          {collapsed ? <HiChevronRight /> : <HiChevronLeft />}
        </button>

        <div className="flex flex-col items-center">
          {/* Círculo (logo o iniciales) — envoltorio "relative group" propio,
              sin overflow-hidden, para que el tooltip no quede recortado por
              el overflow-hidden del círculo. */}
          <div className="relative group flex-shrink-0 w-16 h-16">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center overflow-hidden"
              style={{ backgroundColor: logoUrl ? "transparent" : color }}
            >
              {logoUrl
                ? <img src={logoUrl} alt={nombreEmpresa} className="w-full h-full object-contain" />
                : <span className="text-white font-bold" style={{ fontSize: "18px" }}>{iniciales}</span>}
            </div>

            {/* Tooltip con el nombre completo — hover sobre el círculo */}
            <div
              className="hidden group-hover:block absolute whitespace-normal pointer-events-none"
              style={{
                top: "50%",
                left: "100%",
                transform: "translateY(-50%)",
                marginLeft: "10px",
                backgroundColor: "#1e293b",
                color: "#ffffff",
                fontSize: "12px",
                padding: "6px 10px",
                borderRadius: "6px",
                zIndex: 9999,
                maxWidth: "220px",
              }}
            >
              {nombreEmpresa}
            </div>
          </div>

          {!collapsed && (
            <p
              className="mt-2 text-center"
              style={{ fontSize: "11px", fontWeight: "normal", color: "rgba(255,255,255,0.5)" }}
            >
              Centryx
            </p>
          )}
        </div>
      </div>

      {/* Nav — centrado verticalmente en el espacio disponible entre el
          logo y el footer; sin scroll (overflow-hidden): si algún día hay
          más ítems de los que entran en la pantalla, se recortan en vez de
          scrollear (así lo pidió el usuario explícitamente). */}
      <nav className="flex-1 flex flex-col justify-center overflow-hidden px-2 space-y-0.5">
        {itemsVisibles.map(({ icon: Icon, label, path }) => {
          const active = location.pathname === path;
          return (
            <button
              key={path}
              onClick={() => { navigate(path); closeMobile(); }}
              title={collapsed ? label : undefined}
              style={active ? { backgroundColor: color } : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                active
                  ? "text-white shadow-lg shadow-blue-900/40"
                  : "text-slate-400 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="text-lg flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer usuario */}
      <div className="border-t border-white/10 px-3 py-4">
        {/* Sección Soporte — separada como bloque propio, con su propio
            borde inferior, entre el menú principal y el perfil de usuario */}
        <div className="relative pb-4 mb-3 border-b border-white/10">
          {toastSoporte && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-gray-800 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-50">
              {toastSoporte}
            </div>
          )}
          <button
            onClick={handleSoporteClick}
            title={collapsed ? "Soporte" : undefined}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 transition-colors text-sm font-medium"
            style={{ color: "#25D366" }}
          >
            <FaWhatsapp className="text-lg flex-shrink-0" />
            {!collapsed && <span>Soporte</span>}
          </button>
        </div>
        {!collapsed && usuario && (
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style={{ backgroundColor: color }}>
              {usuario.nombre?.charAt(0) ?? "U"}
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium truncate">{usuario.nombre}</p>
              <p className="text-slate-500 text-xs truncate capitalize">{usuario.rol}</p>
            </div>
          </div>
        )}
        <button
          onClick={logout}
          title={collapsed ? "Cerrar sesión" : undefined}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-colors text-sm"
        >
          <HiLogout className="text-lg flex-shrink-0" />
          {!collapsed && <span>Cerrar sesión</span>}
        </button>
      </div>
    </aside>
    </>
  );
}
