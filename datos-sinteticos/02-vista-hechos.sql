/*
  Vistas de lectura para Power BI sobre los hechos sintéticos (una para cada modelo de la demo del bloque 1).

  dbo.vFactInternetSales     Modelo "ANTES": todas las columnas, FechaPedido (date) y SalesOrderLine, el pedido-línea
                             como texto (p. ej. SO43697-1): casi un valor distinto por fila, sin valor analítico.
  dbo.vFactInternetSalesOpt  Modelo "DESPUÉS": solo lo que se usa. Los importes se parten en parte entera y céntimos
                             (2 decimales): cardinalidad mucho menor. La medida pasa a SUM(entero) + SUM(centimos)/100.
                             No lleva pedido-línea, ni las columnas sin uso.

  Las claves son siempre fechas reales (ver 01-crear-datos-sinteticos.sql).

    sqlcmd -S A01P0717 -E -b -d RendimientoDax50M -i 02-vista-hechos.sql
*/
CREATE OR ALTER VIEW dbo.vFactInternetSales
AS
SELECT
    f.ProductKey, f.OrderDateKey, f.DueDateKey, f.ShipDateKey, f.CustomerKey,
    f.PromotionKey, f.CurrencyKey, f.SalesTerritoryKey, f.SalesOrderNumber,
    f.SalesOrderLineNumber, f.RevisionNumber, f.OrderQuantity, f.UnitPrice,
    f.ExtendedAmount, f.UnitPriceDiscountPct, f.DiscountAmount, f.ProductStandardCost,
    f.TotalProductCost, f.SalesAmount, f.TaxAmt, f.Freight,
    CAST(CONVERT(char(8), f.OrderDateKey) AS date) AS FechaPedido,
    CAST(CONCAT('SO', f.SalesOrderNumber, '-', f.SalesOrderLineNumber) AS nvarchar(30)) AS SalesOrderLine
FROM dbo.FactInternetSales AS f;
GO
CREATE OR ALTER VIEW dbo.vFactInternetSalesOpt
AS
SELECT
    f.ProductKey, f.OrderDateKey, f.DueDateKey, f.ShipDateKey, f.CustomerKey,
    f.PromotionKey, f.CurrencyKey, f.SalesTerritoryKey, f.OrderQuantity, f.ProductStandardCost,
    CAST(CONVERT(char(8), f.OrderDateKey) AS date) AS FechaPedido,
    CAST(s.c  / 100 AS int)     AS SalesAmountEntero,       CAST(s.c  % 100 AS tinyint) AS SalesAmountCent,
    CAST(t.c  / 100 AS int)     AS TaxAmtEntero,            CAST(t.c  % 100 AS tinyint) AS TaxAmtCent,
    CAST(fr.c / 100 AS int)     AS FreightEntero,           CAST(fr.c % 100 AS tinyint) AS FreightCent,
    CAST(tc.c / 100 AS int)     AS TotalProductCostEntero,  CAST(tc.c % 100 AS tinyint) AS TotalProductCostCent
FROM dbo.FactInternetSales AS f
CROSS APPLY (SELECT CAST(ROUND(f.SalesAmount      * 100, 0) AS bigint) AS c) AS s
CROSS APPLY (SELECT CAST(ROUND(f.TaxAmt           * 100, 0) AS bigint) AS c) AS t
CROSS APPLY (SELECT CAST(ROUND(f.Freight          * 100, 0) AS bigint) AS c) AS fr
CROSS APPLY (SELECT CAST(ROUND(f.TotalProductCost * 100, 0) AS bigint) AS c) AS tc;
GO
