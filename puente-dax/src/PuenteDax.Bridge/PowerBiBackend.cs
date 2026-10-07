using System.Security;
using Microsoft.AnalysisServices.AdomdClient;
using PuenteDax.Core;

namespace PuenteDax.Bridge;

/// <summary>
/// Mediciones reales contra el Analysis Services local de Power BI Desktop.
/// Solo funciona en Windows: ADOMD.NET no conecta por TCP a un Analysis Services local desde Linux/macOS.
/// </summary>
public sealed class PowerBiBackend : IDaxBackend
{
    private static readonly TimeSpan TraceStartTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan QueryTraceTimeout = TimeSpan.FromSeconds(60);

    private readonly ILogger<PowerBiBackend> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private AdomdConnection? _connection;
    private TraceSession? _trace;
    private IReadOnlyDictionary<int, HashSet<int>> _supported = new Dictionary<int, HashSet<int>>();
    private string _server = string.Empty;
    private string _database = string.Empty;

    // Servidor y modelo pedidos (línea de comandos o último /api/connect): los reintentos los usan.
    private string? _wantedServer;
    private string? _wantedDatabase;

    public PowerBiBackend(ILogger<PowerBiBackend> log, BridgeOptions options)
    {
        _log = log;
        _wantedServer = options.Server;
        _wantedDatabase = options.Database;
    }

    public string Mode => "live";
    public ConnectionInfo? Connection { get; private set; }

    public async Task<ConnectionInfo> ConnectAsync(ConnectRequest request, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            // Ya conectados a lo pedido (p. ej. una consulta llegó mientras arrancaba): no reconectar.
            if (Connection is not null && _trace is not null
                && (request.Server is null || request.Server.Equals(_server, StringComparison.OrdinalIgnoreCase))
                && (request.Database is null || request.Database == _database))
                return Connection;

            Close();
            if (request.Server is not null)
            {
                _wantedServer = request.Server;
                _wantedDatabase = request.Database;
            }
            var server = _wantedServer
                ?? PowerBiInstances.Discover().FirstOrDefault(i => i.Reachable)?.Server
                ?? throw new InvalidOperationException(
                    "No encuentro ningún Power BI Desktop abierto. Abre un .pbix o arranca el puente con --server localhost:PUERTO.");

            await Task.Run(() =>
            {
                var connection = new AdomdConnection($"Data Source={server};");
                connection.Open();
                var database = _wantedDatabase ?? FirstCatalog(connection);
                connection.ChangeDatabase(database);
                _connection = connection;
                _server = server;
                _database = database;
                _supported = SupportedTraceColumns.Read(connection);
                _trace = StartTrace(includePlan: false);
            }, ct);

            Connection = new ConnectionInfo(_server, _database, PowerBiInstances.SingleDesktopTitle(), Mode);
            _log.LogInformation("Conectado a {Server} · {Database}", _server, _database);
            return Connection;
        }
        catch
        {
            Close();
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<QueryResponse> QueryAsync(QueryRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Dax)) throw new ArgumentException("La consulta DAX está vacía.");
        if (_connection is null) await ConnectAsync(new ConnectRequest(), ct);

        await _gate.WaitAsync(ct);
        try
        {
            var connection = _connection ?? throw new InvalidOperationException("No hay conexión con Power BI Desktop.");

            // El plan de consulta añade eventos a la traza: solo se pide cuando hace falta.
            if (_trace is null || _trace.IncludesPlan != request.IncludePlan)
            {
                _trace?.Dispose();
                _trace = null;
                _trace = await Task.Run(() => StartTrace(request.IncludePlan), ct);
            }

            if (request.ClearCache) await Task.Run(() => ClearCache(connection), ct);

            var marker = Guid.NewGuid().ToString("N");
            var capture = _trace.BeginCapture(marker);
            try
            {
                var dax = $"/* puente:{marker} */\n{request.Dax}";
                var result = await Task.Run(() => Execute(connection, dax, Math.Clamp(request.MaxRows, 0, 500)), ct);
                var events = await capture.WaitAsync(QueryTraceTimeout, ct);
                var timings = ServerTimingsCalculator.Calculate(events);
                return new QueryResponse(Mode, request.ClearCache, result, timings, DateTime.UtcNow);
            }
            finally
            {
                _trace.EndCapture(capture);
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    private TraceSession StartTrace(bool includePlan)
    {
        var connection = _connection ?? throw new InvalidOperationException("No hay conexión.");
        return TraceSession.Start(_server, _database, connection.SessionID, _supported, includePlan,
            ping: () => connection.GetSchemaDataSet("MDSCHEMA_CUBES", new AdomdRestrictionCollection()),
            _log, TraceStartTimeout);
    }

    private static string FirstCatalog(AdomdConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT [CATALOG_NAME] FROM $SYSTEM.DBSCHEMA_CATALOGS";
        using var reader = command.ExecuteReader();
        return reader.Read()
            ? reader.GetString(0)
            : throw new InvalidOperationException("La instancia no tiene ningún modelo cargado.");
    }

    private void ClearCache(AdomdConnection connection)
    {
        using var command = connection.CreateCommand();
        command.CommandText =
            "<Batch xmlns=\"http://schemas.microsoft.com/analysisservices/2003/engine\"><ClearCache><Object>" +
            $"<DatabaseID>{SecurityElement.Escape(_database)}</DatabaseID>" +
            "</Object></ClearCache></Batch>";
        command.ExecuteNonQuery();
    }

    /// <summary>Lee TODAS las filas (si no, la duración no incluiría la serialización) y devuelve las primeras.</summary>
    private static ResultSet Execute(AdomdConnection connection, string dax, int maxRows)
    {
        using var command = connection.CreateCommand();
        command.CommandText = dax;
        using var reader = command.ExecuteReader();
        var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
        var rows = new List<object?[]>();
        var count = 0;
        while (reader.Read())
        {
            count++;
            if (rows.Count >= maxRows) continue;
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var value = reader.GetValue(i);
                row[i] = value is DBNull ? null : value;
            }
            rows.Add(row);
        }
        return new ResultSet(columns, rows, count, count > rows.Count);
    }

    private void Close()
    {
        try { _trace?.Dispose(); } catch (Exception ex) { _log.LogWarning(ex, "Cerrando la traza"); }
        _trace = null;
        try { _connection?.Close(); } catch (Exception ex) { _log.LogDebug(ex, "Cerrando la conexión"); }
        _connection = null;
        Connection = null;
    }

    public async ValueTask DisposeAsync()
    {
        await _gate.WaitAsync();
        try
        {
            Close();
        }
        finally
        {
            _gate.Release();
        }
    }
}
