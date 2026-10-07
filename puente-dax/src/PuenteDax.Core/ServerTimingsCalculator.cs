using System.Text.RegularExpressions;

namespace PuenteDax.Core;

/// <summary>
/// Calcula los tiempos de FE y SE a partir de los eventos de traza de una consulta.
///
/// Sigue el mismo criterio que DAX Studio (ServerTimesModel.ProcessResults):
///  - El FE no emite eventos propios: su tiempo son los huecos de la consulta en los que
///    no hay ninguna consulta SE activa (barrido de una línea de tiempo).
///  - El SE es la duración total menos el FE, salvo que la suma neta de las consultas SE
///    sea menor (entonces se usa esa suma y el FE absorbe el resto).
///  - Los batches restan la duración y la CPU de sus consultas internas.
///  - Filas y KB salen del texto "Estimated size" del xmSQL; los callbacks, de buscar
///    CallbackDataID y similares en ese texto.
/// Es una reimplementación propia, no una copia del código de DAX Studio.
/// </summary>
public static class ServerTimingsCalculator
{
    // Dos formatos según la versión del motor:
    //   'Estimated size ( volume, marshalling bytes ) : 1234, 56789'
    //   [Estimated size (volume, marshalling bytes): 37, 592]
    private static readonly Regex EstimatedSize = new(
        @"[\'\[]Estimated size[^:\]']*:\s*(?<rows>\d+),\s*(?<bytes>\d+)[\'\]]",
        RegexOptions.Compiled);

    // Sufijos de identificador interno en los nombres del xmSQL: [Ventas (123)].[Importe (456)]
    private static readonly Regex LineageId = new(@" \(\d+\)(?=[\]\$'])", RegexOptions.Compiled);

    // Mismos marcadores que usa DAX Studio. "Cond" va con límites de palabra para no marcar
    // como callback columnas como "Condiciones de pago".
    private static readonly Regex CallbackMarker = new(
        @"CallbackDataID|LogAbsValueCallback|RoundValueCallback|EncodeCallback|MinMaxColumnPositionCallback|\bCond\b",
        RegexOptions.Compiled);

    public static bool ContainsCallback(string xmSql) => CallbackMarker.IsMatch(xmSql);

    /// <summary>Quita los identificadores internos de los nombres para que el xmSQL se lea en clase.</summary>
    public static string SimplifyXmSql(string xmSql) => LineageId.Replace(xmSql, string.Empty);

    public static (long? Rows, long? KBytes) EstimatedSizeOf(string xmSql)
    {
        var m = EstimatedSize.Match(xmSql);
        if (!m.Success) return (null, null);
        var rows = long.Parse(m.Groups["rows"].Value);
        var bytes = long.Parse(m.Groups["bytes"].Value);
        return (rows, 1 + bytes / 1024);
    }

    /// <param name="events">Eventos de UNA consulta, en el orden en que llegaron.</param>
    public static ServerTimings Calculate(IEnumerable<TraceRecord> events)
    {
        var list = events.Select(Normalize).ToList();
        var queryEnd = list.LastOrDefault(e => e.Kind == TraceKind.QueryEnd)
            ?? throw new InvalidOperationException("La traza no contiene el evento QueryEnd de la consulta.");

        var formulaEngine = SweepFormulaEngine(list, queryEnd);

        var queries = new List<StorageEngineQuery>();
        long seNet = 0, seCpu = 0, rows = 0, kbytes = 0;
        int seCount = 0, cacheHits = 0, callbacks = 0;
        int batchDepth = 0;
        long batchDuration = 0, batchCpu = 0;
        TraceRecord? maxEvent = null;
        string? logicalPlan = null, physicalPlan = null, executionMetrics = null;

        foreach (var e in list)
        {
            switch (e.Kind)
            {
                case TraceKind.StorageEngineBegin when e.Subclass == TraceSubclass.BatchVertiPaqScan:
                    batchDepth++;
                    batchDuration = 0;
                    batchCpu = 0;
                    break;

                case TraceKind.StorageEngineEnd when e.Subclass == TraceSubclass.BatchVertiPaqScan:
                {
                    batchDepth = Math.Max(batchDepth - 1, 0);
                    var duration = Math.Max(e.DurationMs - batchDuration, 0);
                    var cpu = Math.Max(e.CpuMs - batchCpu, 0);
                    seNet += duration;
                    seCpu += cpu;
                    seCount++;
                    queries.Add(ToQuery(e, "batch", duration, cpu, inBatch: false));
                    break;
                }

                case TraceKind.StorageEngineEnd when e.Subclass == TraceSubclass.VertiPaqScan:
                {
                    long net = e.DurationMs;
                    var inBatch = batchDepth > 0;
                    if (inBatch)
                    {
                        batchDuration += net;
                        batchCpu += e.CpuMs;
                    }
                    else
                    {
                        net = NetParallelDuration(ref maxEvent, e);
                    }
                    seNet += net;
                    seCpu += e.CpuMs;
                    seCount++;
                    queries.Add(ToQuery(e, "scan", e.DurationMs, e.CpuMs, inBatch));
                    break;
                }

                case TraceKind.StorageEngineEnd:
                    // VertiPaqScanInternal y otros: cuentan en el barrido, no como consulta.
                    queries.Add(ToQuery(e, "internal", e.DurationMs, e.CpuMs, inBatch: batchDepth > 0));
                    break;

                case TraceKind.DirectQueryEnd:
                {
                    var net = NetParallelDuration(ref maxEvent, e);
                    seNet += net;
                    seCpu += e.CpuMs;
                    seCount++;
                    queries.Add(ToQuery(e, "directquery", e.DurationMs, e.CpuMs, inBatch: false));
                    break;
                }

                case TraceKind.StorageEngineCacheMatch:
                    cacheHits++;
                    queries.Add(ToQuery(e, "cache", 0, 0, inBatch: false));
                    break;

                case TraceKind.QueryPlan when e.Subclass == TraceSubclass.LogicalPlan:
                    logicalPlan = e.TextData;
                    break;

                case TraceKind.QueryPlan when e.Subclass == TraceSubclass.PhysicalPlan:
                    physicalPlan = e.TextData;
                    break;

                case TraceKind.ExecutionMetrics:
                    executionMetrics = e.TextData;
                    break;
            }
        }

        var total = Math.Max(queryEnd.DurationMs, formulaEngine);
        long storageEngine;
        if (seNet + formulaEngine < total)
        {
            storageEngine = seNet;
            formulaEngine = total - storageEngine;
        }
        else
        {
            storageEngine = total - formulaEngine;
        }

        var numbered = new List<StorageEngineQuery>(queries.Count);
        var line = 1;
        foreach (var q in queries)
        {
            var withOffset = q with
            {
                Line = line++,
                StartOffsetMs = Math.Max(0, q.StartOffsetMs - Ticks(queryEnd.StartTime)),
            };
            numbered.Add(withOffset);
            if (withOffset.Type is "scan" or "batch" or "directquery")
            {
                rows += withOffset.Rows ?? 0;
                kbytes += withOffset.KBytes ?? 0;
                if (withOffset.Callback) callbacks++;
            }
        }

        return new ServerTimings
        {
            TotalMs = total,
            FormulaEngineMs = formulaEngine,
            StorageEngineMs = storageEngine,
            StorageEngineCpuMs = seCpu,
            Parallelism = storageEngine > 0 ? Math.Round((double)seCpu / storageEngine, 2) : null,
            StorageEngineQueries = seCount,
            CacheHits = cacheHits,
            Callbacks = callbacks,
            Rows = rows,
            KBytes = kbytes,
            Queries = numbered,
            LogicalPlan = logicalPlan,
            PhysicalPlan = physicalPlan,
            ExecutionMetrics = executionMetrics,
        };
    }

    /// <summary>Corrige eventos de fin con EndTime o Duration incoherentes (como hace DAX Studio).</summary>
    private static TraceRecord Normalize(TraceRecord e)
    {
        if (!IsTimed(e)) return e;
        if (e.EndTime == e.StartTime && e.DurationMs > 0)
            return e with { EndTime = e.StartTime.AddMilliseconds(e.DurationMs) };
        var span = (long)(e.EndTime - e.StartTime).TotalMilliseconds;
        if (e.EndTime >= e.StartTime && span > e.DurationMs)
            return e with { DurationMs = span };
        return e;
    }

    private static bool IsTimed(TraceRecord e) =>
        e.Kind is TraceKind.StorageEngineEnd or TraceKind.DirectQueryEnd or TraceKind.QueryEnd;

    /// <summary>FE = suma de los tramos de la consulta sin ninguna consulta SE en curso.</summary>
    private static long SweepFormulaEngine(List<TraceRecord> list, TraceRecord queryEnd)
    {
        var points = new List<(int Group, DateTime Time, int Order, bool IsStart, TraceRecord Event)>();
        foreach (var e in list.Where(e => e.Kind is TraceKind.StorageEngineEnd or TraceKind.DirectQueryEnd))
        {
            points.Add((1, e.StartTime, 1, true, e));
            points.Add((1, e.EndTime, 0, false, e));
        }
        points.Add((0, queryEnd.StartTime, 0, true, queryEnd));
        points.Add((2, queryEnd.EndTime, 0, false, queryEnd));
        points.Sort((a, b) =>
        {
            var c = a.Group.CompareTo(b.Group);
            if (c != 0) return c;
            c = a.Time.CompareTo(b.Time);
            return c != 0 ? c : a.Order.CompareTo(b.Order); // a igual hora, los fines antes que los inicios
        });

        double fe = 0;
        var level = 0;
        var cursor = queryEnd.StartTime;
        foreach (var p in points)
        {
            if (p.Event.Kind == TraceKind.QueryEnd)
            {
                if (p.IsStart) cursor = p.Time;
                else if (level == 0) fe += Math.Max(0, (p.Time - cursor).TotalMilliseconds);
                continue;
            }

            if (p.IsStart)
            {
                if (level == 0) fe += Math.Max(0, (p.Time - cursor).TotalMilliseconds);
                level++;
            }
            else
            {
                level = Math.Max(level - 1, 0);
                if (level == 0) cursor = p.Time > cursor ? p.Time : cursor;
            }
        }
        return (long)Math.Round(fe);
    }

    /// <summary>Descuenta el solape con la consulta SE que termina más tarde (paralelismo).</summary>
    private static long NetParallelDuration(ref TraceRecord? maxEvent, TraceRecord e)
    {
        if (maxEvent is null)
        {
            maxEvent = e;
            return e.DurationMs;
        }
        var overlap = (maxEvent.EndTime - e.StartTime).TotalMilliseconds;
        if (overlap <= 0)
        {
            maxEvent = e;
            return e.DurationMs;
        }
        if (maxEvent.EndTime > e.EndTime) return 0;
        var net = (long)(e.EndTime - maxEvent.EndTime).TotalMilliseconds;
        maxEvent = e;
        return net;
    }

    private static StorageEngineQuery ToQuery(TraceRecord e, string type, long duration, long cpu, bool inBatch)
    {
        var (rows, kbytes) = EstimatedSizeOf(e.TextData);
        return new StorageEngineQuery
        {
            Type = type,
            Subclass = e.Subclass,
            StartOffsetMs = Ticks(e.StartTime),
            DurationMs = duration,
            CpuMs = cpu,
            Rows = rows,
            KBytes = kbytes,
            Callback = type != "cache" && ContainsCallback(e.TextData),
            InBatch = inBatch,
            Query = SimplifyXmSql(e.TextData),
        };
    }

    // Milisegundos absolutos; se convierten en desplazamiento respecto al inicio de la consulta al final.
    private static long Ticks(DateTime t) => t.Ticks / TimeSpan.TicksPerMillisecond;
}
