namespace PuenteDax.Core;

/// <summary>Una consulta al Storage Engine (o un acierto de caché) tal como se ve en Server Timings.</summary>
public sealed record StorageEngineQuery
{
    public int Line { get; init; }

    /// <summary>scan · batch · internal · cache · directquery</summary>
    public string Type { get; init; } = string.Empty;

    public string Subclass { get; init; } = string.Empty;
    public long StartOffsetMs { get; init; }
    public long DurationMs { get; init; }
    public long CpuMs { get; init; }
    public long? Rows { get; init; }
    public long? KBytes { get; init; }
    public bool Callback { get; init; }

    /// <summary>Consulta interna de un batch (se suma dentro del batch).</summary>
    public bool InBatch { get; init; }

    public string Query { get; init; } = string.Empty;
}

/// <summary>Resultado del cálculo: lo mismo que enseña la pestaña Server Timings de DAX Studio.</summary>
public sealed record ServerTimings
{
    public long TotalMs { get; init; }
    public long FormulaEngineMs { get; init; }
    public long StorageEngineMs { get; init; }
    public long StorageEngineCpuMs { get; init; }

    /// <summary>CPU del SE dividido entre su duración: &gt; 1 indica trabajo en paralelo.</summary>
    public double? Parallelism { get; init; }

    public int StorageEngineQueries { get; init; }
    public int CacheHits { get; init; }
    public int Callbacks { get; init; }
    public long Rows { get; init; }
    public long KBytes { get; init; }
    public IReadOnlyList<StorageEngineQuery> Queries { get; init; } = Array.Empty<StorageEngineQuery>();
    public string? LogicalPlan { get; init; }
    public string? PhysicalPlan { get; init; }

    /// <summary>JSON del evento ExecutionMetrics, si el motor lo emite.</summary>
    public string? ExecutionMetrics { get; init; }
}
