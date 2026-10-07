# Seminario Rendimiento DAX 2.0 — Guión del workshop (4 h)

> Base: "WorkShop Funcionalidades Avanzadas y Rendimiento" (octubre 25), 56 diapositivas, con checklist final fechado en marzo 2022.
> Este guión reordena el material, corrige lo obsoleto, añade demos y cierra cada sección con **"Y esto con IA, ¿qué?"**.

**Nota de método.** He revisado el texto del PDF, no las capturas ni las demos en sí. Las cifras de las diapositivas (ms, consultas SE, KB, filas) las trato como "datos de la última vez que se midió". Los números de diapositiva citados son los de la página del PDF. Las novedades de producto marcadas con 🔎 deben **confirmarse en tu versión de Desktop o Fabric antes de presentar**: el estado preview/GA cambia cada mes. Las fuentes consultadas están en el anexo C.

---

## 0. Hallazgos de la revisión crítica

### 0.1 Afirmaciones del material original

| # | Afirmación original (dispositiva) | Veredicto | Qué decir en 2.0 |
|---|---|---|---|
| 1 | Los modos son Import / DirectQuery / Live / Dual (diap. 7) | **Incompleto** | Faltan Direct Lake (Fabric), modelos compuestos sobre semantic models, tablas híbridas, agregaciones de usuario y automáticas. El "PBI Dataset" de la diapositiva se llama hoy *semantic model*. Añadir una matriz de decisión. |
| 2 | "Intenta ordenar las columnas para obtener el mejor ratio de compresión" (diap. 10) | **Mantener como truco empírico** | Es experiencia de campo: ordenar el origen puede mejorar RLE en columnas de baja cardinalidad, aunque VertiPaq reordena por segmento con sus propias heurísticas y el resultado **no está garantizado**. Presentarlo como "prueba y mide" (VertiPaq Analyzer antes/después), junto a las palancas seguras: reducir cardinalidad, separar fecha y hora, usar enteros, quitar GUIDs/textos largos, desactivar Auto date/time y revisar el encoding (hint Value/Hash). |
| 3 | Diccionario "innecesario" para Int; RLE (diap. 12–13) | **Correcto, pero simplificado** | Añadir value encoding vs hash encoding, y que RLE depende del orden *dentro del segmento*. Introducir segmentos y su efecto. |
| 4 | Las columnas calculadas comprimen peor (diap. 14–15) | **Vigente con matices** | Se calculan en el refresco y se almacenan, pero **no participan en la elección del orden de las filas** del segmento: por eso suelen comprimir peor. Mover la lógica a Power Query o al origen sigue siendo lo recomendable. En tablas Direct Lake no hay Power Query: la lógica va al lakehouse o warehouse (revisar las limitaciones vigentes de Direct Lake con columnas calculadas 🔎). |
| 5 | "Procesamiento de los datos (CPU y RAM)" es una de las 3 áreas a optimizar (diap. 6) | **Anunciado y no desarrollado** | El PDF explica qué se carga al refrescar (diap. 9), pero no cómo optimizar el refresco. Falta query folding, particiones, incremental refresh, paralelismo y framing en Direct Lake. Se añade como sección. |
| 6 | Formula Engine "mono hilo (¡no siempre!)" y "sin caché" (diap. 44, 49) | **Precisar** | El FE es esencialmente monohilo. El "multihilo" de la diapositiva son los *callbacks*: código del FE que se ejecuta dentro de los hilos del SE. La caché que reutiliza resultados es la del SE. En capacidades Premium/Fabric existe además *query caching* para la carga inicial de informes 🔎. |
| 7 | "Regla de oro: + SE − FE" (diap. 44) | **Útil pero incompleta** | Añadir una segunda regla: **menos materialización** (tamaño de los data caches). Muchas consultas lentas son SE rápido más una caché enorme que el FE tiene que procesar. |
| 8 | Esquema DSE / Data Model Engine (diap. 43–44) | **Revisar** | Mantenerlo como idea, pero verificar el diagrama. Hoy es más útil enseñar el flujo *visual → consulta DAX (normalmente SUMMARIZECOLUMNS, a menudo con TOPN) → plan lógico/físico → xmSQL*. |
| 9 | AA (v1, v2, v3 y grupo de cálculo) e YTD (v1, v2 con tabla intermedia y relación MxN) (diap. 25–26) | **Re-medir** | Hay alternativas nuevas: inteligencia de tiempo basada en calendarios 🔎 (en *public preview* desde septiembre de 2025; no encontré anuncio de GA), funciones de ventana (OFFSET/WINDOW/INDEX/RANK) y UDF. Todas se miden contra las variantes originales. |
| 10 | "DAX Fusion" = que 4 columnas de la misma tabla vayan en 1 consulta (diap. 45) | **Correcto pero parcial** | Lo que describe la diapositiva es **vertical fusion** (varias agregaciones con el mismo contexto de filtro en una sola consulta SE). Falta **horizontal fusion**, que Microsoft añadió en Power BI en **septiembre de 2022**, *después* del checklist de marzo 2022: fusiona consultas SE que solo difieren en el filtro sobre una columna (típico de grupos de cálculo y comparativas por periodo o moneda). Volver a ejecutar la demo de ruptura (multi-moneda) con el motor actual. |
| 11 | Callback = rendimiento malo, "no hay fórmulas mágicas" (diap. 50) | **Vigente; re-medir** | Sigue siendo correcto detectarlos: en DAX Studio, las consultas SE con `CallbackDataID` aparecen en negrita. No he encontrado documentación concreta de qué casos se han eliminado del motor, así que cada ejemplo se vuelve a medir en vivo con la versión actual. |
| 12 | Checklist (marzo 2022): "usar siempre DIVIDE" (diap. 54) | **Matizar** | La guía de Microsoft: `DIVIDE` cuando el denominador es una expresión que puede devolver 0 o BLANK; operador `/` cuando el denominador es una constante (evita una comprobación innecesaria). Por tanto, no es "siempre". |
| 13 | Checklist: "SUMMARIZECOLUMNS o ADDCOLUMNS(SUMMARIZE())" (diap. 54) | **Actualizar** | Mantener y añadir: SUMMARIZE solo para agrupar, no para añadir columnas calculadas. Revisar si SUMMARIZECOLUMNS es ya utilizable dentro de medidas en tu caso 🔎. |
| 14 | Checklist: iteradores anidados, transición de contexto, filtros dinámicos, ORs en RLS (diap. 54) | **Vigente** | Reforzar con ejemplos medidos. |
| 15 | Herramientas: Tabular Editor, DAX Studio, ALM Toolkit (diap. 2) | **Ampliar** | Añadir: DAX query view, TMDL view, Best Practice Analyzer, Semantic Link Labs, VertiPaq Analyzer, DAX Optimizer, el *Benchmark* de DAX Studio, workspace monitoring. |
| 16 | Grupos de cálculo + format string dinámico (diap. 20) | **Vigente** | Hoy es un patrón estándar. Enlazarlo con multi-moneda y multi-idioma. |
| 17 | Multi-idioma con parámetros de campo (11 ms vs 111 ms) (diap. 33–34) | **Vigente y reforzable** | Añadir `USERCULTURE()` para elegir idioma sin slicer, y traducciones de metadatos del propio modelo (culturas). |
| 18 | Cálculos de tiempo "uno a uno" o generados con C# en Tabular Editor (diap. 20) | **Hay alternativa nueva** | Las UDF de DAX permiten reutilizar patrones sin duplicar lógica. Fuentes secundarias las dan como GA desde junio 2026, con nivel de compatibilidad 1702+ 🔎. |

### 0.2 Huecos del material original

- No se habla de **diseño del informe**: nº de visuales, slicers, tooltips, interacciones, "Optimize ribbon" (pausar visuales, presets).
- No se habla de **producción**: monitorización, capacidades, RLS en carga real, query scale-out, caché.
- Se mide con trazas (diap. 22–23), pero no se explica un **método de medición reproducible** (caché fría y caliente, repeticiones, tabla de resultados).
- Erratas a corregir en las diapositivas: la diap. 39 titula "Multi Idioma con campos fijos y switch" en una comparativa de multi-moneda.
- Las demos están en "10 minutos" encadenados: demasiado denso para 4 h. Se propone un guion con menos demos, pero con medición común.

---

## 1. Agenda propuesta (240 min)

| Bloque | Contenido | Min |
|---|---|---|
| 0 | Apertura, regla de juego y cómo medimos | 10 |
| 1 | Anatomía del motor y del almacenamiento | 35 |
| 2 | Herramientas y método de medición | 30 |
| 3 | Tiempo: dimensión, cálculos y rendimiento | 45 |
| — | **Descanso** | 10 |
| 4 | Multi-idioma y multi-moneda | 35 |
| 5 | FE/SE, Fusion, Callbacks y materialización | 40 |
| 6 | Capa de informe, producción y checklist 2.0 | 25 |
| 7 | Cierre, retos y preguntas | 10 |
| | **Total** | **240** |

Cada bloque de contenido (1 a 6) termina con **"Y esto con IA, ¿qué?"** (3–5 min, ya incluido en su tiempo).

---

## 2. Bloque 0 — Apertura (10 min)

**Objetivo:** fijar la idea de que *medimos, no opinamos*.

**Guion**
1. Presentación (2 min). Qué se va a llevar la audiencia: un método, un checklist y un puñado de patrones comprobados.
2. "Las reglas viejas hay que re-medirlas": mostrar una tabla de 5 afirmaciones del seminario original y avisar de que a lo largo de la sesión se contrastan en vivo (3 min).
3. Los tres frentes a optimizar: procesamiento, almacenamiento, consulta (ver diapositiva original "¿Qué optimizar?"). Añadir un cuarto frente: **informe y producción** (2 min).
4. Material y modelos de demo; plantilla de resultados `benchmark` (3 min), descrita en el bloque 2.

**Mejoras**
- Un modelo único de demo (p. ej. Contoso o AdventureWorks ampliado) para todas las demos, en vez de saltar entre modelos.
- Dar a la audiencia un `.pbix` o `.pbip`/TMDL con las versiones v1/v2/v3 de cada patrón.

---

## 3. Bloque 1 — Anatomía del motor y del almacenamiento (35 min)

### 3.1 Contenido (diapositivas 6–15 del original)

**1) Modos de almacenamiento (8 min)**
- Import, DirectQuery, Dual, conexión a semantic model; **añadir Direct Lake** y modelos compuestos.
- Matriz de decisión: volumen, frescura, latencia aceptable, coste de capacidad, seguridad.
- Mantener la referencia a la charla Import vs DirectQuery, pero con la fecha actualizada.

**2) VertiPaq: diccionario, RLE, value/hash encoding (12 min)**
- Mantener los ejemplos DateCode y ShopId, que son buenos.
- Mantener el consejo de ordenar el origen como **truco de experiencia, no garantizado**, y medir el efecto en vivo (mismo dato ordenado vs sin ordenar).
- Añadir: segmentos, ordenación automática, `Encoding hint`, columnas que no se usan (ocultarlas no las elimina).
- Efecto de las columnas calculadas (diapositivas 14–15) y comparación con Power Query.

**3) Procesamiento y refresco (8 min)** — *nuevo*
- Query folding: cómo comprobarlo y qué lo rompe.
- Particiones e incremental refresh; paralelismo.
- Direct Lake: *framing* en vez de refresco. El *fallback a DirectQuery* solo existe en Direct Lake sobre SQL endpoint (es más lento y conviene detectarlo). Direct Lake sobre OneLake no tiene fallback.

**4) Reducción de tamaño en 5 pasos (7 min)** — *nuevo*, con demo
1. Desactivar Auto date/time.
2. Separar fecha y hora; truncar decimales innecesarios.
3. Sustituir claves de texto por enteros.
4. Eliminar columnas que no se usan.
5. Revisar jerarquías y columnas de alta cardinalidad.

### 3.2 Demos

- **Demo A (existente)**: ejemplo de compresión con DateCode y ShopId, mostrando el diccionario real con VertiPaq Analyzer.
- **Demo B (nueva)**: modelo "antes/después" del paso 4. Medir tamaño total y por columna con VertiPaq Analyzer (DAX Studio o Tabular Editor).
- **Demo C (nueva, 3 min)**: mismo modelo con y sin una columna GUID en la tabla de hechos. Comparar tamaño en memoria y tiempo de refresco. Después lanzar una consulta que **no** usa esa columna y comprobar que su tiempo apenas cambia (almacenamiento columnar). Lección: la columna cuesta memoria y refresco, y penaliza las consultas que sí la tocan (p. ej. `DISTINCTCOUNT`).

### 3.3 Y esto con IA, ¿qué?
- Pegar la tabla de columnas de VertiPaq Analyzer (*View Metrics* en DAX Studio) a un asistente y pedir "las 10 columnas que más ahorrarían y por qué". **Punto clave:** la IA propone, el modelo y el usuario deciden. Hay que comprobar que la columna no se use en informes ni en relaciones.
- Un asistente con acceso al modelo puede inspeccionarlo y proponer cambios. Microsoft presentó en Ignite (noviembre 2025), en *public preview*, dos servidores MCP oficiales: **Power BI Modeling MCP** (crear y modificar modelos en Desktop o Fabric) y **Remote MCP** (consultar modelos existentes). También hay implementaciones de terceros. 🔎 Confirmar el estado y los permisos antes de enseñarlo.
- Pedir a la IA que revise las reglas del Best Practice Analyzer y redacte nuevas reglas para tu organización.

---

## 4. Bloque 2 — Herramientas y método de medición (30 min)

### 4.1 Contenido

**Herramientas (10 min)**
- Tabular Editor (2 y 3), DAX Studio, ALM Toolkit: conservar el recorrido "como si fuera la primera vez".
- **Nuevas**: DAX query view y TMDL view de Power BI Desktop; Semantic Link / Semantic Link Labs en notebooks de Fabric; DAX Optimizer; workspace monitoring.
- DAX Studio añade soporte para el evento *ExecutionMetrics* en Server Timings y mejoras con Direct Lake 🔎 (según la búsqueda; comprobar la versión instalada).

**Método de medición (15 min)**
1. Capturar la consulta con Performance Analyzer ("Copy query").
2. Pegarla en DAX Studio.
3. Limpiar caché → ejecutar → anotar **FE ms, SE ms, nº de SE queries, SE CPU, filas y KB de los data caches**.
4. Repetir varias veces en frío y en caliente y quedarse con la mediana. DAX Studio lo automatiza con **Run Benchmark** (pestaña *Advanced*): limpia la caché antes de cada ejecución en frío y resume duración total y SE.
5. Anotar en la **plantilla `benchmark`**:

| Variante | Frío ms | Caliente ms | FE ms | SE ms | Nº SE | Filas | KB | Callbacks (Sí/No) |
|---|---|---|---|---|---|---|---|---|

**Consejo:** que cada asistente rellene esta plantilla durante todo el workshop. Al final, el cuadro comparativo sale solo.

### 4.2 Demos
- **Demo (existente)**: Performance Analyzer → DAX Studio → Server Timings.
- **Demo (nueva)**: ejecutar la misma consulta con caché fría y caliente. En caliente, las consultas SE se resuelven desde la caché y el tiempo de SE cae, mientras que el FE trabaja igual. Rematar con *Run Benchmark*.

### 4.3 Y esto con IA, ¿qué?
- **Patrón "trace → IA → re-trace":** copiar la consulta y los Server Timings, pedir al asistente que interprete el plan y proponga una reescritura. Después medir con el mismo método. Si la IA mejora el tiempo, se queda. Si no, se descarta.
- Copilot en DAX query view para explicar una consulta o proponer una versión alternativa.
- Aviso: la IA no ve el plan físico si no se lo das. Entrégale siempre la traza, no solo el código.

---

## 5. Bloque 3 — Tiempo: dimensión, cálculos y rendimiento (45 min)

### 5.1 Contenido (diapositivas 16–27)

**1) Qué tiene una buena dimensión tiempo (8 min)**
- Mantener la "visión casi completa" y la discusión DAX / Power Query / base de datos.
- Recomendación: generarla en el origen (warehouse/lakehouse) si el equipo lo permite; DAX/Power Query para prototipos.
- Atributos adicionales: festivos (locales, variables), campañas, años fiscales, semanas ISO, rebajas. Retos: no complicar y no penalizar rendimiento.

**2) Cómo implementar los cálculos de tiempo (12 min)**
- DAX uno a uno → patrones en Tabular Editor con C# → **grupos de cálculo** con `SELECTEDMEASURE` y formato dinámico.
- **Novedad 🔎: inteligencia de tiempo basada en calendarios.** Llegó en *public preview* a Desktop en septiembre de 2025 y no he encontrado anuncio de GA. Permite calendarios gregorianos, fiscales, retail (445/454/544), ISO, 13 meses o lunares, y añade funciones semanales como `TOTALWTD`. Se define con la interfaz de calendarios o en TMDL, y elimina la exigencia de una tabla de fechas continua. Microsoft Learn la recomienda también por rendimiento: buena ocasión para medirlo en directo.
- Mostrar `TOTALYTD` clásico vs la versión con calendario, y medir ambos.

**3) Aproximaciones y rendimiento (20 min)** — la parte más valiosa del original
- Cifras de la diap. 25:
  - AA v1 (`SAMEPERIODLASTYEAR`): 32 ms, 11 SE queries, 327 KB, 24 495 filas.
  - AA v2 (offset sobre el Año u otro campo): 17 ms, 9 SE, 23 KB, 1 015 filas.
  - AA v3 (truco *DateEquivalente −1* + `USERELATIONSHIP`): 9 ms, 4 SE, 12 KB, 404 filas.
  - Grupo de cálculo, ítem "AA V1": 47 ms, 22 SE, 397 KB, 40 351 filas.
  - Grupo de cálculo, ítem "AA V2": 40 ms, 23 SE, 42 KB, 1 338 filas.
  - Mensaje para la sala: si esos ítems replican la lógica de v1 y v2 (confírmalo en la demo), en aquella medición el grupo de cálculo costó más que la medida equivalente. Hay que volver a medirlo.
- Cifras de la diap. 26:
  - YTD v1 (`TOTALYTD`): 33 ms, 13 SE, 330 KB, 24 463 filas.
  - YTD v2 (tabla intermedia con YTD "explotado" + `USERELATIONSHIP` MxN): 8 ms, 4 SE, 12 KB, 404 filas.
- **Añadir variantes 2.0 a la misma tabla:**
  - AA/YTD con **calendario** (nuevo).
  - AA con **`OFFSET`/`WINDOW`** (medirlas; no dar por hecho que ganan).
  - AA envuelto en una **UDF** (misma lógica, reutilizable).
- Discutir el coste de v3 y v2: mantenimiento, tamaño de la tabla puente y legibilidad. *La más rápida no siempre es la mejor para el equipo.*

**4) YTD ¿a qué fecha calculamos? (5 min)**
- Cierre sobre fechas futuras y cierres parciales (pregunta recurrente).

### 5.2 Demos
- **Demo 1 (existente):** creación de la dimensión tiempo en todos los sabores (DAX, PQ, SQL) — recortar a 7 min y comparar tamaño.
- **Demo 2 (existente):** cálculos de tiempo con Tabular Editor y grupos de cálculo — dejar solo la versión con grupo de cálculo + formato dinámico.
- **Demo 3 (existente):** comprobación de rendimiento de las distintas opciones — ahora con la plantilla `benchmark`.
- **Demo 4 (nueva):** mismo informe, mismo AA, con tabla de fechas clásica vs calendario.

### 5.3 Y esto con IA, ¿qué?
- Pedir a un asistente que genere la dimensión tiempo según los atributos del negocio (festivos locales, fiscal, semanas ISO) **en T-SQL, Power Query o TMDL**; se revisa y se mide como cualquier otra.
- Convertir las medidas de tiempo clásicas a la versión con calendario con ayuda de IA, **validando que los resultados coinciden** con una consulta de comparación (`EXCEPT` en los dos sentidos).
- Riesgo típico: la IA inventa un nombre de función de tiempo o aplica `DATEADD` en tablas con huecos. Dejar siempre un test de regresión.

---

## 6. Descanso (10 min)

---

## 7. Bloque 4 — Multi-idioma y multi-moneda (35 min)

### 7.1 Multi-idioma (15 min)

**Contenido (diapositivas 30–34)**
1. **Literales** (Marca → Brand): traducción de la interfaz.
2. **Contenido** (descripción de producto por idioma).
3. Solución sencilla: exportar a mano o con Tabular Editor.
4. Solución compleja: relaciones MxN (reales o virtuales) o parámetros (la diap. 31 dice *What-if*; las diap. 33–34 usan parámetros de campo).

**Cifras originales**
- MxN: 111 ms, 105 SE queries, 1 056 KB, muchas filas.
- Parámetros de campo: 11 ms, 1 SE, 2 KB, 120 filas.

**Mejoras**
- **`USERCULTURE()`** para escoger el idioma del usuario sin slicer. 🔎 Confirmar en el servicio y en Desktop.
- Traducciones de metadatos del modelo (culturas) para nombres de tablas, columnas y medidas.
- Dejar claro cuándo una solución *no* escala (muchos idiomas, muchas columnas).

### 7.2 Multi-moneda (20 min)

**Contenido (diapositivas 35–39)**
- Sencillo: tres columnas en el hecho (euros, dólares, local) → tres medidas o una con slicer.
- Complejo: tabla de cambios con factor de origen a base y su inverso, moneda destino única, granularidad moneda-fecha.
- Cifras de la diap. 39:
  - MxN solo a base: 75 ms / 21 SE / 1 119 KB / muchas filas.
  - Campos fijos + switch: 33 ms / 8 SE / 90 KB / ~2 800 filas.
  - Ambas monedas: 9 ms / 1 SE / 60 KB / 2 535 filas.

**Mejoras**
- Patrón con **grupo de cálculo para conversión de moneda** + **formato dinámico** (símbolo/decimales por moneda).
- Redondeo y moneda base: dejar claro dónde se convierte (por línea o por agregado). Cambia el resultado.
- Tabla de tipos de cambio con fecha de vigencia (último cambio ≤ fecha del hecho). Medir ambos enfoques.

### 7.3 Demos
- Existentes: multi-idioma de literales + contenido; MxN vs parámetros de campo; multi-moneda sencilla y compleja.
- **Nueva:** `USERCULTURE()` cambiando la salida sin tocar el slicer.
- **Nueva:** formato dinámico con símbolo de moneda.

### 7.4 Y esto con IA, ¿qué?
- Traducir los literales y las descripciones con un asistente, **con glosario de negocio** (si no, "Margen" acaba traducido como "Margin" y "Gross profit" a la vez).
- Revisión de consistencia: pedirle una lista de términos que cambian entre idiomas.
- No usar IA para tipos de cambio: son datos, no texto. La IA diseña el patrón, el dato viene de una fuente fiable.

---

## 8. Bloque 5 — FE/SE, Fusion, Callbacks y materialización (40 min)

### 8.1 Contenido (diapositivas 40–53)

**1) Motor: SE vs FE (8 min)**
- Mantener las dos cajas (SE multihilo/simple/con caché; FE monohilo/complejo/lee data caches).
- Añadir: **el tamaño de la caché de datos** (materialización) como tercer eje.

**2) DAX Fusion (10 min)**
- Prueba del original (diap. 45): un visual pide 4 columnas de la misma tabla. ¿1 consulta o 4? Esto es **vertical fusion**: varias agregaciones con el mismo contexto de filtro en una sola consulta SE.
- Añadir **horizontal fusion** (Power BI, septiembre 2022): consultas SE que solo difieren en el filtro sobre una columna se fusionan en una, añadiendo esa columna al agrupado. Es lo que ocurre en comparativas por periodo, ítems de grupos de cálculo o conversiones por moneda.
- Patrones que pueden impedir la fusión: lógica que cambia según la medida (`IF`/`SWITCH` con ramas distintas) o filtros sobre columnas diferentes. Comprobarlo siempre en Server Timings, no a ojo.
- Discusión del original: *¿qué hacemos si se rompe?* → medidas con filtros uniformes, `VAR` para evaluar una vez, simplificar condicionales.

**3) Callbacks (12 min)**
- Ejemplo del original (diap. 51): `SUMX('Internet Sales', IF([SalesAmount] > 10, 1, 0))`. El SE no sabe evaluar el `IF` y pide al FE que lo evalúe durante el escaneo (el "cell by cell" de tabular).
- Cómo detectarlos: DAX Studio, consultas SE en negrita con `CallbackDataID`.
- **Re-medir:** antes de enseñar un ejemplo, comprobar en la versión actual que sigue generando callback. El motor cambia entre versiones.
- Reescritura clásica: `CALCULATE(COUNTROWS('Internet Sales'), 'Internet Sales'[SalesAmount] > 10)`. Ojo: no es idéntica, porque devuelve BLANK donde la original devuelve 0. Si hace falta el 0, añadir `+ 0` o `COALESCE(..., 0)`, y medir el efecto.

**4) Materialización (5 min)** — *nuevo*
- Un `FILTER` que itera una tabla de hechos grande con predicados complejos o con medidas (transición de contexto por fila), o un `SUMMARIZE`/`ADDCOLUMNS` con muchas columnas, puede crear una caché enorme. Con un predicado simple sobre una columna, el optimizador suele generar el mismo plan que un filtro de columna.
- Mostrar "filas y KB" en Server Timings como indicador principal.

**5) Otras optimizaciones DAX (5 min)**
- `VAR` y evaluación única; evitar iteradores anidados y transiciones de contexto innecesarias; `KEEPFILTERS`; `SELECTEDVALUE`; `COALESCE`.
- **Nuevo:** UDF para empaquetar patrones. Su objetivo es reutilizar y mantener el código, no acelerarlo. Ojo con el modo de paso de parámetros: `VAL` evalúa el argumento una vez en el contexto de quien llama; `EXPR` lo evalúa donde se usa dentro de la función, y puede hacerlo varias veces. Medir siempre frente a la versión sin UDF.

### 8.2 Demos
- **Demo 1 (existente):** ruptura de DAX Fusion con multi-moneda; después, evitar la ruptura. Volver a grabarla con el motor actual: la horizontal fusion (2022) puede haber cambiado el resultado.
- **Demo 2 (existente):** detectar y eliminar un callback.
- **Demo 3 (nueva):** `FILTER` sobre hechos vs `CALCULATE` con predicado de columna; comparar filas y KB de caché. Si el optimizador las resuelve igual, también es una lección: probar después con un predicado que use una medida.
- **Demo 4 (nueva):** la misma lógica escrita con una UDF (`VAL` y `EXPR`); medir y comparar planes.

### 8.3 Y esto con IA, ¿qué?
- **Reto "IA vs plan de ejecución":** darle a un asistente solo el código, luego código + traza, y comparar la calidad de sus propuestas. Se aprende mucho sobre qué contexto necesita.
- Pedir una explicación del `Explain Plan`/Server Timings en lenguaje llano para equipos junior.
- Que la IA convierta bloques repetidos en UDF, **con test de equivalencia**.
- Peligro: sugiere reglas "de manual" que ya no aplican (como las del checklist de 2022). Siempre medir.

---

## 9. Bloque 6 — Capa de informe, producción y checklist 2.0 (25 min)

### 9.1 Contenido

**Capa de informe (8 min)** — *nuevo*
- Número de visuales por página; visuales "pesados" (matrices con muchas medidas).
- Slicers: botón *Apply all slicers* (y opciones de reducción de consultas), segmentadores en cascada.
- Cinta *Optimize*: *Optimization presets* (reducción de consultas vs interactividad) para el consumidor; *Pause visuals* es una ayuda para quien diseña en Desktop (sobre todo con DirectQuery), no acelera el informe publicado.
- Tooltips de página, drill-through y bookmarks: comprobar con Performance Analyzer qué consultas lanzan realmente.

**Producción (7 min)** — *nuevo*
- RLS: evitar ORs complejos y filtros bidireccionales; probar con carga real.
- Monitorización: workspace monitoring, Capacity Metrics, logs de consultas. 🔎
- Query scale-out, caché de consultas, modelo grande (large format).

**Checklist 2.0 (10 min)** — evolución del de marzo 2022

| # | Antes (2022) | Ahora (2.0) |
|---|---|---|
| 1 | Usar siempre DIVIDE, COALESCE, SUMMARIZECOLUMNS o ADDCOLUMNS(SUMMARIZE()) | DIVIDE cuando el denominador sea una expresión que pueda dar 0/BLANK; `/` con denominador constante; SUMMARIZE solo para agrupar |
| 2 | Iteradores, anidados y transición de contexto | Se mantiene; medir con filas/KB de caché |
| 3 | Filtros dinámicos | Se mantiene |
| 4 | Tamaño de los data caches | **Primer indicador a mirar** |
| 5 | Callbacks | Detectar y **re-medir** en cada versión del motor |
| 6 | Evitar lógica con ORs (RLS) | Se mantiene; probar con carga real |
| 7 | — | **Medir antes de optimizar (caché fría y caliente)** |
| 8 | — | Modelo: cardinalidad, enteros, sin Auto date/time |
| 9 | — | Informe: nº de visuales, *Apply all slicers*, *Optimization presets* |
| 10 | — | Usar UDF para reutilizar, no para acelerar; cuidado con `VAL`/`EXPR` |
| 11 | — | Fusion: comprobar vertical y horizontal en Server Timings |
| 12 | — | La IA propone, la traza decide |

### 9.2 Demo
- **Demo (nueva, 5 min):** un informe con 20 visuales y Performance Analyzer. (1) Contar las consultas al cambiar 3 slicers, con y sin *Apply all slicers*. (2) Reducir visuales (p. ej. agrupar tarjetas en una sola visual) y comparar el tiempo de carga de la página.

### 9.3 Y esto con IA, ¿qué?
- **Auditoría asistida:** pasarle a un asistente la salida de VertiPaq Analyzer, el BPA y el listado de medidas y pedir un informe priorizado (impacto/esfuerzo).
- **Agentes con acceso al modelo** (Power BI Modeling MCP, en preview 🔎): útiles para hacer cambios masivos (renombrar, formatear, documentar medidas). Control: revisar el diff (TMDL en git) antes de publicar.
- **Documentación automática** de medidas y modelo. Un buen sitio donde la IA ahorra tiempo sin riesgo de rendimiento.

---

## 10. Bloque 7 — Cierre (10 min)

1. Repaso del checklist 2.0 (3 min).
2. **Tabla `benchmark` final** de la sala: qué patrón ganó en qué escenario (3 min).
3. Retos para casa (2 min):
   - Re-medir un patrón que ya tienes en producción.
   - Meter el BPA en el flujo de despliegue.
   - Probar la inteligencia de tiempo basada en calendarios en una copia del modelo.
4. Preguntas (2 min). Contacto: www.naveiaschool.com — formate@naveiaschool.com.

---

## 11. Anexo A — Banco de demos nuevas

| ID | Nombre | Qué demuestra | Duración |
|---|---|---|---|
| N1 | Modelo antes/después (tamaño) | Efecto de cardinalidad, GUIDs, Auto date/time | 8 min |
| N2 | Frío vs caliente | Por qué hay que limpiar caché | 4 min |
| N3 | AA con calendarios vs v1/v2/v3 | Rendimiento y simplicidad | 8 min |
| N4 | `USERCULTURE()` | Multi-idioma sin slicer | 4 min |
| N5 | Conversión de moneda con grupo de cálculo + formato dinámico | Patrón actual | 6 min |
| N6 | `FILTER` vs `CALCULATE` con predicado | Materialización | 5 min |
| N7 | UDF vs medida sin UDF | Efecto de `VAL`/`EXPR` en el plan | 4 min |
| N8 | Informe de 20 visuales | *Apply all slicers*, nº de visuales | 5 min |
| N9 | Reto IA con/sin traza | Qué contexto necesita la IA | 8 min |

Fragmento ilustrativo para N6 (ajustar nombres a tu modelo). Con un predicado tan simple, el optimizador puede generar el mismo plan para ambas: comprobarlo en Server Timings.

```dax
-- Variante A: FILTER itera la tabla de hechos
EVALUATE
ROW ( "x", COUNTROWS ( FILTER ( 'Internet Sales', 'Internet Sales'[SalesAmount] > 10 ) ) )

-- Variante B: filtro de columna en CALCULATE
EVALUATE
ROW ( "x", CALCULATE ( COUNTROWS ( 'Internet Sales' ), 'Internet Sales'[SalesAmount] > 10 ) )
```

Fragmento ilustrativo para N7 (sintaxis de UDF 🔎: confirmar en tu versión; las anotaciones de tipo son opcionales):

```dax
DEFINE
    FUNCTION PctDe = ( n : VAL, d : VAL ) => DIVIDE ( n, d )
EVALUATE
ROW ( "pct", PctDe ( [Ventas], [Ventas Totales] ) )
```

## 12. Anexo B — Plantilla de prompt "trace → IA"

> Eres un experto en rendimiento DAX. Te paso: (1) el esquema relevante del modelo, (2) la medida/consulta, (3) los Server Timings con caché fría (FE, SE, nº de SE queries, filas y KB de los data caches) y (4) cualquier callback detectado. Propón como máximo 3 reescrituras que mantengan el mismo resultado, explica qué cambia en el plan y dime cómo comprobar que el resultado es idéntico.

Siempre: ejecutar la reescritura, comparar resultado (`EXCEPT` o comparación de tablas) y comparar la tabla `benchmark`.

## 13. Anexo C — Fuentes y puntos a verificar antes de presentar

**Contrastado (octubre 2026)**
- **Vertical y horizontal fusion**, y fecha de la horizontal fusion (septiembre 2022): SQLBI, [Introducing horizontal fusion in DAX](https://www.sqlbi.com/articles/introducing-horizontal-fusion-in-dax/) y [Optimizing fusion optimization for DAX measures](https://www.sqlbi.com/articles/optimizing-fusion-optimization-for-dax-measures/).
- **DIVIDE vs `/`**: Microsoft Learn, [DAX: DIVIDE function vs divide operator](https://learn.microsoft.com/en-us/dax/best-practices/dax-divide-function-operator).
- **Run Benchmark** de DAX Studio (frío/caliente): [daxstudio.org – Run Benchmark](https://daxstudio.org/docs/features/run-benchmark/).
- **Direct Lake y fallback** (solo sobre SQL endpoint; no sobre OneLake): Microsoft Learn, [How Direct Lake works](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-how-it-works).
- **Cinta Optimize** (*Pause visuals*, *Apply all slicers*, *Optimization presets*): Microsoft Learn, [Optimize ribbon in Power BI Desktop](https://learn.microsoft.com/en-us/power-bi/create-reports/desktop-optimize-ribbon).
- **Inteligencia de tiempo basada en calendarios** (*public preview*, septiembre 2025): [blog de Power BI](https://powerbi.microsoft.com/en-us/blog/calendar-based-time-intelligence-time-intelligence-tailored-preview/), [SQLBI](https://www.sqlbi.com/articles/introducing-calendar-based-time-intelligence-in-dax/) y [Microsoft Learn](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-time-intelligence). No encontré anuncio de GA.
- **UDF: sintaxis y modos `VAL`/`EXPR`**: [SQLBI – Introducing user-defined functions in DAX](https://www.sqlbi.com/articles/introducing-user-defined-functions-in-dax/) y [Microsoft Learn – FUNCTION statement](https://learn.microsoft.com/en-us/dax/function-statement-dax).
- **Servidores MCP oficiales de Power BI** (Modeling y Remote, *public preview* desde Ignite, noviembre 2025): [Microsoft Learn – MCP servers overview](https://learn.microsoft.com/en-us/power-bi/developer/mcp/mcp-servers-overview).

**Pendiente de confirmar en tu versión** 🔎
- **GA de las UDF** (junio 2026) y nivel de compatibilidad 1702+: solo lo he visto en fuentes secundarias.
- **DAX Studio**: soporte del evento *ExecutionMetrics* y mejoras con Direct Lake (notas de versión).
- Si los ejemplos de **callback** del PDF siguen generando callback hoy: no he encontrado documentación de cambios concretos; probarlo en vivo.
- `USERCULTURE()`, *query caching* en Premium/Fabric, uso de SUMMARIZECOLUMNS dentro de medidas y limitaciones de columnas calculadas en Direct Lake: confirmar comportamiento y versión mínima.
- Cifras de las diapositivas (ms, SE queries, KB, filas): proceden del PDF y deben **re-medirse** en el entorno de la sesión.
