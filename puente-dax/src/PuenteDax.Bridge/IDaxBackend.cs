using PuenteDax.Core;

namespace PuenteDax.Bridge;

/// <summary>Origen de las mediciones: Power BI Desktop real o el simulador.</summary>
public interface IDaxBackend : IAsyncDisposable
{
    string Mode { get; }
    ConnectionInfo? Connection { get; }
    Task<ConnectionInfo> ConnectAsync(ConnectRequest request, CancellationToken ct);
    Task<QueryResponse> QueryAsync(QueryRequest request, CancellationToken ct);

    /// <summary>Tamaños y cardinalidades del modelo (lo que enseña VertiPaq Analyzer).</summary>
    Task<ModelStats> ModelStatsAsync(bool readStatisticsFromData, CancellationToken ct);
}

public static class BenchmarkRunner
{
    public const int MaxIterations = 20;

    /// <summary>N ejecuciones en frío (limpiando caché antes de cada una) y N en caliente, como DAX Studio.</summary>
    public static async Task<BenchmarkResponse> RunAsync(IDaxBackend backend, BenchmarkRequest request, CancellationToken ct)
    {
        if (request.Cold is < 0 or > MaxIterations || request.Warm is < 0 or > MaxIterations)
            throw new ArgumentException($"Cold y Warm deben estar entre 0 y {MaxIterations}.");
        if (request.Cold + request.Warm == 0)
            throw new ArgumentException("Hace falta al menos una ejecución.");

        var runs = new List<BenchmarkRun>();
        QueryResponse? firstCold = null, lastWarm = null;

        for (var i = 1; i <= request.Cold; i++)
        {
            var r = await backend.QueryAsync(new QueryRequest(request.Dax, ClearCache: true, MaxRows: 5), ct);
            firstCold ??= r;
            runs.Add(Benchmark.ToRun(Benchmark.Cold, i, r.Timings));
        }

        for (var i = 1; i <= request.Warm; i++)
        {
            var r = await backend.QueryAsync(new QueryRequest(request.Dax, ClearCache: false, MaxRows: 5), ct);
            lastWarm = r;
            runs.Add(Benchmark.ToRun(Benchmark.Warm, i, r.Timings));
        }

        return new BenchmarkResponse(runs, Benchmark.Summarize(runs), firstCold, lastWarm);
    }
}
