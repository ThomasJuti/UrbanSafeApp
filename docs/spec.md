# UrbanSafe — Especificación del MVP

> Estado: Borrador v0.1 · 2026-09-19
> Contexto: MVP funcional desarrollado como proyecto de clase universitaria. Esta versión no se integra con plataformas de domicilios (Rappi, DiDi).

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
- Consultar periódicamente noticias sobre hechos peligrosos en Bogotá (preferiblemente mediante feeds RSS en lugar de scraping de HTML).
- Extraer de cada artículo: tipo de incidente, texto de ubicación, fecha/hora y relevancia (LLM con salida estructurada).
- Geocodificar el texto de ubicación a coordenadas.
- Descartar artículos irrelevantes o no geocodificables; deduplicar un mismo hecho publicado por varios medios.
- Guardar el resultado como `Incidente` con fuente `noticias`.

### M2 — Datos abiertos oficiales
- Importar periódicamente datasets oficiales de delitos en Bogotá (Policía / Secretaría Distrital de Seguridad).
- Se usan como línea base histórica: qué zonas y franjas horarias son peligrosas.
- La granularidad depende de cada dataset (localidad, UPZ, barrio); por confirmar en cada caso.

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
| `tipo` | Valor de catálogo: hurto, hurto de moto, riña, atraco, accidente, otro (catálogo por definir) |
| `gravedad` | Escala numérica por tipo (por definir) |
| `ubicacion` | Punto (lat, lng), o área cuando la fuente solo indica una zona |
| `ocurrido_en` | Cuándo ocurrió el hecho (mejor estimación) |
| `reportado_en` | Cuándo entró al sistema |
| `fuente` | `noticias` · `datos_abiertos` · `comunidad` |
| `referencia_fuente` | URL del artículo, ID del dataset o usuario que reportó |
| `confianza` | 0–1, depende de la fuente y de la corroboración |

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
  | Meses, por franja horaria | Riesgo base a partir de datos abiertos |

- **RN-06 · Peso de un incidente.** `peso = gravedad × confianza × e^(−antigüedad/τ)`, con τ ≈ 3 días (por ajustar). No hay corte abrupto; los incidentes de más de una semana tienen un peso despreciable.
- **RN-07 · Costo de ruta.** `costo(tramo) = tiempo_recorrido × (1 + α · riesgo(tramo, hora))`. Las tres opciones de ruta usan tres valores de α (0 para la más rápida).
- **RN-08 · Sin reruteo automático.** El sistema sugiere una nueva ruta; el domiciliario decide.

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

## 8. Stack tecnológico

TypeScript en frontend y backend, para compartir tipos (como `Incidente`) entre ambos.

| Pieza | Tecnología | Motivo |
|---|---|---|
| Base de datos | PostgreSQL + PostGIS + pgRouting | Incidentes geoespaciales, grafo de calles y ruteo con costo de riesgo en un solo lugar; el modelo de riesgo (RN-06, RN-07) queda expresado en SQL |
| Backend / API | Node.js + TypeScript con Hono | Liviano; el cómputo pesado lo resuelve la base de datos |
| Tiempo real | WebSockets (Socket.IO) | Difusión inmediata de reportes y alertas a todos los mapas conectados |
| Frontend | React + Vite + TypeScript; una app con dos rutas: `/domiciliario` (M7) y `/reportar` (M8) | Ambas vistas son aplicaciones interactivas centradas en el mapa |
| Mapa | MapLibre GL JS | Open source, mapas vectoriales, sin costos de licencia |
| Extracción de noticias | API de Claude con salida estructurada (Claude Haiku 4.5) | Extracción de tipo, ubicación y hora a JSON sin NLP propio |
| Geocodificación | Google Geocoding API | Mejor manejo de direcciones colombianas que Nominatim |
| Tareas programadas | node-cron dentro del backend | Suficiente para la frecuencia de ingesta del MVP |
| Entorno local | Docker Compose (PostgreSQL/PostGIS + API) | Mismo entorno para todo el equipo con un comando |

## 9. Preguntas abiertas

1. Feeds de noticias y datasets abiertos específicos, y su granularidad real.
2. Catálogo de tipos de incidente y escala de gravedad.
3. Valores de parámetros: τ, α por opción de ruta, radio de alerta, ventana de tiempo de alertas, límite de reportes.
4. Criterios de deduplicación de un mismo hecho entre fuentes.
5. Hosting para la demo.
