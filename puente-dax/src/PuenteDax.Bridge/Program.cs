using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.FileProviders;
using PuenteDax.Bridge;

BridgeOptions options;
try
{
    options = BridgeOptions.Parse(args);
}
catch (Exception ex)
{
    Console.Error.WriteLine(ex.Message);
    return 2;
}

if (options.ShowHelp)
{
    Console.WriteLine(BridgeOptions.Help);
    return 0;
}

// Si ya hay un puente en ese puerto (p. ej. se pulsa el External Tool desde otro .pbix),
// le pasamos el nuevo modelo y salimos en vez de fallar por puerto ocupado.
if (!PortIsFree(options.Port))
    return await HandOffAsync(options);

var builder = WebApplication.CreateBuilder(new WebApplicationOptions
{
    Args = Array.Empty<string>(),
    ContentRootPath = AppContext.BaseDirectory,
});
builder.WebHost.UseUrls($"http://127.0.0.1:{options.Port}");
// Solo se aceptan peticiones dirigidas a localhost (defensa frente a DNS rebinding).
builder.Configuration["AllowedHosts"] = "127.0.0.1;localhost";
builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(o => { o.SingleLine = true; o.TimestampFormat = "HH:mm:ss "; });
builder.Logging.AddFilter("Microsoft", LogLevel.Warning);

builder.Services.AddSingleton(options);
if (options.Mock) builder.Services.AddSingleton<IDaxBackend, MockBackend>();
else builder.Services.AddSingleton<IDaxBackend, PowerBiBackend>();
builder.Services.AddDirectoryBrowser();
builder.Services.AddCors(cors => cors.AddDefaultPolicy(policy => policy
    .SetIsOriginAllowed(origin => IsAllowedOrigin(origin, options))
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();
var log = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("PuenteDax");

// Compatibilidad con la antigua Private Network Access de Chrome (preflight hacia localhost).
app.Use(async (context, next) =>
{
    if (context.Request.Headers.ContainsKey("Access-Control-Request-Private-Network"))
        context.Response.OnStarting(() =>
        {
            context.Response.Headers["Access-Control-Allow-Private-Network"] = "true";
            return Task.CompletedTask;
        });
    await next();
});
app.UseCors();

// Token obligatorio en la API, salvo /api/health y /api/session-token.
app.Use(async (context, next) =>
{
    var path = context.Request.Path;
    var open = path.Equals("/api/health") || path.Equals("/api/session-token");
    if (path.StartsWithSegments("/api") && !open && !HttpMethods.IsOptions(context.Request.Method))
    {
        var sent = Encoding.UTF8.GetBytes(context.Request.Headers["X-Puente-Token"].ToString());
        if (!CryptographicOperations.FixedTimeEquals(sent, Encoding.UTF8.GetBytes(options.Token)))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new ErrorResponse("Falta el token del puente o no es correcto (cabecera X-Puente-Token)."));
            return;
        }
    }
    await next();
});

if (options.WebRoot is not null)
{
    app.UseFileServer(new FileServerOptions
    {
        FileProvider = new PhysicalFileProvider(options.WebRoot),
        EnableDirectoryBrowsing = true,
    });
}
else
{
    app.MapGet("/", () => Results.Redirect("/lab/demo.html"));
}

// Widget y demo embebidos en el ejecutable.
app.MapGet("/lab/{file}", (string file) =>
{
    var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream($"web/{file}");
    return stream is null ? Results.NotFound() : Results.Stream(stream, ContentType(file));
});

var api = app.MapGroup("/api");

api.MapGet("/health", (IDaxBackend backend) => Results.Ok(new
{
    ok = true,
    version = typeof(BridgeOptions).Assembly.GetName().Version?.ToString(3),
    mode = backend.Mode,
    connection = backend.Connection,
}));

// Las páginas servidas por el propio puente obtienen el token sin pedirlo al usuario.
// Sec-Fetch-Site lo pone el navegador y una web externa no puede falsificarlo.
api.MapGet("/session-token", (HttpContext context) =>
    context.Request.Headers["Sec-Fetch-Site"].ToString() == "same-origin"
        ? Results.Ok(new { token = options.Token })
        : Results.Json(new ErrorResponse("Solo para páginas servidas por el propio puente."), statusCode: StatusCodes.Status403Forbidden));

api.MapGet("/instances", (IDaxBackend backend) =>
    backend.Mode == "mock"
        ? Results.Ok(new[] { new PowerBiInstance("localhost:0", 0, "(simulado)", DateTime.UtcNow, true) })
        : Results.Ok(PowerBiInstances.Discover()));

api.MapPost("/connect", (ConnectRequest request, IDaxBackend backend, CancellationToken ct) =>
    Guard(() => backend.ConnectAsync(request, ct)));

api.MapPost("/query", (QueryRequest request, IDaxBackend backend, CancellationToken ct) =>
    Guard(() => backend.QueryAsync(request, ct)));

api.MapPost("/benchmark", (BenchmarkRequest request, IDaxBackend backend, CancellationToken ct) =>
    Guard(() => BenchmarkRunner.RunAsync(backend, request, ct)));

app.Lifetime.ApplicationStarted.Register(() =>
{
    var url = $"http://127.0.0.1:{options.Port}/";
    Console.WriteLine();
    Console.WriteLine("  ┌─ Puente DAX ─────────────────────────────────────────");
    Console.WriteLine($"  │ Modo     : {(options.Mock ? "SIMULADO (sin Power BI)" : "Power BI Desktop")}");
    Console.WriteLine($"  │ Dirección: {url}");
    Console.WriteLine($"  │ Token    : {options.Token}");
    Console.WriteLine($"  │ Páginas  : {options.WebRoot ?? "demo embebida en /lab/demo.html"}");
    Console.WriteLine("  │ Ctrl+C para cerrar (la traza se elimina del servidor al salir)");
    Console.WriteLine("  └──────────────────────────────────────────────────────");
    Console.WriteLine();

    // Conexión inicial en segundo plano: con --server (External Tool) o buscando Desktop.
    var backend = app.Services.GetRequiredService<IDaxBackend>();
    _ = Task.Run(async () =>
    {
        try
        {
            var info = await backend.ConnectAsync(new ConnectRequest(options.Server, options.Database), CancellationToken.None);
            log.LogInformation("Listo: {Server} · {Database} {Title}", info.Server, info.Database, info.Title);
        }
        catch (Exception ex)
        {
            log.LogWarning("Aún sin conexión: {Message}", ex.Message);
        }
    });

    if (options.OpenBrowser)
    {
        try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
        catch (Exception ex) { log.LogWarning("No se pudo abrir el navegador: {Message}", ex.Message); }
    }
});

app.Lifetime.ApplicationStopping.Register(() =>
    app.Services.GetRequiredService<IDaxBackend>().DisposeAsync().AsTask().GetAwaiter().GetResult());

app.Run();
return 0;

static bool PortIsFree(int port)
{
    try
    {
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, port);
        listener.Start();
        listener.Stop();
        return true;
    }
    catch (System.Net.Sockets.SocketException)
    {
        return false;
    }
}

static async Task<int> HandOffAsync(BridgeOptions options)
{
    var url = $"http://127.0.0.1:{options.Port}/";
    Console.WriteLine($"Ya hay un Puente DAX escuchando en {url}");
    try
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(90) };
        using var request = new HttpRequestMessage(HttpMethod.Post, url + "api/connect")
        {
            Content = System.Net.Http.Json.JsonContent.Create(new ConnectRequest(options.Server, options.Database)),
        };
        request.Headers.Add("X-Puente-Token", options.Token);
        using var response = await http.SendAsync(request);
        Console.WriteLine(response.IsSuccessStatusCode
            ? "Le he pasado el modelo abierto: ya mide contra él."
            : $"No ha aceptado el cambio de modelo ({(int)response.StatusCode}). ¿Usa otro token? Ciérralo o arranca este con --port.");
        if (options.OpenBrowser) Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }
    catch (Exception ex)
    {
        Console.WriteLine($"El puerto {options.Port} está ocupado por otro programa ({ex.Message}). Usa --port.");
    }
    await Task.Delay(TimeSpan.FromSeconds(4)); // para que se pueda leer el mensaje si se lanzó desde Desktop
    return 0;
}

static async Task<IResult> Guard<T>(Func<Task<T>> action)
{
    try
    {
        return Results.Ok(await action());
    }
    catch (OperationCanceledException)
    {
        return Results.StatusCode(499);
    }
    catch (ArgumentException ex)
    {
        return Results.BadRequest(new ErrorResponse(ex.Message));
    }
    catch (Exception ex)
    {
        // Los errores de DAX llegan aquí: se devuelven tal cual para enseñarlos en la slide.
        return Results.Json(new ErrorResponse(Innermost(ex).Message), statusCode: StatusCodes.Status500InternalServerError);
    }
}

static Exception Innermost(Exception ex) => ex.InnerException is null ? ex : Innermost(ex.InnerException);

static bool IsAllowedOrigin(string origin, BridgeOptions options)
{
    if (origin == "null") return true; // diapositivas abiertas como fichero (file://)
    if (options.AllowedOrigins.Contains(origin.TrimEnd('/'), StringComparer.OrdinalIgnoreCase)) return true;
    return Uri.TryCreate(origin, UriKind.Absolute, out var uri) && uri.IsLoopback;
}

static string ContentType(string file) => Path.GetExtension(file).ToLowerInvariant() switch
{
    ".js" => "text/javascript; charset=utf-8",
    ".css" => "text/css; charset=utf-8",
    ".html" => "text/html; charset=utf-8",
    ".json" => "application/json; charset=utf-8",
    ".svg" => "image/svg+xml",
    _ => "application/octet-stream",
};
