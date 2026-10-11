# Año anterior (AA): resultados de las pruebas

Medido el 2026-10-11 con el Puente DAX contra Power BI Desktop (modelo `PowerBi`, 198 535 320 filas de hechos
sintéticos, ver `datos-sinteticos/`). Cada variante de las diapositivas `AA 1/5` … `AA 5/5` se ejecutó **en frío**
(`ClearCache` antes), sin plan de consulta, con `watch="Fecha.Fecha"` aplicado a mano con el mismo criterio que `dax-lab.js`
(el SELECT del xmSQL contiene `'Fecha'[Date]` → AGRUPA).
Datos en bruto: [aa_frio.json](aa_frio.json), [aa_benchmark.json](aa_benchmark.json). Se reproduce con
[run_aa.py](run_aa.py) (el puente debe estar en el puerto 5199 con token `workshop`).

Claves del modelo usadas: `Fecha` = `'Fecha'`, `Fecha.Fecha` = `'Fecha'[Date]`, `Fecha.Año` = `[Year]`, `Fecha.Mes` = `[Month]`,
`Fecha.Dia` = `[Day]`, `AA.FechaAA` = `'Internet Sales'[FechaAA]`, `Calendario` = `'Gregoriano'`,
`Demo.AñoBisiesto` = 2020, `Demo.AñoSiguiente` = 2021.

## 1. Cifras en frío, una por variante

Total / FE / SE en ms; SE-cpu en ms; `SE n` = consultas SE; filas y KB = lo que el SE devuelve al FE; callbacks.
`AGRUPA`/`FILTRA` = consultas SE cuyo xmSQL agrupa o solo filtra por `'Fecha'[Date]`.

| Variante | Total | FE | SE | SE n | Filas | KB | Callbacks | AGRUPA | FILTRA |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| SPLY · año-mes | 1351 | 92 | 1259 | 4 | 17 823 | 166 | 0 | 3 | 1 |
| SPLY · días de febrero | 393 | 68 | 325 | 4 | 23 388 | 276 | 0 | 4 | 0 |
| SPLY · cuadre | 442 | 56 | 386 | 5 | 17 543 | 186 | 0 | 3 | 2 |
| Offset · año-mes | 1083 | 73 | 1010 | 5 | 889 | 15 | 0 | 0 | 2 |
| Offset · días de febrero | 593 | 92 | 501 | 9 | 18 464 | 335 | 0 | 6 | 1 |
| Offset · cuadre | 898 | 80 | 818 | 12 | 12 683 | 246 | 0 | 5 | 4 |
| Calendario · año-mes | 1531 | 48 | 1483 | 7 | 4 963 | 45 | 0 | 0 | 2 |
| Calendario · días de febrero | 670 | 57 | 613 | 7 | 29 276 | 232 | 0 | 6 | 0 |
| Calendario · cuadre | 741 | 66 | 675 | 11 | 27 523 | 174 | 0 | 5 | 2 |
| Columna · año-mes | 774 | 57 | 717 | 2 | 570 | 10 | 0 | 0 | 2 |
| Columna · días de febrero | 349 | 46 | 303 | 2 | 11 694 | 184 | 0 | 2 | 0 |
| Columna · cuadre | 267 | 51 | 216 | 2 | 5 848 | 93 | 0 | 1 | 1 |
| Cuatro · tras el bisiesto (2021) | 1244 | 90 | 1154 | 22 | 58 684 | 516 | 0 | 19 | 1 |
| Cuatro · el año bisiesto (2020) | 1202 | 100 | 1102 | 22 | 58 696 | 516 | 0 | 19 | 1 |

Ninguna variante genera callbacks. El FE es siempre pequeño (46–100 ms): el tiempo está en el SE.

## 2. Benchmark en año-mes (3 frías + 3 calientes)

Medianas del total en ms.

| Método | Frío (3) | Mediana fría | Caliente (3) | Mediana caliente | SE n (frío) |
|---|---|---:|---|---:|---:|
| SAMEPERIODLASTYEAR | 1013 · 1176 · 843 | **1013** | 16 · 26 · 23 | 23 | 4 |
| Offset (restar 1 al año) | 1136 · 1110 · 1180 | **1136** | 16 · 9 · 13 | 13 | 5 |
| Calendario | 1550 · 1553 · 1419 | **1550** | 16 · 14 · 20 | 16 | 7 |
| Columna desplazada | 962 · 794 · 817 | **817** | 9 · 10 · 7 | 9 | 2 |

La columna desplazada es la más rápida en frío y la que menos consultas SE hace (2). El calendario es el más lento (7 consultas SE).
Las medianas calientes son todas FE puro por aciertos de caché (7–26 ms); ahí no hay diferencia que contar.
Las 3 frías de SPLY varían entre 843 y 1176 ms: con tan pocas repeticiones no se puede decir que SPLY gane al offset por margen
(1013 frente a 1136).

## 3. El cuadre del 29 de febrero (hipótesis de las diapositivas)

Año siguiente al bisiesto = 2021 frente a 2020 (ventas del 29-feb-2020: **17 250 143,43**).

| Método | AA de febrero | Suma de AA día a día | Diferencia |
|---|---:|---:|---:|
| SAMEPERIODLASTYEAR | 467 179 184,02 | 449 929 040,59 | **17 250 143,43** |
| Offset | 467 179 184,02 | 449 929 040,59 | **17 250 143,43** |
| Calendario | 467 179 184,02 | 449 929 040,59 | **17 250 143,43** |
| Columna desplazada | 467 179 184,02 | 467 179 184,02 | **0** |

**Hipótesis confirmada con los números:** SAMEPERIODLASTYEAR y el offset por día pierden el 29-feb al bajar a día
(diferencia = ventas del 29-feb exactas), y la columna desplazada lo acumula en el 28-feb (AA del 28-feb-2021 = 34 555 061 =
17 304 917 + 17 250 143). **El calendario también lo pierde en el cuadre de febrero**, aunque por otra razón (ver §4).
A nivel de mes los cuatro métodos coinciden (el mes incluye el 29): febrero, marzo y diciembre de 2021 dan el mismo AA en los cuatro.

Día a día alrededor del 29-feb (importes redondeados):

Tras el bisiesto (2021):

| Día | Ventas | SPLY | Offset | Calendario | Columna |
|---|---:|---:|---:|---:|---:|
| 26-feb-21 | 16 090 180 | 16 352 355 | 16 352 355 | 16 352 355 | 16 352 355 |
| 27-feb-21 | 16 607 654 | 16 826 869 | 16 826 869 | 16 826 869 | 16 826 869 |
| 28-feb-21 | 17 021 477 | 17 304 917 | 17 304 917 | 17 304 917 | **34 555 061** |
| 01-mar-21 | 16 791 166 | 17 073 353 | 17 073 353 | **17 250 143** | 17 073 353 |
| 02-mar-21 | 23 644 888 | 23 941 405 | 23 941 405 | **17 073 353** | 23 941 405 |

El año bisiesto (2020), donde el 29-feb mira a un día que no existe en 2019:

| Día | Ventas | SPLY | Offset | Calendario | Columna |
|---|---:|---:|---:|---:|---:|
| 28-feb-20 | 17 304 917 | 16 461 229 | 16 461 229 | 16 461 229 | 16 461 229 |
| 29-feb-20 | 17 250 143 | **16 461 229** (repite el 28) | **vacío** | 16 289 642 | **vacío** |
| 01-mar-20 | 17 073 353 | 16 289 642 | 16 289 642 | **22 936 157** | 16 289 642 |
| 02-mar-20 | 23 941 405 | 22 936 157 | 22 936 157 | **12 357 512** | 22 936 157 |

## 4. Hallazgo que no estaba en las diapositivas: el calendario se desplaza un día

Con `SAMEPERIODLASTYEAR ( 'Gregoriano' )` la comparación va por **posición dentro del año**, no por mes-día:

| Día de 2021 | AA calendario | Es el día… de 2020 |
|---|---:|---|
| 01-mar-21 | 17 250 143 | 29-feb-20 |
| 02-mar-21 | 17 073 353 | 01-mar-20 |
| 15-jun-21 | 23 787 995 | 14-jun-20 |
| 31-dic-21 | 10 487 498 | 30-dic-20 |

Todo lo que sigue al 29-feb queda alineado **un día antes** el resto del año, y el 31-dic-2021 no ve el 31-dic-2020. A nivel de mes
el resultado es correcto (febrero, marzo y diciembre de 2021 comprobados; el año completo no se ha comprobado); solo a nivel de día se desalinea. Se detectó con la preview de calendarios de este Desktop;
conviene repetirlo en la versión final. SPLY, offset y columna alinean por fecha y no tienen este problema.

## 5. Granularidad (pregunta de la demo 1.3)

Pidiendo solo año-mes, con `watch="Fecha.Fecha"`:

- **SAMEPERIODLASTYEAR: sí baja al día.** 3 de sus 4 consultas SE AGRUPAN por `'Fecha'[Date]` (17 823 filas y 166 KB al FE).
- **Offset, Calendario y Columna: no.** Ninguna consulta SE agrupa por la fecha (solo la FILTRAN) y devuelven 889, 4 963 y 570 filas.

Es lo que explica que el offset y la columna devuelvan 20 a 30 veces menos filas que SPLY.

## 6. Cambios que hicieron falta para medir

El Puente DAX **no funcionaba contra este Power BI Desktop** (cada consulta con traza fallaba con «No llegó el evento QueryEnd»).
Se han corregido en `puente-dax/src/PuenteDax.Bridge/TraceSession.cs` tres suposiciones sobre la traza de este motor:

1. Desktop **quita el comentario inicial** `/* puente:… */` del texto de `QueryBegin`/`QueryEnd`; el puente nunca reconocía su consulta. Ahora el primer `QueryBegin` de la captura es el suyo (la traza ya está filtrada a su sesión y las consultas se serializan) y el `QueryEnd` se casa por `ActivityID`.
2. Los eventos del **Storage Engine llevan otro `ActivityID`** que el de la consulta y se descartaban (todo el tiempo salía como FE). Ahora se aceptan también por estar entre el `QueryBegin` y el `QueryEnd`.
3. `ExecutionMetrics` sigue casándose solo por `ActivityID`.

El ejecutable instalado en `%LOCALAPPDATA%\PuenteDax` **no incluye** esta corrección; las pruebas se hicieron con una compilación aparte.

## 7. Textos de las diapositivas

Las notas y consejos de `AA 1/5` a `AA 5/5` coincidían con lo medido; se han retocado solo estos:

- `AA 3/5`: la nota del ponente (`data-notes`) y el consejo recogen el desplazamiento de un día del calendario (§4).
- `AA 4/5`: las pestañas Power Query, DAX y T-SQL usaban `OrderDate` y `'Date'[FullDateAlternateKey]`; ahora reflejan lo implementado (`FechaPedido`, `'Fecha'[Date]`).

## 8. Pendiente

- No se ha usado la casilla *plan* (planes lógico y físico): no se ha medido ni comparado.
- Las demos de otros bloques (VertiPaq, idioma, moneda, RLS…) no se han tocado.
- El plan B `grabaciones.js` no se ha generado: se hace desde el navegador (botón ⤓ grabaciones.js) y la decisión de versionarlo es tuya.
- Las medidas del informe (`Ventas AA · …`) ya están en el modelo y dan los mismos totales que las variantes de las diapositivas.
