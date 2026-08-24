import React, { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ServerStatusProvider } from "./context/ServerStatusContext";
import { EmpresaProvider } from "./context/EmpresaContext";
import { SidebarProvider } from "./context/SidebarContext";
import { tienePermiso } from "./core/permisos";
import { getOnboardingStatus } from "./api/configuracionApi";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import ModalBienvenida from "./components/ModalBienvenida";

const Gastos              = lazy(() => import("./pages/Gastos"));
const Pagos               = lazy(() => import("./pages/Pagos"));
const FlujoCaja           = lazy(() => import("./pages/FlujoCaja"));
const Clientes            = lazy(() => import("./pages/Clientes"));
const FichaCliente        = lazy(() => import("./pages/FichaCliente"));
const Ventas              = lazy(() => import("./pages/Ventas"));
const Cobranza            = lazy(() => import("./pages/Cobranza"));
const Prestamos           = lazy(() => import("./pages/Prestamos"));
const HistorialComercial  = lazy(() => import("./pages/HistorialComercial"));
const DocumentosSustento  = lazy(() => import("./pages/DocumentosSustento"));
const Proveedores         = lazy(() => import("./pages/Proveedores"));
const Indicadores         = lazy(() => import("./pages/Indicadores"));
const Reportes            = lazy(() => import("./pages/Reportes"));
const Configuracion       = lazy(() => import("./pages/Configuracion"));
const Onboarding          = lazy(() => import("./pages/Onboarding"));
const ImprimirComprobante = lazy(() => import("./pages/ImprimirComprobante"));

function Fallback() {
  return <div className="flex h-screen items-center justify-center text-gray-400 text-sm">Cargando módulo...</div>;
}

function AccesoDenegado() {
  return (
    <div className="flex h-screen items-center justify-center text-center px-6">
      <div>
        <p className="text-4xl mb-3">🚫</p>
        <p className="text-gray-700 font-semibold">No tienes permiso para acceder a este módulo.</p>
        <p className="text-sm text-gray-400 mt-1">Contacta a un Administrador si crees que esto es un error.</p>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, modulo }) {
  const { isAuth, usuario } = useAuth();
  if (!isAuth) return <Navigate to="/login" replace />;
  if (modulo && !tienePermiso(usuario?.rol, modulo)) return <AccesoDenegado />;
  return children;
}

// Redirige al wizard de bienvenida si la empresa aún no completó el onboarding.
// Se monta una única vez por sesión (envuelve todo el árbol de rutas), no por página.
function OnboardingGate({ children }) {
  const { isAuth } = useAuth();
  const location = useLocation();
  const [estado, setEstado] = useState("cargando"); // cargando | ok | pendiente

  useEffect(() => {
    if (!isAuth) { setEstado("ok"); return; }
    let activo = true;
    const verificar = () => {
      getOnboardingStatus()
        .then(r => { if (activo) setEstado(r.completado ? "ok" : "pendiente"); })
        .catch(() => { if (activo) setEstado("ok"); }); // si falla la verificación, no bloquear el acceso
    };
    verificar();
    // Permite forzar la re-consulta sin recargar la página (ver SistemaTab.jsx: reset de onboarding).
    window.addEventListener("onboarding-reset", verificar);
    return () => { activo = false; window.removeEventListener("onboarding-reset", verificar); };
  }, [isAuth]);

  if (!isAuth || location.pathname === "/login" || location.pathname === "/onboarding") return children;
  if (estado === "cargando") return <Fallback />;
  if (estado === "pendiente") return <Navigate to="/onboarding" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <ServerStatusProvider>
      <EmpresaProvider>
      <SidebarProvider>
      <BrowserRouter>
        <OnboardingGate>
          <Suspense fallback={<Fallback />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
              <Route path="/" element={<ProtectedRoute modulo="dashboard"><Dashboard /></ProtectedRoute>} />
              <Route path="/clientes" element={<ProtectedRoute modulo="clientes"><Clientes /></ProtectedRoute>} />
              <Route path="/clientes/:id" element={<ProtectedRoute modulo="clientes"><FichaCliente /></ProtectedRoute>} />
              <Route path="/ventas"    element={<ProtectedRoute modulo="ventas"><Ventas /></ProtectedRoute>} />
              <Route path="/imprimir/comprobante/:id" element={<ProtectedRoute modulo="ventas"><ImprimirComprobante /></ProtectedRoute>} />
              <Route path="/gastos"      element={<ProtectedRoute modulo="gastos"><Gastos /></ProtectedRoute>} />
              <Route path="/pagos"      element={<ProtectedRoute modulo="gastos"><Pagos /></ProtectedRoute>} />
              <Route path="/flujo-caja" element={<ProtectedRoute modulo="flujo_caja"><FlujoCaja /></ProtectedRoute>} />
              <Route path="/cobranza" element={<ProtectedRoute modulo="cobranza"><Cobranza /></ProtectedRoute>} />
              <Route path="/prestamos" element={<ProtectedRoute modulo="prestamos"><Prestamos /></ProtectedRoute>} />
              <Route path="/historial-comercial" element={<ProtectedRoute modulo="ventas"><HistorialComercial /></ProtectedRoute>} />
              <Route path="/documentos-sustento" element={<ProtectedRoute modulo="ventas"><DocumentosSustento /></ProtectedRoute>} />
              <Route path="/proveedores" element={<ProtectedRoute modulo="proveedores"><Proveedores /></ProtectedRoute>} />
              <Route path="/indicadores" element={<ProtectedRoute modulo="indicadores"><Indicadores /></ProtectedRoute>} />
              <Route path="/reportes" element={<ProtectedRoute modulo="reportes"><Reportes /></ProtectedRoute>} />
              <Route path="/configuracion" element={<ProtectedRoute modulo="configuracion"><Configuracion /></ProtectedRoute>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </OnboardingGate>
        <ModalBienvenida />
      </BrowserRouter>
      </SidebarProvider>
      </EmpresaProvider>
      </ServerStatusProvider>
    </AuthProvider>
  );
}
