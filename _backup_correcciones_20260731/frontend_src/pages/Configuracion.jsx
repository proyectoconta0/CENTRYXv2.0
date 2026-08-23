import React, { useState } from "react";
import Sidebar from "../components/Sidebar";
import Header from "../components/Header";
import EmpresaTab from "../components/configuracion/EmpresaTab";
import RubroTab from "../components/configuracion/RubroTab";
import UsuariosTab from "../components/configuracion/UsuariosTab";
import DocumentosTab from "../components/configuracion/DocumentosTab";
import AlertasTab from "../components/configuracion/AlertasTab";
import SistemaTab from "../components/configuracion/SistemaTab";

const TABS = [
  { key: "empresa",    label: "Empresa" },
  { key: "rubro",      label: "Rubro" },
  { key: "usuarios",   label: "Usuarios" },
  { key: "documentos", label: "Documentos" },
  { key: "alertas",    label: "Alertas" },
  { key: "sistema",    label: "Sistema" },
];

export default function Configuracion() {
  const [tab, setTab] = useState("empresa");

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title="Configuración" />
        <main className="flex-1 overflow-y-auto p-6">

          <div className="mb-6">
            <h1 className="text-2xl font-bold text-gray-800">Configuración</h1>
            <p className="text-sm text-gray-500 mt-0.5">Empresa, rubro, usuarios, documentos y alertas del sistema</p>
          </div>

          <div className="flex gap-1 bg-white rounded-lg border border-gray-200 p-1 w-fit mb-6 flex-wrap">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-all ${
                  tab === t.key ? "bg-blue-600 text-white shadow-sm" : "text-gray-600 hover:text-gray-800"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "empresa" && <EmpresaTab />}
          {tab === "rubro" && <RubroTab />}
          {tab === "usuarios" && <UsuariosTab />}
          {tab === "documentos" && <DocumentosTab />}
          {tab === "alertas" && <AlertasTab />}
          {tab === "sistema" && <SistemaTab />}

        </main>
      </div>
    </div>
  );
}
