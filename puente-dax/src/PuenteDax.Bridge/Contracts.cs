using PuenteDax.Core;

namespace PuenteDax.Bridge;

public sealed record ConnectRequest(string? Server = null, string? Database = null);

public sealed record ConnectionInfo(string Server, string Database, string? Title, string Mode);

/// <summary>
/// Trace=false ejecuta sin traza (comprobaciones rápidas). Role/EffectiveUser ejecutan la consulta
/// con seguridad de fila aplicada, como "View as" en Power BI Desktop.
/// </summary>
public sealed record QueryRequest(
    string Dax,
    bool ClearCache = true,
    bool IncludePlan = false,
    int MaxRows = 20,
    bool Trace = true,
    string? Role = null,
    string? EffectiveUser = null);

public sealed record ResultSet(IReadOnlyList<string> Columns, IReadOnlyList<object?[]> Rows, int RowCount, bool Truncated);

/// <summary>Source: live (Power BI Desktop) · mock (simulado).</summary>
public sealed record QueryResponse(
    string Source,
    bool ColdCache,
    ResultSet Result,
    ServerTimings Timings,
    DateTime MeasuredAt);

public sealed record BenchmarkRequest(string Dax, int Cold = 3, int Warm = 3);

public sealed record BenchmarkResponse(
    IReadOnlyList<BenchmarkRun> Runs,
    BenchmarkSummary Summary,
    QueryResponse? FirstCold,
    QueryResponse? LastWarm);

public sealed record PowerBiInstance(string Server, int Port, string WorkspaceFolder, DateTime LastWriteUtc, bool Reachable);

public sealed record ErrorResponse(string Error);

/// <summary>Estadísticas tipo VertiPaq Analyzer (tamaños en bytes).</summary>
public sealed record ColumnStats(
    string Table,
    string Column,
    long Rows,
    long Cardinality,
    string? Encoding,
    string? DataType,
    long DictionarySize,
    long DataSize,
    long HierarchiesSize,
    long TotalSize,
    double PercentDatabase,
    bool IsHidden);

public sealed record TableStats(
    string Table,
    long Rows,
    long ColumnsSize,
    long RelationshipsSize,
    long UserHierarchiesSize,
    long TotalSize,
    double PercentDatabase);

public sealed record ModelStats(
    string Source,
    string Database,
    long TotalSize,
    IReadOnlyList<TableStats> Tables,
    IReadOnlyList<ColumnStats> Columns,
    DateTime MeasuredAt);
