using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using PuenteDax.Core;

namespace PuenteDax.Bridge;

/// <summary>
/// «PuenteDax.exe ci»: el check de rendimiento de los pull requests. Mide las mismas consultas en producción
/// (base) y en el modelo desplegado desde el PR (candidato), intercalando ambos, y aplica reglas.yml.
/// Código de salida: 0 aprobado · 1 alguna regla incumplida · 2 error de uso o de conexión.
/// </summary>
public static class CiRunner
{
    public const string Help = """
        Puente DAX · check de rendimiento para CI (producción frente a PR)

        Uso: PuenteDax.exe ci --reglas <reglas.yml> --servidor <xmla> --base <modelo> --pr <modelo> [opciones]

          --reglas <fichero>        reglas.yml (las consultas de visuales van en su carpeta «consultas»).
          --servidor <xmla>         powerbi://api.powerbi.com/v1.0/myorg/<Workspace> o localhost:PUERTO.
          --base-servidor <xmla>    Servidor de producción, si no es el mismo (p. ej. otro Desktop).
          --pr-servidor <xmla>      Servidor del PR, si no es el mismo.
          --base <modelo>           Modelo de producción (en Desktop se puede omitir).
          --pr <modelo>             Modelo desplegado desde el PR.
          --salida <fichero.json>   Mediciones y hallazgos en JSON.
          --resumen <fichero.md>    Resumen en Markdown (también va a $GITHUB_STEP_SUMMARY si existe).
          --mock                    Simulado, sin Power BI (prueba de humo del workflow).

        Credenciales del servicio (variables de entorno, nunca en la línea de comandos):
          FABRIC_TENANT_ID, FABRIC_CLIENT_ID, FABRIC_CLIENT_SECRET  → service principal.
          Sin ellas, ADOMD usa la identidad de Windows (Desktop) o pide inicio de sesión.
        """;

    private static readonly TimeSpan QueryTimeout = TimeSpan.FromMinutes(3);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        Converters = { new JsonStringEnumConverter() },
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private sealed record Consulta(string Id, string Nombre, string Tipo, string Dax);

    public static async Task<int> RunAsync(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Dictionary<string, string?> o;
        try
        {
            o = Parse(args);
        }
        catch (ArgumentException ex)
        {
            Console.Error.WriteLine(ex.Message);
            return 2;
        }
        if (o.ContainsKey("--help"))
        {
            Console.WriteLine(Help);
            return 0;
        }

        var reglasPath = o.GetValueOrDefault("--reglas") ?? throw new ArgumentException("Falta --reglas.");
        var reglas = ReglasRendimiento.LeerFichero(reglasPath);
        var mock = o.ContainsKey("--mock");
        var servidor = o.GetValueOrDefault("--servidor");
        var baseServidor = o.GetValueOrDefault("--base-servidor") ?? servidor;
        var prServidor = o.GetValueOrDefault("--pr-servidor") ?? servidor;
        var baseModelo = o.GetValueOrDefault("--base");
        var prModelo = o.GetValueOrDefault("--pr");
        if (!mock && (baseServidor is null || prServidor is null))
        {
            Console.Error.WriteLine("Falta --servidor (o --base-servidor y --pr-servidor). Usa ci --help.");
            return 2;
        }

        using var loggers = LoggerFactory.Create(b => b
            .AddSimpleConsole(s => { s.SingleLine = true; s.TimestampFormat = "HH:mm:ss "; })
            .SetMinimumLevel(LogLevel.Warning));
        var credenciales = Credenciales();
        await using var prod = Backend(mock, baseServidor, baseModelo, credenciales, loggers);
        await using var pr = Backend(mock, prServidor, prModelo, credenciales, loggers);

        ConnectionInfo infoProd, infoPr;
        try
        {
            infoProd = await prod.ConnectAsync(new ConnectRequest(baseServidor, baseModelo), CancellationToken.None);
            infoPr = await pr.ConnectAsync(new ConnectRequest(prServidor, prModelo), CancellationToken.None);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"No se pudo conectar: {Innermost(ex).Message}");
            return 2;
        }
        Console.WriteLine($"Producción: {infoProd.Server} · {infoProd.Database}");
        Console.WriteLine($"PR        : {infoPr.Server} · {infoPr.Database}");

        var consultas = ConsultasDeVisuales(reglas, Path.GetDirectoryName(Path.GetFullPath(reglasPath))!);
        if (!mock) consultas.AddRange(await ConsultasDeMedidas(reglas, prod, pr));
        Console.WriteLine($"{consultas.Count} consultas · {reglas.Ejecuciones.Frio} en frío + {reglas.Ejecuciones.Caliente} en caliente por modelo");
        Console.WriteLine();

        var medidas = new List<ConsultaMedida>();
        for (var i = 0; i < consultas.Count; i++)
        {
            var c = consultas[i];
            var medida = await MedirAsync(c, prod, pr, reglas.Ejecuciones);
            medidas.Add(medida);
            Console.WriteLine($"[{i + 1,3}/{consultas.Count}] {c.Tipo}: {c.Nombre} · PROD {Ms(medida.Base, medida.ErrorBase)} · PR {Ms(medida.Candidato, medida.ErrorCandidato)}");
        }

        var veredicto = EvaluadorRendimiento.Evaluar(reglas, medidas);
        var markdown = EvaluadorRendimiento.Markdown(veredicto, infoProd.Database, infoPr.Database);
        Console.WriteLine();
        Console.WriteLine(markdown);

        if (o.GetValueOrDefault("--salida") is { } salida)
            await File.WriteAllTextAsync(salida, JsonSerializer.Serialize(new { produccion = infoProd, pr = infoPr, veredicto }, Json));
        if (o.GetValueOrDefault("--resumen") is { } resumen)
            await File.WriteAllTextAsync(resumen, markdown);
        if (Environment.GetEnvironmentVariable("GITHUB_STEP_SUMMARY") is { Length: > 0 } summary)
            await File.AppendAllTextAsync(summary, markdown + Environment.NewLine);

        return veredicto.Aprobado ? 0 : 1;
    }

    /// <summary>Frío y caliente intercalando producción y PR: si la capacidad va lenta, va lenta para los dos.</summary>
    private static async Task<ConsultaMedida> MedirAsync(Consulta c, IDaxBackend prod, IDaxBackend pr, EjecucionesConfig n)
    {
        var lado = new[] { new Lado(prod), new Lado(pr) };
        for (var i = 0; i < n.Frio; i++)
            foreach (var l in lado) await l.Ejecutar(c.Dax, frio: true);
        for (var i = 0; i < n.Caliente; i++)
            foreach (var l in lado) await l.Ejecutar(c.Dax, frio: false);
        return new ConsultaMedida(c.Id, c.Nombre, c.Tipo, lado[0].Medicion(), lado[1].Medicion(), lado[0].Error, lado[1].Error);
    }

    private sealed class Lado(IDaxBackend backend)
    {
        private readonly List<ServerTimings> _frio = new();
        private readonly List<ServerTimings> _caliente = new();
        private string? _hash;

        public string? Error { get; private set; }

        public async Task Ejecutar(string dax, bool frio)
        {
            if (Error is not null) return;
            try
            {
                using var cts = new CancellationTokenSource(QueryTimeout);
                var r = await backend.QueryAsync(new QueryRequest(dax, ClearCache: frio, MaxRows: 1), cts.Token);
                (frio ? _frio : _caliente).Add(r.Timings);
                _hash ??= r.Result.Hash;
            }
            catch (OperationCanceledException)
            {
                Error = $"Tiempo agotado ({QueryTimeout.TotalMinutes:0} min)";
            }
            catch (Exception ex)
            {
                Error = Innermost(ex).Message;
            }
        }

        public Medicion? Medicion()
        {
            if (Error is not null || _frio.Count + _caliente.Count == 0) return null;
            var frio = _frio.Count > 0 ? _frio : _caliente;
            var caliente = _caliente.Count > 0 ? _caliente : _frio;
            // Las cuentas salen de la primera ejecución en frío: con caché caliente el SE puede no ejecutarse.
            return new Medicion(
                Benchmark.Median(frio.Select(t => t.TotalMs)),
                Benchmark.Median(caliente.Select(t => t.TotalMs)),
                Benchmark.Median(frio.Select(t => t.StorageEngineCpuMs)),
                frio[0].StorageEngineQueries,
                frio[0].Callbacks,
                _hash);
        }
    }

    /// <summary>Un fichero .dax por visual. Cabecera opcional: «// visual: …», «// pagina: …».</summary>
    private static List<Consulta> ConsultasDeVisuales(ReglasRendimiento reglas, string carpetaReglas)
    {
        var carpeta = Path.Combine(carpetaReglas, reglas.Visuales.Carpeta);
        if (!Directory.Exists(carpeta)) return new();
        return Directory.EnumerateFiles(carpeta, "*.dax")
            .OrderBy(f => f, StringComparer.Ordinal)
            .Select(f =>
            {
                var lineas = File.ReadAllLines(f);
                var cabecera = lineas.TakeWhile(l => l.TrimStart().StartsWith("//")).ToList();
                // Se envía sin la cabecera: así el texto del evento de traza es el mismo DAX.
                var dax = string.Join('\n', lineas.Skip(cabecera.Count)).Trim();
                var meta = cabecera
                    .Select(l => l.Trim().TrimStart('/').Split(':', 2))
                    .Where(p => p.Length == 2)
                    .ToDictionary(p => p[0].Trim().ToLowerInvariant(), p => p[1].Trim());
                var nombre = meta.GetValueOrDefault("visual") ?? Path.GetFileNameWithoutExtension(f);
                if (meta.GetValueOrDefault("pagina") is { } pagina) nombre = $"{pagina} / {nombre}";
                return new Consulta(Path.GetFileNameWithoutExtension(f), nombre, TipoConsulta.Visual, dax);
            })
            .ToList();
    }

    /// <summary>
    /// Medidas a medir. «afectadas»: las que cambian en el PR más las que dependen de ellas
    /// (INFO.CALCDEPENDENCY), y las nuevas. «todas»: todas las de producción y las nuevas.
    /// </summary>
    private static async Task<List<Consulta>> ConsultasDeMedidas(ReglasRendimiento reglas, IDaxBackend prod, IDaxBackend pr)
    {
        var cfg = reglas.Medidas;
        var modo = cfg.Modo.ToLowerInvariant();
        if (modo == "ninguna") return new();

        const string medidasDax = "EVALUATE SELECTCOLUMNS(INFO.VIEW.MEASURES(), \"Nombre\", [Name], \"Expresion\", [Expression])";
        var enProd = await Diccionario(prod, medidasDax);
        var enPr = await Diccionario(pr, medidasDax);
        if (enProd is null || enPr is null)
        {
            Console.WriteLine("⚠️  No se pudo leer INFO.VIEW.MEASURES: solo se miden los visuales.");
            return new();
        }

        var nuevas = enPr.Keys.Where(k => !enProd.ContainsKey(k)).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var elegidas = new HashSet<string>(nuevas, StringComparer.OrdinalIgnoreCase);
        if (modo == "todas")
        {
            elegidas.UnionWith(enProd.Keys.Where(enPr.ContainsKey));
        }
        else
        {
            var cambiadas = enProd.Keys.Where(k => enPr.TryGetValue(k, out var e) && Normalizar(e) != Normalizar(enProd[k])).ToList();
            Console.WriteLine($"Medidas cambiadas en el PR: {(cambiadas.Count == 0 ? "ninguna" : string.Join(", ", cambiadas))}");
            elegidas.UnionWith(cambiadas);
            var dependientes = await Dependientes(pr, cambiadas);
            if (dependientes is null)
            {
                Console.WriteLine("⚠️  INFO.CALCDEPENDENCY no disponible: se miden todas las medidas.");
                elegidas.UnionWith(enProd.Keys.Where(enPr.ContainsKey));
            }
            else
            {
                elegidas.UnionWith(dependientes.Where(enProd.ContainsKey));
            }
        }

        elegidas.ExceptWith(cfg.Excluir);
        return elegidas
            .OrderBy(m => m, StringComparer.CurrentCulture)
            .Select(m => new Consulta($"medida:{m}", m + (nuevas.Contains(m) ? " (nueva)" : string.Empty), TipoConsulta.Medida, cfg.Consulta(m)))
            .ToList();
    }

    /// <summary>Cierre transitivo: medidas que usan (directa o indirectamente) alguna de las cambiadas.</summary>
    private static async Task<HashSet<string>?> Dependientes(IDaxBackend pr, IReadOnlyCollection<string> cambiadas)
    {
        var resultado = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (cambiadas.Count == 0) return resultado;
        const string dax = """
            EVALUATE SELECTCOLUMNS(
                FILTER(INFO.CALCDEPENDENCY(), [OBJECT_TYPE] = "MEASURE" && [REFERENCED_OBJECT_TYPE] = "MEASURE"),
                "Medida", [OBJECT], "Usa", [REFERENCED_OBJECT])
            """;
        var filas = await Filas(pr, dax);
        if (filas is null) return null;

        var pendientes = new Queue<string>(cambiadas);
        while (pendientes.Count > 0)
        {
            var actual = pendientes.Dequeue();
            foreach (var f in filas.Where(f => string.Equals(f.Value, actual, StringComparison.OrdinalIgnoreCase)))
                if (resultado.Add(f.Key)) pendientes.Enqueue(f.Key);
        }
        return resultado;
    }

    private static async Task<Dictionary<string, string>?> Diccionario(IDaxBackend backend, string dax)
    {
        var filas = await Filas(backend, dax);
        return filas?.GroupBy(f => f.Key, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First().Value, StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>Consulta de metadatos de dos columnas, sin traza. Null si falla o viene truncada.</summary>
    private static async Task<List<KeyValuePair<string, string>>?> Filas(IDaxBackend backend, string dax)
    {
        try
        {
            var r = await backend.QueryAsync(new QueryRequest(dax, ClearCache: false, MaxRows: 500, Trace: false), CancellationToken.None);
            if (r.Result.Truncated) return null;
            return r.Result.Rows
                .Where(f => f.Length >= 2 && f[0] is not null)
                .Select(f => new KeyValuePair<string, string>(f[0]!.ToString()!, f[1]?.ToString() ?? string.Empty))
                .ToList();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"⚠️  {Innermost(ex).Message}");
            return null;
        }
    }

    private static string Normalizar(string dax) => string.Join(' ', dax.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));

    private static IDaxBackend Backend(bool mock, string? servidor, string? modelo, string? credenciales, ILoggerFactory loggers) =>
        mock
            ? new MockBackend()
            : new PowerBiBackend(loggers.CreateLogger<PowerBiBackend>(), BridgeOptions.ForModel(servidor!, modelo, credenciales));

    /// <summary>Service principal para XMLA: User ID=app:&lt;clientId&gt;@&lt;tenantId&gt;.</summary>
    private static string? Credenciales()
    {
        var tenant = Environment.GetEnvironmentVariable("FABRIC_TENANT_ID");
        var client = Environment.GetEnvironmentVariable("FABRIC_CLIENT_ID");
        var secret = Environment.GetEnvironmentVariable("FABRIC_CLIENT_SECRET");
        if (string.IsNullOrWhiteSpace(tenant) || string.IsNullOrWhiteSpace(client) || string.IsNullOrWhiteSpace(secret))
            return null;
        return $"User ID=app:{client}@{tenant};Password=\"{secret.Replace("\"", "\"\"")}\";";
    }

    private static Dictionary<string, string?> Parse(string[] args)
    {
        var flags = new HashSet<string> { "--mock", "--help" };
        var valores = new HashSet<string> { "--reglas", "--servidor", "--base-servidor", "--pr-servidor", "--base", "--pr", "--salida", "--resumen" };
        var o = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        for (var i = 0; i < args.Length; i++)
        {
            var a = args[i].ToLowerInvariant();
            if (a is "-h" or "/?") a = "--help";
            if (flags.Contains(a)) o[a] = null;
            else if (valores.Contains(a) && i + 1 < args.Length) o[a] = args[++i];
            else throw new ArgumentException($"Opción desconocida o sin valor: {args[i]}. Usa ci --help.");
        }
        if (!o.ContainsKey("--help") && !o.ContainsKey("--reglas")) throw new ArgumentException("Falta --reglas. Usa ci --help.");
        return o;
    }

    private static string Ms(Medicion? m, string? error) =>
        error is not null ? "ERROR" : m is null ? "–" : $"{m.FrioMs:#,0} ms frío / {m.CalienteMs:#,0} ms caliente · SE {m.ConsultasSe} · CB {m.Callbacks}";

    private static Exception Innermost(Exception ex) => ex.InnerException is null ? ex : Innermost(ex.InnerException);
}
