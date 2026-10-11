/*
  Vista de lectura para Power BI sobre los hechos sintéticos.
  Añade FechaPedido (tipo date) calculada desde OrderDateKey, para que el modelo pueda
  relacionarse por fecha y plegar a SQL el cálculo de FechaAA (Date.AddYears -> DATEADD).
  Las claves son siempre fechas reales (ver 01-crear-datos-sinteticos.sql).

    sqlcmd -S A01P0717 -E -b -d RendimientoDax -i 02-vista-hechos.sql
*/
CREATE OR ALTER VIEW dbo.vFactInternetSales
AS
SELECT
    f.ProductKey, f.OrderDateKey, f.DueDateKey, f.ShipDateKey, f.CustomerKey,
    f.PromotionKey, f.CurrencyKey, f.SalesTerritoryKey, f.SalesOrderNumber,
    f.SalesOrderLineNumber, f.RevisionNumber, f.OrderQuantity, f.UnitPrice,
    f.ExtendedAmount, f.UnitPriceDiscountPct, f.DiscountAmount, f.ProductStandardCost,
    f.TotalProductCost, f.SalesAmount, f.TaxAmt, f.Freight,
    CAST(CONVERT(char(8), f.OrderDateKey) AS date) AS FechaPedido
FROM dbo.FactInternetSales AS f;
GO
