import React, { createContext, useContext, useState } from "react";
import { logoutApi } from "../api/dashboardApi";

const AuthContext = createContext(null);

// Lee el token/usuario de localStorage de forma síncrona en el estado inicial
// (no en un useEffect) para que isAuth ya sea correcto en el primer render.
// Si se leyera en un useEffect, en una pestaña recién abierta (p.ej. al hacer
// window.open de la vista de impresión) ProtectedRoute redirigiría a /login
// antes de que el efecto alcance a hidratar el token — el <Navigate> de
// react-router corre en un useLayoutEffect, que se ejecuta antes que un
// useEffect normal.
function leerUsuarioGuardado() {
  const u = localStorage.getItem("gp_usuario");
  if (!u) return null;
  try {
    return JSON.parse(u);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(leerUsuarioGuardado);
  const [token, setToken] = useState(() => localStorage.getItem("gp_token"));

  const login = (tokenValue, usuarioData) => {
    setToken(tokenValue);
    setUsuario(usuarioData);
    localStorage.setItem("gp_token", tokenValue);
    localStorage.setItem("gp_usuario", JSON.stringify(usuarioData));
  };

  const logout = () => {
    // Se registra el "Cierre de sesión" en el log de auditoría antes de
    // borrar el token local — si se limpiara primero, la petición saldría
    // sin Authorization y el backend no podría identificar al usuario.
    logoutApi().catch(() => {}).finally(() => {
      setToken(null);
      setUsuario(null);
      localStorage.removeItem("gp_token");
      localStorage.removeItem("gp_usuario");
    });
  };

  return (
    <AuthContext.Provider value={{ usuario, token, login, logout, isAuth: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
