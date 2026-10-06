# UrbanSafe — Especificación del MVP

## Estado de implementación

Actualizar esta sección en el mismo cambio que implemente algo del spec. Lo que no aparece aquí sigue pendiente.

### Hecho

- **Cimiento del repo.** Monorepo pnpm (`apps/api`, `apps/web`, `packages/shared`), TypeScript strict, ESLint con las reglas de arquitectura y Vitest. Proyecto de Supabase `UrbanSafe` (São Paulo); las migraciones se aplican con dbmate.
- **Modelo `Incidente` (sección 4, RN-01).** Esquema zod, catálogo de delitos y parámetros iniciales en `packages/shared`. Tablas `incidents` e `incident_sources` con geometría en SRID 4326, índice GiST y RLS activado sin políticas. Los datos de prueba están en `db/seeds` y usan el prefijo de id `00000000-0000-4000-8000-`.
- **Mapa de incidentes (M8, solo la lectura; RN-12).** `GET /api/incidents?bbox=` devuelve los incidentes de los últimos 7 días con confianza de al menos 0,1 dentro de la caja visible, sin el campo `sources`. `/reportar` los dibuja en MapLibre, agrupados, y vuelve a pedirlos al mover el mapa.
- **Reportes comunitarios, parte 1 (M3: apodo, reportar y tiempo real; RN-04; RN-09 para reportes de la comunidad).**
  - **Identidad.** El apodo y un `deviceId` se guardan en `localStorage`.
  - **Envío.** Se reporta tocando el mapa y eligiendo el tipo. `POST /api/reports` es idempotente por `clientId`.
  - **Una sola transacción.** Todo ocurre en la función SQL `submit_community_report`: límite de 5 por hora, deduplicación por tipo compatible, a ≤ 500 m y ≤ 24 h, y confirmación +0,15 si el reporte cae en un incidente de otro.
  - **Concurrencia.** Se serializa con un advisory lock global, no por celda; para el volumen del MVP alcanza.
  - **Tiempo real.** Los mapas conectados reciben `incident.created` e `incident.updated` por Socket.IO, en la sala pública `incidents`.
- **Reportes comunitarios, parte 2 (M3, F4; RN-04; RN-12).**
  - **"¿Sigue ahí?".** En el popup de un incidente visible, "Sí" confirma (+0,15) y "No" niega (−0,2), con piso 0 y tope 1. Va por `POST /api/reports/votes`.
  - **Voto único.** Un voto por dispositivo e incidente, garantizado por la llave primaria de `incident_votes`. Repetir el mismo voto es un reintento; cambiarlo no cuenta. Nadie vota su propio reporte, y quien ya votó no vuelve a contar reportándolo.
  - **Reputación.** `reporters.vote_balance` suma las confirmaciones y resta las negaciones que reciben sus incidentes, por voto o por reporte. La confianza inicial de sus siguientes reportes sube 0,02 por punto, hasta 0,5.
  - **Visibilidad (RN-12).** Cada voto emite `incident.updated`. El mapa oculta lo que cae bajo 0,1 y lo vuelve a mostrar si sube; votar un incidente oculto responde 404.
  - **Concurrencia.** Votos y reportes comparten el mismo advisory lock.
- **RN-02 en el MVP.** Se reporta eligiendo un punto en el mapa, como permite el spec mientras no haya GPS real.
- **Ruteo, parte 1 (M5: grafo y ruta más rápida).**
  - **Grafo.** `pnpm db:import-graph` descarga las vías del casco urbano desde Overpass y reemplaza `road_vertices` y `road_edges` en una sola transacción. Quedan unos 115 000 vértices y 152 000 tramos (9 900 km, 54 MB).
  - **Ruta.** `POST /api/routes` busca la ruta más rápida con `pgr_dijkstra` sobre el grafo recortado alrededor del origen y el destino. Si no encuentra camino, reintenta con un margen mayor.
  - **Límites.** Corre con su propio `statement_timeout` y con 4 cálculos simultáneos como máximo.
  - **Tiempos medidos.** En la base, entre 80 y 280 ms por ruta; desde local, de 0,6 a 0,9 s en total, dominado por los viajes de ida y vuelta a São Paulo.
  - **Vista.** `/domiciliario` permite tocar el origen y el destino, dibuja la ruta y muestra la distancia y el tiempo.
- **Riesgo base por localidad (M2, `RiesgoBaseZona`).**
  - **Importación.** `pnpm db:import-base-risk` descarga Delito de Alto Impacto por localidad y reemplaza `locality_base_risk` en una transacción. El área y la normalización se calculan en SQL.
  - **Periodo.** Hoy usa enero a agosto de 2026 y quedan 20 localidades.
  - **Lectura.** `GET /api/base-risk` devuelve las geometrías simplificadas (unos 50 KB) con una hora de caché.
  - **Mapa.** `/reportar` pinta cada localidad según su riesgo, debajo de las etiquetas, con una leyenda.
  - **Limitación.** En Chapinero, Santa Fe, Usaquén y las localidades del sur, el área incluye cerros y zona rural, así que su tasa queda más baja que la del casco urbano.
- **Modelo de riesgo (M4; RN-06, RN-10, RN-11, RN-12).**
  - **Precalculado.** `road_edges.risk` guarda `riesgo(tramo, franja)` para las 4 franjas; las funciones SQL `refresh_edge_risk` y `refresh_time_multipliers` lo calculan. Las franjas se cuentan en hora de Bogotá.
  - **Horizonte.** El riesgo reciente usa los incidentes visibles de la misma ventana de 7 días del mapa.
  - **Localidad del tramo.** Se asigna por su punto medio al importar el grafo o el riesgo base. Unos 19 500 tramos caen en municipios vecinos (Soacha, Mosquera, Chía…): no tienen localidad, así que su riesgo base es 0 y su multiplicador es 1.
  - **Recálculo incremental.** Se recalcula al crearse o cambiar un incidente, por eventos del bus, agrupados en 300 ms y solo sobre los tramos a menos de R. Tarda unos 165 ms.
  - **Recálculo completo.** Cada hora se recalcula todo para que el decaimiento avance (unos 4 s, escribiendo solo los tramos que cambian). Cada día se recalcula el multiplicador horario.
  - **Concurrencia.** Los recálculos van en una cola en el proceso y con un advisory lock en la base.
  - **Compactación.** Tras importar, `VACUUM FULL` de `road_edges`: reescribir el riesgo de toda la ciudad duplica la tabla y una ruta en frío pasaba de 3 s.
- **Ruteo, parte 2 (M5: las 3 rutas; RN-07).**
  - **Cálculo.** `POST /api/routes` devuelve rápida, balanceada y segura con α = 0, 1 y 5 sobre el riesgo de la franja actual. Las tres van en serie dentro de una sola consulta: en paralelo se estorban en la CPU de la base y tardaban 2,3 s en vez de 0,7 s.
  - **Nivel e incidentes.** Cada opción trae su nivel de riesgo (promedio ponderado por longitud, que con velocidad fija equivale a ponderar por tiempo) y los incidentes visibles de los últimos 7 días a menos de R de la ruta.
  - **Pool propio.** El ruteo usa su propio pool, con el `statement_timeout` puesto en la sesión, así que cada pedido hace un solo viaje a la base.
  - **Vista.** `/domiciliario` muestra las 3 opciones como tarjetas con tiempo, tiempo extra frente a la más rápida, nivel de riesgo e incidentes cercanos. La elegida se pinta en azul y las demás en gris; también se elige tocando la línea.
  - **Carga medida (`pnpm load:routes`, desde local contra São Paulo).**
    - **Sostenida.** 30 usuarios pidiendo cada 5 a 15 s durante 60 s, con trayectos de 2 a 8 km: p50 474 ms y p95 1 380 ms. **Cumple** el presupuesto de 1,5 s.
    - **Ráfaga.** Los 30 pedidos a la vez dan p95 3,5 s. El límite es la CPU de la base, no la cola del API: subir la concurrencia a 8 casi no cambia el resultado.

- **Simulador de pedidos, parte 1 (M7 en el servidor; F1 pasos 1 a 4, 6 y 7; RN-03).**
  - **Pedido.** `POST /api/delivery/sessions` crea una sesión con un pedido al azar: recogida y entrega ajustadas al vértice del grafo más cercano. Si un punto queda a más de 200 m de una calle, se descarta. El primer pedido también sortea dónde arranca el domiciliario; los siguientes salen de donde terminó.
  - **Tramos.** Aceptar calcula las 3 rutas del tramo hacia la recogida. Al llegar se calculan las del tramo hacia la entrega, con el riesgo de la hora en que empieza cada tramo. El cliente elige por tipo de ruta; nunca manda geometría.
  - **Movimiento.** Un único ticker a 1 Hz avanza todas las sesiones sobre la ruta elegida, a la velocidad promedio por el multiplicador.
  - **Fuente de posición.** La posición sale de una interfaz `PositionSource`; hoy la implementa la ruta simulada.
  - **Resumen.** Tiempo extra, exposición evitada e incidentes evitados frente a la ruta más rápida de cada tramo.
  - **Privacidad (RN-03).** Estado y posición viajan solo a la sala privada de la sesión. Un socket entra a esa sala con `delivery.join` y el id de la sesión, que solo conoce la pestaña que la creó.
  - **Concurrencia.** Los comandos de una sesión van en cola: aceptar dos veces calcula las rutas una sola vez y elegir la misma ruta dos veces es un reintento. Las sesiones viven en memoria y se descartan tras 2 h sin comandos.
  - **Tiempos medidos.** Crear un pedido tarda unos 0,2 s y aceptarlo, entre 0,2 y 0,4 s, ya con la conexión caliente.
- **Endurecimiento del API (M3, M4, M5, M7).**
  - **Límite por IP.** Reportes, votos, `POST /api/routes` y los pedidos simulados (crear, aceptar, siguiente) tienen un límite por IP en ventana fija, además del límite por dispositivo de RN-04. Al pasarse responden 429 con `Retry-After`. La IP sale del socket; `X-Forwarded-For` solo se usa con `TRUST_PROXY=true`, y entonces se toma la última entrada, la que puso el proxy propio.
  - **Holgura.** Los límites son amplios porque en la demo unos 30 usuarios pueden compartir la IP de una misma red. `pnpm load:routes` hace unos 190 pedidos desde una sola IP: correrlo dos veces en 10 minutos topa el límite, salvo que se reinicie el API.
  - **Reportes en el casco urbano.** El contrato rechaza reportes fuera del casco urbano, igual que las rutas. La web avisa en vez de abrir el reporte.
  - **Cola del ruteo acotada.** Con `ROUTING_MAX_QUEUE` pedidos esperando, el siguiente responde 503 con `Retry-After` en vez de esperar sin fin. Aceptar un pedido en ese caso lo deja ofrecido y responde 503. El segundo tramo se reintenta solo cada 2 s, hasta 5 veces. La ráfaga de 30 de `pnpm load:routes` cabe en la cola de 30 y no recibe 503.
  - **Límite de sesiones.** Con 500 sesiones en memoria, crear otra descarta la más inactiva que no esté en camino; si todas están en camino, responde 503.
  - **Recálculo de riesgo sin acumulación.** A lo sumo corre un lote incremental y espera otro: lo que llega durante la corrida se suma al lote que espera.
  - **SQL de `route_between`.** La función arma su consulta con literales escapados (`%L`) en vez de interpolar texto (`%s`).

### Siguiente

- **Simulador de pedidos, parte 2 (M7 en la web).** El flujo del pedido en `/domiciliario`, la prueba de carga con 30 sesiones y la medición del criterio "Valor de la ruta segura".

- **Revisión mensual del riesgo base (M2).** Por ahora la importación se corre a mano; falta programarla.
- **Caché de rutas.** Cachear por (origen, destino, versión del riesgo), como dice AGENTS. Ayudaría sobre todo en ráfagas.
- **Verificar el certificado de Supabase.** Hoy la conexión a la base va cifrada pero sin validar la CA. Falta agregar el certificado del proyecto y conectar con `verify-full`.

## 1. Visión

**Problema.** Los domiciliarios en Bogotá eligen sus rutas sin información de seguridad. La información que existe está dispersa (medios de noticias, grupos de WhatsApp), llega tarde y nadie la verifica.

**Propuesta.** Cuando un domiciliario toma un pedido, UrbanSafe calcula rutas hacia el destino que evitan zonas peligrosas, combinando noticias, datos abiertos oficiales y reportes de otros domiciliarios. Durante el recorrido, alerta al domiciliario sobre incidentes recientes en su camino.

## 2. Actores

| Actor | Descripción |
|---|---|
| **Domiciliario** | Toma un pedido, elige una ruta, recibe alertas y puede reportar incidentes. En el MVP se desplaza en moto. |
| **Reportero comunitario** | Cualquier usuario que envía, confirma o niega reportes de incidentes desde una web móvil. |
| **Sistema de ingesta** | Recolecta periódicamente incidentes desde noticias y datos abiertos. |
| **Simulador de pedidos** | Reemplaza a las plataformas de domicilios: genera pedidos con punto de recogida y de entrega en Bogotá. |

## 3. Módulos

### M1 — Ingesta de noticias
- Consultar cada 30–60 minutos feeds RSS sobre delitos en Bogotá (sin scraping de HTML):

  | Fuente | Feed | Contenido |
  |---|---|---|
  | Google News RSS (principal) | `https://news.google.com/rss/search?q=<consulta>&hl=es-419&gl=CO&ceid=CO:es-419`, con las consultas definidas abajo | Título y fragmento; agrega medios sin RSS propio funcional (Caracol, RCN, El Espectador, Infobae) |
  | El Tiempo — Bogotá | `https://www.eltiempo.com/rss/bogota.xml` | Resumen |
  | Publimetro | `https://www.publimetro.co/arc/outboundfeeds/rss/` | Resumen y texto parcial |
  | Semana | `https://www.semana.com/arc/outboundfeeds/rss/` | Resumen |
  | KienyKe | `https://www.kienyke.com/feed` | Texto completo |

- Consultas iniciales de Google News (se ajustan según los resultados reales):

  | Consulta | Cubre |
  |---|---|
  | `hurto Bogotá` | Hurto a persona (amplia) |
  | `robo celular Bogotá` | Hurto a persona |
  | `robo de moto Bogotá` | Hurto de moto |
  | `robo de bicicleta Bogotá` | Hurto de bicicleta |
  | `atraco Bogotá` | Atraco con arma |
  | `riña Bogotá` | Riña, lesiones personales |
  | `homicidio OR sicariato Bogotá` | Homicidio / sicariato |
  | `domiciliario robo OR atraco Bogotá` | Hechos contra domiciliarios |

  Usar el operador `when:1d` para limitar a noticias del último día, previa verificación de que el RSS lo respeta.

- Extraer de cada artículo: tipo de delito, texto de ubicación, fecha/hora y relevancia (LLM con salida estructurada), a partir del título y el resumen disponibles en el feed. Si el artículo no indica la hora del hecho, se registra solo la fecha (ver RN-11).
- Geocodificar el texto de ubicación a coordenadas. Si solo se identifica el barrio o la localidad, registrar el incidente como área del nivel correspondiente, con confianza reducida (ver Parámetros iniciales).
- Descartar artículos irrelevantes, fuera de Bogotá o sin ubicación identificable.
- Los enlaces de Google News vienen codificados (`news.google.com/rss/articles/...`). Se intenta decodificarlos para obtener la URL original del medio; si la decodificación falla, el artículo se conserva con el enlace de Google News y la deduplicación exacta usa el título normalizado más el nombre del medio (RN-09).
- Deduplicar obligatoriamente según RN-09: Google News repite noticias de los feeds directos y varios medios publican el mismo hecho.
- Guardar el resultado como `Incidente` con fuente `noticias`.

### M2 — Datos abiertos oficiales
- Fuente: **Delito de Alto Impacto Bogotá D.C.**, de la Secretaría Distrital de Seguridad, Convivencia y Justicia (https://datosabiertos.bogota.gov.co/dataset/delito-de-alto-impacto-bogota-d-c), en GeoJSON.
- Granularidad: por localidad, con un total por año desde 2018; el año en curso trae solo los meses publicados (por ejemplo, enero a agosto). No incluye hora del día ni coordenadas exactas. Se descarga del servicio oficial de la Secretaría (Esri REST), cuya URL no cambia con cada publicación.
- Uso: riesgo base por localidad (qué zonas son históricamente más peligrosas). No aporta patrón horario ni alertas.
- Se usan solo las categorías de delitos que ocurren en vía pública: homicidios, lesiones personales y hurto a personas, de automotores, de motocicletas, de bicicletas y de celulares. Quedan fuera el hurto a residencias y a comercio, los delitos sexuales y la violencia intrafamiliar.
- Como son conteos agregados y no hechos individuales, no se convierten en `Incidente`: se guardan como `RiesgoBaseZona` (sección 4; excepción explícita a RN-01).
- Cálculo del riesgo base: delitos del periodo más reciente publicado (el año en curso, hasta el mes de corte) divididos por el área de la localidad (delitos/km²), normalizados por la localidad con la tasa más alta, de modo que queda en 0–1. Como se normaliza, no importa que el periodo tenga menos de 12 meses.
- La zona "Sin Localización" del dataset no tiene geometría y se descarta.
- Importación inicial y revisión mensual de actualizaciones.
- **Limitación conocida:** ninguna fuente oficial disponible ofrece hora ni coordenadas exactas; la precisión espacial y el patrón horario dependen de las noticias (M1) y de los reportes comunitarios (M3).

### M3 — Reportes comunitarios
- Un usuario reporta un incidente en dos pasos: tipo de incidente + ubicación.
- Los reportes nuevos aparecen en el mapa de inmediato (tiempo real).
- Cualquier usuario de la web de reportes (M8) puede tocar un incidente visible y responder "¿Sigue ahí?" para confirmarlo o negarlo. Cada usuario vota una sola vez por incidente y no puede votar sus propios reportes.
- Identidad del usuario: apodo + identificador anónimo de dispositivo guardado en `localStorage`. La reputación (RN-04), el límite de reportes y el voto único se asocian a ese identificador.
- **Limitación conocida:** borrar el almacenamiento del navegador o cambiar de dispositivo genera una identidad nueva; se acepta en el MVP.

### M4 — Modelo de riesgo
- Calcula un puntaje de riesgo por tramo de calle, en 0–1, combinando tres componentes (RN-10):
  - **Riesgo reciente:** incidentes cercanos ponderados por gravedad, confianza y antigüedad (RN-06), según su distancia al tramo.
  - **Riesgo base:** el `RiesgoBaseZona` de la localidad del tramo (M2).
  - **Multiplicador horario:** patrón por localidad y franja horaria (RN-11).
- El riesgo reciente se recalcula cuando llegan incidentes nuevos o cambia la confianza de uno existente. El multiplicador horario se recalcula una vez al día.

### M5 — Ruteo seguro
- Dado un origen y un destino, devolver 3 opciones de ruta: **más rápida**, **balanceada** y **más segura**.
- El ruteo es para moto: respeta sentidos viales y excluye vías no aptas (peatonales, ciclorrutas, escaleras).
- El tiempo de recorrido de un tramo es su longitud dividida por una velocidad promedio fija para toda la ciudad (ver Parámetros iniciales). No se considera tráfico.
- Cada opción muestra el tiempo estimado, el tiempo extra frente a la más rápida, el nivel de riesgo y el número de incidentes cercanos a la ruta.
- **Nivel de riesgo de una ruta:** promedio de `riesgo(tramo, hora)` ponderado por el tiempo de recorrido de cada tramo, clasificado como bajo, medio o alto según los umbrales de Parámetros iniciales.
- **Incidentes cercanos a una ruta:** incidentes visibles (RN-12) dentro del radio de influencia de algún tramo de la ruta.
- Grafo de calles tomado de OpenStreetMap:
  - **Cobertura:** solo el casco urbano de Bogotá (ver Parámetros iniciales). El origen y el destino tienen que caer dentro.
  - **Vías incluidas:** las `highway` aptas para moto, de `motorway` a `living_street` más `service` y los enlaces (`*_link`).
  - **Vías excluidas:** las marcadas `access`, `motor_vehicle` o `motorcycle` = `no`/`private`, salvo que `motorcycle` o `motor_vehicle` las habilite explícitamente. Así salen los carriles exclusivos de TransMilenio.
  - **Sentidos viales:** salen de `oneway` y de las rotondas (`junction=roundabout`).
  - **Componentes sueltos:** se conserva solo el componente conectado más grande, para que nunca se enrute hacia una isla sin salida.
  - Se descarga con la API Overpass y se recarga completo cuando se quiere actualizar.

### M6 — Alertas en tiempo real
- Mientras el domiciliario sigue una ruta, alertar cuando haya un incidente reciente adelante en la ruta dentro de un radio definido.
- Alertar cuando aparezca un incidente nuevo sobre la ruta activa.
- Un incidente es reciente si entró al sistema (`reportado_en`) en las últimas 6 h **y** ocurrió (`ocurrido_en`) en las últimas 24 h. Así las noticias, que se publican horas después del hecho, también pueden generar alertas.
- Cada alerta ofrece **Recalcular ruta**, que calcula 3 opciones nuevas desde la posición actual hasta el destino del tramo en curso.

### M7 — Simulador de pedidos (app del domiciliario)
- Aplicación web que genera un pedido (punto de recogida y de entrega en Bogotá).
- El recorrido tiene dos tramos: posición actual → recogida y recogida → entrega. Para cada tramo se ofrecen las 3 rutas de M5.
- El domiciliario acepta el pedido, ve las 3 rutas y los incidentes cercanos en el mapa, elige una y su posición avanza sobre ella (animada, con velocidad ajustable).
- Muestra en vivo los incidentes y las alertas que llegan.
- Termina con un resumen de la entrega: tiempo extra invertido y riesgo evitado.
- **Riesgo evitado:** comparación de las rutas recorridas frente a la ruta más rápida de cada tramo, calculada con el riesgo a la hora de inicio de cada tramo:
  - Exposición evitada: `1 − exposición(elegida) / exposición(rápida)`, en porcentaje, donde `exposición(ruta) = Σ tiempo_recorrido(tramo) × riesgo(tramo, hora)`.
  - Incidentes evitados: incidentes cercanos a la ruta más rápida que no están cerca de la ruta elegida.

### M8 — Web de reportes (móvil)
- Vista web móvil sin creación de cuenta; el usuario solo ingresa un apodo.
- Muestra el mapa de la ciudad con los incidentes visibles (noticias y reportes comunitarios) ocurridos dentro de la ventana del mapa (ver Parámetros iniciales), y el riesgo base por localidad.
- El usuario toca un punto del mapa, elige el tipo de incidente y lo envía.
- El usuario toca un incidente existente para confirmarlo o negarlo (M3).
- Nunca muestra la ruta ni la posición de ningún domiciliario (RN-03).

## 4. Conceptos centrales

### Incidente
Las noticias y los reportes comunitarios terminan en la misma entidad, de modo que el mapa, el modelo de riesgo y las alertas consumen un único modelo.

| Campo | Descripción |
|---|---|
| `id` | Identificador único |
| `tipo` | Valor del catálogo de delitos (ver tabla siguiente) |
| `gravedad` | 1–5, determinada por el tipo |
| `ubicacion` | Punto (lat, lng), o área (barrio o localidad) cuando la fuente solo indica una zona |
| `ocurrido_en` | Cuándo ocurrió el hecho (mejor estimación) |
| `hora_conocida` | Si `ocurrido_en` incluye una hora confiable o solo la fecha (RN-11) |
| `reportado_en` | Cuándo entró al sistema |
| `fuentes` | Lista de pares (tipo de fuente, referencia). Tipo: `noticias` · `comunidad`; referencia: URL del artículo o identificador del usuario que reportó. Es una lista porque un incidente puede consolidar varias fuentes (RN-09) |
| `confianza` | 0–1, depende de la fuente y de la corroboración |

### RiesgoBaseZona
Riesgo histórico de una localidad, calculado a partir de datos abiertos (M2). No es un `Incidente`: no tiene fecha de ocurrido, no decae y no genera alertas.

| Campo | Descripción |
|---|---|
| `localidad` | Código y geometría de la localidad |
| `riesgo_base` | 0–1, tasa de delitos/km² normalizada por la localidad más alta |
| `periodo` | Meses del dataset usados en el cálculo |
| `actualizado_en` | Fecha de la última importación |

### Catálogo de tipos de delito

| Tipo | Gravedad (1–5) | Criterio |
|---|---|---|
| Hurto a persona (celular, pertenencias) | 3 | Pérdida económica sin arma |
| Hurto de moto | 5 | El domiciliario pierde su herramienta de trabajo |
| Hurto de bicicleta | 5 | El domiciliario en bici pierde su herramienta de trabajo |
| Hurto de vehículo | 2 | Afecta poco a quien pasa por la vía |
| Atraco con arma | 5 | Riesgo para la integridad física |
| Homicidio / sicariato | 5 | Riesgo máximo para la integridad física |
| Lesiones personales | 4 | Agresión física directa |
| Riña | 2 | Riesgo indirecto para quien pasa |
| Otro | 1 | Hechos que no encajan en las categorías anteriores |

### Tipos compatibles para fusión
El LLM puede clasificar el mismo hecho con tipos distintos según la redacción de cada medio. Para RN-09, estos grupos se consideran el mismo hecho; al fusionar se conserva el tipo de mayor gravedad:

| Grupo | Tipos |
|---|---|
| Hurtos | Atraco con arma con cualquier hurto (a persona, de moto, de bicicleta, de vehículo) |
| Agresiones | Riña ↔ Lesiones personales ↔ Homicidio / sicariato |

Dos hurtos distintos entre sí (por ejemplo, de moto y de bicicleta) no son compatibles.

### Fuente de posición
El sistema consume la posición del domiciliario desde una fuente abstracta. En el MVP la única fuente es la **ruta simulada**. El GPS real es una fuente futura que se conecta a la misma interfaz sin cambiar el resto del sistema.

## 5. Reglas de negocio

- **RN-01 · Modelo único.** Toda fuente de hechos individuales (noticias, comunidad) se normaliza a un `Incidente` antes de usarse. Única excepción: los datos abiertos, que son conteos agregados y se guardan como `RiesgoBaseZona`.
- **RN-02 · Reportar donde estás.** En el producto real, un reporte comunitario toma la posición actual de quien reporta; no se permite elegir un punto arbitrario. En el MVP la web de reportes (M8) permite elegir un punto en el mapa, ya que no hay GPS real.
- **RN-03 · Privacidad.** La aplicación nunca muestra la ruta ni la posición de otro domiciliario.
- **RN-04 · Validación de reportes.**
  - Los reportes comunitarios nuevos empiezan con confianza baja.
  - Cada confirmación de otro usuario sube la confianza; cada negación la baja.
  - Cada usuario vota una sola vez por incidente y no vota sus propios reportes.
  - Los usuarios cuyos reportes suelen confirmarse ganan reputación; sus siguientes reportes empiezan con mayor confianza.
    - El **saldo** de un usuario es la cantidad de confirmaciones menos la cantidad de negaciones que recibieron, de otros usuarios, los incidentes donde es fuente comunitaria.
    - Confianza inicial de su próximo reporte = `min(0,5; 0,3 + 0,02 × max(0, saldo))`.
    - Un saldo negativo no baja la confianza inicial: los reportes falsos ya pierden peso con las negaciones.
  - Límite de frecuencia: máximo 5 reportes por usuario por hora.
- **RN-05 · Horizontes de tiempo.**

  | Horizonte | Se usa para |
  |---|---|
  | Horas | Alertas en tiempo real (M6) |
  | ~1 semana, con decaimiento | Riesgo reciente de tramos (M4, M5) |
  | Periodo más reciente publicado (el año en curso), por localidad | Riesgo base a partir de datos abiertos (M2) |
  | 8 semanas, por localidad y franja horaria, sin decaimiento | Multiplicador horario a partir de noticias y reportes comunitarios (RN-11) |

- **RN-06 · Peso de un incidente.** `peso = gravedad × confianza × e^(−antigüedad/τ)`, con τ ≈ 3 días (por ajustar). No hay corte abrupto; los incidentes de más de una semana tienen un peso despreciable para el riesgo reciente.
- **RN-07 · Costo de ruta.** `costo(tramo) = tiempo_recorrido × (1 + α · riesgo(tramo, hora))`, con `tiempo_recorrido = longitud / velocidad promedio`. Las tres opciones de ruta usan tres valores de α (0 para la más rápida).
- **RN-08 · Sin reruteo automático.** El sistema sugiere una nueva ruta; el domiciliario decide.
- **RN-09 · Deduplicación.**
  - **Duplicado exacto:** misma URL original del artículo o título casi idéntico. Si la URL de Google News no se pudo decodificar (M1), se compara el título normalizado más el medio. Se descarta la copia.
  - **Mismo hecho:** dos incidentes con tipos iguales o compatibles (sección 4), a menos de 500 m entre sí (o con el punto dentro del área del otro, solo si el área es de nivel barrio) y con menos de 24 h de diferencia en `ocurrido_en` se fusionan en uno solo que conserva todas sus fuentes y el tipo de mayor gravedad. La fusión aumenta la confianza del incidente.
  - Un incidente de nivel localidad nunca absorbe a otros por contención: el área es demasiado grande para asumir que es el mismo hecho.
  - Un reporte comunitario que coincide con un incidente existente cuenta como confirmación (RN-04) en lugar de crear un incidente nuevo. Si quien reporta ya es fuente de ese incidente o ya votó sobre él, no cuenta de nuevo. El reporte se compara con un `ocurrido_en` igual al momento del envío.
- **RN-10 · Riesgo de un tramo.**
  - Aporte de un incidente puntual: `peso × max(0, 1 − d / R)`, donde `d` es la distancia del incidente al tramo y `R` el radio de influencia.
  - Aporte de un incidente de área: `peso × min(1, A₀ / A)` a cada tramo dentro del área, donde `A` es el área del barrio o localidad y `A₀ = π·R²`. Así el peso se reparte en proporción al tamaño de la zona.
  - `reciente(tramo) = 1 − e^(−S/k)`, donde `S` es la suma de aportes de los incidentes visibles (RN-12).
  - `riesgo(tramo, hora) = min(1, (w_base · base(localidad) + w_reciente · reciente(tramo)) × m(localidad, franja(hora)))`.
- **RN-11 · Multiplicador horario.**
  - Franjas: madrugada 0–6 h, mañana 6–12 h, tarde 12–18 h, noche 18–24 h.
  - `m(localidad, franja) = 4 × (incidentes de la localidad en esa franja / incidentes de la localidad)`, contando incidentes de las últimas 8 semanas, sin decaimiento y sin ponderar por confianza.
  - Solo cuentan incidentes con `hora_conocida`. Los incidentes sin hora sí cuentan para el riesgo reciente (RN-10).
  - El multiplicador se acota a [0,5; 2]. Si la localidad tiene menos de 10 incidentes con hora en la ventana, `m = 1`.
- **RN-12 · Visibilidad.** Un incidente con confianza menor a 0,1 se oculta: no aparece en los mapas, no aporta riesgo y no genera alertas. Si vuelve a subir de 0,1 por nuevas confirmaciones, se muestra otra vez.

### Parámetros iniciales

Valores de partida; se ajustan con pruebas sobre rutas reales.

| Parámetro | Valor | Efecto |
|---|---|---|
| τ (decaimiento, RN-06) | 3 días | Un incidente de hace 3 días pesa ~37 % de uno de hoy; uno de hace una semana, ~10 % |
| Radio de influencia R (RN-10) | 250 m, con caída lineal | Un incidente pesa completo sobre su tramo y nada a partir de 250 m |
| k (saturación, RN-10) | 5 | Un atraco con arma reciente de noticias (peso 3,5) lleva el riesgo reciente a ~0,5 |
| w_base / w_reciente (RN-10) | 0,3 / 0,7 | Lo reciente pesa más que lo histórico |
| Multiplicador horario (RN-11) | Ventana 8 semanas · mínimo 10 incidentes con hora · acotado a [0,5; 2] | Evita patrones con pocos datos |
| α (RN-07): rápida / balanceada / segura | 0 / 1 / 5 | Un tramo de riesgo máximo cuesta 1×, 2× y 6× su tiempo de recorrido |
| Velocidad promedio de moto (M5) | 25 km/h | Base del tiempo estimado; sin tráfico |
| Casco urbano (M5) | Longitud −74,23 a −73,99 · Latitud 4,46 a 4,84 | Deja por fuera Sumapaz y la zona rural |
| Recorte del grafo para rutear (M5) | Caja de origen y destino + 2 km por lado; si no hay ruta, + 6 km | La ruta casi nunca se sale de esa caja y el Dijkstra trabaja sobre mucho menos grafo |
| Nivel de riesgo de ruta (M5) | Bajo < 0,2 ≤ medio < 0,5 ≤ alto | Clasificación que ve el domiciliario |
| Pedido simulado (M7) | Recogida a 1–4 km del domiciliario y entrega a 2–6 km de la recogida, en línea recta | Trayectos típicos de domicilio en moto |
| Velocidad de la simulación (M7) | 1×, 5×, 10× o 20× la velocidad promedio, 10× por defecto; una posición por segundo | Una entrega de 20 min se ve en 2 min |
| Franjas horarias (RN-11) | 4 franjas de 6 h, en hora de Bogotá (`America/Bogota`) | La franja no depende de la zona horaria del servidor |
| Radio de alerta (M6) | 300 m alrededor de la ruta, hasta 1 km adelante | No alerta por tramos ya recorridos ni por incidentes lejanos |
| Ventana de alertas (M6) | `reportado_en` en las últimas 6 h y `ocurrido_en` en las últimas 24 h | Los incidentes más antiguos solo influyen en el ruteo |
| Límite de reportes (RN-04) | 5 por usuario por hora | Frena el spam |
| Límite por IP (API) | Ventana de 10 min · reportes 100 · votos 300 · rutas 300 · crear pedido 60 · aceptar o siguiente pedido 300 | Frena a quien cambia de dispositivo para saltarse RN-04, con holgura para ~30 usuarios detrás de una misma red |
| Cola del ruteo (M5) | 4 cálculos simultáneos · hasta 30 en espera; el resto recibe 503 | Una ráfaga de la demo cabe; una avalancha no deja pedidos esperando sin fin |
| Confianza inicial | Noticias 0,7 · Comunidad 0,3 | Los reportes comunitarios necesitan confirmación |
| Factor de confianza por área (M1) | Barrio × 0,5 · Localidad × 0,25 | Una ubicación imprecisa pesa menos |
| Ajustes de confianza | Confirmación +0,15 · Negación −0,2 · Fusión con otra fuente +0,1 · Tope 1,0 | Los reportes falsos pierden peso rápido |
| Reputación (RN-04) | +0,02 de confianza inicial por punto de saldo · Máximo 0,5 | Unas 10 confirmaciones netas llevan a un reportero al máximo |
| Umbral de visibilidad (RN-12) | 0,1 | Con 2 negaciones, un reporte comunitario nuevo se oculta |
| Ventana del mapa (M8) | 7 días por `ocurrido_en` | Igual al horizonte del riesgo reciente; lo más viejo ya casi no pesa (RN-06) |

## 6. Flujos principales

### F1 — Entrega con ruta segura
1. Llega un pedido (recogida → entrega).
2. El domiciliario lo acepta.
3. El sistema devuelve 3 opciones de ruta para el tramo hacia la recogida, con tiempo, tiempo extra, nivel de riesgo e incidentes cercanos.
4. El domiciliario elige una y empieza el recorrido.
5. Si aparece un incidente o hay uno adelante en la ruta, se muestra una alerta con la opción de recalcular desde la posición actual.
6. Al llegar a la recogida, se repiten los pasos 3 a 5 para el tramo hacia la entrega.
7. Al llegar a la entrega, se muestra el resumen: tiempo extra y riesgo evitado.

### F2 — Reporte comunitario
1. El usuario abre la web de reportes e ingresa un apodo.
2. Toca un punto del mapa, elige el tipo de incidente y lo envía.
3. El incidente aparece en tiempo real en todos los mapas conectados.
4. Si afecta una ruta activa, el domiciliario recibe una alerta (paso 5 de F1).

### F3 — Ingesta de noticias
1. Una tarea programada consulta artículos nuevos.
2. Filtro de relevancia + extracción estructurada.
3. Geocodificación.
4. Deduplicación y almacenamiento como `Incidente`.
5. Se recalcula el riesgo de los tramos afectados.

### F4 — Confirmación de un incidente
1. En la web de reportes, el usuario toca un incidente visible.
2. Responde "¿Sigue ahí?": sí o no.
3. La confianza del incidente se ajusta (RN-04) y, si cruza el umbral de visibilidad, el incidente se oculta o se vuelve a mostrar (RN-12).
4. Se recalcula el riesgo de los tramos afectados.

## 7. Criterios de éxito del MVP

Metas iniciales; se revisan tras las primeras pruebas.

| Criterio | Meta |
|---|---|
| Flujos completos | F1, F2, F3 y F4 funcionan de punta a punta en una demo sin intervención manual |
| Concurrencia | La demo soporta ~30 usuarios concurrentes cumpliendo los presupuestos de rendimiento de `AGENTS.md` |
| Tiempo real | Un reporte enviado desde `/reportar` aparece en el mapa de `/domiciliario` en menos de 1 s (p95) |
| Ruteo | Las 3 opciones de ruta se calculan en menos de 1,5 s (p95) |
| Valor de la ruta segura | En al menos el 70 % de los pedidos simulados, la ruta más segura reduce la exposición al menos 50 % frente a la más rápida, con no más de 25 % de tiempo extra |
| Calidad de la extracción | En una muestra de 50 artículos revisada a mano, al menos 80 % tiene tipo y ubicación correctos |
| Deduplicación | En la misma muestra, menos del 10 % de los incidentes guardados son duplicados de otro |

## 8. Fuera de alcance (MVP)

- Integración con Rappi, DiDi o cualquier plataforma de domicilios.
- GPS real y ubicación en segundo plano.
- Ruteo para bicicleta y otros vehículos (el MVP solo rutea para moto).
- Tráfico en tiempo real o velocidades por tipo de vía.
- Modelos predictivos con machine learning ("predictivo" significa patrones por zona y franja horaria).
- Verificación de identidad o cuentas de usuario completas.
- X/Twitter como fuente (API de pago).
- Siniestros viales y cualquier riesgo que no sea un delito: el MVP se limita a delitos.
- Datasets de la Policía Nacional en datos.gov.co: su granularidad es por municipio y no permite diferenciar zonas dentro de Bogotá.
- Waze for Cities: requiere un aliado institucional.

## 9. Stack tecnológico

TypeScript en frontend y backend, para compartir tipos (como `Incidente`) entre ambos.

| Pieza | Tecnología | Motivo |
|---|---|---|
| Base de datos | PostgreSQL + PostGIS + pgRouting, administrado en Supabase (solo como base de datos) | Incidentes geoespaciales, grafo de calles y ruteo con costo de riesgo en un solo lugar; el modelo de riesgo (RN-06, RN-07, RN-10, RN-11) queda expresado en SQL. Supabase simplifica el despliegue sin cambiar el modelo |
| Backend / API | Node.js + TypeScript con Hono | Liviano; el cómputo pesado lo resuelve la base de datos |
| Tiempo real | WebSockets (Socket.IO) | Difusión inmediata de reportes y alertas a todos los mapas conectados |
| Frontend | React + Vite + TypeScript; una app con dos rutas: `/domiciliario` (M7) y `/reportar` (M8) | Ambas vistas son aplicaciones interactivas centradas en el mapa |
| Mapa | MapLibre GL JS | Open source, mapas vectoriales, sin costos de licencia |
| Extracción de noticias | LLM con salida estructurada, detrás de un adaptador intercambiable (proveedor por definir) | Extracción de tipo, ubicación y hora a JSON sin NLP propio; el adaptador permite cambiar de proveedor sin afectar el resto del sistema |
| Geocodificación | Google Geocoding API | Mejor manejo de direcciones colombianas que Nominatim |
| Tareas programadas | node-cron dentro del backend | Suficiente para la frecuencia de ingesta del MVP |
| Entorno de desarrollo | API y web en local contra un proyecto de Supabase en la nube compartido por el equipo; sin Docker | Prioriza la velocidad de desarrollo del MVP sobre el aislamiento entre entornos |
