import axios from "axios";

const API = axios.create({ baseURL: `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api/busqueda` });

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

export const buscarGlobal = (q) => API.get("", { params: { q } }).then(r => r.data);
