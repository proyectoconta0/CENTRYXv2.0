import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const ServerStatusContext = createContext({ online: true, checking: false });

export function ServerStatusProvider({ children }) {
  const [online, setOnline]     = useState(true);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(`${process.env.REACT_APP_API_URL || "http://localhost:8000"}/`, { signal: controller.signal });
      setOnline(res.ok);
    } catch {
      setOnline(false);
    } finally {
      clearTimeout(timer);
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, 30000);

    // Señal inmediata desde el interceptor de axios
    const handleOffline = () => setOnline(false);
    window.addEventListener("server:offline", handleOffline);

    // Volver a verificar cuando el usuario recupera la pestaña
    const handleVisibility = () => {
      if (!document.hidden) check();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener("server:offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [check]);

  return (
    <ServerStatusContext.Provider value={{ online, checking }}>
      {children}
    </ServerStatusContext.Provider>
  );
}

export const useServerStatus = () => useContext(ServerStatusContext);
