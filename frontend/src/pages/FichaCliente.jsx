import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import SustentoModal from "../components/comercial/SustentoModal";
import FormCliente from "../components/comercial/FormCliente";
import Toast from "../components/Toast";
import {
  getCliente, getHistorialCliente,
  subirComprobante, eliminarComprobante, getComprobanteBlob,
  getEstadoCuentaCliente, getEstadoCuentaResumen, enviarEstadoCuentaCliente,
  getGarantias, getCreditosDisponibles,
} from "../api/comercialApi";
import {
  HiArrowLeft, HiPencil, HiPhone, HiMail, HiLocationMarker,
  HiUser, HiBriefcase, HiDocumentText, HiDocumentReport,
  HiEye, HiDownload, HiTrash, HiUpload, HiExclamationCircle, HiX, HiMailOpen,
} from "react-icons/hi";

const SERV_COLOR = ["bg-blue-50 text-blue-700","bg-green-50 text-green-700","bg-amber-50 text-amber-700","bg-indigo-50 text-indigo-700","bg-pink-50 text-pink-700","bg-teal-50 text-teal-700","bg-orange-50 text-orange-700"];

function fmtFecha(d) { return d ? new Date(d).toLocaleDateString("es-PE",{day:"2-digit",month:"short",year:"numeric"}) : "—"; }
function fmtMonto(n) {
  return `S/ ${(n || 0).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function FichaCliente() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [cliente, setCliente]     = useState(null);
  const [historial, setHistorial] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [garantias, setGarantias] = useState([]);
  const [creditos, setCreditos] = useState([]);
  const [showEdit, setShowEdit]   = useState(false);
  const [sustentoVenta, setSustentoVenta] = useState(null);

  // comprobantes
  const [uploadingId, setUploadingId]       = useState(null);
  const [confirmDelComp, setConfirmDelComp] = useState(null);
  const [toast, setToast] = useState(null);
  const comprobanteRef = useRef();

  // estado de cuenta
  const [estadoCuentaModal, setEstadoCuentaModal] = useState(false);
  const [ecDesde, setEcDesde] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  });
  const [ecHasta, setEcHasta] = useState(() => new Date().toISOString().slice(0, 10));
  const [ecGenerando, setEcGenerando] = useState(false);
  const [ecError, setEcError] = useState("");

  // estado de cuenta — envío por correo
  const [envioModal, setEnvioModal]           = useState(false);
  const [envioPara, setEnvioPara]             = useState("");
  const [envioSinEmail, setEnvioSinEmail]     = useState(false);
  const [envioCc, setEnvioCc]                 = useState("");
  const [envioAsunto, setEnvioAsunto]         = useState("");
  const [envioMensaje, setEnvioMensaje]       = useState("");
  const [envioEnviando, setEnvioEnviando]     = useState(false);
  const [envioError, setEnvioError]           = useState("");
  const [envioExito, setEnvioExito]           = useState("");

  const handleDescargarPdf = async () => {
    setEcGenerando(true);
    setEcError("");
    try {
      const blob = await getEstadoCuentaCliente(id, { desde: ecDesde, hasta: ecHasta });
      const url = window.URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      window.open(url, "_blank");
      setEstadoCuentaModal(false);
    } catch {
      setEcError("Error al generar el PDF. Intente nuevamente.");
    } finally {
      setEcGenerando(false);
    }
  };

  const handleAbrirEnvioCorreo = async () => {
    setEcGenerando(true);
    setEcError("");
    try {
      const r = await getEstadoCuentaResumen(id, { desde: ecDesde, hasta: ecHasta });
      const empresaNombre = r.empresa?.nombre_empresa || "Centryx";
      const tieneEmail = !!r.cliente?.email;

      setEnvioPara(r.cliente?.email || "");
      setEnvioSinEmail(!tieneEmail);
      setEnvioCc("");
      setEnvioAsunto(`Estado de Cuenta - ${empresaNombre} - ${r.periodo_label}`);
      setEnvioMensaje(
        `Estimado/a ${r.cliente?.razon_social || "cliente"},\n\n` +
        `Adjunto encontrará su estado de cuenta del período ${r.periodo_label}.\n\n` +
        `Resumen:\n` +
        `Total Facturado: ${fmtMonto(r.resumen.total_facturado)}\n` +
        `Total Cobrado:   ${fmtMonto(r.resumen.total_cobrado)}\n` +
        `Saldo Pendiente: ${fmtMonto(r.resumen.saldo_pendiente)}\n\n` +
        `Quedamos atentos a cualquier consulta.\n\n` +
        `Saludos,\n${empresaNombre}\n${r.empresa?.telefono || ""}\n${r.empresa?.email || ""}`
      );
      setEnvioError("");
      setEnvioExito("");
      setEstadoCuentaModal(false);
      setEnvioModal(true);
    } catch {
      setEcError("Error al preparar el correo. Intente nuevamente.");
    } finally {
      setEcGenerando(false);
    }
  };

  const handleEnviarCorreo = async () => {
    setEnvioEnviando(true);
    setEnvioError("");
    setEnvioExito("");
    try {
      const r = await enviarEstadoCuentaCliente(id, {
        desde: ecDesde, hasta: ecHasta,
        destinatario: envioPara, cc: envioCc.trim() || undefined,
        asunto: envioAsunto, mensaje: envioMensaje,
      });
      setEnvioExito(r.mensaje || "Correo enviado correctamente");
    } catch (err) {
      setEnvioError(err.response?.data?.detail || "Error al enviar el correo. Intente nuevamente.");
    } finally {
      setEnvioEnviando(false);
    }
  };

  const cargar = async () => {
    setLoading(true);
    try {
      const [c, h] = await Promise.all([getCliente(id), getHistorialCliente(id)]);
      setCliente(c); setHistorial(h);
    } catch { navigate("/clientes"); }
    finally { setLoading(false); }
  };
  useEffect(() => { cargar(); }, [id]);

  useEffect(() => {
    // Garantías se identifican por RUC/DNI (no hay más cliente_id en el modelo),
    // por eso se espera a que el cliente esté cargado para tener su RUC.
    // Incluye "retenida" y "devolucion_parcial" — ambas todavía retienen
    // parte del monto (monto_pendiente > 0); no se filtra por un solo estado.
    if (!cliente?.ruc) { setGarantias([]); return; }
    getGarantias({ cliente: cliente.ruc, per_page: 100 })
      .then(r => setGarantias((r.data || []).filter(g => (g.monto_pendiente ?? g.monto) > 0)))
      .catch(() => setGarantias([]));
  }, [cliente?.ruc]);

  useEffect(() => {
    if (!cliente?.ruc) { setCreditos([]); return; }
    getCreditosDisponibles(cliente.ruc).then(setCreditos).catch(() => setCreditos([]));
  }, [cliente?.ruc]);

  const handleComprobanteClick = (ventaId) => {
    setUploadingId(ventaId);
    comprobanteRef.current.value = "";
    comprobanteRef.current.click();
  };

  const handleComprobanteFile = async (e) => {
    const file = e.target.files[0];
    if (!file) { setUploadingId(null); return; }
    const ext = file.name.split(".").pop().toLowerCase();
    if (!["pdf","jpg","jpeg","png"].includes(ext)) {
      setToast({ message: "Solo se aceptan PDF, JPG y PNG", type: "error" }); setUploadingId(null); return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setToast({ message: "Archivo mayor a 10 MB", type: "error" }); setUploadingId(null); return;
    }
    const fd = new FormData();
    fd.append("file", file);
    try {
      await subirComprobante(uploadingId, fd);
      await cargar();
    } catch (err) {
      setToast({ message: err.response?.data?.detail || "Error al subir comprobante", type: "error" });
    } finally {
      setUploadingId(null);
    }
  };

  const handleEliminarComprobante = async (ventaId) => {
    try { await eliminarComprobante(ventaId); await cargar(); }
    catch { setToast({ message: "Error al eliminar comprobante", type: "error" }); }
    finally { setConfirmDelComp(null); }
  };

  // El router de /ventas exige login, así que el PDF no puede abrirse con
  // una URL directa vía window.open/href (no lleva el token) — se descarga
  // como blob vía axios (mismo patrón que imprimirComprobanteVenta en
  // PlantillaComprobante.jsx).
  const verComprobante = async (ventaId) => {
    // La pestaña se abre ANTES del await para no disparar el bloqueador de
    // pop-ups del navegador (solo permite window.open síncrono al clic).
    const ventana = window.open("", "_blank");
    try {
      const blob = await getComprobanteBlob(ventaId);
      const url = window.URL.createObjectURL(blob);
      if (ventana) ventana.location.href = url;
      else window.open(url, "_blank");
      setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch {
      if (ventana) ventana.close();
      setToast({ message: "No se pudo abrir el comprobante", type: "error" });
    }
  };

  const descargarComprobante = async (ventaId, nombreArchivo) => {
    try {
      const blob = await getComprobanteBlob(ventaId, true);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nombreArchivo || "comprobante.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      setToast({ message: "No se pudo descargar el comprobante", type: "error" });
    }
  };

  if (loading) return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Cargando ficha...</div>
    </div>
  );
  if (!cliente) return null;

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto bg-gray-50 p-6 space-y-5">

          {/* Input oculto para subir comprobante */}
          <input
            ref={comprobanteRef}
            type="file"
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png"
            onChange={handleComprobanteFile}
          />

          {/* Breadcrumb + acciones */}
          <div className="flex items-center justify-between">
            <button onClick={() => navigate("/clientes")} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors">
              <HiArrowLeft /> Volver a Clientes
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => { setEstadoCuentaModal(true); setEcError(""); }}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors shadow-sm">
                <HiDocumentReport className="text-base" /> Estado de Cuenta
              </button>
              <button onClick={() => setShowEdit(true)} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg transition-colors shadow-sm">
                <HiPencil className="text-base" /> Editar
              </button>
            </div>
          </div>

          {/* Header card */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
                  {cliente.razon_social.charAt(0)}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h1 className="text-xl font-bold text-gray-800">{cliente.razon_social}</h1>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${cliente.activo ? "bg-green-100 text-green-700" : "bg-red-100 text-red-600"}`}>
                      {cliente.activo ? "Activo" : "Inactivo"}
                    </span>
                  </div>
                  <p className="text-sm text-gray-500 mt-0.5 font-mono">RUC: {cliente.ruc}</p>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 gap-4 mt-5 pt-5 border-t border-gray-100">
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Total Vendido</p>
                <p className="text-2xl font-bold text-blue-600">{fmtMonto(cliente.total_comprado)}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-500 mb-1">Última Venta</p>
                <p className="text-lg font-semibold text-gray-700">{fmtFecha(cliente.ultima_compra)}</p>
              </div>
            </div>
          </div>

          {/* Datos generales */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Datos Generales</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { icon: HiUser, label: "Contacto", val: cliente.contacto },
                { icon: HiBriefcase, label: "Cargo", val: cliente.cargo_contacto },
                { icon: HiPhone, label: "Teléfono", val: cliente.telefono },
                { icon: HiMail, label: "Email", val: cliente.email },
                { icon: HiLocationMarker, label: "Distrito", val: cliente.distrito },
                { icon: HiLocationMarker, label: "Dirección", val: cliente.direccion },
              ].map(({ icon: Icon, label, val }) => (
                <div key={label}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className="text-gray-400 text-sm" />
                    <span className="text-xs text-gray-400 font-medium">{label}</span>
                  </div>
                  <p className="text-sm text-gray-700">{val || "—"}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Garantías */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Garantías</h3>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{garantias.length}</span>
            </div>
            {garantias.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-4">Sin garantías retenidas</p>
            ) : (
              <>
                <div className="space-y-2 mb-3">
                  {garantias.map(g => (
                    <div key={g.id} className="flex items-center justify-between bg-amber-50 rounded-xl px-4 py-2.5">
                      <div>
                        <p className="text-sm font-semibold text-amber-700">{fmtMonto(g.monto_pendiente ?? g.monto)}</p>
                        <p className="text-xs text-gray-500">{g.tipo_documento} {g.numero_documento || ""} · {fmtFecha(g.fecha_cobro)}</p>
                      </div>
                      <span className="text-xs px-2 py-1 rounded-full font-medium bg-amber-100 text-amber-700">
                        {g.estado === "devolucion_parcial" ? "Parcial" : "Retenida"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-100 text-sm">
                  <span className="text-gray-600 font-semibold">Total retenido</span>
                  <span className="font-bold text-amber-700">{fmtMonto(garantias.reduce((acc, g) => acc + (g.monto_pendiente ?? g.monto ?? 0), 0))}</span>
                </div>
              </>
            )}
          </div>

          {/* Créditos Disponibles */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Créditos Disponibles</h3>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{creditos.length}</span>
            </div>
            {creditos.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-4">Sin créditos disponibles</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="text-gray-500 uppercase">
                    <tr className="border-b border-gray-100">
                      <th className="py-2 text-left font-semibold">N° Documento</th>
                      <th className="py-2 text-left font-semibold">Origen</th>
                      <th className="py-2 text-right font-semibold">Monto Original</th>
                      <th className="py-2 text-right font-semibold">Disponible</th>
                      <th className="py-2 text-left font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {creditos.map(c => (
                      <tr key={c.id}>
                        <td className="py-2 font-mono text-gray-700 whitespace-nowrap">{c.numero_documento || "—"}</td>
                        <td className="py-2 text-gray-600 whitespace-nowrap">{c.origen === "garantia_ejecutada" ? "Garantía Ejecutada" : c.origen}</td>
                        <td className="py-2 text-right text-gray-700 whitespace-nowrap">{fmtMonto(c.monto_original)}</td>
                        <td className="py-2 text-right font-semibold text-green-700 whitespace-nowrap">{fmtMonto(c.monto_disponible)}</td>
                        <td className="py-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                            c.estado === "disponible" ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"
                          }`}>
                            {c.estado}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Información de Auditoría */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Información de Auditoría</p>
            <div className="space-y-1 text-sm text-gray-600">
              <p>👤 Creado por: <span className="font-medium text-gray-800">{cliente.creado_por || "—"}</span></p>
              <p>📅 Fecha creación: <span className="font-medium text-gray-800">{cliente.creado_en || "—"}</span></p>
              <p>📥 Método de creación: <span className="font-medium text-gray-800">{cliente.metodo_creacion || "Manual"}</span></p>
              {cliente.modificado_por && (
                <>
                  <p>👤 Modificado por: <span className="font-medium text-gray-800">{cliente.modificado_por}</span></p>
                  <p>📅 Última modificación: <span className="font-medium text-gray-800">{cliente.modificado_en}</span></p>
                </>
              )}
            </div>
          </div>

          {/* Historial de Ventas */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-700">Historial de Ventas</h3>
              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{historial.length}</span>
            </div>

            <div className="p-5">
              {historial.length === 0 ? (
                <div className="text-center py-10 text-gray-400 text-sm">Sin historial de compras</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[900px]">
                    <thead className="text-xs text-gray-500 uppercase">
                      <tr className="border-b border-gray-100">
                        <th className="pb-3 text-left font-semibold">Fecha</th>
                        <th className="pb-3 text-left font-semibold">Tipo de Servicio</th>
                        <th className="pb-3 text-left font-semibold">Descripción</th>
                        <th className="pb-3 text-left font-semibold">N° Factura</th>
                        <th className="pb-3 text-right font-semibold">Monto</th>
                        <th className="pb-3 text-left font-semibold pl-4">Comprobante</th>
                        <th className="pb-3 text-center font-semibold">Ver Sustento</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {historial.map((h, i) => (
                        <tr key={h.id} className="hover:bg-gray-50">
                          <td className="py-3 text-gray-500 whitespace-nowrap">{fmtFecha(h.fecha)}</td>
                          <td className="py-3">
                            <span className={`text-xs px-2 py-1 rounded-full font-medium ${SERV_COLOR[i % SERV_COLOR.length]}`}>
                              {h.tipo_servicio}
                            </span>
                          </td>
                          <td className="py-3 text-gray-600 max-w-[160px] truncate">{h.descripcion || "—"}</td>
                          <td className="py-3 text-gray-500 font-mono text-xs">{h.numero_factura || "—"}</td>
                          <td className="py-3 text-right font-semibold text-gray-800 whitespace-nowrap">
                            S/ {h.monto?.toLocaleString("es-PE")}
                          </td>
                          <td className="py-3 pl-4">
                            {h.tiene_comprobante ? (
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-600 truncate max-w-[100px]" title={h.comprobante_nombre}>
                                  {h.comprobante_nombre}
                                </span>
                                <button
                                  onClick={() => verComprobante(h.id)}
                                  className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                  title="Ver"
                                >
                                  <HiEye className="text-sm" />
                                </button>
                                <button
                                  onClick={() => descargarComprobante(h.id, h.comprobante_nombre)}
                                  className="p-1 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded transition-colors"
                                  title="Descargar"
                                >
                                  <HiDownload className="text-sm" />
                                </button>
                                <button
                                  onClick={() => setConfirmDelComp(h.id)}
                                  className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                  title="Eliminar"
                                >
                                  <HiTrash className="text-sm" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleComprobanteClick(h.id)}
                                disabled={uploadingId === h.id}
                                className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-600 rounded-lg transition-colors disabled:opacity-60"
                              >
                                <HiUpload className="text-xs" />
                                {uploadingId === h.id ? "Subiendo..." : "Subir comprobante"}
                              </button>
                            )}
                          </td>
                          <td className="py-3 text-center">
                            <button
                              onClick={() => setSustentoVenta(h)}
                              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors font-medium"
                            >
                              <HiDocumentText className="text-sm" />
                              Ver Sustento
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* Modal editar cliente */}
      {showEdit && (
        <FormCliente
          cliente={cliente}
          onClose={() => setShowEdit(false)}
          onSaved={() => { setShowEdit(false); cargar(); }}
        />
      )}

      {/* Modal Estado de Cuenta */}
      {estadoCuentaModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEstadoCuentaModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <HiDocumentReport className="text-blue-600 text-lg" />
                </div>
                <h2 className="text-base font-semibold text-gray-800">Estado de Cuenta</h2>
              </div>
              <button onClick={() => setEstadoCuentaModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="text-lg" />
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {ecError && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-100">
                  {ecError}
                </div>
              )}
              <div>
                <label className="text-xs font-medium text-gray-600">Período Desde</label>
                <input type="date" value={ecDesde} onChange={e => setEcDesde(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Período Hasta</label>
                <input type="date" value={ecHasta} onChange={e => setEcHasta(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-gray-100">
              <button onClick={() => setEstadoCuentaModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={handleDescargarPdf} disabled={ecGenerando}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 rounded-lg font-medium transition-colors disabled:opacity-60">
                <HiDownload className="text-sm" /> {ecGenerando ? "Generando..." : "Descargar PDF"}
              </button>
              <button onClick={handleAbrirEnvioCorreo} disabled={ecGenerando}
                className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60">
                <HiMailOpen className="text-sm" /> Enviar por correo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Enviar Estado de Cuenta por correo */}
      {envioModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setEnvioModal(false)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                  <HiMailOpen className="text-blue-600 text-lg" />
                </div>
                <h2 className="text-base font-semibold text-gray-800">Enviar Estado de Cuenta</h2>
              </div>
              <button onClick={() => setEnvioModal(false)} className="text-gray-400 hover:text-gray-600">
                <HiX className="text-lg" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
              {envioError && (
                <div className="bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg border border-red-100">
                  {envioError}
                </div>
              )}
              {envioExito && (
                <div className="bg-green-50 text-green-700 text-sm px-4 py-3 rounded-lg border border-green-100">
                  {envioExito}
                </div>
              )}
              {envioSinEmail && !envioExito && (
                <div className="bg-amber-50 text-amber-700 text-sm px-4 py-3 rounded-lg border border-amber-100">
                  Este cliente no tiene un correo registrado. Escribe uno manualmente para poder enviarlo.
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600">Para</label>
                <input type="email" value={envioPara} onChange={e => setEnvioPara(e.target.value)}
                  placeholder="cliente@ejemplo.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">CC (opcional)</label>
                <input type="text" value={envioCc} onChange={e => setEnvioCc(e.target.value)}
                  placeholder="otro@ejemplo.com"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Asunto</label>
                <input type="text" value={envioAsunto} onChange={e => setEnvioAsunto(e.target.value)}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Mensaje</label>
                <textarea value={envioMensaje} onChange={e => setEnvioMensaje(e.target.value)}
                  rows={10}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
              </div>
            </div>

            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={() => setEnvioModal(false)}
                className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={handleEnviarCorreo} disabled={envioEnviando || !envioPara.trim()}
                className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors disabled:opacity-60">
                {envioEnviando ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm eliminar comprobante */}
      {confirmDelComp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setConfirmDelComp(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                <HiExclamationCircle className="text-red-500 text-xl" />
              </div>
              <div>
                <p className="font-semibold text-gray-800">Eliminar comprobante</p>
                <p className="text-sm text-gray-500">Esta acción no se puede deshacer.</p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirmDelComp(null)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancelar</button>
              <button onClick={() => handleEliminarComprobante(confirmDelComp)} className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium">Eliminar</button>
            </div>
          </div>
        </div>
      )}

      {/* Panel lateral: documentos de sustento de una venta */}
      {sustentoVenta && (
        <SustentoModal
          clienteId={id}
          venta={sustentoVenta}
          onClose={() => setSustentoVenta(null)}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
