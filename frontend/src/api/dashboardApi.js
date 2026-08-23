import axios from "axios";

const API = axios.create({ baseURL: `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api` });

API.interceptors.request.use((config) => {
  const token = localStorage.getItem("gp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const loginApi = (email, password) =>
  API.post("/auth/login", { email, password }).then((r) => r.data);

export const logoutApi = () => API.post("/auth/logout").then((r) => r.data);

export const getKpis             = (rango = {}) => API.get("/dashboard/kpis", { params: rango }).then((r) => r.data);
export const getVentasEvolucion  = (rango = {}) => API.get("/dashboard/ventas-evolucion", { params: rango }).then((r) => r.data);
export const getFlujoCaja        = () => API.get("/dashboard/flujo-caja").then((r) => r.data);
export const getTopClientes      = (rango = {}) => API.get("/dashboard/top-clientes", { params: rango }).then((r) => r.data);
export const getCobranzaEstado   = (rango = {}) => API.get("/dashboard/cobranza-estado", { params: rango }).then((r) => r.data);
export const getGastosCategoria  = (rango = {}) => API.get("/dashboard/gastos-categoria", { params: rango }).then((r) => r.data);
export const getProyectosEjecucion = () => API.get("/dashboard/proyectos-ejecucion").then((r) => r.data);
export const getIndicadoresKpi   = (rango = {}) => API.get("/dashboard/indicadores-kpi", { params: rango }).then((r) => r.data);
export const getFiltrosOpciones  = () => API.get("/dashboard/filtros-opciones").then((r) => r.data);
