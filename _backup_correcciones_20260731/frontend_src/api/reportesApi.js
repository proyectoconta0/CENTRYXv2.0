import axios from "axios";

const API = axios.create({ baseURL: "http://localhost:8000/api/reportes" });

API.interceptors.request.use((cfg) => {
  const t = localStorage.getItem("gp_token");
  if (t) cfg.headers.Authorization = `Bearer ${t}`;
  return cfg;
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error.response) {
      window.dispatchEvent(new CustomEvent("server:offline"));
      return Promise.reject(error);
    }
    if (error.response.status === 401) {
      localStorage.removeItem("gp_token");
      localStorage.removeItem("gp_usuario");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

const RUTA = {
  general:     "/general",
  ventas:      "/ventas",
  gastos:      "/gastos",
  cobranza:    "/cobranza",
  flujo_caja:  "/flujo-caja",
  proveedores: "/proveedores",
};

// Descarga el reporte (blob) para el tipo + parámetros dados.
export const generarReporte = (tipo, params = {}) =>
  API.get(RUTA[tipo], { params, responseType: "blob" }).then(r => r.data);

export const getHistorialReportes = () =>
  API.get("/historial").then(r => r.data);

export const redescargarReporte = (id) =>
  API.get(`/${id}/descargar`, { responseType: "blob" }).then(r => r.data);
