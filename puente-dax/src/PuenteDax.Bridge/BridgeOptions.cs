using System.Security.Cryptography;

namespace PuenteDax.Bridge;

/// <summary>Opciones de línea de comandos. Power BI Desktop pasa --server y --database al lanzarlo como External Tool.</summary>
public sealed class BridgeOptions
{
    public string? Server { get; private set; }
    public string? Database { get; private set; }
    public int Port { get; private set; } = 5199;
    public string Token { get; private set; } = NewToken();
    public bool TokenWasGenerated { get; private set; } = true;
    public string? WebRoot { get; private set; }
    public string? ReportDir { get; private set; }
    public List<string> AllowedOrigins { get; } = new();
    public bool Mock { get; private set; }
    public bool OpenBrowser { get; private set; }
    public bool ShowHelp { get; private set; }

    public const string Help = """
        Puente DAX · mide consultas DAX contra Power BI Desktop (FE, SE, callbacks, planes)

        Uso: PuenteDax.exe [opciones]

          --server <host:puerto>   Instancia de Analysis Services de Power BI Desktop.
                                   Como External Tool, Desktop lo pasa solo (%server%).
                                   Si no se indica, se busca el primer Desktop abierto.
          --database <nombre>      Modelo (Desktop lo pasa como %database%).
          --port <n>               Puerto HTTP del puente (por defecto 5199).
          --token <texto>          Token que deben enviar las páginas (X-Puente-Token).
                                   Si no se indica, se genera uno aleatorio.
          --www <carpeta>          Sirve esa carpeta en http://127.0.0.1:<puerto>/
                                   (por ejemplo, la carpeta de las diapositivas).
          --report <carpeta>       Carpeta .Report (PBIR) del informe que se está perfilando: permite al
                                   widget «Dónde duele» poner nombre a páginas y visuales.
          --allow-origin <url>     Origen web adicional autorizado (repetible).
          --mock                   Modo simulado: no necesita Power BI.
          --open                   Abre el navegador al arrancar.
          --help                   Esta ayuda.
        """;

    public static BridgeOptions Parse(string[] args)
    {
        var o = new BridgeOptions();
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            string Next() => i + 1 < args.Length
                ? args[++i]
                : throw new ArgumentException($"Falta el valor de {arg}");

            switch (arg.ToLowerInvariant())
            {
                case "--server": o.Server = Clean(Next()); break;
                case "--database": o.Database = Clean(Next()); break;
                case "--port": o.Port = int.Parse(Next()); break;
                case "--token": o.Token = Next(); o.TokenWasGenerated = false; break;
                case "--www": o.WebRoot = Path.GetFullPath(Next()); break;
                case "--report": o.ReportDir = Path.GetFullPath(Next()); break;
                case "--allow-origin": o.AllowedOrigins.Add(Next().TrimEnd('/')); break;
                case "--mock": o.Mock = true; break;
                case "--open": o.OpenBrowser = true; break;
                case "--help" or "-h" or "/?": o.ShowHelp = true; break;
                default: throw new ArgumentException($"Opción desconocida: {arg}. Usa --help.");
            }
        }

        if (o.WebRoot is not null && !Directory.Exists(o.WebRoot))
            throw new ArgumentException($"La carpeta de --www no existe: {o.WebRoot}");
        return o;
    }

    // Si Desktop no tiene modelo abierto, los marcadores llegan sin sustituir.
    private static string? Clean(string value) =>
        string.IsNullOrWhiteSpace(value) || value.StartsWith('%') ? null : value.Trim();

    private static string NewToken() =>
        Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
}
