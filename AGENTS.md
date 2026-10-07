# AGENTS.md — UrbanSafe

Lineamientos para cualquier persona o agente que trabaje en este repo.

## Qué es

UrbanSafe calcula rutas más seguras para domiciliarios en Bogotá combinando noticias, datos abiertos oficiales y reportes comunitarios, y alerta sobre incidentes durante el recorrido.

**La fuente de verdad es [`docs/spec.md`](docs/spec.md).** Si el código y el spec no coinciden, gana el spec; si el spec está mal o incompleto, se corrige el spec en el mismo cambio. El avance está en **Estado de implementación**, al inicio del spec: no reimplementar lo que figura como hecho, y actualizar esa sección en el mismo cambio.

## Stack

- **Lenguaje:** TypeScript en todo el repo (modo `strict`, ESM).
- **Monorepo:** pnpm workspaces.
- **Base de datos:** PostgreSQL + PostGIS + pgRouting en Supabase. Supabase se usa **solo como base de datos**: no se usan su Realtime, Auth, Edge Functions ni la API REST autogenerada.
- **API:** Node.js + Hono; tiempo real con Socket.IO; tareas con node-cron.
- **Web:** React + Vite + MapLibre GL JS.
- **Acceso a datos:** Kysely (SQL tipado, PostGIS con `sql\`...\``). Sin ORM.
- **Migraciones:** SQL puro (dbmate).
- **Validación:** zod (esquemas en `packages/shared`).
- **Pruebas:** Vitest; integración contra PostGIS real en Supabase.
- **Entorno de desarrollo:** API y web en local contra un proyecto de Supabase en la nube compartido por el equipo. Sin Docker.

## Comandos

Requiere Node ≥ 22 y pnpm 10 (`npm i -g pnpm@10`). Copiar `.env.example` a `.env` con la conexión del proyecto de Supabase.

| Comando | Qué hace |
|---|---|
| `pnpm install` | Instala dependencias |
| `pnpm db:migrate` | Aplica migraciones pendientes (dbmate) |
| `pnpm db:new <nombre>` | Crea una migración nueva |
| `pnpm db:seed` | Recarga los datos de prueba de `db/seeds` |
| `pnpm db:import-graph` | Reemplaza el grafo vial con las vías del casco urbano descargadas de OSM (Overpass) |
| `pnpm db:import-base-risk` | Recalcula el riesgo base por localidad con el último corte de datos abiertos (M2) |
| `pnpm dev` | API en `:3000` y web en `:5173` (la web redirige `/api` al API) |
| `pnpm typecheck` · `pnpm lint` · `pnpm test` | Verificaciones antes de un PR |
| `pnpm test:integration` | Pruebas contra PostGIS real (`TEST_DATABASE_URL`) |
| `pnpm load:routes [url]` | Prueba de carga del presupuesto de ruteo (30 usuarios) contra un API ya corriendo |
| `pnpm load:delivery [url]` | 30 sesiones de entrega a la vez: ráfaga al aceptar y recorrido hasta entregar |
| `pnpm measure:safe-route [url]` | Mide el criterio "Valor de la ruta segura" con 30 pedidos simulados |
| `pnpm ingest:news` | Una corrida de la ingesta de noticias (M1) y su resumen; necesita `GEMINI_API_KEY` y `GOOGLE_GEOCODING_API_KEY` |
| `pnpm ingest:news --dry-run` | Solo descarga y lee los feeds: cuenta ítems por feed, sin LLM, geocodificador ni base |
| `pnpm ingest:sample [n] [--out archivo]` | Exporta en Markdown los últimos n (50) artículos procesados para la revisión manual de §7 |

`db:import-graph` y `db:import-base-risk` recalculan después el riesgo de todos los tramos y compactan `road_edges` con `VACUUM FULL`.

## Estructura

```
apps/
  api/src/
    app/            # arranque: servidor, registro de rutas, scheduler, importaciones
    features/       # una carpeta por feature (ver abajo)
    shared/         # config, db, http (límite por IP), bus de eventos, realtime, logger
  web/src/
    app/            # arranque: router, providers
    pages/          # /domiciliario (M7) y /reportar (M8); solo componen features
    features/       # incidents, base-risk, reports, routing, alerts, delivery, nickname
    shared/         # mapa base, cliente HTTP, socket, UI genérica
packages/
  shared/src/       # tipos y esquemas compartidos: Incidente, catálogo, parámetros, contratos, eventos
db/
  migrations/       # SQL versionado, incluidas las funciones SQL
  seeds/            # datos de prueba
scripts/            # tareas sueltas; las importaciones viven en api/src/app
docs/spec.md
```

### Features del API y su trazabilidad con el spec

| Feature | Cubre | Estado |
|---|---|---|
| `incidents` | Modelo único (RN-01), deduplicación y fusión (RN-09) | Hecho el modelo, la persistencia y la lectura por caja con visibilidad (RN-12). RN-09 hecho para reportes y noticias: `find_matching_incident` lo usan `submit_community_report` y `submit_news_incident`, bajo el mismo advisory lock |
| `news-ingestion` | M1, F3: RSS, extracción con LLM, geocodificación | Hecho: feeds RSS cada 45 min (solo con `backgroundJobs` y las dos claves), duplicado exacto antes del LLM (`news_articles`), una lectura por historia y descarte de seguimientos sin el delito en el título, consultas de Google con `intitle:`, extractor Gemini y geocodificador Google detrás de sus interfaces, caché de geocodificación, fusión en SQL y eventos al bus. Una vía larga se guarda como corredor de OSM; una localidad no se fusiona con otra noticia de la misma localidad. Falta la revisión manual de §7 |
| `open-data` | M2: `RiesgoBaseZona` por localidad | Hecho: importación del dataset oficial, cálculo normalizado en SQL, lectura para el mapa y revisión cada 30 días con los trabajos de fondo |
| `reports` | M3, F4, RN-02, RN-04, RN-12: reportes, confirmar/negar, reputación, límite, visibilidad | Hecho: envío con límite por dispositivo (RN-04) y por IP, solo dentro del casco urbano, deduplicación e idempotencia, confirmar/negar con voto único, reputación, visibilidad (RN-12) y emisión en tiempo real. RN-02 queda como lo permite el MVP (punto elegido en el mapa) |
| `risk` | M4, RN-05, RN-06, RN-10, RN-11: puntaje de riesgo por tramo y multiplicador horario | Hecho: riesgo precalculado por tramo y franja, recálculo incremental por eventos del bus (un lote corriendo y uno en espera, como máximo), completo cada hora (decaimiento) y multiplicador diario. Corre solo si el servidor arranca con `backgroundJobs` |
| `routing` | M5, RN-07: 3 rutas (rápida, balanceada, segura) | Hecho: 3 rutas con nivel de riesgo e incidentes cercanos, cola acotada (503 al llenarse), caché corta por par de vértices (se invalida al recalcular el riesgo) y límite por IP; cumple el presupuesto en carga sostenida |
| `alerts` | M6, RN-08: alertas sobre la ruta activa | Hecho: al elegir ruta se cargan los candidatos una vez; cada posición mira solo esa lista. Un incidente nuevo se compara con las rutas en camino. El aviso va a la sala privada y recalcular es un comando del domiciliario |
| `delivery` | M7: pedidos simulados, fuente de posición, resumen, app del domiciliario | Hecho servidor, web y pruebas: 30 sesiones entregan a la vez (la ráfaga al aceptar no cumple 1,5 s) y el criterio "Valor de la ruta segura" está medido y hoy no se cumple |

## Reglas de arquitectura (feature-based)

1. **Todo lo de una feature vive en su carpeta.** Rutas, lógica, acceso a datos, componentes y hooks. No hay carpetas globales de `controllers/`, `services/` o `components/`.
2. **Cada feature expone un `index.ts` público.** Otras features importan solo desde ahí, nunca archivos internos.
3. **`shared/` no importa de `features/`.** La dependencia va en una sola dirección.
4. **En la web, `pages/` solo compone features.** Sin lógica de negocio en las páginas.
5. **Las cadenas entre features van por el bus de eventos** (`shared/events`), no con llamadas directas. Ejemplo: `incident.created` → `risk` recalcula → `alerts` evalúa rutas activas (F2.4, F3.5).
6. **Los tipos compartidos se definen una sola vez** en `packages/shared`. No se redefine `Incidente` ni los contratos en `api` o `web`.
7. **Interfaces (puertos y adaptadores) solo donde el spec pide intercambiar:**
   - extractor LLM (`news-ingestion/extractor`)
   - geocodificador (`news-ingestion/geocoder`)
   - fuente de posición (`delivery/position`: ruta simulada hoy, GPS real después)

   No se agregan abstracciones para lo demás.
8. Las reglas de importación se hacen cumplir con ESLint (`eslint-plugin-boundaries`).

### Estructura interna sugerida de una feature

```
features/<nombre>/
  index.ts                  # API pública
  <nombre>.routes.ts        # endpoints Hono (api)
  <nombre>.service.ts       # lógica de negocio
  <nombre>.repository.ts    # consultas Kysely/SQL
  <nombre>.test.ts
  components/ hooks/ api.ts # (web)
```

Solo se crean los archivos que la feature necesita.

## Reglas de negocio no negociables

- **RN-01:** toda fuente de hechos individuales (noticias, comunidad) se normaliza a `Incidente` antes de usarse. Los datos abiertos son la única excepción y se guardan como `RiesgoBaseZona`.
- **RN-03, privacidad:**
  - La posición y la ruta de un domiciliario solo se emiten a **su propia sala** de Socket.IO (`delivery:<sesión>`). Un socket entra con `delivery.join` y el id de la sesión, que funciona como credencial. En la web el id vive en `sessionStorage` de la pestaña, no en `localStorage`.
  - Los incidentes van a una sala pública.
  - Nunca hacer broadcast de posiciones ni exponer rutas en endpoints públicos.
  - La web `/reportar` jamás recibe datos de domiciliarios.
- **RN-08:** el sistema sugiere reruteo; nunca recalcula la ruta activa automáticamente.
- **La simulación de posición corre en el servidor.** El frontend solo dibuja y envía comandos (aceptar, elegir ruta, velocidad). Así las alertas no cambian cuando llegue el GPS real.
- **Los parámetros** (τ, α, radios, ventanas, confianzas, límites) viven en `packages/shared` y reflejan la tabla "Parámetros iniciales" del spec. No se escriben números mágicos en el código.

## Base de datos

- El cómputo geoespacial y de riesgo vive en PostGIS:
  - RN-06, RN-07, RN-10 y RN-11 como funciones SQL, creadas en migraciones (`refresh_edge_risk`, `refresh_time_multipliers`, `route_between`).
  - El riesgo por tramo se **precalcula** en una columna y se actualiza con incidentes nuevos; pgRouting no calcula el riesgo dentro del Dijkstra.
- Para ruteo, recortar el grafo a una caja alrededor de origen y destino.
- Coordenadas en SRID 4326; distancias con `geography` o en una proyección métrica.
- Índices GiST en toda columna geométrica.
- Toda modificación de esquema es una migración nueva. No se editan migraciones ya aplicadas.

### Supabase
- **Extensiones en el schema `extensions`** (convención de Supabase): `create extension ... with schema extensions`.
- **RLS activado en toda tabla nueva, sin políticas.** Supabase expone el schema `public` por su API REST con la clave anónima; sin RLS, cualquiera podría leer o escribir las tablas saltándose el API (y RN-03). El API se conecta con un rol que no está sujeto a RLS.
- **Funciones SQL: revocar `EXECUTE` a `public`, `anon` y `authenticated`** en la misma migración que las crea. Supabase les da permiso por defecto y las expone en `/rest/v1/rpc`.
- **Conexión del API por el pooler en modo sesión** (puerto 5432 del host `pooler.supabase.com`). El modo transacción (6543) no conserva ajustes de sesión como `statement_timeout`, y la conexión directa solo funciona por IPv6.
- **Un solo proyecto de desarrollo compartido.** Las migraciones se aplican una vez, por quien las crea, al integrarse. Nadie edita el esquema desde el dashboard.
- **Los seeds marcan sus filas** para poder borrarlas sin tocar datos reales (ver `db/seeds`).
- Las claves de Supabase (`service_role`, contraseña de la base) solo viven en `.env`, nunca en la web.

## Concurrencia y rendimiento

La demo debe soportar **~30 usuarios concurrentes**: domiciliarios simulando entregas y reporteros enviando incidentes al mismo tiempo. Toda feature se diseña pensando en esa carga desde el inicio.

Supuesto del MVP: **una sola instancia del API**. Por eso el estado en memoria (sesiones de entrega, rutas activas) es válido. Ese estado se encapsula en la feature dueña, para que escalar horizontalmente después (Redis + adaptador de Socket.IO) no obligue a reescribir.

### Presupuestos de rendimiento

| Operación | Objetivo (p95, 30 usuarios) |
|---|---|
| 3 opciones de ruta (M5) | < 1,5 s |
| Recalcular ruta desde una alerta | < 1 s |
| Reporte comunitario visible en todos los mapas (F2.3) | < 1 s |
| Alerta tras un incidente nuevo sobre una ruta activa (M6) | < 2 s |
| Endpoints de lectura (incidentes por zona, etc.) | < 200 ms |

Si una feature no cumple su presupuesto, no se da por terminada.

### Base de datos
- **Dos pools de conexiones, de tamaño fijo, creados en `app/`.** El general (`DB_POOL_SIZE`) y uno de ruteo con una conexión por cálculo simultáneo (`ROUTING_CONCURRENCY`). Ninguna feature abre conexiones propias. La suma tiene que caber en el límite de clientes del pooler de Supabase.
- **`statement_timeout`** en todas las consultas. El pool de ruteo trae el suyo en la sesión: fijarlo por pedido costaba dos viajes más a la base, unos 280 ms desde Bogotá.
- **Índices en todo filtro.** Índice GiST en geometrías e índice en `ocurrido_en`. Toda consulta espacial nueva se revisa con `EXPLAIN ANALYZE` antes de integrarse.
- **Nada de N+1.** Se resuelve con una consulta o en lote; los inserts masivos (ingesta) van en lote.
- **Transacciones cortas**, sin llamadas de red (LLM, geocodificador) dentro de ellas.
- **Actualizaciones atómicas en SQL**, nunca leer, modificar y escribir desde Node. Ejemplo: `UPDATE ... SET confianza = LEAST(1, confianza + 0.15)`.

### Ruteo (M5)
- El grafo se **recorta** a una caja alrededor de origen y destino, y el riesgo por tramo está **precalculado**.
- Las 3 rutas se calculan **en serie dentro de una sola consulta**. El Dijkstra es pura CPU de la base: en paralelo se estorban y tardaban 2,3 s en vez de 0,7 s.
- **Límite de concurrencia** para el ruteo (`p-limit`), para que 30 pedidos simultáneos no saturen la base. Las solicitudes que excedan el límite esperan en cola, hasta `ROUTING_MAX_QUEUE` en espera. Más allá, `RoutingBusyError` y 503 con `Retry-After`: quien llama decide si reintenta (`delivery` reintenta solo el segundo tramo).
- **Caché corta** de resultados por (nodo origen, nodo destino, franja, versión del riesgo). Se invalida cuando `risk` termina un recálculo.
- Tras reescribir el riesgo de toda la ciudad, compactar `road_edges` (`VACUUM FULL`): la tabla duplica su tamaño y las rutas en frío se vuelven lentas.

### Modelo de riesgo (M4)
- **Recálculo incremental:** solo los tramos cercanos al incidente nuevo, nunca toda la ciudad.
- **Agrupar ráfagas.** Una corrida de ingesta que inserta muchos incidentes dispara un solo recálculo, con debounce o cola. Mientras corre un lote, lo nuevo se acumula en el siguiente: nunca se encolan lotes sin límite.
- **Nunca dos recálculos a la vez sobre lo mismo.** Se garantiza con una cola de un solo consumidor o un advisory lock de Postgres. `risk` usa los dos.
- **Las pruebas no arrancan los trabajos de fondo** (`backgroundJobs: false`): recalcularían el riesgo de toda la ciudad en la base compartida.

### Alertas y simulación (M6, M7)
- **Un único ticker global** avanza todas las sesiones de entrega. Prohibido un `setInterval` por usuario.
- **Candidatos precalculados.** Al elegir una ruta se calcula una vez qué incidentes están cerca (300 m, ventana de alertas de M6). En cada tick se evalúan solo esos candidatos en memoria, sin consultar la base.
- **Incidente nuevo:** se compara una vez contra las rutas activas (son ~30) y se agrega a los candidatos de las rutas afectadas.
- **Posiciones a frecuencia limitada** (~1 Hz por sesión) y solo a la sala del domiciliario (RN-03).

### Reportes y condiciones de carrera (M3, RN-04, RN-09)
- **Votos únicos:** restricción `UNIQUE (usuario, incidente)` en confirmaciones y negaciones. El mismo voto enviado dos veces no cuenta doble.
- **Límite de reportes atómico.** La verificación y el registro ocurren en la misma operación, sin chequear y luego insertar.
- **Deduplicación y fusión dentro de una transacción.** Los candidatos se bloquean con `SELECT ... FOR UPDATE` (o con un advisory lock por celda geográfica) para que dos reportes simultáneos del mismo hecho no creen dos incidentes.
- **Endpoints idempotentes** donde haya reintentos del cliente (ID de cliente en el reporte).

### Límite por IP
- **Todo endpoint que escribe o que cuesta CPU de la base lleva límite por IP** (`shared/http`, registrado en `app/create-app.ts`). Los límites viven en `params.ipRateLimit`. Es en memoria, válido con una sola instancia.
- **La IP sale del socket.** `X-Forwarded-For` solo se lee con `TRUST_PROXY=true`, y se toma la última entrada (la del proxy propio); la primera la controla el cliente. El proxy de Vite manda `X-Forwarded-For`.

### Tiempo real (Socket.IO)
- **Estado inicial por HTTP y cambios por socket.** El mapa carga los incidentes de su zona por HTTP; el socket envía solo deltas (`incident.created`, `incident.updated`), nunca el mapa completo.
- **Payloads mínimos:** IDs, coordenadas y campos que la UI usa.
- **Salas siempre:** una por domiciliario y una pública de incidentes. Nada de `io.emit` global con datos privados.

### Ingesta (M1, M2)
- **Siempre fuera del camino de las peticiones de usuario.** Corre en el scheduler.
- **Nunca dos corridas solapadas**, con un lock.
- **Deduplicar por URL antes de llamar al LLM**, para ahorrar llamadas y latencia.
- **Concurrencia limitada** hacia el LLM y el geocodificador, con timeouts y reintentos con backoff.
- **Caché de geocodificación** por texto de ubicación normalizado.

### Frontend
- **Las posiciones animadas no pasan por estado de React** en cada tick. Se actualiza la fuente de MapLibre (`setData`) o se usan refs.
- **Incidentes agrupados** (clustering de MapLibre) cuando hay muchos en pantalla.
- **Una sola conexión de socket por pestaña**, compartida entre features vía `shared/socket`.

### Verificación
- **Prueba de carga antes de la demo** que simule 30 domiciliarios simultáneos (pedido, 3 rutas, recorrido) más reporteros enviando incidentes. Se usa k6 o autocannon, y el script vive en `scripts/`.
- **Tiempos visibles:** registrar la duración de consultas de ruteo y riesgo en el log, y habilitar `pg_stat_statements` para detectar consultas lentas.
- **Sin optimización prematura:** se optimiza lo que mide lento contra los presupuestos de arriba. Las reglas de esta sección no son negociables; lo demás se decide con datos.

## Integraciones externas

- **Noticias:** solo RSS, sin scraping de HTML (M1). Las fuentes y consultas están en el spec.
- **LLM:** salida estructurada validada con zod; el proveedor se elige por variable de entorno.
- **Geocodificación:** Google Geocoding API detrás de su interfaz. Revisar sus términos sobre almacenamiento de coordenadas antes de persistirlas a largo plazo.
- **Secretos:** solo en variables de entorno (`.env`, nunca versionado). Mantener `.env.example` actualizado.

## Convenciones de código

- Identificadores, archivos y carpetas en **inglés**. Comentarios, documentación y textos de UI en **español**.
- Archivos en `kebab-case`; componentes React en `PascalCase.tsx`.
- Validar toda entrada externa (HTTP, sockets, RSS, LLM) con zod en el borde.
- Referenciar el spec en TODOs y comentarios relevantes: `// TODO(M6): ...`, `// RN-09`.
- Comentar el *por qué*, no el *qué*.

## Pruebas

- Unitarias junto al código (`*.test.ts`) para reglas puras: peso de incidentes, deduplicación, ajustes de confianza, límite de reportes.
- Integración contra PostGIS + pgRouting real para el ruteo y las consultas espaciales, en archivos `*.int.test.ts`. No simular PostGIS.
  - Se corren contra la base apuntada por `TEST_DATABASE_URL` (puede ser el proyecto de desarrollo).
  - Cada prueba corre dentro de una transacción que se revierte al final, para no dejar datos en la base compartida.
  - Las pruebas de concurrencia, que necesitan varias conexiones, usan datos con un marcador propio y los borran al terminar.
- Cada regla de negocio (RN-xx) implementada debe tener al menos una prueba.
- Las operaciones con riesgo de carrera (votos, fusión de incidentes, límite de reportes) tienen una prueba de concurrencia: varias peticiones simultáneas producen el resultado correcto.

## Flujo de trabajo

- Ramas cortas desde `main`; commits pequeños con el formato `tipo: descripción` (`feat`, `fix`, `chore`, `docs`, `refactor`, `test`).
- PRs que referencien el módulo o la regla (`M5`, `RN-04`) que implementan.
- Antes de abrir un PR: typecheck, lint y pruebas en verde.

## Agregar una feature nueva

1. Confirmar que está en el spec (o actualizar el spec primero).
2. Crear `features/<nombre>/` con su `index.ts`.
3. Definir tipos y contratos nuevos en `packages/shared`.
4. Si necesita esquema, crear una migración en `db/migrations`.
5. Registrar rutas en `app/` y suscribirse a eventos del bus si reacciona a otras features.
6. Revisar la sección "Concurrencia y rendimiento":
   - qué pasa con 30 usuarios a la vez,
   - qué condiciones de carrera existen,
   - qué presupuesto de tiempo le aplica.
7. Agregar pruebas y actualizar la tabla de trazabilidad de este archivo.

