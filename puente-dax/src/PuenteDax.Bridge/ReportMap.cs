using System.Text.Json;

namespace PuenteDax.Bridge;

public sealed record MapVisual(string Id, string Type, string Title, IReadOnlyList<string> Measures, IReadOnlyList<string> Columns);

public sealed record MapPage(string Id, string Name, IReadOnlyList<MapVisual> Visuals);

public sealed record ReportMapResponse(string Report, IReadOnlyList<MapPage> Pages);

/// <summary>
/// Lee la carpeta .Report de un PBIR y devuelve páginas y visuales con las medidas y columnas que usan.
/// El id del visual es el mismo que el Analizador de rendimiento exporta como visualId.
/// </summary>
public static class ReportMap
{
    public static ReportMapResponse Read(string reportDir)
    {
        var pagesDir = Path.Combine(reportDir, "definition", "pages");
        if (!Directory.Exists(pagesDir)) throw new ArgumentException($"No es una carpeta .Report de PBIR: {reportDir}");

        var order = new List<string>();
        var pagesJson = Path.Combine(pagesDir, "pages.json");
        if (File.Exists(pagesJson))
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(pagesJson));
            if (doc.RootElement.TryGetProperty("pageOrder", out var o))
                order.AddRange(o.EnumerateArray().Select(x => x.GetString() ?? ""));
        }

        var pages = new List<MapPage>();
        foreach (var dir in Directory.GetDirectories(pagesDir))
        {
            var pageFile = Path.Combine(dir, "page.json");
            if (!File.Exists(pageFile)) continue;
            using var page = JsonDocument.Parse(File.ReadAllText(pageFile));
            var id = Path.GetFileName(dir);
            var name = page.RootElement.TryGetProperty("displayName", out var dn) ? dn.GetString() ?? id : id;
            var visuals = new List<MapVisual>();
            var visualsDir = Path.Combine(dir, "visuals");
            if (Directory.Exists(visualsDir))
                foreach (var vdir in Directory.GetDirectories(visualsDir))
                {
                    var file = Path.Combine(vdir, "visual.json");
                    if (File.Exists(file)) visuals.Add(ReadVisual(Path.GetFileName(vdir), file));
                }
            pages.Add(new MapPage(id, name, visuals));
        }

        pages = pages.OrderBy(p => order.IndexOf(p.Id) is var i && i < 0 ? int.MaxValue : i).ToList();
        return new ReportMapResponse(Path.GetFileName(reportDir.TrimEnd('\\', '/')), pages);
    }

    private static MapVisual ReadVisual(string id, string file)
    {
        using var doc = JsonDocument.Parse(File.ReadAllText(file));
        var root = doc.RootElement;
        var visual = root.GetProperty("visual");
        var type = visual.TryGetProperty("visualType", out var t) ? t.GetString() ?? "" : "";
        var measures = new List<string>();
        var columns = new List<string>();
        if (visual.TryGetProperty("query", out var q) && q.TryGetProperty("queryState", out var state))
            foreach (var role in state.EnumerateObject())
                if (role.Value.TryGetProperty("projections", out var projections))
                    foreach (var p in projections.EnumerateArray())
                        if (p.TryGetProperty("field", out var f)) Collect(f, measures, columns);
        return new MapVisual(id, type, TitleOf(visual) ?? type, measures.Distinct().ToList(), columns.Distinct().ToList());
    }

    private static void Collect(JsonElement field, List<string> measures, List<string> columns)
    {
        if (field.TryGetProperty("Measure", out var m) && m.TryGetProperty("Property", out var mp))
            measures.Add(mp.GetString() ?? "");
        else if (field.TryGetProperty("Column", out var c) && c.TryGetProperty("Property", out var cp))
            columns.Add(cp.GetString() ?? "");
        else if (field.TryGetProperty("Aggregation", out var a) && a.TryGetProperty("Expression", out var ae))
            Collect(ae, measures, columns);
        else if (field.TryGetProperty("HierarchyLevel", out var h) && h.TryGetProperty("Level", out var lv))
            columns.Add(lv.GetString() ?? "");
    }

    private static string? TitleOf(JsonElement visual)
    {
        try
        {
            if (!visual.TryGetProperty("visualContainerObjects", out var vco) || !vco.TryGetProperty("title", out var title)) return null;
            var value = title[0].GetProperty("properties").GetProperty("text").GetProperty("expr").GetProperty("Literal").GetProperty("Value").GetString();
            return value?.Trim('\'');
        }
        catch
        {
            return null;
        }
    }
}
