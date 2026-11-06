using System.Diagnostics;
using System.Globalization;
using System.Security;
using System.Security.Cryptography;
using System.Text;
using Dax.Model.Extractor;
using Dax.ViewModel;
using Microsoft.AnalysisServices.AdomdClient;
using PuenteDax.Core;

namespace PuenteDax.Bridge;

/// <summary>
/// Mediciones reales contra el Analysis Services local de Power BI Desktop o, con credenciales,
/// contra un modelo del servicio por XMLA (powerbi://…), que es lo que usa el check de CI.
/// Solo funciona en Windows: ADOMD.NET no conecta por TCP a un Analysis Services local desde Linux/macOS.
/// </summary>
public sealed class PowerBiBackend : IDaxBackend
{
    private static readonly TimeSpan TraceStartTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan QueryTraceTimeout = TimeSpan.FromSeconds(60);

    private readonly ILogger<PowerBiBackend> _log;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private IReadOnlyDictionary<int, HashSet<int>> _supported = new Dictionary<int, HashSet<int>>();
    private string _server = string.Empty;
    private string _database = string.Empty;

    // En Desktop el ID del modelo coincide con su nombre; en el servicio es un GUID y ClearCache lo necesita.
    private string _databaseId = string.Empty;
    private readonly string? _credentials;

    // Sesión de administrador y, aparte, una por rol/usuario para las demos de RLS.
    private DaxSession? _admin;
    private readonly Dictionary<string, DaxSession> _roleSessions = new(StringComparer.OrdinalIgnoreCase);

    // Servidor y modelo pedidos (línea de comandos o último /api/connect): los reintentos los usan.
    private string? _wantedServer;
    private string? _wantedDatabase;

    public PowerBiBackend(ILogger<PowerBiBackend> log, BridgeOptions options)
    {
        _log = log;
        _wantedServer = options.Server;
        _wantedDatabase = options.Database;
        _credentials = options.Credentials;
    }

    public string Mode => "live";
    public ConnectionInfo? Connection { get; private set; }

    public async Task<ConnectionInfo> ConnectAsync(ConnectRequest request, CancellationToken ct)
    {
        await _gate.WaitAsync(ct);
        try
        {
            // Ya conectados a lo pedido (p. ej. una consulta llegó mientras arrancaba): no reconectar.
            if (Connection is not null && _admin?.Trace is not null
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
                var connection = new AdomdConnection(ConnectionString(server));
                connection.Open();
                var database = _wantedDatabase ?? FirstCatalog(connection);
                connection.ChangeDatabase(database);
                _server = server;
                _database = database;
                _databaseId = DatabaseId(connection, database);
                _admin = new DaxSession("admin", connection);
                _supported = SupportedTraceColumns.Read(connection);
                _admin.Trace = StartTrace(_admin, includePlan: false);
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
        if (_admin is null) await ConnectAsync(new ConnectRequest(), ct);

        await _gate.WaitAsync(ct);
        try
        {
            var admin = _admin ?? throw new InvalidOperationException("No hay conexión con Power BI Desktop.");
            var session = await Task.Run(() => SessionFor(request.Role, request.EffectiveUser), ct);

            if (!request.Trace)
            {
                // Comprobaciones rápidas: sin traza ni caché fría, solo el tiempo de reloj.
                var clock = Stopwatch.StartNew();
                var quick = await Task.Run(() => Execute(session.Connection, request.Dax, Math.Clamp(request.MaxRows, 0, 500)), ct);
                return new QueryResponse(Mode, false, quick, new ServerTimings { TotalMs = clock.ElapsedMilliseconds }, DateTime.UtcNow);
            }

            // El plan de consulta añade eventos a la traza: solo se pide cuando hace falta.
            if (session.Trace is null || session.Trace.IncludesPlan != request.IncludePlan)
            {
                session.Trace?.Dispose();
                session.Trace = null;
                session.Trace = await Task.Run(() => StartTrace(session, request.IncludePlan), ct);
            }

            // La caché del SE es del servidor: se limpia con la sesión de administrador.
            if (request.ClearCache) await Task.Run(() => ClearCache(admin.Connection), ct);

            // Si la traza se queda muda (inactividad o consultas muy largas) no llega el QueryEnd: se recrea y se reintenta una vez.
            for (var attempt = 1; ; attempt++)
            {
                var marker = Guid.NewGuid().ToString("N");
                var trace = session.Trace!;
                var capture = trace.BeginCapture(marker, request.Dax);
                try
                {
                    var dax = $"/* puente:{marker} */\n{request.Dax}";
                    var result = await Task.Run(() => Execute(session.Connection, dax, Math.Clamp(request.MaxRows, 0, 500)), ct);
                    var events = await capture.WaitAsync(QueryTraceTimeout, ct);
                    var timings = ServerTimingsCalculator.Calculate(events);
                    return new QueryResponse(Mode, request.ClearCache, result, timings, DateTime.UtcNow);
                }
                catch (TimeoutException) when (attempt == 1)
                {
                    _log.LogWarning("No llegó el QueryEnd: se recrea la traza y se reintenta la consulta.");
                    trace.EndCapture(capture);
                    trace.Dispose();
                    session.Trace = await Task.Run(() => StartTrace(session, request.IncludePlan), ct);
                    if (request.ClearCache) await Task.Run(() => ClearCache(admin.Connection), ct);
                    continue;
                }
                finally
                {
                    session.Trace?.EndCapture(capture);
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<ModelStats> ModelStatsAsync(bool readStatisticsFromData, CancellationToken ct)
    {
        if (_admin is null) await ConnectAsync(new ConnectRequest(), ct);

        await _gate.WaitAsync(ct);
        try
        {
            var connectionString = ConnectionString(_server, _database);
            var version = typeof(PowerBiBackend).Assembly.GetName().Version?.ToString(3) ?? "0.1.0";
            var model = await Task.Run(() =>
            {
                try
                {
                    return TomExtractor.GetDaxModel(connectionString, "PuenteDax", version, readStatisticsFromData: readStatisticsFromData);
                }
                catch (Exception ex) when (readStatisticsFromData)
                {
                    // Como DAX Studio: si leer estadísticas de los datos falla, se repite sin ellas.
                    _log.LogWarning("Estadísticas desde datos no disponibles ({Message}); se repite sin ellas.", ex.Message);
                    return TomExtractor.GetDaxModel(connectionString, "PuenteDax", version, readStatisticsFromData: false);
                }
            }, ct);
            return ToStats(new VpaModel(model), _database, Mode);
        }
        finally
        {
            _gate.Release();
        }
    }

    internal static ModelStats ToStats(VpaModel vpa, string database, string source)
    {
        var tables = vpa.Tables
            .Select(t => new TableStats(t.TableName, t.RowsCount, t.ColumnsTotalSize, t.RelationshipsSize,
                t.UserHierarchiesSize, t.TableSize, t.PercentageDatabase))
            .OrderByDescending(t => t.TotalSize)
            .ToList();
        var columns = vpa.Columns
            .Where(c => !c.IsRowNumber)
            .Select(c => new ColumnStats(c.Table.TableName, c.ColumnName, c.TableRowsCount, c.ColumnCardinality,
                c.Encoding, c.DataType, c.DictionarySize, c.DataSize, c.HierarchiesSize, c.TotalSize,
                c.PercentageDatabase, c.IsHidden))
            .OrderByDescending(c => c.TotalSize)
            .ToList();
        return new ModelStats(source, database, tables.Sum(t => t.TotalSize), tables, columns, DateTime.UtcNow);
    }

    private DaxSession SessionFor(string? role, string? effectiveUser)
    {
        var admin = _admin ?? throw new InvalidOperationException("No hay conexión con Power BI Desktop.");
        if (string.IsNullOrWhiteSpace(role) && string.IsNullOrWhiteSpace(effectiveUser)) return admin;

        var key = $"{role}|{effectiveUser}";
        if (_roleSessions.TryGetValue(key, out var existing)) return existing;

        // Igual que "Ver como" de Desktop: la conexión lleva Roles / EffectiveUserName.
        // La traza (AMO) se abre como administrador sobre esta sesión.
        var builder = ConnectionString(_server, _database);
        if (!string.IsNullOrWhiteSpace(role)) builder += $"Roles={Quote(role)};";
        if (!string.IsNullOrWhiteSpace(effectiveUser)) builder += $"EffectiveUserName={Quote(effectiveUser)};";
        var connection = new AdomdConnection(builder);
        connection.Open();
        var session = new DaxSession(key, connection);
        _roleSessions[key] = session;
        _log.LogInformation("Sesión con seguridad aplicada: rol {Role} · usuario {User}", role ?? "-", effectiveUser ?? "-");
        return session;
    }

    private static string Quote(string value) =>
        value.Contains('"') ? throw new ArgumentException("El rol o usuario no puede contener comillas dobles.") : $"\"{value}\"";

    private TraceSession StartTrace(DaxSession session, bool includePlan)
    {
        var connection = session.Connection;
        return TraceSession.Start(ConnectionString(_server, _database), connection.SessionID, _supported, includePlan,
            ping: () => connection.GetSchemaDataSet("MDSCHEMA_CUBES", new AdomdRestrictionCollection()),
            _log, TraceStartTimeout);
    }

    private string ConnectionString(string server, string? database = null) =>
        $"Data Source={server};" + (database is null ? string.Empty : $"Initial Catalog={database};") + _credentials;

    private static string DatabaseId(AdomdConnection connection, string database)
    {
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT [CATALOG_NAME], [DATABASE_ID] FROM $SYSTEM.DBSCHEMA_CATALOGS";
        try
        {
            using var reader = command.ExecuteReader();
            while (reader.Read())
                if (string.Equals(reader.GetString(0), database, StringComparison.OrdinalIgnoreCase) && !reader.IsDBNull(1))
                    return reader.GetString(1);
        }
        catch (AdomdException)
        {
            // Motores sin DATABASE_ID en el DMV: el nombre sirve como ID.
        }
        return database;
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
            $"<DatabaseID>{SecurityElement.Escape(_databaseId)}</DatabaseID>" +
            "</Object></ClearCache></Batch>";
        command.ExecuteNonQuery();
    }

    /// <summary>
    /// Lee TODAS las filas (si no, la duración no incluiría la serialización) y devuelve las primeras,
    /// más una huella del resultado completo para comparar modelos (CI: ¿más rápido pero distinto?).
    /// </summary>
    private static ResultSet Execute(AdomdConnection connection, string dax, int maxRows)
    {
        using var command = connection.CreateCommand();
        command.CommandText = dax;
        using var reader = command.ExecuteReader();
        var columns = Enumerable.Range(0, reader.FieldCount).Select(reader.GetName).ToList();
        var rows = new List<object?[]>();
        var fingerprint = new List<string>();
        var count = 0;
        while (reader.Read())
        {
            count++;
            var row = new object?[reader.FieldCount];
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var value = reader.GetValue(i);
                row[i] = value is DBNull ? null : value;
            }
            fingerprint.Add(string.Join('\u001f', row.Select(Canonical)));
            if (rows.Count < maxRows) rows.Add(row);
        }
        // Sin ORDER BY el orden de las filas no está garantizado: se ordena antes de calcular la huella.
        fingerprint.Sort(StringComparer.Ordinal);
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', fingerprint))))[..16];
        return new ResultSet(columns, rows, count, count > rows.Count, hash);
    }

    /// <summary>Los double varían en los últimos dígitos según el orden de agregación en paralelo: se redondean.</summary>
    private static string Canonical(object? value) => value switch
    {
        null => "∅",
        double d => d.ToString("G12", CultureInfo.InvariantCulture),
        float f => ((double)f).ToString("G12", CultureInfo.InvariantCulture),
        DateTime t => t.ToString("O", CultureInfo.InvariantCulture),
        IFormattable x => x.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };

    private void Close()
    {
        foreach (var session in _roleSessions.Values) session.Dispose(_log);
        _roleSessions.Clear();
        _admin?.Dispose(_log);
        _admin = null;
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

    /// <summary>Conexión ADOMD con su traza.</summary>
    private sealed class DaxSession
    {
        public DaxSession(string key, AdomdConnection connection)
        {
            Key = key;
            Connection = connection;
        }

        public string Key { get; }
        public AdomdConnection Connection { get; }
        public TraceSession? Trace { get; set; }

        public void Dispose(ILogger log)
        {
            try { Trace?.Dispose(); } catch (Exception ex) { log.LogWarning(ex, "Cerrando la traza de {Key}", Key); }
            Trace = null;
            try { Connection.Close(); } catch (Exception ex) { log.LogDebug(ex, "Cerrando la conexión de {Key}", Key); }
        }
    }
}
