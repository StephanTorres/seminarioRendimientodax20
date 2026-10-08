namespace PuenteDax.Core;

/// <summary>Tipos de evento de traza que intervienen en la medición de una consulta DAX.</summary>
public enum TraceKind
{
    Other,
    QueryBegin,
    QueryEnd,
    StorageEngineBegin,
    StorageEngineEnd,
    StorageEngineCacheMatch,
    DirectQueryEnd,
    QueryPlan,
    ExecutionMetrics,
}

/// <summary>
/// Evento de traza ya normalizado. No depende de AMO, de modo que el cálculo de tiempos
/// se puede probar con eventos sintéticos en cualquier plataforma.
/// </summary>
public sealed record TraceRecord
{
    public TraceKind Kind { get; init; }

    /// <summary>Nombre del subclass de AMO (VertiPaqScan, BatchVertiPaqScan, DAXVertiPaqPhysicalPlan…).</summary>
    public string Subclass { get; init; } = string.Empty;

    public DateTime StartTime { get; init; }
    public DateTime EndTime { get; init; }
    public long DurationMs { get; init; }
    public long CpuMs { get; init; }
    public string TextData { get; init; } = string.Empty;

    /// <summary>Identificador compartido por todos los eventos de una misma petición.</summary>
    public string? ActivityId { get; init; }
}

/// <summary>Nombres de los subclass de AMO que usa el cálculo.</summary>
public static class TraceSubclass
{
    public const string VertiPaqScan = "VertiPaqScan";
    public const string VertiPaqScanInternal = "VertiPaqScanInternal";
    public const string BatchVertiPaqScan = "BatchVertiPaqScan";
    public const string VertiPaqCacheExactMatch = "VertiPaqCacheExactMatch";
    public const string LogicalPlan = "DAXVertiPaqLogicalPlan";
    public const string PhysicalPlan = "DAXVertiPaqPhysicalPlan";
}
