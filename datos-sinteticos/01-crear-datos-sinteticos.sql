/*
  Datos sintéticos para las demos de Rendimiento DAX 2.0
  ------------------------------------------------------
  Crea la base $(DB) (ficheros en $(RUTA), no en C:) con:
    dbo.FactInternetSales  ~8,3 M filas x $(MULT) (MULT=24 -> ~200 M, MULT=6 -> ~50 M), 2011-01-01 .. $(FIN),
                           columnstore agrupado.
    dbo.FactCurrencyRate   14 monedas x cada día de 2010-12-29 .. 2026-12-31.

  Origen: AdventureWorksDW2022 (solo lectura). Las dimensiones NO se copian: el modelo
  sigue leyéndolas de AdventureWorksDW2022.

  Reglas:
   - Cada día destino toma como plantilla las filas de 2011-2013 con el mismo mes y día.
     El 29-feb destino usa la plantilla del 28-feb (vende como un día normal).
   - Fechas siempre reales: 29-feb solo en años bisiestos. Due/Ship conservan el desfase.
   - Cada fila plantilla se replica @mult veces con clientes distintos.
   - Importes x factor anual "al azar" (0,6 .. 1,6; semilla fija, reproducible)
     x ruido de fila (0,85 .. 1,15).

  Uso (si la base ya existe, aborta sin tocar nada):
    (PowerShell)  $env:RUTA = 'D:\SQLServer\Data'; $env:FIN = '20261011'
                  $env:DB = 'RendimientoDax50M'; $env:MULT = '6'
                  sqlcmd -S A01P0717 -E -b -i 01-crear-datos-sinteticos.sql
    (sqlcmd toma $(RUTA), $(FIN), $(DB) y $(MULT) de las variables de entorno si no se pasan con -v)
*/
SET NOCOUNT ON;
GO
USE master;
GO
IF DB_ID(N'$(DB)') IS NOT NULL
    RAISERROR(N'La base $(DB) ya existe: no se toca nada. Eliminala a mano para regenerar.', 16, 1);
GO
CREATE DATABASE $(DB)
ON PRIMARY (NAME = $(DB),     FILENAME = N'$(RUTA)\$(DB).mdf',     SIZE = 2GB, FILEGROWTH = 1GB)
LOG ON     (NAME = $(DB)_log, FILENAME = N'$(RUTA)\$(DB)_log.ldf', SIZE = 2GB, FILEGROWTH = 1GB);
GO
ALTER DATABASE $(DB) SET RECOVERY SIMPLE;
GO
USE $(DB);
GO
CREATE TABLE dbo.FactInternetSales (
    ProductKey            int      NOT NULL,
    OrderDateKey          int      NOT NULL,
    DueDateKey            int      NOT NULL,
    ShipDateKey           int      NOT NULL,
    CustomerKey           int      NOT NULL,
    PromotionKey          int      NOT NULL,
    CurrencyKey           int      NOT NULL,
    SalesTerritoryKey     int      NOT NULL,
    SalesOrderNumber      bigint   NOT NULL,
    SalesOrderLineNumber  tinyint  NOT NULL,
    RevisionNumber        tinyint  NOT NULL,
    OrderQuantity         smallint NOT NULL,
    UnitPrice             money    NOT NULL,
    ExtendedAmount        money    NOT NULL,
    UnitPriceDiscountPct  float    NOT NULL,
    DiscountAmount        float    NOT NULL,
    ProductStandardCost   money    NOT NULL,
    TotalProductCost      money    NOT NULL,
    SalesAmount           money    NOT NULL,
    TaxAmt                money    NOT NULL,
    Freight               money    NOT NULL
);
-- Columnstore con compresion de archivo: lo mas pequeno posible (mas que PAGE/ROW sobre rowstore).
-- Solo Power BI lo lee, una vez por refresco, asi que el coste extra de CPU al leer no importa.
CREATE CLUSTERED COLUMNSTORE INDEX CCI_FactInternetSales ON dbo.FactInternetSales
    WITH (DATA_COMPRESSION = COLUMNSTORE_ARCHIVE);
GO
/* ---------- Plantilla: filas de 2011-2013 con mes-dia y desfases ---------- */
SELECT
    ROW_NUMBER() OVER (ORDER BY f.OrderDateKey, f.SalesOrderNumber, f.SalesOrderLineNumber) AS rn,
    DENSE_RANK() OVER (ORDER BY f.SalesOrderNumber) AS ordn,
    (f.OrderDateKey / 100 % 100) * 100 + (f.OrderDateKey % 100) AS md,
    DATEDIFF(DAY, DATEFROMPARTS(f.OrderDateKey/10000, f.OrderDateKey/100%100, f.OrderDateKey%100),
                  DATEFROMPARTS(f.DueDateKey/10000,   f.DueDateKey/100%100,   f.DueDateKey%100))  AS DiasVenc,
    DATEDIFF(DAY, DATEFROMPARTS(f.OrderDateKey/10000, f.OrderDateKey/100%100, f.OrderDateKey%100),
                  DATEFROMPARTS(f.ShipDateKey/10000,  f.ShipDateKey/100%100,  f.ShipDateKey%100)) AS DiasEnvio,
    f.ProductKey, f.CustomerKey, f.PromotionKey, f.CurrencyKey, f.SalesTerritoryKey,
    f.SalesOrderLineNumber, f.RevisionNumber, f.OrderQuantity, f.UnitPrice, f.ExtendedAmount,
    f.UnitPriceDiscountPct, f.DiscountAmount, f.ProductStandardCost, f.TotalProductCost,
    f.SalesAmount, f.TaxAmt, f.Freight
INTO #plantilla
FROM AdventureWorksDW2022.dbo.FactInternetSales AS f
WHERE f.OrderDateKey / 10000 BETWEEN 2011 AND 2013
  AND NOT (f.OrderDateKey / 100 % 100 = 2 AND f.OrderDateKey % 100 = 29);   -- el 29-feb de origen no se usa
CREATE CLUSTERED INDEX ix ON #plantilla (md);

/* ---------- Calendario destino ---------- */
DECLARE @fin date = CONVERT(date, '$(FIN)');
SELECT
    n.i AS idx,
    d.f AS fecha,
    CONVERT(int, CONVERT(char(8), d.f, 112)) AS clave,
    YEAR(d.f) AS anio,
    CASE WHEN MONTH(d.f) = 2 AND DAY(d.f) = 29 THEN 228 ELSE MONTH(d.f) * 100 + DAY(d.f) END AS md
INTO #dias
FROM (SELECT TOP (DATEDIFF(DAY, '20110101', @fin) + 1)
             ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i
      FROM sys.all_columns a CROSS JOIN sys.all_columns b) AS n
CROSS APPLY (SELECT DATEADD(DAY, n.i, CONVERT(date, '20110101')) AS f) AS d;
CREATE UNIQUE CLUSTERED INDEX ix ON #dias (anio, idx);

/* Factor anual al azar, semilla fija (reproducible) */
SELECT y.anio, CONVERT(float, 0.6 + (ABS(CHECKSUM(y.anio, 20261011)) % 1001) / 1000.0) AS factor
INTO #factor
FROM (SELECT DISTINCT anio FROM #dias) AS y;
SELECT anio, ROUND(factor, 3) AS factor_anual FROM #factor ORDER BY anio;

/* ---------- Hechos: un INSERT por año (minimiza log, rowgroups completos) ---------- */
DECLARE @mult int = $(MULT), @y int = 2011, @ymax int = (SELECT MAX(anio) FROM #dias);
DECLARE @t0 datetime2 = SYSDATETIME(), @n bigint;
WHILE @y <= @ymax
BEGIN
    INSERT INTO dbo.FactInternetSales WITH (TABLOCK)
    SELECT
        p.ProductKey,
        d.clave,
        CONVERT(int, CONVERT(char(8), DATEADD(DAY, p.DiasVenc,  d.fecha), 112)),
        CONVERT(int, CONVERT(char(8), DATEADD(DAY, p.DiasEnvio, d.fecha), 112)),
        11000 + ((p.CustomerKey - 11000) + (t.k - 1) * 1237 + (d.anio - 2011) * 311) % 18484,
        p.PromotionKey, p.CurrencyKey, p.SalesTerritoryKey,
        ((CONVERT(bigint, d.idx) * 100 + t.k) * 100000) + p.ordn,
        p.SalesOrderLineNumber, p.RevisionNumber, p.OrderQuantity,
        p.UnitPrice,
        CONVERT(money, p.ExtendedAmount * v.f),
        p.UnitPriceDiscountPct,
        p.DiscountAmount * v.f,
        p.ProductStandardCost,
        CONVERT(money, p.TotalProductCost * v.f),
        CONVERT(money, p.SalesAmount * v.f),
        CONVERT(money, p.TaxAmt * v.f),
        CONVERT(money, p.Freight * v.f)
    FROM #dias AS d
    JOIN #plantilla AS p ON p.md = d.md
    JOIN #factor   AS fa ON fa.anio = d.anio
    CROSS JOIN (SELECT TOP (@mult) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS k FROM sys.all_columns) AS t
    CROSS APPLY (SELECT fa.factor * (0.85 + 0.30 * (ABS(CHECKSUM(d.clave, p.rn, t.k)) % 1000) / 999.0) AS f) AS v
    WHERE d.anio = @y
    OPTION (MAXDOP 4);
    SET @n = @@ROWCOUNT;
    PRINT CONCAT(@y, ': ', FORMAT(@n, 'N0'), ' filas  (', DATEDIFF(SECOND, @t0, SYSDATETIME()), ' s acumulados)');
    SET @y += 1;
END
GO
ALTER INDEX CCI_FactInternetSales ON dbo.FactInternetSales REORGANIZE WITH (COMPRESS_ALL_ROW_GROUPS = ON);
GO
/* ---------- Tipos de cambio sinteticos (14 monedas, cada dia) ---------- */
CREATE TABLE dbo.FactCurrencyRate (
    CurrencyKey  int      NOT NULL,
    DateKey      int      NOT NULL,
    AverageRate  float    NOT NULL,
    EndOfDayRate float    NOT NULL,
    [Date]       datetime NOT NULL
);
CREATE CLUSTERED COLUMNSTORE INDEX CCI_FactCurrencyRate ON dbo.FactCurrencyRate
    WITH (DATA_COMPRESSION = COLUMNSTORE_ARCHIVE);
GO
WITH base AS (
    SELECT CurrencyKey, AVG(AverageRate) AS b
    FROM AdventureWorksDW2022.dbo.FactCurrencyRate GROUP BY CurrencyKey
), dias AS (
    SELECT TOP (DATEDIFF(DAY, '20101229', '20261231') + 1)
           ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) - 1 AS i
    FROM sys.all_columns a CROSS JOIN sys.all_columns b
), x AS (
    SELECT b.CurrencyKey, DATEADD(DAY, d.i, CONVERT(date, '20101229')) AS f, d.i,
           b.b * (1 + 0.08 * SIN(2 * PI() * d.i / 365.25 + b.CurrencyKey)
                    + 0.02 * ((ABS(CHECKSUM(b.CurrencyKey, d.i)) % 1000) / 1000.0 - 0.5)) AS media
    FROM base b CROSS JOIN dias d
)
INSERT INTO dbo.FactCurrencyRate WITH (TABLOCK)
SELECT CurrencyKey,
       CONVERT(int, CONVERT(char(8), f, 112)),
       media,
       media * (1 + 0.005 * ((ABS(CHECKSUM(CurrencyKey, i, 7)) % 1000) / 1000.0 - 0.5)),
       CONVERT(datetime, f)
FROM x;
GO
/* ---------- Comprobaciones ---------- */
SELECT COUNT_BIG(*) AS filas_hechos, SUM(SalesAmount) AS importe_total,
       MIN(OrderDateKey) AS min_clave, MAX(OrderDateKey) AS max_clave
FROM dbo.FactInternetSales;
SELECT OrderDateKey / 10000 AS anio, COUNT_BIG(*) AS filas, SUM(SalesAmount) AS importe
FROM dbo.FactInternetSales GROUP BY OrderDateKey / 10000 ORDER BY 1;
SELECT OrderDateKey AS dia_29feb, COUNT_BIG(*) AS filas, SUM(SalesAmount) AS importe
FROM dbo.FactInternetSales WHERE OrderDateKey % 10000 = 229 GROUP BY OrderDateKey ORDER BY 1;
SELECT 'claves invalidas (deben ser 0)' AS prueba, COUNT_BIG(*) AS filas
FROM dbo.FactInternetSales
WHERE TRY_CONVERT(date, CONVERT(char(8), OrderDateKey)) IS NULL
   OR TRY_CONVERT(date, CONVERT(char(8), DueDateKey))  IS NULL
   OR TRY_CONVERT(date, CONVERT(char(8), ShipDateKey)) IS NULL;
SELECT COUNT(*) AS filas_tipo_cambio, COUNT(DISTINCT CurrencyKey) AS monedas, MIN(DateKey) AS min_d, MAX(DateKey) AS max_d
FROM dbo.FactCurrencyRate;
SELECT SUM(a.total_pages) * 8 / 1024 AS mb_hechos
FROM sys.partitions p JOIN sys.allocation_units a ON a.container_id = p.hobt_id
WHERE p.object_id = OBJECT_ID('dbo.FactInternetSales');
GO
