import axios from "axios";

const API = axios.create({ baseURL: `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api/configuracion` });

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

// ── Empresa ──────────────────────────────────────────────────────────────────
export const getEmpresa = () => API.get("/empresa").then(r => r.data);
// Sin token — para la pantalla de Login, antes de autenticarse. Solo trae
// nombre_empresa y ruc (ver comentario del endpoint en configuracion.py).
export const getEmpresaPublica = () => API.get("/empresa-publica").then(r => r.data);
export const getEmpresaPorSubdominio = (subdominio) => API.get(`/empresa-publica?subdominio=${subdominio}`).then(r => r.data);
export const updateEmpresa = (data) => API.put("/empresa", data).then(r => r.data);
export const subirLogo = (file) => {
  const fd = new FormData();
  fd.append("file", file);
  return API.post("/empresa/logo", fd, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
};
// El logo se guarda como base64 en la BD (Railway no tiene disco persistente):
// si logo_url ya es una data: URL se usa tal cual; si no (empresas con un
// logo antiguo subido a disco), se cae al endpoint del backend.
export const getLogoUrl = (empresa) => {
  if (!empresa?.logo_url) return null;
  if (empresa.logo_url.startsWith("data:image")) return empresa.logo_url;
  return `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api/configuracion/empresa/logo?v=${empresa.updated_at || ""}`;
};
export const probarSmtp = () => API.get("/smtp/probar").then(r => r.data);

// ── Rubro ────────────────────────────────────────────────────────────────────
export const getRubro = () => API.get("/rubro").then(r => r.data);
export const updateRubro = (data) => API.put("/rubro", data).then(r => r.data);

// ── Usuarios ─────────────────────────────────────────────────────────────────
export const getUsuarios = () => API.get("/usuarios").then(r => r.data);
export const crearUsuario = (data) => API.post("/usuarios", data).then(r => r.data);
export const actualizarUsuario = (id, data) => API.put(`/usuarios/${id}`, data).then(r => r.data);
export const eliminarUsuario = (id) => API.delete(`/usuarios/${id}`).then(r => r.data);

// ── Documentos (correlativos) ──────────────────────────────────────────────────
export const getDocumentosConfig = () => API.get("/documentos").then(r => r.data);
export const updateDocumentosConfig = (documentos) => API.put("/documentos", { documentos }).then(r => r.data);
export const crearDocumentoConfig = (documento) => API.post("/documentos", documento).then(r => r.data);

// ── Alertas ──────────────────────────────────────────────────────────────────
export const getAlertas = () => API.get("/alertas").then(r => r.data);
export const updateAlertas = (alertas) => API.put("/alertas", { alertas }).then(r => r.data);

// ── Onboarding ───────────────────────────────────────────────────────────────
export const getOnboardingStatus = () => API.get("/onboarding-status").then(r => r.data);
export const resetearOnboarding = () => API.post("/resetear-onboarding").then(r => r.data);

// ── Sistema ──────────────────────────────────────────────────────────────────
export const exportarData = () => API.get("/exportar-data", { responseType: "blob" }).then(r => r.data);

// ── Backup y Restauración ──────────────────────────────────────────────────
export const exportarBackup = () => API.get("/backup/exportar", { responseType: "blob" }).then(r => r.data);
export const importarBackup = (file) => {
  const fd = new FormData();
  fd.append("archivo", file);
  return API.post("/backup/importar", fd, { headers: { "Content-Type": "multipart/form-data" } }).then(r => r.data);
};
export const limpiarRegistros = (confirmar) => API.delete("/backup/limpiar", { data: { confirmar } }).then(r => r.data);

// ── Gastos: Categorías y Áreas (gestión dinámica) ─────────────────────────────
export const getCategoriasGasto    = () => API.get("/categorias-gasto").then(r => r.data);
export const crearCategoriaGasto   = (data) => API.post("/categorias-gasto", data).then(r => r.data);
export const actualizarCategoriaGasto = (id, data) => API.put(`/categorias-gasto/${id}`, data).then(r => r.data);
export const eliminarCategoriaGasto   = (id) => API.delete(`/categorias-gasto/${id}`).then(r => r.data);

export const getAreasGasto    = () => API.get("/areas-gasto").then(r => r.data);
export const crearAreaGasto   = (data) => API.post("/areas-gasto", data).then(r => r.data);
export const actualizarAreaGasto = (id, data) => API.put(`/areas-gasto/${id}`, data).then(r => r.data);
export const eliminarAreaGasto   = (id) => API.delete(`/areas-gasto/${id}`).then(r => r.data);
