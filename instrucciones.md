# Instrucciones para Claude Code en VS Code (local, Windows)

Este fichero es el guion para que Claude Code, ejecutándose **en tu máquina** (VS Code, con el PBIP y
Power BI Desktop a mano), prepare y pruebe el modelo y el informe de las demos del workshop
*Rendimiento DAX 2.0*. En la nube no se puede: allí no existe el PBIP ni Power BI Desktop.

> **Para Claude:** lee este fichero entero, `puente-dax/README.md` y `puente-dax/INVESTIGACION.md` antes
> de tocar nada. Trabaja por fases, **pide confirmación antes de cada acción destructiva** y no avances de
> fase si la anterior falla.

## 0. Contexto

- Presentación: `rendimiento-dax-2.0-datasaturday-madrid-2026.html`. Las demos son diapositivas de
  laboratorio con `<dax-lab>` que ejecutan DAX contra Power BI Desktop mediante el **Puente DAX**
  (`puente-dax/`). Los nombres de tablas y columnas salen de `window.PUENTE_DAX_MODELO` (final del HTML).
- Modelo de demo: `powerbi/` (PBIP, ~780 MB de datos, ~200 M de filas en la tabla de hechos).
- Demo prioritaria: **año anterior en 5 laboratorios** (SAMEPERIODLASTYEAR, offset, calendarios, columna
  desplazada en los hechos, los cuatro día a día). Ver las diapositivas `AA 1/5` … `AA 5/5`.

## 1. Requisitos (comprobar y avisar si falta algo)

| Qué | Cómo comprobarlo |
|---|---|
| Power BI Desktop **septiembre 2025 o posterior**, con la vista previa *inteligencia de tiempo basada en calendarios* activada | Archivo → Opciones → Características de vista previa |
| Formato **PBIP con TMDL y PBIR** habilitado | Opciones → Características de vista previa (*Guardar con formato de proyecto de Power BI* y TMDL/PBIR) |
| Skills de Fabric disponibles en Claude Code | Debe poder invocar `semantic-model-authoring`, `powerbi-report-planning`, `powerbi-report-design` y `powerbi-report-authoring` (y `dim-tiempo-casi-perfecta` si hace falta tocar la dimensión) |
| Puente DAX instalado | `puente-dax/instalar/instalar.ps1`; el botón **Puente DAX** aparece en *Herramientas externas* |
| Git en la rama de trabajo | `git status` limpio y copia de seguridad de `powerbi/` (ver fase 2) |

Si alguna skill no está, dilo y para: no improvises con ficheros a mano salvo en TMDL, que es texto.

## 2. Reglas de seguridad

1. **Antes de editar**, crea una copia de `powerbi/` fuera del repo (por ejemplo `..\powerbi-backup-AAAAMMDD`)
   y trabaja en una rama (`git switch -c demos-powerbi`).
2. **Nunca subas datos al repo:** `.gitignore` ya excluye `powerbi/**/.pbi/cache.abf` y `*.pbix`. Antes de
   cada commit ejecuta `git status` y comprueba que no hay ficheros de más de 5 MB.
3. No borres páginas, tablas ni medidas sin enseñarme antes la lista exacta de lo que se va a eliminar.
4. No publiques en Fabric ni en el servicio. Todo es local.
5. No guardes credenciales ni cadenas de conexión en ficheros del repo.

## 3. Fase A · Inspeccionar el modelo semántico (solo lectura)

Usa la skill `semantic-model-authoring` (o lee directamente los `.tmdl` de `powerbi/*.SemanticModel/definition`).
Entrega un resumen con:

- Tablas, columnas y tipos; relaciones (activas e inactivas); medidas; calendarios; roles; funciones (UDF).
- Tabla de **hechos** (nombre, nº de filas aproximado) y su columna de fecha del pedido.
- Dimensión de fecha: nombre, columna de fecha, columnas de año, mes y **día del mes**, si está marcada
  como tabla de fechas, y si hay huecos.
- Años con datos y **qué año es bisiesto con ventas** (p. ej. 2020 o 2024) y el siguiente.

Con eso, propón el valor de cada clave de `PUENTE_DAX_MODELO` (tabla siguiente) y **espera mi confirmación**.

| Clave | Qué es | Valor por defecto (AdventureWorksDW) |
|---|---|---|
| `Ventas`, `Ventas.Importe` | Tabla de hechos e importe | `'Internet Sales'`, `'Internet Sales'[SalesAmount]` |
| `Fecha`, `Fecha.Fecha`, `Fecha.Año`, `Fecha.Mes`, `Fecha.Dia` | Dimensión de fecha | `'Date'`, `[FullDateAlternateKey]`, `[CalendarYear]`, `[MonthNumberOfYear]`, `[DayNumberOfMonth]` |
| `Demo.AñoBisiesto`, `Demo.AñoSiguiente` | Año bisiesto con datos y el siguiente | 2012 y 2013 |
| `AA.FechaAA` | Columna de los hechos: fecha del pedido + 1 año | `'Internet Sales'[OrderDateAA]` |
| `Calendario` | Calendario de la inteligencia de tiempo | `'Gregoriano'` |

## 4. Fase B · Preparar el modelo para la demo de año anterior

Con `semantic-model-authoring` (edición de TMDL), y **mostrando el diff antes de aplicarlo**:

1. **Columna desplazada en los hechos** `FechaAA` = fecha del pedido + 1 año, con el 29 de febrero
   acumulado en el 28 de febrero del año siguiente.
   - **Preferido (Power Query):** `Table.AddColumn(Hechos, "FechaAA", each Date.AddYears([OrderDate], 1), type date)`.
   - Alternativa DAX (columna calculada, pesa en el refresco con 200 M de filas): `EDATE ( [OrderDate], 12 )`.
   - Tipo `date`, **sin hora**, para que su cardinalidad sea la de la dimensión de fecha.
2. **Relación inactiva** `Fecha[Fecha]` (1) → `Hechos[FechaAA]` (*). Debe quedar **inactiva**: la medida
   la activa con `USERELATIONSHIP`.
3. **Calendario** de inteligencia de tiempo (gregoriano) sobre la dimensión de fecha, con las columnas de
   año, trimestre, mes y día asociadas por categoría de tiempo. Nómbralo como la clave `Calendario`.
4. Comprueba que la dimensión de fecha es continua y está marcada como tabla de fechas. Si hay que crear o
   completar la dimensión, usa la skill `dim-tiempo-casi-perfecta` (TMDL).
5. No añadas medidas al modelo para las demos: las diapositivas definen las suyas en `DEFINE MEASURE`.
   (Las medidas del informe de la fase E sí viven en el modelo, ver allí.)

Tras aplicar: refresca el modelo en Desktop (puede tardar) y verifica con una consulta DAX que
`FechaAA` tiene datos y que el total de ventas no cambia.

## 5. Fase C · Probar las demos con el Puente DAX

1. Abre el PBIP en Power BI Desktop y pulsa **Puente DAX** (Herramientas externas).
   Alternativa: `PuenteDax.exe --www <carpeta del repo> --open`.
2. Abre `http://127.0.0.1:5199/rendimiento-dax-2.0-datasaturday-madrid-2026.html`.
3. Actualiza `PUENTE_DAX_MODELO` en el HTML con los valores confirmados en la fase A.
4. Backstage (`End`): **▶ Comprobar** debe salir todo en verde; **▶ Probar demos** ejecuta todas las variantes.
   Claves en rojo → corrígelas en el bloque de configuración, **no** en las consultas.
5. En las 5 diapositivas `AA n/5`, para cada variante: **▶ Frío**, mira las pestañas **Storage Engine**,
   **Formula Engine** y **Plan** y anota en `pruebas/AA-resultados.md` (créalo):
   - Total / FE / SE, nº de consultas SE, filas y KB, callbacks.
   - **Cuadre del 29 de febrero:** AA del mes, suma de AA día a día, diferencia y ventas del 29 de febrero
     para cada método. Las diapositivas parten de la hipótesis de que SAMEPERIODLASTYEAR y el offset por día
     pierden el 29 y la columna desplazada lo acumula en el 28: **confírmala o refútala con los números**, y
     corrige los textos `data-notes` y los consejos de las diapositivas si el resultado es otro.
   - **Granularidad:** con `watch="Fecha.Fecha"`, ¿qué métodos tienen consultas SE que **AGRUPAN** por la
     fecha cuando solo se pide año-mes? Es la pregunta de la demo 1.3.
6. Ejecuta **⏱ Benchmark** de cada variante en año-mes (3 frías + 3 calientes) para la tabla comparativa.
7. Pulsa **⤓ grabaciones.js** y guarda el fichero junto al HTML (plan B). No está en `.gitignore`: pregúntame
   si se versiona.
8. Si una consulta falla (sintaxis, función no disponible, relación ausente), arregla **la diapositiva**
   (DAX en `rendimiento-dax-2.0-datasaturday-madrid-2026.html`), vuelve a probar y deja constancia en
   `pruebas/AA-resultados.md`.

## 6. Fase D · Plan y diseño del informe (una página por demo)

Invoca `powerbi-report-planning` y `powerbi-report-design` **antes** de escribir PBIR. Entrega un brief y
**espera mi aprobación**:

- **Páginas:** una por demo (empieza por la de tiempo / año anterior; dime cuántas demos tiene hoy la
  presentación: bloques 1–6 del README del puente) más, si procede, una portada. Cada página responde a la
  pregunta de su demo con 1–3 visuales, no más.
- **Marca personal / tema** (tomado de la presentación, tema oscuro «terminal»):

  | Elemento | Valor |
  |---|---|
  | Fondo | `#050d0a` |
  | Texto | `#d6efe3` (atenuado `#7fa595`) |
  | Acento / Storage Engine | `#3dfc8f` |
  | Formula Engine | `#ffb347` |
  | Callbacks / alerta | `#ff5c6c` |
  | Información | `#5fd4ff` |
  | Tipografía | títulos *Chakra Petch*, cuerpo *IBM Plex Sans*, cifras *IBM Plex Mono* |

  Crea un **tema JSON** del informe con esos tokens. Si una fuente no está instalada, usa una de respaldo y
  dilo. Comprueba el contraste de texto sobre fondo (mínimo AA).
- **Página de año anterior (la primera):** matriz o línea por año-mes con `Ventas` y `Ventas AA`; tabla de
  días de febrero alrededor del 29 con las cuatro medidas; tarjeta con el «cuadre». Para que existan en el
  informe, las medidas viven en el modelo con **nombres que digan el método** (`Ventas AA · SPLY`,
  `Ventas AA · Offset día`, `Ventas AA · Calendario`, `Ventas AA · Columna`). Mismo DAX que las diapositivas.
- Accesibilidad: títulos alternativos, orden de tabulación, sin depender solo del color.

## 7. Fase E · Implementar el informe (`powerbi-report-authoring`)

1. **Enséñame la lista de páginas y visuales actuales** de `powerbi/*.Report` y espera confirmación:
   después **borra todas las páginas** (no el modelo) y crea las nuevas según el brief aprobado.
2. Aplica el tema, crea páginas y visuales, y valida el PBIR con la CLI de la skill (`powerbi-report-author`).
3. Recarga en Power BI Desktop (`powerbi-desktop`) y haz **captura de pantalla de cada página**; revísalas:
   desbordes, solapes, etiquetas cortadas, contraste. Corrige y repite.
4. No publiques. Guarda las capturas en `pruebas/capturas/` (no más de 1 MB cada una).

## 8. Fase F · Cierre

1. `git status`: sin datos, sin `cache.abf`, sin `.pbix`.
2. Commit por fase, con mensajes descriptivos, en la rama de trabajo. No hagas push sin que yo lo pida.
3. Resume en `pruebas/AA-resultados.md`: qué se cambió en el modelo, qué falló, cifras definitivas y
   decisiones pendientes. Si cambiaste textos de las diapositivas por los resultados reales, lístalos.

## 9. Lo que NO debes hacer

- No cambiar el comportamiento del puente ni de `dax-lab.js` salvo que un fallo real lo exija (y avisarme).
- No tocar la lógica de las demos de otros bloques (VertiPaq, idioma, moneda, RLS…) en esta pasada.
- No inventar resultados: si una prueba no se ha podido ejecutar, dilo.
- No dar por buena una afirmación de las diapositivas que no esté medida.
