import axios from "axios";

const API = axios.create({ baseURL: `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api` });

API.interceptors.request.use((config) => {
  const token = localStorage.getItem("gp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ── Empresas ──────────────────────────────────────────────────────────────────

export const getEmpresas      = (params = {}) => API.get("/admin/empresas", { params }).then((r) => r.data);
export const getEmpresaById   = (id)          => API.get(`/admin/empresas/${id}`).then((r) => r.data);
export const crearEmpresa     = (data)        => API.post("/admin/empresas", data).then((r) => r.data);
export const actualizarEmpresa = (id, data)   => API.put(`/admin/empresas/${id}`, data).then((r) => r.data);
export const desactivarEmpresa = (id)         => API.delete(`/admin/empresas/${id}`).then((r) => r.data);

// ── Usuarios ──────────────────────────────────────────────────────────────────

export const getUsuariosAdmin      = (params = {}) => API.get("/admin/usuarios", { params }).then((r) => r.data);
export const getUsuarioById        = (id)           => API.get(`/admin/usuarios/${id}`).then((r) => r.data);
export const crearUsuarioAdmin     = (data)         => API.post("/admin/usuarios", data).then((r) => r.data);
export const actualizarUsuarioAdmin = (id, data)    => API.put(`/admin/usuarios/${id}`, data).then((r) => r.data);
export const desactivarUsuario     = (id)           => API.delete(`/admin/usuarios/${id}`).then((r) => r.data);

// ── Utilidades ────────────────────────────────────────────────────────────────

export const getRoles  = () => API.get("/admin/roles").then((r) => r.data);
export const getPlanes = () => API.get("/admin/planes").then((r) => r.data);
