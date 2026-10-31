using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Xml;
using Microsoft.AnalysisServices.AdomdClient;
using PuenteDax.Core;
using Amo = Microsoft.AnalysisServices;

namespace PuenteDax.Bridge;

/// <summary>
/// Traza de servidor (AMO) filtrada a la sesión ADOMD del puente. Se crea una vez por conexión y
/// queda escuchando; cada consulta abre una <see cref="QueryCapture"/> para quedarse con sus eventos.
/// Es la misma técnica que usa DAX Studio para Server Timings y Query Plan.
/// </summary>
internal sealed class TraceSession : IDisposable
{
    private static readonly Amo.TraceColumn[] DesiredColumns =
    {
        Amo.TraceColumn.ActivityID, Amo.TraceColumn.CpuTime, Amo.TraceColumn.CurrentTime,
        Amo.TraceColumn.DatabaseName, Amo.TraceColumn.Duration, Amo.TraceColumn.EndTime,
        Amo.TraceColumn.EventClass, Amo.TraceColumn.EventSubclass, Amo.TraceColumn.ObjectName,
        Amo.TraceColumn.RequestID, Amo.TraceColumn.SessionID, Amo.TraceColumn.Spid,
        Amo.TraceColumn.StartTime, Amo.TraceColumn.TextData,
    };

    private readonly Amo.Server _server;
    private readonly Amo.Trace _trace;
    private readonly ILogger _log;
    private volatile bool _alive;
    private volatile QueryCapture? _capture;

    public bool IncludesPlan { get; }
    public bool IncludesExecutionMetrics { get; }

    private TraceSession(Amo.Server server, Amo.Trace trace, bool includesPlan, bool includesMetrics, ILogger log)
    {
        _server = server;
        _trace = trace;
        IncludesPlan = includesPlan;
        IncludesExecutionMetrics = includesMetrics;
        _log = log;
    }

    public static TraceSession Start(
        string dataSource, string database, string sessionId,
        IReadOnlyDictionary<int, HashSet<int>> supported, bool includePlan,
        Action ping, ILogger log, TimeSpan timeout)
    {
        var server = new Amo.Server();
        server.Connect($"Data Source={dataSource};Initial Catalog={database};SessionId={sessionId}");

        var trace = server.Traces.Add($"PuenteDax_{Guid.NewGuid():N}");
        var classes = new List<Amo.TraceEventClass>
        {
            Amo.TraceEventClass.DiscoverBegin, // latido: confirma que la traza ya está viva
            Amo.TraceEventClass.QueryBegin,
            Amo.TraceEventClass.QueryEnd,
            Amo.TraceEventClass.VertiPaqSEQueryBegin,
            Amo.TraceEventClass.VertiPaqSEQueryEnd,
            Amo.TraceEventClass.VertiPaqSEQueryCacheMatch,
            Amo.TraceEventClass.DirectQueryEnd,
            Amo.TraceEventClass.ExecutionMetrics,
        };
        if (includePlan) classes.Add(Amo.TraceEventClass.DAXQueryPlan);

        var includesMetrics = false;
        foreach (var eventClass in classes)
        {
            // Las columnas disponibles cambian según la versión del motor: solo pedimos las que existen.
            if (!supported.TryGetValue((int)eventClass, out var columns)) continue;
            var traceEvent = new Amo.TraceEvent(eventClass);
            foreach (var column in DesiredColumns.Where(c => columns.Contains((int)c)))
                traceEvent.Columns.Add(column);
            trace.Events.Add(traceEvent);
            includesMetrics |= eventClass == Amo.TraceEventClass.ExecutionMetrics;
        }

        trace.Filter = SessionFilter(sessionId);
        trace.StopTime = DateTime.UtcNow.AddHours(24);
        trace.Update(Amo.UpdateOptions.Default, Amo.UpdateMode.CreateOrReplace);

        var session = new TraceSession(server, trace, includePlan, includesMetrics, log);
        trace.OnEvent += session.OnEvent;
        trace.Start();

        // La traza tarda en activarse: hacemos peticiones de descubrimiento hasta ver el primer evento.
        var clock = Stopwatch.StartNew();
        while (!session._alive)
        {
            if (clock.Elapsed > timeout)
            {
                session.Dispose();
                throw new TimeoutException("La traza no ha empezado a recibir eventos. Comprueba que Power BI Desktop sigue abierto.");
            }
            ping();
            Thread.Sleep(250);
        }
        log.LogInformation("Traza activa en {Elapsed} ms (plan de consulta: {Plan})", clock.ElapsedMilliseconds, includePlan);
        return session;
    }

    public QueryCapture BeginCapture(string marker, string text)
    {
        var capture = new QueryCapture(marker, text, IncludesExecutionMetrics);
        _capture = capture;
        return capture;
    }

    public void EndCapture(QueryCapture capture)
    {
        if (ReferenceEquals(_capture, capture)) _capture = null;
    }

    private void OnEvent(object sender, Amo.TraceEventArgs e)
    {
        _alive = true;
        try
        {
            var record = Map(e);
            if (record is not null && _capture is not null)
                _log.LogDebug("Evento {Kind}/{Subclass} activity={Activity} texto={Length} caracteres", record.Kind, record.Subclass, record.ActivityId, record.TextData.Length);
            if (record is not null) _capture?.Add(record);
        }
        catch (Exception ex)
        {
            _log.LogWarning(ex, "No se pudo leer un evento de traza {EventClass}", e.EventClass);
        }
    }

    /// <summary>Convierte el evento de AMO; no todas las columnas existen en todos los eventos.</summary>
    private static TraceRecord? Map(Amo.TraceEventArgs e)
    {
        var kind = e.EventClass switch
        {
            Amo.TraceEventClass.QueryBegin => TraceKind.QueryBegin,
            Amo.TraceEventClass.QueryEnd => TraceKind.QueryEnd,
            Amo.TraceEventClass.VertiPaqSEQueryBegin => TraceKind.StorageEngineBegin,
            Amo.TraceEventClass.VertiPaqSEQueryEnd => TraceKind.StorageEngineEnd,
            Amo.TraceEventClass.VertiPaqSEQueryCacheMatch => TraceKind.StorageEngineCacheMatch,
            Amo.TraceEventClass.DirectQueryEnd => TraceKind.DirectQueryEnd,
            Amo.TraceEventClass.DAXQueryPlan => TraceKind.QueryPlan,
            Amo.TraceEventClass.ExecutionMetrics => TraceKind.ExecutionMetrics,
            _ => TraceKind.Other,
        };
        if (kind == TraceKind.Other) return null;

        var record = new TraceRecord
        {
            Kind = kind,
            Subclass = Safe(() => e.EventSubclass.ToString(), string.Empty),
            TextData = Safe(() => e.TextData, string.Empty) ?? string.Empty,
            ActivityId = Safe<string?>(() => e[Amo.TraceColumn.ActivityID], null),
        };

        return kind switch
        {
            TraceKind.QueryBegin => record with { StartTime = Safe(() => e.StartTime, DateTime.MinValue) },
            TraceKind.QueryEnd or TraceKind.StorageEngineEnd => record with
            {
                StartTime = Safe(() => e.StartTime, DateTime.MinValue),
                EndTime = Safe(() => e.EndTime, DateTime.MinValue),
                DurationMs = Safe(() => e.Duration, 0L),
                CpuMs = Safe(() => e.CpuTime, 0L),
            },
            TraceKind.DirectQueryEnd => record with
            {
                StartTime = Safe(() => e.StartTime, DateTime.MinValue),
                EndTime = Safe(() => e.EndTime, DateTime.MinValue),
                DurationMs = Safe(() => e.Duration, 0L),
                CpuMs = Safe(() => e.Duration, 0L), // en DirectQuery la CPU no se informa
            },
            TraceKind.StorageEngineBegin or TraceKind.StorageEngineCacheMatch => record with
            {
                StartTime = Safe(() => e.CurrentTime, DateTime.MinValue),
                EndTime = Safe(() => e.CurrentTime, DateTime.MinValue),
            },
            _ => record,
        };
    }

    private static T Safe<T>(Func<T> read, T fallback)
    {
        try
        {
            return read();
        }
        catch
        {
            return fallback;
        }
    }

    // Eventos de nuestra sesión + ExecutionMetrics (que no lleva SessionID; se casa luego por ActivityID).
    private static XmlNode SessionFilter(string sessionId)
    {
        var xml = string.Format(CultureInfo.InvariantCulture,
            "<Or xmlns=\"http://schemas.microsoft.com/analysisservices/2003/engine\">" +
            "<Equal><ColumnID>{0}</ColumnID><Value>{1}</Value></Equal>" +
            "<Equal><ColumnID>{2}</ColumnID><Value>{3}</Value></Equal>" +
            "</Or>",
            (int)Amo.TraceColumn.SessionID, System.Security.SecurityElement.Escape(sessionId),
            (int)Amo.TraceColumn.EventClass, (int)Amo.TraceEventClass.ExecutionMetrics);
        var doc = new XmlDocument { XmlResolver = null };
        doc.LoadXml(xml);
        return doc;
    }

    public void Dispose()
    {
        _trace.OnEvent -= OnEvent;
        try { _trace.Stop(); } catch (Exception ex) { _log.LogDebug(ex, "Stop de la traza"); }
        try { _trace.Drop(); } catch (Exception ex) { _log.LogWarning(ex, "No se pudo eliminar la traza del servidor"); }
        try { _server.Disconnect(); } catch (Exception ex) { _log.LogDebug(ex, "Desconexión AMO"); }
    }
}

/// <summary>Eventos de UNA consulta, identificada por un comentario único al principio del DAX.</summary>
internal sealed class QueryCapture
{
    private readonly string _marker;
    private readonly string _text;
    private readonly bool _expectMetrics;
    private readonly ConcurrentQueue<(int Index, TraceRecord Record)> _events = new();
    private readonly TaskCompletionSource _queryEnd = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private int _counter;
    private int _beginIndex = -1;
    private int _endIndex = -1;
    private volatile string? _activityId;

    public QueryCapture(string marker, string text, bool expectMetrics)
    {
        _marker = marker;
        _text = Collapse(text);
        _expectMetrics = expectMetrics;
    }

    // Power BI Desktop quita TODOS los comentarios iniciales (/* */ y --) del texto del evento, no solo el marcador:
    // se quitan también del texto enviado para que una consulta que empieza por "-- …" se siga reconociendo.
    private static readonly System.Text.RegularExpressions.Regex LeadingComments =
        new(@"^(?:\s+|--[^\r\n]*|/\*.*?\*/)*", System.Text.RegularExpressions.RegexOptions.Singleline);

    private static string Collapse(string text) =>
        System.Text.RegularExpressions.Regex.Replace(LeadingComments.Replace(text ?? string.Empty, string.Empty, 1), @"\s+", " ").Trim();

    public void Add(TraceRecord record)
    {
        var index = Interlocked.Increment(ref _counter);
        _events.Enqueue((index, record));
        if (record.Kind == TraceKind.QueryBegin
            && (record.TextData.Contains(_marker, StringComparison.Ordinal)
                // Algunos motores (p. ej. Power BI Desktop) quitan el comentario inicial del texto del evento:
                // la consulta es la que tiene el mismo texto que la enviada. Así un evento tardío de una consulta
                // anterior (por ejemplo, una que falló) no se confunde con la actual.
                || (_activityId is null && Collapse(record.TextData) == _text)))
        {
            _beginIndex = index;
            _activityId ??= record.ActivityId;
        }
        else if (record.Kind == TraceKind.QueryEnd
                 && (record.TextData.Contains(_marker, StringComparison.Ordinal)
                     // Algunos motores no repiten el texto de la consulta en QueryEnd: se casa por ActivityID.
                     || (_activityId is not null && record.ActivityId == _activityId)))
        {
            _endIndex = index;
            _activityId ??= record.ActivityId;
            _queryEnd.TrySetResult();
        }
    }

    public async Task<IReadOnlyList<TraceRecord>> WaitAsync(TimeSpan timeout, CancellationToken ct)
    {
        try
        {
            await _queryEnd.Task.WaitAsync(timeout, ct);
        }
        catch (TimeoutException)
        {
            throw new TimeoutException("No llegó el evento QueryEnd de la consulta a la traza.");
        }

        // ExecutionMetrics y algún evento rezagado llegan después del QueryEnd.
        var clock = System.Diagnostics.Stopwatch.StartNew();
        do
        {
            await Task.Delay(50, ct);
        }
        while (_expectMetrics && !Select().Any(r => r.Kind == TraceKind.ExecutionMetrics) && clock.ElapsedMilliseconds < 1000);

        return Select();
    }

    /// <summary>Por ActivityID; los eventos sin ActivityID se aceptan si llegaron entre nuestro QueryBegin y QueryEnd.</summary>
    private List<TraceRecord> Select()
    {
        var activity = _activityId;
        var begin = _beginIndex;
        var end = _endIndex;
        return _events
            .OrderBy(e => e.Index)
            .Where(e =>
            {
                var sameActivity = !string.IsNullOrEmpty(activity) && e.Record.ActivityId == activity;
                // ExecutionMetrics no lleva SessionID: solo se acepta por ActivityID (puede llegar antes del QueryBegin).
                if (e.Record.Kind == TraceKind.ExecutionMetrics) return sameActivity;
                // Algunos motores (p. ej. Power BI Desktop) dan a los eventos del SE un ActivityID distinto al de la
                // consulta: se aceptan también por estar entre nuestro QueryBegin y QueryEnd (la sesión serializa).
                return sameActivity || (begin > 0 && e.Index >= begin && (end < 0 || e.Index <= end));
            })
            .Where(e => e.Record.Kind is not (TraceKind.QueryBegin or TraceKind.QueryEnd)
                        || e.Record.TextData.Contains(_marker, StringComparison.Ordinal)
                        || (!string.IsNullOrEmpty(activity) && e.Record.ActivityId == activity))
            .Select(e => e.Record)
            .ToList();
    }
}

/// <summary>Qué columnas admite cada evento en esta versión del motor (DISCOVER_TRACE_EVENT_CATEGORIES).</summary>
internal static class SupportedTraceColumns
{
    public static IReadOnlyDictionary<int, HashSet<int>> Read(AdomdConnection connection)
    {
        var result = new Dictionary<int, HashSet<int>>();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT * FROM $SYSTEM.DISCOVER_TRACE_EVENT_CATEGORIES";
        using var reader = command.ExecuteReader();
        while (reader.Read())
        {
            var doc = new XmlDocument { XmlResolver = null };
            doc.LoadXml(reader.GetString(0));
            foreach (XmlNode eventNode in doc.SelectNodes("/EVENTCATEGORY/EVENTLIST/EVENT")!)
            {
                if (!int.TryParse(eventNode.SelectSingleNode("ID")?.InnerText, out var eventId)) continue;
                var columns = new HashSet<int>();
                foreach (XmlNode column in eventNode.SelectNodes("EVENTCOLUMNLIST/EVENTCOLUMN/ID")!)
                {
                    if (int.TryParse(column.InnerText, out var columnId)) columns.Add(columnId);
                }
                result[eventId] = columns;
            }
        }
        return result;
    }
}
