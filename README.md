# Centryx — ElectroPro SAC

Sistema de gestión gerencial para empresa instaladora (eléctricas, sanitarias y gas).

**Empresa:** ElectroPro SAC  
**RUC:** 20123456789  
**Sede:** Lima, Perú  
**Versión:** 1.0.0

---

## Stack Tecnológico

| Capa        | Tecnología                                      |
|-------------|--------------------------------------------------|
| Backend     | Python 3.11 · FastAPI · SQLAlchemy · Alembic    |
| Base datos  | PostgreSQL 18                                    |
| Frontend    | React 18 · Tailwind CSS · Chart.js              |
| Auth        | JWT (python-jose + passlib/bcrypt)              |

---

## Estructura del Proyecto

```
CENTRYX/
├── backend/
│   ├── app/
│   │   ├── models/models.py          # Modelos SQLAlchemy
│   │   ├── schemas/schemas.py        # Schemas Pydantic
│   │   ├── routers/
│   │   │   ├── auth.py               # POST /api/auth/login
│   │   │   └── dashboard.py          # GET /api/dashboard/*
│   │   └── services/
│   │       └── dashboard_service.py  # Lógica de negocio
│   ├── alembic/                      # Migraciones
│   ├── main.py                       # Punto de entrada FastAPI
│   ├── database.py                   # Conexión PostgreSQL
│   ├── seed_data.py                  # Datos semilla realistas
│   ├── .env                          # Variables de entorno
│   └── requirements.txt
└── frontend/
    ├── src/
    │   ├── api/dashboardApi.js       # Llamadas HTTP (axios)
    │   ├── context/AuthContext.jsx   # Estado de autenticación
    │   ├── components/
    │   │   ├── Sidebar.jsx           # Menú lateral colapsable
    │   │   ├── Header.jsx            # Encabezado con selector período
    │   │   ├── KPICard.jsx           # Tarjeta métrica con variación
    │   │   ├── TopClientes.jsx       # Ranking clientes con barras
    │   │   ├── ProyectosEjecucion.jsx# Lista proyectos con progreso
    │   │   └── IndicadoresKPI.jsx    # Fila indicadores financieros
    │   ├── charts/
    │   │   ├── VentasEvolucionChart.jsx  # Línea (mensual/semanal/diario)
    │   │   ├── FlujoCajaChart.jsx        # Barras verde/rojo proyectado
    │   │   ├── CobranzaDonutChart.jsx    # Donut semáforo cobranza
    │   │   └── GastosDonutChart.jsx      # Donut gastos por categoría
    │   ├── pages/
    │   │   ├── Login.jsx             # Pantalla de inicio de sesión
    │   │   └── Dashboard.jsx         # Página principal del dashboard
    │   ├── App.js                    # Rutas y rutas protegidas
    │   └── index.js
    ├── tailwind.config.js
    └── package.json
```

---

## Instalación y Puesta en Marcha

### Requisitos Previos

- Python 3.11+
- Node.js 18+ y npm
- PostgreSQL 18 corriendo en `localhost:5432`

---

### 1. Crear la Base de Datos

```sql
-- En psql o pgAdmin:
CREATE DATABASE gerencialpro;
```

---

### 2. Backend

```bash
cd backend

# Crear entorno virtual
python -m venv venv

# Activar (Windows)
venv\Scripts\activate

# Instalar dependencias
pip install -r requirements.txt

# Crear tablas e insertar datos seed
python seed_data.py

# Iniciar el servidor
uvicorn main:app --reload --port 8000
```

El API quedará disponible en: http://localhost:8000  
Documentación interactiva: http://localhost:8000/docs

---

### 3. Frontend

```bash
cd frontend

# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npm start
```

La aplicación quedará disponible en: http://localhost:3000

---

### 4. Migraciones con Alembic (opcional)

```bash
cd backend

# Generar migración inicial
alembic revision --autogenerate -m "initial"

# Aplicar migraciones
alembic upgrade head
```

---

## Credenciales de Acceso

| Usuario           | Email                     | Contraseña   | Rol      |
|-------------------|---------------------------|--------------|----------|
| Marco Salcedo     | marco.salcedo@electropro.pe | Marco2026* | admin    |
| Ana Flores        | gerente@electropro.pe     | gerente123   | gerente  |
| Luis Quispe       | contador@electropro.pe    | conta123     | contador |
| Rosa Mamani       | ventas@electropro.pe      | ventas123    | vendedor |

---

## Endpoints API

### Autenticación

| Método | Ruta              | Descripción         |
|--------|-------------------|---------------------|
| POST   | /api/auth/login   | Obtener JWT token   |

**Body login:**
```json
{ "email": "admin@electropro.pe", "password": "admin123" }
```

### Dashboard

| Método | Ruta                               | Descripción                        |
|--------|------------------------------------|------------------------------------|
| GET    | /api/dashboard/kpis                | 5 indicadores principales          |
| GET    | /api/dashboard/ventas-evolucion    | Serie temporal mensual/semanal/día |
| GET    | /api/dashboard/flujo-caja          | Proyección 6 meses                 |
| GET    | /api/dashboard/top-clientes        | Top 5 por ventas del año           |
| GET    | /api/dashboard/cobranza-estado     | Semáforo cuentas por cobrar        |
| GET    | /api/dashboard/gastos-categoria    | Distribución gastos del mes        |
| GET    | /api/dashboard/proyectos-ejecucion | Proyectos activos con avance       |
| GET    | /api/dashboard/indicadores-kpi     | Ratios financieros                 |

---

## Datos Seed Incluidos

### Clientes (10)
Empresas del rubro construcción e inmobiliario de Lima:
Los Portales, Cosapi, Paz Centenario, Viva GyM, Edifica, JE Construcciones,
Urbanova, Menorca Inversiones, AESA Contratistas, Grupo T&C Inmobiliaria.

### Proyectos Activos (4)
| Proyecto                                     | Presupuesto | Avance |
|----------------------------------------------|-------------|--------|
| Torre Residencial Miraflores – Eléctrica     | S/ 450,000  | 75%    |
| Centro Empresarial San Isidro – Eléctrica    | S/ 620,000  | 60%    |
| Residencial La Molina – Sanitarias           | S/ 280,000  | 45%    |
| Hospital SJL – Gas Centralizado              | S/ 380,000  | 30%    |

### Ventas Últimos 6 Meses (tendencia creciente)
Ene: S/ 95K → Feb: S/ 108K → Mar: S/ 118K → Abr: S/ 128K → May: S/ 142K → Jun: S/ 150K

### Gastos del Mes
| Categoría       | Monto     | %   |
|-----------------|-----------|-----|
| Personal        | S/ 39,600 | 44% |
| Administrativos | S/ 19,800 | 22% |
| Operativos      | S/ 18,000 | 20% |
| Ventas          | S/ 12,600 | 14% |

### Flujo de Caja Proyectado (6 meses)
Jun–Nov 2026: de S/ 165K a S/ 198K en ingresos proyectados.

---

## Variables de Entorno Backend

```env
DATABASE_URL=postgresql://postgres:admin123@localhost:5432/gerencialpro
SECRET_KEY=gerencialpro_secret_key_2024_electropro_sac_lima_peru
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=480
```

---

## Funcionalidades del Dashboard

- **Sidebar** colapsable con 12 módulos de navegación
- **Header** con saludo personalizado, selector de período y filtros
- **5 KPI cards** con variación vs. mes anterior (flechas arriba/abajo)
- **Gráfico de líneas** — Evolución de ventas (mensual / semanal / diario)
- **Gráfico de barras** — Flujo de caja proyectado (verde=ingresos, rojo=egresos)
- **Top 5 Clientes** — con barras de progreso y porcentaje
- **Donut Cobranza** — semáforo verde/amarillo/rojo
- **Donut Gastos** — distribución por categoría
- **Proyectos en ejecución** — con barra de avance físico
- **5 indicadores financieros** — rentabilidad, liquidez, rotación, cumplimiento, productividad

El frontend incluye **datos fallback** integrados, por lo que el dashboard muestra
información aun si el backend no está en línea.

---

© 2026 ElectroPro SAC · Lima, Perú
