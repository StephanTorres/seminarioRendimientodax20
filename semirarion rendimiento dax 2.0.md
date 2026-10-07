# Seminario Rendimiento DAX 2.0 — Guión del workshop (4 h)

> Base: "WorkShop Funcionalidades Avanzadas y Rendimiento" (octubre 25), 56 diapositivas, con checklist final fechado en marzo 2022.
> Este guión reordena el material, corrige lo obsoleto, añade demos y cierra cada sección con **"Y esto con IA, ¿qué?"**.

**Nota de método.** He revisado el texto del PDF, no las capturas ni las demos en sí. Las cifras de las diapositivas (ms, consultas SE, KB, filas) las trato como "datos de la última vez que se midió". Las novedades de producto marcadas con 🔎 deben **confirmarse en tu versión de Desktop o Fabric antes de presentar**: el estado preview/GA cambia cada mes. De las que busqué, solo las UDF y la inteligencia de tiempo basada en calendarios tienen estado indicado abajo.

---

## 0. Hallazgos de la revisión crítica

### 0.1 Afirmaciones del material original

| # | Afirmación original (dispositiva) | Veredicto | Qué decir en 2.0 |
|---|---|---|---|
| 1 | Los modos son Import / DirectQuery / Live / Dual | **Incompleto** | Faltan Direct Lake (Fabric), modelos compuestos sobre semantic models, tablas híbridas, agregaciones de usuario y automáticas. "Live connection" es hoy "conexión a un semantic model". Añadir una matriz de decisión. |
| 2 | "Intenta ordenar las columnas para obtener el mejor ratio de compresión" | **Matizar** | VertiPaq decide el orden por segmento. La palanca real es **reducir cardinalidad**, separar fecha y hora, usar enteros, quitar GUIDs/textos largos, desactivar Auto date/time y revisar el encoding (hint Value/Hash). Ordenar el origen ayuda poco. |
| 3 | Diccionario "innecesario" para Int; RLE | **Correcto, pero simplificado** | Añadir value encoding vs hash encoding, y que RLE depende del orden *dentro del segmento*. Introducir segmentos y su efecto. |
| 4 | Las columnas calculadas comprimen peor | **Vigente con matices** | Se calculan en el refresco, se almacenan y no heredan el orden del origen. Mover la lógica a Power Query o al origen sigue siendo lo recomendable. Con Direct Lake, no hay Power Query en el modelo. La lógica debe estar en el lakehouse o warehouse. |
| 5 | "Procesamiento de los datos (CPU y RAM)" es una de las 3 áreas a optimizar | **Anunciado y no desarrollado** | El PDF no trata el refresco. Falta query folding, particiones, incremental refresh, paralelismo y framing en Direct Lake. Se añade como sección. |
| 6 | Formula Engine "mono hilo (¡no siempre!)" y "sin caché" | **Precisar** | El FE es esencialmente monohilo. La concurrencia viene de los *callbacks* que el SE lanza al FE. Hay caché de SE, y el servicio tiene además caché de consultas de visuales. Redactar esto mejor. |
| 7 | "Regla de oro: + SE − FE" | **Útil pero incompleta** | Añadir una segunda regla: **menos materialización** (tamaño de los data caches). Muchas consultas lentas son SE rápido más una caché enorme que el FE tiene que procesar. |
| 8 | Esquema DSE / Data Model Engine | **Revisar** | Mantenerlo como idea, pero verificar el diagrama. Hoy es más útil enseñar el flujo *visual → consulta DAX (SUMMARIZECOLUMNS + TOPN) → plan lógico/físico → xmSQL*. |
| 9 | Dos soluciones de AA, YTD y multi-idioma con "tabla intermedia" y relaciones MxN (v2/v3) | **Re-medir** | Hay alternativas nuevas: inteligencia de tiempo basada en calendarios 🔎 (la búsqueda la sitúa en preview desde sept 2025; comprobar si ya es GA), funciones de ventana (OFFSET/WINDOW/INDEX/RANK) y UDF. Todas se miden contra v1/v2/v3. |
| 10 | "DAX Fusion" = que 4 columnas de la misma tabla vayan en 1 consulta | **Correcto pero parcial** | Es horizontal fusion. Falta vertical fusion y los patrones que la rompen (IF/SWITCH con ramas distintas, medidas con filtros dispares). Mantener la prueba "¿1 consulta o 4?" y ampliarla con Server Timings. |
| 11 | Callback = rendimiento malo, "no hay fórmulas mágicas" | **Matizar** | Han mejorado varios casos (comprobarlo medida a medida, no confiar en el folklore). Aun así hay que saber detectarlos: en DAX Studio, SE "CallbackDataID" en negrita. |
| 12 | Checklist (marzo 2022): "usar siempre DIVIDE" | **Matizar** | DIVIDE sigue siendo seguro cuando el divisor puede ser 0 o blanco. No es "siempre". Comparar `/` con `DIVIDE` en el modelo actual. |
| 13 | Checklist: "SUMMARIZECOLUMNS o ADDCOLUMNS(SUMMARIZE())" | **Actualizar** | Mantener y añadir: SUMMARIZE solo para agrupar, nunca para añadir columnas calculadas. Revisar si SUMMARIZECOLUMNS es ya utilizable dentro de medidas en tu caso 🔎. |
| 14 | Checklist: iteradores anidados, transición de contexto, filtros dinámicos, ORs en RLS | **Vigente** | Reforzar con ejemplos medidos. |
| 15 | Herramientas: Tabular Editor, DAX Studio, ALM Toolkit | **Ampliar** | Añadir: DAX query view, TMDL view, Best Practice Analyzer, Semantic Link Labs, VertiPaq Analyzer, DAX Optimizer, Performance Analyzer renovado, workspace monitoring. |
| 16 | "Calculation groups + dynamic format string" | **GA** | Hoy es patrón estándar. Enlazarlo con multi-moneda y multi-idioma. |
| 17 | Multi-idioma con parámetros de campo (11 ms vs 111 ms) | **Vigente y reforzable** | Añadir `USERCULTURE()` para elegir idioma sin slicer, y traducciones de metadatos del propio modelo (culturas). |
| 18 | Medidas con funciones "copy-paste" | **Obsoleto** | Las UDF de DAX (GA en junio 2026 según los resultados de la búsqueda; compat. 1702+) permiten reutilizar patrones sin duplicar lógica. |

### 0.2 Huecos del material original

- No se habla de **diseño del informe**: nº de visuales, slicers, tooltips, interacciones, "Optimize ribbon" (pausar visuales, presets).
- No se habla de **producción**: monitorización, capacidades, RLS en carga real, query scale-out, caché.
- No hay **método de medición reproducible** (caché fría y caliente, repeticiones, tabla de resultados).
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

Cada bloque termina con **"Y esto con IA, ¿qué?"** (3–5 min, ya incluido en su tiempo).

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

### 3.1 Contenido (diapositivas 72–195 del original)

**1) Modos de almacenamiento (8 min)**
- Import, DirectQuery, Dual, conexión a semantic model; **añadir Direct Lake** y modelos compuestos.
- Matriz de decisión: volumen, frescura, latencia aceptable, coste de capacidad, seguridad.
- Mantener la referencia a la charla Import vs DirectQuery, pero con la fecha actualizada.

**2) VertiPaq: diccionario, RLE, value/hash encoding (12 min)**
- Mantener los ejemplos DateCode y ShopId, que son buenos.
- Añadir: segmentos, ordenación automática, `Encoding hint`, columnas que no se usan (ocultarlas no las elimina).
- Efecto de las columnas calculadas (diapositivas 176–191) y comparación con Power Query.

**3) Procesamiento y refresco (8 min)** — *nuevo*
- Query folding: cómo comprobarlo y qué lo rompe.
- Particiones e incremental refresh; paralelismo.
- Direct Lake: *framing* en vez de refresco. Qué pasa con el *fallback a DirectQuery* y cómo se detecta.

**4) Reducción de tamaño en 5 pasos (7 min)** — *nuevo*, con demo
1. Desactivar Auto date/time.
2. Separar fecha y hora; truncar decimales innecesarios.
3. Sustituir claves de texto por enteros.
4. Eliminar columnas que no se usan.
5. Revisar jerarquías y columnas de alta cardinalidad.

### 3.2 Demos

- **Demo A (existente)**: ejemplo de compresión con DateCode y ShopId, mostrando el diccionario real con VertiPaq Analyzer.
- **Demo B (nueva)**: modelo "antes/después" del paso 4. Medir tamaño total y por columna con VertiPaq Analyzer (DAX Studio o Tabular Editor).
- **Demo C (nueva, 3 min)**: mostrar que la misma consulta DAX tarda distinto cuando el modelo tiene una columna GUID en la tabla de hechos.

### 3.3 Y esto con IA, ¿qué?
- Pegar el resultado del VertiPaq Analyzer (CSV) a un asistente y pedir "las 10 columnas que más ahorrarían y por qué". **Punto clave:** la IA propone, el modelo y el usuario deciden. Hay que comprobar que la columna no se use en informes ni en relaciones.
- Un asistente con acceso a los metadatos del modelo (servidor MCP de modelado de Power BI) puede inspeccionar el modelo y proponer cambios. 🔎 Confirmar el estado del servidor MCP y sus permisos antes de enseñarlo.
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
4. Repetir 5 veces en frío y 5 en caliente; quedarse con la mediana.
5. Anotar en la **plantilla `benchmark`**:

| Variante | Frío ms | Caliente ms | FE ms | SE ms | Nº SE | Filas | KB | Callbacks (Sí/No) |
|---|---|---|---|---|---|---|---|---|

**Consejo:** que cada asistente rellene esta plantilla durante todo el workshop. Al final, el cuadro comparativo sale solo.

### 4.2 Demos
- **Demo (existente)**: Performance Analyzer → DAX Studio → Server Timings.
- **Demo (nueva)**: ejecutar la misma consulta con caché fría y caliente y ver cómo cambia el número de SE queries.

### 4.3 Y esto con IA, ¿qué?
- **Patrón "trace → IA → re-trace":** copiar la consulta y los Server Timings, pedir al asistente que interprete el plan y proponga una reescritura. Después medir con el mismo método. Si la IA mejora el tiempo, se queda. Si no, se descarta.
- Copilot en DAX query view para explicar una consulta o proponer una versión alternativa.
- Aviso: la IA no ve el plan físico si no se lo das. Entrégale siempre la traza, no solo el código.

---

## 5. Bloque 3 — Tiempo: dimensión, cálculos y rendimiento (45 min)

### 5.1 Contenido (diapositivas 199–335)

**1) Qué tiene una buena dimensión tiempo (8 min)**
- Mantener la "visión casi completa" y la discusión DAX / Power Query / base de datos.
- Recomendación: generarla en el origen (warehouse/lakehouse) si el equipo lo permite; DAX/Power Query para prototipos.
- Atributos adicionales: festivos (locales, variables), campañas, años fiscales, semanas ISO, rebajas. Retos: no complicar y no penalizar rendimiento.

**2) Cómo implementar los cálculos de tiempo (12 min)**
- DAX uno a uno → patrones en Tabular Editor con C# → **grupos de cálculo** con `SELECTEDMEASURE` y formato dinámico.
- **Novedad 🔎: inteligencia de tiempo basada en calendarios.** Según lo buscado, se activó en preview en Desktop (sept 2025) y permite calendarios fiscales, retail (445/454/544), ISO, 13 meses o lunares, con funciones como `TOTALWTD`. Comprobar si ya es GA. Se define con la interfaz de calendario o en TMDL, y ya no exige una tabla de fechas continua.
- Mostrar `TOTALYTD` clásico vs la versión con calendario, y medir ambos.

**3) Aproximaciones y rendimiento (20 min)** — la parte más valiosa del original
- AA v1 (`SAMEPERIODLASTYEAR`): 47 ms, 22 SE queries, 397 KB, 40 351 filas.
- AA v2 (offset sobre Año u otro campo): 32 ms, 11 SE, 327 KB.
- AA v3 (truco *DateEquivalente −1* + `USERELATIONSHIP`): 9 ms, 4 SE, 12 KB, 404 filas.
- Grupo de cálculo AA: 40 ms, 23 SE, 42 KB.
- YTD v1 `TOTALYTD`: 33 ms, 13 SE, 330 KB. YTD v2 (tabla intermedia con YTD "explotado" + MxN): 8 ms, 4 SE, 12 KB.
- **Añadir variantes 2.0 a la misma tabla:**
  - AA/YTD con **calendario** (nuevo).
  - AA con **`OFFSET`/`WINDOW`** (para mostrar que no siempre ganan: verificar).
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
- Convertir las medidas de tiempo clásicas a la versión con calendario con ayuda de IA, **validando que los resultados coinciden** con una consulta de comparación (`EXCEPT` de ambas).
- Riesgo típico: la IA inventa un nombre de función de tiempo o aplica `DATEADD` en tablas con huecos. Dejar siempre un test de regresión.

---

## 6. Descanso (10 min)

---

## 7. Bloque 4 — Multi-idioma y multi-moneda (35 min)

### 7.1 Multi-idioma (15 min)

**Contenido (diapositivas 363–413)**
1. **Literales** (Marca → Brand): traducción de la interfaz.
2. **Contenido** (descripción de producto por idioma).
3. Solución sencilla: exportar a mano o con Tabular Editor.
4. Solución compleja: relaciones MxN o parámetros de campo.

**Cifras originales**
- MxN: 111 ms, 105 SE queries, 1 056 KB, muchas filas.
- Parámetros de campo: 11 ms, 1 SE, 2 KB, 120 filas.

**Mejoras**
- **`USERCULTURE()`** para escoger el idioma del usuario sin slicer. 🔎 Confirmar en el servicio y en Desktop.
- Traducciones de metadatos del modelo (culturas) para nombres de tablas, columnas y medidas.
- Dejar claro cuándo una solución *no* escala (muchos idiomas, muchas columnas).

### 7.2 Multi-moneda (20 min)

**Contenido (diapositivas 414–463)**
- Sencillo: tres columnas en el hecho (euros, dólares, local) → tres medidas o una con slicer.
- Complejo: tabla de cambios con factor de origen a base y su inverso, moneda destino única, granularidad moneda-fecha.
- Cifras: MxN solo a base 75 ms / 21 SE / 1 119 KB; campos fijos + switch 33 ms / 8 SE / 90 KB; ambas monedas 9 ms / 1 SE / 60 KB.

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

### 8.1 Contenido (diapositivas 464–628)

**1) Motor: SE vs FE (8 min)**
- Mantener las dos cajas (SE multihilo/simple/con caché; FE monohilo/complejo/lee data caches).
- Añadir: **el tamaño de la caché de datos** (materialización) como tercer eje.

**2) DAX Fusion (10 min)**
- Prueba del original: un visual pide 4 columnas de la misma tabla. ¿1 consulta o 4?
- Añadir **vertical fusion**, y los patrones que rompen la fusión (condiciones distintas por medida, `IF`/`SWITCH` con ramas, filtros dispares).
- Discusión del original: *¿qué hacemos si se rompe?* → medidas con filtros uniformes, `VAR` para evaluar una vez, simplificar condicionales.

**3) Callbacks (12 min)**
- Ejemplo del original: `SUMX('Internet Sales', IF([SalesAmount] > 10, 1, 0))`. El SE no sabe evaluar el `IF` y pide al FE que lo haga fila a fila.
- Cómo detectarlos: DAX Studio, líneas de SE en negrita con `CallbackDataID`.
- **Re-medir:** parte de lo que antes provocaba callbacks hoy ya no lo hace. Medirlo en el modelo actual, no asumirlo.
- Reescritura clásica: `CALCULATE(COUNTROWS('Internet Sales'), 'Internet Sales'[SalesAmount] > 10)`.

**4) Materialización (5 min)** — *nuevo*
- Un `FILTER` sobre una tabla de hechos grande o un `SUMMARIZE` con muchas columnas crea una caché enorme.
- Mostrar "filas y KB" en Server Timings como indicador principal.

**5) Otras optimizaciones DAX (5 min)**
- `VAR` y evaluación única; evitar iteradores anidados y transiciones de contexto innecesarias; `KEEPFILTERS`; `SELECTEDVALUE`; `COALESCE`.
- **Nuevo:** UDF para empaquetar patrones, y su efecto (ninguno) sobre rendimiento: son *azúcar*, no optimización. La medición debe confirmarlo.

### 8.2 Demos
- **Demo 1 (existente):** ruptura de DAX Fusion con multi-moneda; después, evitar la ruptura.
- **Demo 2 (existente):** detectar y eliminar un callback.
- **Demo 3 (nueva):** una medida con `FILTER` sobre hechos vs `CALCULATE` con predicado; comparar KB de caché.
- **Demo 4 (nueva):** la misma lógica escrita con una UDF; medir y confirmar el mismo plan.

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
- Slicers: botón "Aplicar", segmentadores en cascada.
- Cinta *Optimize*: pausar visuales, preajustes.
- Tooltips, drill-through y bookmarks que lanzan consultas ocultas.

**Producción (7 min)** — *nuevo*
- RLS: evitar ORs complejos y filtros bidireccionales; probar con carga real.
- Monitorización: workspace monitoring, Capacity Metrics, logs de consultas. 🔎
- Query scale-out, caché de consultas, modelo grande (large format).

**Checklist 2.0 (10 min)** — evolución del de marzo 2022

| # | Antes (2022) | Ahora (2.0) |
|---|---|---|
| 1 | Usar siempre DIVIDE, COALESCE, SUMMARIZECOLUMNS o ADDCOLUMNS(SUMMARIZE()) | DIVIDE cuando el divisor pueda ser 0/blanco; comparar con `/`; SUMMARIZE solo para agrupar |
| 2 | Iteradores, anidados y transición de contexto | Se mantiene; medir con filas/KB de caché |
| 3 | Filtros dinámicos | Se mantiene |
| 4 | Tamaño de los data caches | **Primer indicador a mirar** |
| 5 | Callbacks | Detectar y **re-medir** (el motor mejora) |
| 6 | Evitar lógica con ORs (RLS) | Se mantiene; probar con carga real |
| 7 | — | **Medir antes de optimizar (caché fría y caliente)** |
| 8 | — | Modelo: cardinalidad, enteros, sin Auto date/time |
| 9 | — | Informe: nº de visuales, Aplicar en slicers, Optimize ribbon |
| 10 | — | Usar UDF para reutilizar, sin esperar mejoras de rendimiento |
| 11 | — | La IA propone, la traza decide |

### 9.2 Demo
- **Demo (nueva, 5 min):** un informe con 20 visuales; Performance Analyzer; aplicar "Pausar" y "Aplicar" en slicers y comparar el tiempo de carga de página.

### 9.3 Y esto con IA, ¿qué?
- **Auditoría asistida:** pasarle a un asistente la salida de VertiPaq Analyzer, el BPA y el listado de medidas y pedir un informe priorizado (impacto/esfuerzo).
- **Agentes con acceso al modelo** (servidor MCP de modelado de Power BI): útiles para hacer cambios masivos (renombrar, formatear, documentar medidas). Control: revisar el diff (TMDL en git) antes de publicar.
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
| N7 | UDF = mismo plan | Las UDF no cambian el rendimiento | 4 min |
| N8 | Informe de 20 visuales | Optimize ribbon, Aplicar en slicers | 5 min |
| N9 | Reto IA con/sin traza | Qué contexto necesita la IA | 8 min |

Fragmento ilustrativo para N6 (ajustar nombres a tu modelo):

```dax
-- Versión lenta (candidata a materializar)
EVALUATE
ROW ( "x", COUNTROWS ( FILTER ( 'Internet Sales', 'Internet Sales'[SalesAmount] > 10 ) ) )

-- Versión recomendada
EVALUATE
ROW ( "x", CALCULATE ( COUNTROWS ( 'Internet Sales' ), 'Internet Sales'[SalesAmount] > 10 ) )
```

Fragmento ilustrativo para N7 (sintaxis de UDF 🔎: confirmar en tu versión):

```dax
DEFINE
    FUNCTION PctDe = ( n : SCALAR NUMERIC, d : SCALAR NUMERIC ) => DIVIDE ( n, d )
EVALUATE
ROW ( "pct", PctDe ( [Ventas], [Ventas Totales] ) )
```

## 12. Anexo B — Plantilla de prompt "trace → IA"

> Eres un experto en rendimiento DAX. Te paso: (1) el esquema relevante del modelo, (2) la medida/consulta, (3) los Server Timings con caché fría (FE, SE, nº de SE queries, filas y KB de los data caches) y (4) cualquier callback detectado. Propón como máximo 3 reescrituras que mantengan el mismo resultado, explica qué cambia en el plan y dime cómo comprobar que el resultado es idéntico.

Siempre: ejecutar la reescritura, comparar resultado (`EXCEPT` o comparación de tablas) y comparar la tabla `benchmark`.

## 13. Anexo C — Fuentes y puntos a verificar antes de presentar

- Estado de **DAX user-defined functions**: según búsquedas, GA en la versión de junio de 2026 (compat. 1702+). Confirmar en la documentación oficial de Microsoft Learn.
- Estado de la **inteligencia de tiempo basada en calendarios**: la búsqueda indica *public preview* desde septiembre de 2025 y no encontré confirmación de GA. Comprobarlo en el menú de funciones en vista previa de tu Desktop y en Microsoft Learn ("Time intelligence in Power BI Desktop").
- **DAX Studio** (ExecutionMetrics, Direct Lake, Delta Analyzer): confirmar con las notas de versión de la herramienta.
- **Servidor MCP de modelado de Power BI** y las herramientas de análisis de rendimiento asociadas: confirmar estado y alcance (hay varias implementaciones de terceros).
- Mejoras concretas del motor sobre callbacks y DIVIDE/IF: **no las doy por cerradas**; probar en vivo y consultar los artículos de SQLBI sobre fusion y callbacks.
- `USERCULTURE()`, visual calculations, dynamic format string, selection expressions en grupos de cálculo: confirmar versión mínima.
- Cifras de las diapositivas (ms, SE queries, KB, filas): proceden del PDF y deben **re-medirse** en el entorno de la sesión.
