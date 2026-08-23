import axios from "axios";

const API = axios.create({ baseURL: `${process.env.REACT_APP_API_URL || "http://localhost:8000"}/api` });

API.interceptors.request.use((config) => {
  const token = localStorage.getItem("gp_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const getNotificacionesResumen = () =>
  API.get("/notificaciones/resumen").then((r) => r.data);
