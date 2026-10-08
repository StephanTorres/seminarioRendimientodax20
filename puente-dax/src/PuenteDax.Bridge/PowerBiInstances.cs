using System.Diagnostics;
using System.Net;
using System.Net.Sockets;

namespace PuenteDax.Bridge;

/// <summary>
/// Localiza los Analysis Services locales que levanta Power BI Desktop: cada uno deja su
/// puerto en AnalysisServicesWorkspaces\…\Data\msmdsrv.port.txt (versión instalador y Store).
/// </summary>
public static class PowerBiInstances
{
    public static IReadOnlyList<PowerBiInstance> Discover()
    {
        var found = new List<PowerBiInstance>();
        foreach (var root in WorkspaceRoots().Where(Directory.Exists))
        {
            foreach (var workspace in SafeEnumerate(root))
            {
                var portFile = Path.Combine(workspace, "Data", "msmdsrv.port.txt");
                if (!File.Exists(portFile)) continue;
                var port = ReadPort(portFile);
                if (port is null) continue;
                found.Add(new PowerBiInstance(
                    $"localhost:{port}", port.Value, workspace,
                    File.GetLastWriteTimeUtc(portFile), IsListening(port.Value)));
            }
        }
        return found
            .OrderByDescending(i => i.Reachable)
            .ThenByDescending(i => i.LastWriteUtc)
            .ToList();
    }

    /// <summary>Título de la ventana de Desktop, si solo hay una abierta (para mostrar qué .pbix es).</summary>
    public static string? SingleDesktopTitle()
    {
        try
        {
            var titles = Process.GetProcessesByName("PBIDesktop")
                .Select(p => p.MainWindowTitle)
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Distinct()
                .ToList();
            return titles.Count == 1 ? titles[0] : null;
        }
        catch
        {
            return null;
        }
    }

    private static IEnumerable<string> WorkspaceRoots()
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        yield return Path.Combine(local, "Microsoft", "Power BI Desktop", "AnalysisServicesWorkspaces");
        yield return Path.Combine(profile, "Microsoft", "Power BI Desktop Store App", "AnalysisServicesWorkspaces");
        var packages = Path.Combine(local, "Packages");
        if (Directory.Exists(packages))
        {
            foreach (var pkg in SafeEnumerate(packages, "Microsoft.MicrosoftPowerBIDesktop_*"))
                yield return Path.Combine(pkg, "LocalState", "AnalysisServicesWorkspaces");
        }
    }

    // El fichero suele venir en UTF-16: nos quedamos con los dígitos.
    internal static int? ReadPort(string file)
    {
        try
        {
            var digits = new string(File.ReadAllBytes(file).Where(b => b is >= (byte)'0' and <= (byte)'9').Select(b => (char)b).ToArray());
            return int.TryParse(digits, out var port) && port is > 0 and < 65536 ? port : null;
        }
        catch
        {
            return null;
        }
    }

    private static bool IsListening(int port)
    {
        try
        {
            using var client = new TcpClient();
            return client.ConnectAsync(IPAddress.Loopback, port).Wait(TimeSpan.FromMilliseconds(300)) && client.Connected;
        }
        catch
        {
            return false;
        }
    }

    private static IEnumerable<string> SafeEnumerate(string path, string pattern = "*")
    {
        try
        {
            return Directory.EnumerateDirectories(path, pattern).ToList();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }
}
