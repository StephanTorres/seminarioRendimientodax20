using System.Collections.Concurrent;
using Microsoft.AnalysisServices.AdomdClient;
using PuenteDax.Core;
using Amo = Microsoft.AnalysisServices;

namespace PuenteDax.Bridge;

/// <summary>Una consulta vista por la traza global, con lo que cuesta en el motor.</summary>
public sealed record ProfiledQuery(
    string RequestId,
    DateTime StartedAt,
    DateTime EndedAt,
    string Text,
    string Application,
    string Database,
    long DurationMs,
    long CpuMs,
    long FormulaEngineMs,
    long StorageEngineMs,
    long StorageEngineCpuMs,
    int StorageEngineQueries,
    long Rows,
    long KBytes);

public sealed record ProfileRecording(DateTime StartedAt, DateTime StoppedAt, string Database, IReadOnlyList<ProfiledQuery> Queries);

public sealed record ProfileStatus(bool Recording, int Queries, DateTime? StartedAt);

/// <summary>
/// Graba TODAS las consultas del modelo (sin filtrar por sesión), p. ej. las que lanzan los visuales de un
/// informe en Power BI Desktop. Es la mitad de «dónde duele»: la CPU del motor de cada consulta. La otra mitad
/// (qué visual la lanzó) sale de la exportación del Analizador de rendimiento o, donde se pueda, del PBIR.
/// CPU = FE + CPU acumulada del SE (lo que consume capacidad, no lo que tarda en reloj).
/// </summary>
public sealed class ProfileRecorder
{
    private static readonly Amo.TraceColumn[] Columns =
    {
        Amo.TraceColumn.ActivityID, Amo.TraceColumn.ApplicationName, Amo.TraceColumn.CpuTime, Amo.TraceColumn.CurrentTime,
        Amo.TraceColumn.DatabaseName, Amo.TraceColumn.Duration, Amo.TraceColumn.EndTime, Amo.TraceColumn.EventClass,
        Amo.TraceColumn.EventSubclass, Amo.TraceColumn.RequestID, Amo.TraceColumn.StartTime, Amo.TraceColumn.TextData,
    };

    private sealed record Raw(bool IsQuery, string RequestId, DateTime Start, DateTime End, long Duration, long Cpu,
        string Text, string Subclass, string Application, string Database, string? ActivityId);

    private readonly ILogger<ProfileRecorder> _log;
    private readonly object _gate = new();
    private Amo.Server? _server;
    private Amo.Trace? _trace;
    private ConcurrentQueue<Raw> _events = new();
    private int _queryEnds;
    private DateTime _startedAt;
    private string _database = string.Empty;

    public ProfileRecorder(ILogger<ProfileRecorder> log) => _log = log;

    public ProfileStatus Status => new(_trace is not null, _queryEnds, _trace is null ? null : _startedAt);

    public void Start(string server, string database)
    {
        lock (_gate)
        {
            if (_trace is not null) throw new InvalidOperationException("Ya hay una grabación en marcha.");

            IReadOnlyDictionary<int, HashSet<int>> supported;
            using (var connection = new AdomdConnection($"Data Source={server};Initial Catalog={database}"))
            {
                connection.Open();
                supported = SupportedTraceColumns.Read(connection);
            }

            _events = new ConcurrentQueue<Raw>();
            _queryEnds = 0;
            _database = database;
            var amoServer = new Amo.Server();
            amoServer.Connect($"Data Source={server}");
            var trace = amoServer.Traces.Add($"PuenteDax_Perfil_{Guid.NewGuid():N}");
            foreach (var eventClass in new[] { Amo.TraceEventClass.QueryEnd, Amo.TraceEventClass.VertiPaqSEQueryEnd })
            {
                if (!supported.TryGetValue((int)eventClass, out var allowed)) continue;
                var traceEvent = new Amo.TraceEvent(eventClass);
                foreach (var column in Columns.Where(c => allowed.Contains((int)c))) traceEvent.Columns.Add(column);
                trace.Events.Add(traceEvent);
            }
            trace.StopTime = DateTime.UtcNow.AddHours(8);
            trace.Update(Amo.UpdateOptions.Default, Amo.UpdateMode.CreateOrReplace);
            trace.OnEvent += OnEvent;
            trace.Start();
            _server = amoServer;
            _trace = trace;
            _startedAt = DateTime.UtcNow;
            _log.LogInformation("Grabación de consultas iniciada en {Server} · {Database}", server, database);
        }
    }

    public ProfileRecording Stop()
    {
        Amo.Trace? trace;
        Amo.Server? server;
        lock (_gate)
        {
            trace = _trace ?? throw new InvalidOperationException("No hay ninguna grabación en marcha.");
            server = _server;
            _trace = null;
            _server = null;
        }
        trace.OnEvent -= OnEvent;
        try { trace.Stop(); } catch (Exception ex) { _log.LogDebug(ex, "Stop de la traza de perfil"); }
        try { trace.Drop(); } catch (Exception ex) { _log.LogWarning(ex, "No se pudo eliminar la traza de perfil"); }
        try { server?.Disconnect(); } catch (Exception ex) { _log.LogDebug(ex, "Desconexión AMO"); }

        var raw = _events.ToArray();
        var se = raw.Where(r => !r.IsQuery).GroupBy(r => r.RequestId).ToDictionary(g => g.Key, g => g.OrderBy(r => r.Start).ToList());
        var queries = new List<ProfiledQuery>();
        foreach (var q in raw.Where(r => r.IsQuery && !string.IsNullOrWhiteSpace(r.Text)))
        {
            // Las consultas del propio puente (marcador) no son del informe.
            if (q.Text.Contains("/* puente:", StringComparison.Ordinal)) continue;
            var records = new List<TraceRecord>();
            if (se.TryGetValue(q.RequestId, out var children))
                records.AddRange(children.Select(ToRecord));
            records.Add(ToRecord(q));
            try
            {
                var t = ServerTimingsCalculator.Calculate(records);
                queries.Add(new ProfiledQuery(q.RequestId, q.Start, q.End, q.Text, q.Application, q.Database, q.Duration,
                    t.FormulaEngineMs + t.StorageEngineCpuMs, t.FormulaEngineMs, t.StorageEngineMs, t.StorageEngineCpuMs,
                    t.StorageEngineQueries, t.Rows, t.KBytes));
            }
            catch (Exception ex)
            {
                _log.LogDebug(ex, "No se pudo calcular una consulta grabada");
            }
        }
        _log.LogInformation("Grabación detenida: {Count} consultas", queries.Count);
        return new ProfileRecording(_startedAt, DateTime.UtcNow, _database, queries.OrderBy(q => q.StartedAt).ToList());
    }

    private void OnEvent(object sender, Amo.TraceEventArgs e)
    {
        try
        {
            var isQuery = e.EventClass == Amo.TraceEventClass.QueryEnd;
            if (!isQuery && e.EventClass != Amo.TraceEventClass.VertiPaqSEQueryEnd) return;
            var raw = new Raw(
                isQuery,
                Safe(() => e[Amo.TraceColumn.RequestID]?.ToString(), "") ?? "",
                Safe(() => e.StartTime, DateTime.MinValue),
                Safe(() => e.EndTime, DateTime.MinValue),
                Safe(() => e.Duration, 0L),
                Safe(() => e.CpuTime, 0L),
                Safe(() => e.TextData, "") ?? "",
                Safe(() => e.EventSubclass.ToString(), "") ?? "",
                Safe(() => e.ApplicationName, "") ?? "",
                Safe(() => e.DatabaseName, "") ?? "",
                Safe(() => e[Amo.TraceColumn.ActivityID]?.ToString(), null));
            _events.Enqueue(raw);
            if (isQuery) Interlocked.Increment(ref _queryEnds);
        }
        catch (Exception ex)
        {
            _log.LogDebug(ex, "No se pudo leer un evento de la traza de perfil");
        }
    }

    private static TraceRecord ToRecord(Raw r) => new()
    {
        Kind = r.IsQuery ? TraceKind.QueryEnd : TraceKind.StorageEngineEnd,
        Subclass = r.Subclass,
        StartTime = r.Start,
        EndTime = r.End,
        DurationMs = r.Duration,
        CpuMs = r.Cpu,
        TextData = r.Text,
        ActivityId = r.ActivityId,
    };

    private static T Safe<T>(Func<T> read, T fallback)
    {
        try { return read(); } catch { return fallback; }
    }
}
