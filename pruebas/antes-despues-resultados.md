# Bloque 1: modelo «antes» frente a modelo «después»

Medido el 2026-10-12 con el Puente DAX contra dos Power BI Desktop abiertos a la vez (puertos 5199 y 5200).
Datos: base sintética `RendimientoDax50M` (49 633 830 filas de hechos, ver `datos-sinteticos/`).
Modelos: `PowerBi/` (antes) y `PowerBi-despues/` (después, ver el commit del modelo).

## Qué cambia entre los dos modelos

| | Antes | Después |
|---|---|---|
| Vista de origen | `dbo.vFactInternetSales` | `dbo.vFactInternetSalesOpt` |
| Pedido-línea en texto (`SalesOrderLine`) | sí | no |
| Importes (venta, impuesto, transporte, coste) | una columna con decimales | entero + céntimos (2 decimales), medidas `SUM(entero) + SUM(céntimos)/100` |
| Dólar y Euro | columnas por fila (`Sales Amount Dolar`, `Euro`, `_Currency_Rate.AverageRate`) | medidas con `SUMX` sobre fecha y moneda |
| Columnas sin uso (`RevisionNumber`, `UnitPrice`, `DiscountAmount`) | sí | no |
| Fechas | `Fecha`, `Fecha envío`, `Fecha entrega` | igual |

## Tamaño

| | Antes | Después |
|---|---:|---:|
| Modelo | **5 185,9 MB** | **744,2 MB** |
| Tabla de hechos | 5 156,3 MB | 657,5 MB |
| `SalesOrderLine` | 3 451,1 MB (66,5 %), 49 609 362 valores distintos, HASH | no existe |
| `Sales Amount Dolar` / `Euro` | 236,8 MB / 236,0 MB, 12,4 M / 12,2 M distintos | no existen |
| `_Currency_Rate.AverageRate` (en los hechos) | 74,2 MB | no existe |

Importes partidos (MB totales de la columna; cardinalidad):

| Importe | Antes | Después (entero + céntimos) |
|---|---|---|
| `SalesAmount` | 190,2 MB · 461 146 | 27,7 + 33,0 = **60,7 MB** · 4 895 y 100 |
| `TaxAmt` | 189,3 MB · 309 805 | 12,8 + 20,2 = **33,0 MB** · 397 y 100 |
| `Freight` | 123,5 MB · 244 297 | 8,0 + 14,9 = **22,9 MB** · 125 y 100 |
| `TotalProductCost` | 190,1 MB · 445 808 | 21,2 + 28,2 = **49,4 MB** · 2 960 y 100 |
| **Las cuatro** | **693 MB** | **166 MB** |

Las copias de la tabla de fechas pesan unos 8,6 MB cada una (`Fecha envío`, `Fecha entrega`); `Fecha`, 1,0 MB en el antes y 6,2 MB en el después.

## Tiempo (mediana de 3 ejecuciones en frío; caliente en ms)

| Consulta | Antes frío | Después frío | Antes SE n | Después SE n | Antes cal. | Después cal. |
|---|---:|---:|---:|---:|---:|---:|
| Ventas por año | 133 | 140 | 1 | 1 | 3 | 10 |
| Ventas por año y categoría | 93 | 206 | 1 | 1 | 3 | 4 |
| Coste, impuesto y transporte por año | 150 | 221 | 1 | 1 | 3 | 4 |
| Dólares por año | 106 | **691** | 1 | 4 | 2 | 70 |
| Euros por año | 94 | **664** | 1 | 5 | 1 | 103 |
| Dólares por año y mes | 88 | **803** | 1 | 4 | 4 | 96 |

Demo C (cardinalidad), solo en el antes: sin tocar la columna 146 ms; `DISTINCTCOUNT` sobre el pedido-línea en texto **7 246 ms**;
`DISTINCTCOUNT` sobre una clave entera 57 ms.

## Qué se puede afirmar

- El «después» pesa **86 % menos** (5 186 → 744 MB). Casi todo viene del pedido-línea en texto, de las columnas de dólar y euro por fila y de partir los importes.
- **No es más rápido.** Las sumas sobre importes partidos cuestan lo mismo o hasta el doble en frío (leen dos columnas por importe). Las medidas de dólar y euro con `SUMX` son de 6 a 9 veces más lentas en frío y hacen 4 o 5 consultas SE en lugar de una.
- Partir el importe redondea a 2 decimales: el total del después es 25 631 787 804,27 y el exacto, 25 631 785 160,97 (2 643 de diferencia sobre 25 600 millones).
- Los tiempos son de una máquina y 3 repeticiones por consulta: sirven para el orden de magnitud, no para decimales.

## Pendiente

- Los pasos 1 a 3 del bloque (Auto date/time, fecha y hora, claves enteras) no dan ahorro medible en este modelo: ya estaba así de entrada.
- No se ha comprobado si los textos de las diapositivas coinciden con lo visto en Desktop (Auto date/time).
