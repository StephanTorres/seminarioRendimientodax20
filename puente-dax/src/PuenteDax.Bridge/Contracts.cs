using PuenteDax.Core;

namespace PuenteDax.Bridge;

public sealed record ConnectRequest(string? Server = null, string? Database = null);

public sealed record ConnectionInfo(string Server, string Database, string? Title, string Mode);

public sealed record QueryRequest(string Dax, bool ClearCache = true, bool IncludePlan = false, int MaxRows = 20);

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
