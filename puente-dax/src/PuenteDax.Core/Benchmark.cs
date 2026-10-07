namespace PuenteDax.Core;

/// <summary>Una ejecución de un benchmark, con caché fría ("cold") o caliente ("warm").</summary>
public sealed record BenchmarkRun(
    string Cache,
    int Iteration,
    long TotalMs,
    long FormulaEngineMs,
    long StorageEngineMs,
    int StorageEngineQueries,
    int CacheHits);

public sealed record BenchmarkStats(
    int Runs,
    double MedianTotalMs,
    double MedianFormulaEngineMs,
    double MedianStorageEngineMs,
    long MinTotalMs,
    long MaxTotalMs);

public sealed record BenchmarkSummary(BenchmarkStats? Cold, BenchmarkStats? Warm);

public static class Benchmark
{
    public const string Cold = "cold";
    public const string Warm = "warm";

    public static BenchmarkRun ToRun(string cache, int iteration, ServerTimings t) =>
        new(cache, iteration, t.TotalMs, t.FormulaEngineMs, t.StorageEngineMs, t.StorageEngineQueries, t.CacheHits);

    public static BenchmarkSummary Summarize(IEnumerable<BenchmarkRun> runs)
    {
        var list = runs.ToList();
        return new BenchmarkSummary(
            Stats(list.Where(r => r.Cache == Cold).ToList()),
            Stats(list.Where(r => r.Cache == Warm).ToList()));
    }

    public static double Median(IEnumerable<long> values)
    {
        var sorted = values.OrderBy(v => v).ToArray();
        if (sorted.Length == 0) return 0;
        var mid = sorted.Length / 2;
        return sorted.Length % 2 == 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2.0;
    }

    private static BenchmarkStats? Stats(List<BenchmarkRun> runs) =>
        runs.Count == 0
            ? null
            : new BenchmarkStats(
                runs.Count,
                Median(runs.Select(r => r.TotalMs)),
                Median(runs.Select(r => r.FormulaEngineMs)),
                Median(runs.Select(r => r.StorageEngineMs)),
                runs.Min(r => r.TotalMs),
                runs.Max(r => r.TotalMs));
}
