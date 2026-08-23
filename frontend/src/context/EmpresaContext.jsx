import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useAuth } from "./AuthContext";
import { getEmpresa, getLogoUrl } from "../api/configuracionApi";

const EmpresaContext = createContext(null);

const DEFAULT_EMPRESA = {
  nombre_empresa: "Centryx",
  logo_url: null,
  color_principal: "#1e40af",
  moneda_principal: "PEN",
  onboarding_completado: null, // null = aún no se sabe
};

export function EmpresaProvider({ children }) {
  const { isAuth } = useAuth();
  const [empresa, setEmpresa] = useState(DEFAULT_EMPRESA);
  const [loading, setLoading] = useState(true);

  const recargar = useCallback(() => {
    if (!isAuth) { setLoading(false); return; }
    setLoading(true);
    getEmpresa()
      .then(setEmpresa)
      .catch(() => setEmpresa(DEFAULT_EMPRESA))
      .finally(() => setLoading(false));
  }, [isAuth]);

  useEffect(() => { recargar(); }, [recargar]);

  useEffect(() => {
    if (!empresa?.color_principal) return;
    document.documentElement.style.setProperty("--color-principal", empresa.color_principal);
  }, [empresa?.color_principal]);

  const logoUrl = getLogoUrl(empresa);

  return (
    <EmpresaContext.Provider value={{ empresa, logoUrl, loading, recargarEmpresa: recargar }}>
      {children}
    </EmpresaContext.Provider>
  );
}

export const useEmpresa = () => useContext(EmpresaContext);
