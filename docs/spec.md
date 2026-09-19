# UrbanSafe — Especificación del MVP


## 1. Visión

**Problema.** Los domiciliarios en Bogotá eligen sus rutas sin información de seguridad. La información que existe está dispersa (medios de noticias, grupos de WhatsApp), llega tarde y nadie la verifica.

**Propuesta.** Cuando un domiciliario toma un pedido, UrbanSafe calcula rutas hacia el destino que evitan zonas peligrosas, combinando noticias, datos abiertos oficiales y reportes de otros domiciliarios. Durante el recorrido, alerta al domiciliario sobre incidentes recientes en su camino.

## 2. Actores

| Actor | Descripción |
|---|---|
| **Domiciliario** | Toma un pedido, elige una ruta, recibe alertas y puede reportar incidentes. |
| **Reportero comunitario** | Cualquier usuario que envía reportes de incidentes desde una web móvil. |
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
  | `atraco Bogotá` | Atraco con arma |
  | `riña Bogotá` | Riña |
  | `domiciliario robo OR atraco Bogotá` | Hechos contra domiciliarios |

  Usar el operador `when:1d` para limitar a noticias del último día, previa verificación de que el RSS lo respeta.

- Extraer de cada artículo: tipo de delito, texto de ubicación, fecha/hora y relevancia (LLM con salida estructurada), a partir del título y el resumen disponibles en el feed.
- Geocodificar el texto de ubicación a coordenadas. Si solo se identifica el barrio o la localidad, registrar el incidente como área con confianza reducida.
- Descartar artículos irrelevantes, fuera de Bogotá o sin ubicación identificable.
- Deduplicar obligatoriamente según RN-09: Google News repite noticias de los feeds directos y varios medios publican el mismo hecho.
- Guardar el resultado como `Incidente` con fuente `noticias`.

### M2 — Datos abiertos oficiales
- Fuente: **Delito de Alto Impacto Bogotá D.C.**, de la Secretaría Distrital de Seguridad, Convivencia y Justicia (https://datosabiertos.bogota.gov.co/dataset/delito-de-alto-impacto-bogota-d-c), en GeoJSON.
- Granularidad: por localidad (2018–2024) y por UPZ (2018–2022), agregada por mes. No incluye hora del día ni coordenadas exactas.
- Uso: riesgo base por zona (qué localidades y UPZ son históricamente más peligrosas). No aporta patrón horario.
- Importación inicial y revisión mensual de actualizaciones.
- **Limitación conocida:** ninguna fuente oficial disponible ofrece hora ni coordenadas exactas; la precisión espacial y el patrón horario dependen de las noticias (M1) y de los reportes comunitarios (M3).

### M3 — Reportes comunitarios
- Un usuario reporta un incidente en dos pasos: tipo de incidente + ubicación.
- Los reportes nuevos aparecen en el mapa de inmediato (tiempo real).
- Otros usuarios cercanos al incidente pueden confirmarlo o negarlo ("¿Sigue ahí?").

### M4 — Modelo de riesgo
- Calcula un puntaje de riesgo por tramo de calle a partir de los incidentes cercanos.
- El riesgo depende de la gravedad del incidente, la confianza de la fuente, su antigüedad y la hora del día (ver RN-06, RN-07).
- Se recalcula cuando llegan incidentes nuevos.

### M5 — Ruteo seguro
- Dado un origen y un destino, devolver 3 opciones de ruta: **más rápida**, **balanceada** y **más segura**.
- Cada opción muestra el tiempo estimado, el tiempo extra frente a la más rápida y un nivel de riesgo.
- Grafo de calles tomado de OpenStreetMap.

### M6 — Alertas en tiempo real
- Mientras el domiciliario sigue una ruta, alertar cuando haya un incidente reciente adelante en la ruta dentro de un radio definido.
- Alertar cuando aparezca un incidente nuevo sobre la ruta activa.
- Cada alerta ofrece **Recalcular ruta**.

### M7 — Simulador de pedidos (app del domiciliario)
- Aplicación web que genera un pedido (punto de recogida y de entrega en Bogotá).
- El domiciliario acepta el pedido, ve las 3 rutas y los incidentes cercanos en el mapa, elige una y su posición avanza sobre ella (animada, con velocidad ajustable).
- Muestra en vivo los incidentes y las alertas que llegan.
- Termina con un resumen de la entrega: riesgo evitado y tiempo extra invertido.

### M8 — Web de reportes (móvil)
- Vista web móvil sin creación de cuenta; el usuario solo ingresa un apodo.
- Muestra el mapa de la ciudad con los incidentes existentes (noticias, datos abiertos, reportes comunitarios).
- El usuario toca un punto del mapa, elige el tipo de incidente y lo envía.
- Nunca muestra la ruta ni la posición de ningún domiciliario (RN-03).

## 4. Conceptos centrales

### Incidente
Todas las fuentes terminan en la misma entidad, de modo que el mapa, el modelo de riesgo y las alertas consumen un único modelo.

| Campo | Descripción |
|---|---|
| `id` | Identificador único |
| `tipo` | Valor del catálogo de delitos (ver tabla siguiente) |
| `gravedad` | 1–5, determinada por el tipo |
| `ubicacion` | Punto (lat, lng), o área cuando la fuente solo indica una zona |
| `ocurrido_en` | Cuándo ocurrió el hecho (mejor estimación) |
| `reportado_en` | Cuándo entró al sistema |
| `fuentes` | Lista de pares (tipo de fuente, referencia). Tipo: `noticias` · `datos_abiertos` · `comunidad`; referencia: URL del artículo, ID del dataset o usuario que reportó. Es una lista porque un incidente puede consolidar varias fuentes (RN-09) |
| `confianza` | 0–1, depende de la fuente y de la corroboración |

### Catálogo de tipos de delito

| Tipo | Gravedad (1–5) | Criterio |
|---|---|---|
| Hurto a persona (celular, pertenencias) | 3 | Pérdida económica sin arma |
| Hurto de moto | 5 | El domiciliario pierde su herramienta de trabajo |
| Atraco con arma | 5 | Riesgo para la integridad física |
| Riña | 2 | Riesgo indirecto para quien pasa |
| Otro | 1 | Hechos que no encajan en las categorías anteriores |

### Fuente de posición
El sistema consume la posición del domiciliario desde una fuente abstracta. En el MVP la única fuente es la **ruta simulada**. El GPS real es una fuente futura que se conecta a la misma interfaz sin cambiar el resto del sistema.

## 5. Reglas de negocio

- **RN-01 · Modelo único.** Toda fuente se normaliza a un `Incidente` antes de usarse.
- **RN-02 · Reportar donde estás.** En el producto real, un reporte comunitario toma la posición actual de quien reporta; no se permite elegir un punto arbitrario. En el MVP la web de reportes (M8) permite elegir un punto en el mapa, ya que no hay GPS real.
- **RN-03 · Privacidad.** La aplicación nunca muestra la ruta ni la posición de otro domiciliario.
- **RN-04 · Validación de reportes.**
  - Los reportes comunitarios nuevos empiezan con confianza baja.
  - Cada confirmación de otro usuario sube la confianza; cada negación la baja.
  - Los usuarios cuyos reportes suelen confirmarse ganan reputación; sus siguientes reportes empiezan con mayor confianza.
  - Límite de frecuencia: máximo N reportes por usuario por hora (N por definir).
- **RN-05 · Horizontes de tiempo.**

  | Horizonte | Se usa para |
  |---|---|
  | Horas | Alertas en tiempo real (M6) |
  | ~1 semana, con decaimiento | Riesgo de rutas (M4, M5) |
  | Años, por zona | Riesgo base a partir de datos abiertos (M2) |
  | Semanas, por franja horaria | Patrón horario a partir de noticias y reportes comunitarios |

- **RN-06 · Peso de un incidente.** `peso = gravedad × confianza × e^(−antigüedad/τ)`, con τ ≈ 3 días (por ajustar). No hay corte abrupto; los incidentes de más de una semana tienen un peso despreciable. Los registros de datos abiertos no decaen: aportan un riesgo base constante por zona.
- **RN-07 · Costo de ruta.** `costo(tramo) = tiempo_recorrido × (1 + α · riesgo(tramo, hora))`. Las tres opciones de ruta usan tres valores de α (0 para la más rápida).
- **RN-08 · Sin reruteo automático.** El sistema sugiere una nueva ruta; el domiciliario decide.
- **RN-09 · Deduplicación.**
  - **Duplicado exacto:** misma URL de artículo (resolviendo la redirección de Google News) o título casi idéntico. Se descarta la copia.
  - **Mismo hecho:** dos incidentes con el mismo tipo, a menos de 500 m entre sí (o con el punto dentro del área del otro) y con menos de 24 h de diferencia en `ocurrido_en` se fusionan en uno solo que conserva todas sus fuentes. La fusión aumenta la confianza del incidente.
  - Un reporte comunitario que coincide con un incidente existente cuenta como confirmación (RN-04) en lugar de crear un incidente nuevo.

### Parámetros iniciales

Valores de partida; se ajustan con pruebas sobre rutas reales.

| Parámetro | Valor | Efecto |
|---|---|---|
| τ (decaimiento, RN-06) | 3 días | Un incidente de hace 3 días pesa ~37 % de uno de hoy; uno de hace una semana, ~10 % |
| Riesgo por tramo | Normalizado 0–1 | Da un significado estable a α |
| α (RN-07): rápida / balanceada / segura | 0 / 1 / 5 | Un tramo de riesgo máximo cuesta 1×, 2× y 6× su tiempo de recorrido |
| Radio de alerta (M6) | 300 m alrededor de la ruta, hasta 1 km adelante | No alerta por tramos ya recorridos ni por incidentes lejanos |
| Ventana de alertas (M6) | Últimas 6 h | Los incidentes más antiguos solo influyen en el ruteo |
| Límite de reportes (RN-04) | 5 por usuario por hora | Frena el spam |
| Confianza inicial | Noticias 0,7 · Comunidad 0,3 · Datos abiertos 1,0 | Los datos abiertos solo aportan riesgo base por zona, no alertas |
| Ajustes de confianza | Confirmación +0,15 · Negación −0,2 · Fusión con otra fuente +0,1 · Tope 1,0 | Los reportes falsos pierden peso rápido |

## 6. Flujos principales

### F1 — Entrega con ruta segura
1. Llega un pedido (recogida → entrega).
2. El domiciliario lo acepta.
3. El sistema devuelve 3 opciones de ruta con tiempo, tiempo extra y riesgo.
4. El domiciliario elige una y empieza el recorrido.
5. Si aparece un incidente o hay uno adelante en la ruta, se muestra una alerta con la opción de recalcular.
6. Al llegar, se muestra el resumen de la entrega.

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

## 7. Fuera de alcance (MVP)

- Integración con Rappi, DiDi o cualquier plataforma de domicilios.
- GPS real y ubicación en segundo plano.
- App móvil nativa publicada en tiendas.
- Modelos predictivos con machine learning ("predictivo" significa patrones por zona y franja horaria).
- Verificación de identidad o cuentas de usuario completas.
- X/Twitter como fuente (API de pago).
- Siniestros viales y cualquier riesgo que no sea un delito: el MVP se limita a delitos.
- Datasets de la Policía Nacional en datos.gov.co: su granularidad es por municipio y no permite diferenciar zonas dentro de Bogotá.
- Waze for Cities: requiere un aliado institucional.

## 8. Stack tecnológico

TypeScript en frontend y backend, para compartir tipos (como `Incidente`) entre ambos.

| Pieza | Tecnología | Motivo |
|---|---|---|
| Base de datos | PostgreSQL + PostGIS + pgRouting | Incidentes geoespaciales, grafo de calles y ruteo con costo de riesgo en un solo lugar; el modelo de riesgo (RN-06, RN-07) queda expresado en SQL |
| Backend / API | Node.js + TypeScript con Hono | Liviano; el cómputo pesado lo resuelve la base de datos |
| Tiempo real | WebSockets (Socket.IO) | Difusión inmediata de reportes y alertas a todos los mapas conectados |
| Frontend | React + Vite + TypeScript; una app con dos rutas: `/domiciliario` (M7) y `/reportar` (M8) | Ambas vistas son aplicaciones interactivas centradas en el mapa |
| Mapa | MapLibre GL JS | Open source, mapas vectoriales, sin costos de licencia |
| Extracción de noticias | LLM con salida estructurada, detrás de un adaptador intercambiable (proveedor por definir) | Extracción de tipo, ubicación y hora a JSON sin NLP propio; el adaptador permite cambiar de proveedor sin afectar el resto del sistema |
| Geocodificación | Google Geocoding API | Mejor manejo de direcciones colombianas que Nominatim |
| Tareas programadas | node-cron dentro del backend | Suficiente para la frecuencia de ingesta del MVP |
| Entorno local | Docker Compose (PostgreSQL/PostGIS + API) | Mismo entorno para todo el equipo con un comando |

## 9. Preguntas abiertas

1. Hosting para la demo.
2. Proveedor de LLM para la extracción de noticias (según costo y presupuesto del equipo).
