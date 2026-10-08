using System.Text.Json;
using System.Text.RegularExpressions;
using PuenteDax.Core;

namespace PuenteDax.Bridge;

/// <summary>
/// Simulador para preparar las slides y probar el widget sin Power BI.
/// Genera eventos de traza verosímiles y los pasa por el MISMO cálculo que el modo real,
/// pero los números son inventados: la interfaz lo marca como SIMULADO.
/// </summary>
public sealed class MockBackend : IDaxBackend
{
    private static readonly Regex IteratorWithCondition = new(
        @"\b(SUMX|AVERAGEX|COUNTX|MINX|MAXX|PRODUCTX)\b[\s\S]*\b(IF|SWITCH)\s*\(",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex TimeIntelligence = new(
        @"\b(SAMEPERIODLASTYEAR|DATEADD|TOTALYTD|DATESYTD|PARALLELPERIOD)\b",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private int _runs;

    public string Mode => "mock";
    public ConnectionInfo? Connection { get; private set; }

    public Task<ConnectionInfo> ConnectAsync(ConnectRequest request, CancellationToken ct)
    {
        Connection = new ConnectionInfo("localhost:0", request.Database ?? "Contoso", "Modelo simulado", Mode);
        return Task.FromResult(Connection);
    }

    public async Task<QueryResponse> QueryAsync(QueryRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Dax)) throw new ArgumentException("La consulta DAX está vacía.");
        Connection ??= await ConnectAsync(new ConnectRequest(), ct);

        if (!request.Trace)
        {
            await Task.Delay(30, ct);
            var check = new ResultSet(new[] { "[n]" }, new[] { new object?[] { 1 } }, 1, false);
            return new QueryResponse(Mode, false, check, new ServerTimings { TotalMs = 30 }, DateTime.UtcNow);
        }

        // Con rol, la expresión de seguridad se suma a cada consulta: el simulador añade su coste.
        var dax = string.IsNullOrWhiteSpace(request.Role) ? request.Dax : request.Dax + "\n-- rol: " + request.Role;
        var events = Simulate(dax, request.ClearCache, request.IncludePlan, Interlocked.Increment(ref _runs),
            securityCost: string.IsNullOrWhiteSpace(request.Role) ? 0 : request.Role.Contains("or", StringComparison.OrdinalIgnoreCase) ? 2 : 1);
        var timings = ServerTimingsCalculator.Calculate(events);
        await Task.Delay(TimeSpan.FromMilliseconds(Math.Min(timings.TotalMs, 1500)), ct);

        var value = Math.Round(1000 + StableHash(request.Dax) % 900_000 / 7.0, 2);
        var result = new ResultSet(new[] { "[Valor]" }, new[] { new object?[] { value } }, 1, false);
        return new QueryResponse(Mode, request.ClearCache, result, timings, DateTime.UtcNow);
    }

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;

    public async Task<ModelStats> ModelStatsAsync(bool readStatisticsFromData, CancellationToken ct)
    {
        await Task.Delay(400, ct);
        // Modelo inventado con nombres de AdventureWorksDW, para preparar las slides sin Power BI.
        var columns = new List<ColumnStats>
        {
            Col("Internet Sales", "SalesOrderNumber", 60_398, 27_659, "HASH", "String", 1_300_000, 160_000, 0),
            Col("Internet Sales", "SalesAmount", 60_398, 290, "HASH", "Decimal", 12_000, 75_000, 0),
            Col("Internet Sales", "TotalProductCost", 60_398, 120, "HASH", "Decimal", 6_000, 60_000, 0),
            Col("Internet Sales", "OrderDateKey", 60_398, 1_124, "VALUE", "Int64", 120, 31_000, 0),
            Col("Internet Sales", "ProductKey", 60_398, 158, "VALUE", "Int64", 120, 24_000, 0),
            Col("Internet Sales", "CustomerKey", 60_398, 18_484, "VALUE", "Int64", 120, 64_000, 0),
            Col("Internet Sales", "OrderQuantity", 60_398, 1, "VALUE", "Int64", 120, 2_000, 0),
            Col("Internet Sales", "OrderDate", 60_398, 1_124, "HASH", "DateTime", 30_000, 31_000, 0),
            Col("Date", "FullDateAlternateKey", 3_652, 3_652, "HASH", "DateTime", 70_000, 9_000, 0),
            Col("Date", "CalendarYear", 3_652, 10, "VALUE", "Int64", 120, 600, 0),
            Col("Date", "MonthNumberOfYear", 3_652, 12, "VALUE", "Int64", 120, 600, 0),
            Col("Product", "EnglishProductName", 606, 504, "HASH", "String", 42_000, 1_200, 0),
            Col("Product", "SpanishProductName", 606, 504, "HASH", "String", 41_000, 1_200, 0),
            Col("Product Category", "EnglishProductCategoryName", 4, 4, "HASH", "String", 300, 120, 0),
        };
        var total = columns.Sum(c => c.TotalSize);
        columns = columns.Select(c => c with { PercentDatabase = (double)c.TotalSize / total }).OrderByDescending(c => c.TotalSize).ToList();
        var tables = columns.GroupBy(c => c.Table)
            .Select(g => new TableStats(g.Key, g.First().Rows, g.Sum(c => c.TotalSize), 0, 0, g.Sum(c => c.TotalSize), (double)g.Sum(c => c.TotalSize) / total))
            .OrderByDescending(t => t.TotalSize).ToList();
        return new ModelStats(Mode, Connection?.Database ?? "Contoso", total, tables, columns, DateTime.UtcNow);

        static ColumnStats Col(string table, string column, long rows, long cardinality, string encoding, string type, long dictionary, long data, long hierarchies) =>
            new(table, column, rows, cardinality, encoding, type, dictionary, data, hierarchies, dictionary + data + hierarchies, 0, false);
    }

    private static List<TraceRecord> Simulate(string dax, bool cold, bool includePlan, int run, int securityCost = 0)
    {
        var rng = new Random(StableHash(dax));
        var jitter = new Random(StableHash(dax) ^ run);
        var callback = IteratorWithCondition.IsMatch(dax);
        var timeIntel = TimeIntelligence.IsMatch(dax);
        var seCount = 1 + rng.Next(2) + (callback ? 1 : 0) + (timeIntel ? 3 : 0) + securityCost;

        var t0 = DateTime.UtcNow;
        var activity = Guid.NewGuid().ToString();
        DateTime At(double ms) => t0.AddMilliseconds(Math.Round(ms));
        double Vary(double ms) => ms * (0.9 + jitter.NextDouble() * 0.2);

        var events = new List<TraceRecord>
        {
            new() { Kind = TraceKind.QueryBegin, StartTime = t0, TextData = dax, ActivityId = activity },
        };

        double cursor = Vary(1 + rng.NextDouble() * 2);
        double lastStart = cursor;
        for (var i = 0; i < seCount; i++)
        {
            var isCallback = callback && i == 0;
            var rows = isCallback ? 60_398 : 12 + rng.Next(2_000);
            var xmSql = XmSql(isCallback, timeIntel && i > 0, rows);

            if (!cold)
            {
                events.Add(new TraceRecord
                {
                    Kind = TraceKind.StorageEngineCacheMatch,
                    Subclass = TraceSubclass.VertiPaqCacheExactMatch,
                    StartTime = At(cursor), EndTime = At(cursor),
                    TextData = xmSql, ActivityId = activity,
                });
                cursor += 0.3;
                continue;
            }

            var duration = Vary(isCallback ? 18 + rng.NextDouble() * 12 : 2 + rng.NextDouble() * 6 + (timeIntel ? 4 : 0));
            var parallel = i > 0 && rng.NextDouble() < 0.35;
            var start = parallel ? lastStart + 1 : cursor;
            var end = start + duration;
            var cpu = duration * (isCallback ? 3.4 : 1 + rng.NextDouble() * 1.5);

            events.Add(new TraceRecord
            {
                Kind = TraceKind.StorageEngineBegin, Subclass = TraceSubclass.VertiPaqScan,
                StartTime = At(start), TextData = xmSql, ActivityId = activity,
            });
            events.Add(new TraceRecord
            {
                Kind = TraceKind.StorageEngineEnd, Subclass = TraceSubclass.VertiPaqScan,
                StartTime = At(start), EndTime = At(end),
                DurationMs = (long)Math.Round(duration), CpuMs = (long)Math.Round(cpu),
                TextData = xmSql, ActivityId = activity,
            });

            lastStart = start;
            cursor = Math.Max(cursor, end) + Vary(0.5 + rng.NextDouble() * 2.5);
        }

        var total = cursor + Vary(1 + rng.NextDouble() * 3);
        if (includePlan)
        {
            events.Add(new TraceRecord { Kind = TraceKind.QueryPlan, Subclass = TraceSubclass.LogicalPlan, TextData = "Plan lógico simulado\n  AddColumns: RelLogOp\n    Sum_Vertipaq: ScaLogOp" });
            events.Add(new TraceRecord { Kind = TraceKind.QueryPlan, Subclass = TraceSubclass.PhysicalPlan, TextData = "Plan físico simulado\n  AddColumns: IterPhyOp\n    SpoolLookup: LookupPhyOp" });
        }

        events.Add(new TraceRecord
        {
            Kind = TraceKind.QueryEnd, StartTime = t0, EndTime = At(total),
            DurationMs = (long)Math.Round(total), CpuMs = (long)Math.Round(total), TextData = dax, ActivityId = activity,
        });
        events.Add(new TraceRecord
        {
            Kind = TraceKind.ExecutionMetrics, ActivityId = activity,
            TextData = JsonSerializer.Serialize(new { simulated = true, durationMs = (long)Math.Round(total) }),
        });
        return events;
    }

    private static string XmSql(bool callback, bool timeIntel, int rows)
    {
        var measure = callback
            ? "SUM ( [CallbackDataID ( IF ( 'Internet Sales'[SalesAmount] > 10, 1, 0 ) )] ( PFDATAID ( 'Internet Sales'[SalesAmount] ) ) )"
            : "SUM ( 'Internet Sales'[SalesAmount] )";
        var where = timeIntel ? "\nWHERE\n    'Date'[Date] IN ( 43466.000000, 43467.000000, 43468.000000..[365 total values] );" : ";";
        return "SET DC_KIND=\"AUTO\";\nSELECT\n    'Date'[Calendar Year],\n    " + measure +
               "\nFROM 'Internet Sales'\n    LEFT OUTER JOIN 'Date'\n        ON 'Internet Sales'[OrderDateKey]='Date'[DateKey]" + where +
               $"\n\n[Estimated size (volume, marshalling bytes): {rows}, {rows * 16}]";
    }

    private static int StableHash(string text)
    {
        unchecked
        {
            var h = (int)2166136261;
            foreach (var c in text.Trim()) h = (h ^ c) * 16777619;
            return h & 0x7fffffff;
        }
    }
}
