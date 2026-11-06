using System.Globalization;
using System.Text;

namespace PuenteDax.Core;

/// <summary>visual (consulta de un visual del informe) · medida (consulta generada para una medida).</summary>
public static class TipoConsulta
{
    public const string Visual = "visual";
    public const string Medida = "medida";
}

/// <summary>Medianas de un modelo para una consulta. Las cuentas (SE, callbacks) salen de la primera ejecución en frío.</summary>
public sealed record Medicion(
    double FrioMs,
    double CalienteMs,
    double SeCpuMs,
    int ConsultasSe,
    int Callbacks,
    string? HashResultado);

/// <summary>Una consulta medida en producción (base) y en el PR (candidato).</summary>
public sealed record ConsultaMedida(
    string Id,
    string Nombre,
    string Tipo,
    Medicion? Base,
    Medicion? Candidato,
    string? ErrorBase = null,
    string? ErrorCandidato = null);

public sealed record Hallazgo(string ConsultaId, string Regla, Gravedad Gravedad, string Detalle);

public sealed record Veredicto(
    bool Aprobado,
    IReadOnlyList<Hallazgo> Hallazgos,
    IReadOnlyList<ConsultaMedida> Consultas)
{
    public int Fallos => Hallazgos.Count(h => h.Gravedad == Gravedad.Fallo);
    public int Avisos => Hallazgos.Count(h => h.Gravedad == Gravedad.Aviso);
}

/// <summary>Aplica reglas.yml a las mediciones: producción es la línea base, el PR el candidato.</summary>
public static class EvaluadorRendimiento
{
    public const string ReglaError = "error";
    public const string ReglaRegresion = "regresión";
    public const string ReglaConsultasSe = "consultas al SE";
    public const string ReglaCallbacks = "callbacks nuevos";
    public const string ReglaMaximo = "tiempo máximo";
    public const string ReglaResultado = "resultado distinto";

    public static Veredicto Evaluar(ReglasRendimiento reglas, IReadOnlyList<ConsultaMedida> consultas)
    {
        var hallazgos = new List<Hallazgo>();
        foreach (var c in consultas) hallazgos.AddRange(EvaluarConsulta(reglas, c));
        hallazgos = hallazgos.Where(h => h.Gravedad != Gravedad.Ignorar).ToList();
        return new Veredicto(hallazgos.All(h => h.Gravedad != Gravedad.Fallo), hallazgos, consultas);
    }

    public static IEnumerable<Hallazgo> EvaluarConsulta(ReglasRendimiento reglas, ConsultaMedida c)
    {
        if (c.ErrorCandidato is not null)
        {
            // Si también falla en producción no es culpa del PR, pero conviene verlo.
            yield return new Hallazgo(c.Id, ReglaError, c.ErrorBase is null ? Gravedad.Fallo : Gravedad.Aviso,
                $"La consulta da error en el PR: {Recortar(c.ErrorCandidato)}");
            yield break;
        }
        if (c.Candidato is not { } pr) yield break;

        // Tiempo máximo absoluto: vale también para lo nuevo, que no tiene con qué compararse.
        var maximo = Maximo(reglas, c);
        if (maximo is { } max && pr.FrioMs > max)
            yield return new Hallazgo(c.Id, ReglaMaximo, Gravedad.Fallo,
                $"{Ms(pr.FrioMs)} en frío; el máximo es {Ms(max)}");

        if (c.Base is not { } prod) yield break;

        var r = reglas.Regresion;
        var (antes, despues) = r.Metrica.Equals("caliente", StringComparison.OrdinalIgnoreCase)
            ? (prod.CalienteMs, pr.CalienteMs)
            : (prod.FrioMs, pr.FrioMs);
        if (despues > antes * r.FactorMax && despues - antes > r.MargenMs)
            yield return new Hallazgo(c.Id, ReglaRegresion, r.Gravedad,
                $"{Ms(antes)} → {Ms(despues)} ({Factor(antes, despues)}; límite ×{r.FactorMax.ToString("0.##", Es)} y +{Ms(r.MargenMs)})");

        var d = reglas.Deterministas;
        if (d.ConsultasSeAumentoMax is { } aumento && pr.ConsultasSe - prod.ConsultasSe > aumento)
            yield return new Hallazgo(c.Id, ReglaConsultasSe, d.ConsultasSe,
                $"{prod.ConsultasSe} → {pr.ConsultasSe} consultas al SE");

        if (pr.Callbacks > prod.Callbacks)
            yield return new Hallazgo(c.Id, ReglaCallbacks, d.CallbacksNuevos,
                $"{prod.Callbacks} → {pr.Callbacks} consultas al SE con CallbackDataID");

        if (prod.HashResultado is not null && pr.HashResultado is not null && prod.HashResultado != pr.HashResultado)
            yield return new Hallazgo(c.Id, ReglaResultado, reglas.ResultadosDistintos,
                "El resultado no coincide con producción: ¿más rápido pero distinto?");
    }

    private static double? Maximo(ReglasRendimiento reglas, ConsultaMedida c)
    {
        if (c.Tipo == TipoConsulta.Visual)
        {
            var excepciones = reglas.Visuales.Excepciones;
            if (excepciones.TryGetValue(c.Id, out var porId)) return porId;
            if (excepciones.TryGetValue(c.Nombre, out var porNombre)) return porNombre;
            return reglas.Visuales.MaxMsFrio;
        }
        return reglas.Medidas.MaxMsFrio;
    }

    /// <summary>Resumen para el PR: primero lo que falla y después todas las mediciones plegadas.</summary>
    public static string Markdown(Veredicto v, string baseNombre, string candidatoNombre)
    {
        var sb = new StringBuilder();
        sb.AppendLine(v.Aprobado
            ? "## ✅ Rendimiento DAX: sin regresiones"
            : $"## ❌ Rendimiento DAX: {v.Fallos} {(v.Fallos == 1 ? "regla incumplida" : "reglas incumplidas")}");
        sb.AppendLine();
        sb.AppendLine($"Producción **{baseNombre}** frente al PR **{candidatoNombre}** · {v.Consultas.Count} consultas · {v.Avisos} avisos");
        sb.AppendLine();

        if (v.Hallazgos.Count > 0)
        {
            var nombres = v.Consultas.ToDictionary(c => c.Id, c => c);
            sb.AppendLine("| | Consulta | Regla | Detalle |");
            sb.AppendLine("|---|---|---|---|");
            foreach (var h in v.Hallazgos.OrderByDescending(h => h.Gravedad))
            {
                var c = nombres.GetValueOrDefault(h.ConsultaId);
                var icono = h.Gravedad == Gravedad.Fallo ? "❌" : "⚠️";
                sb.AppendLine($"| {icono} | {Celda(c is null ? h.ConsultaId : $"{c.Tipo}: {c.Nombre}")} | {h.Regla} | {Celda(h.Detalle)} |");
            }
            sb.AppendLine();
        }

        sb.AppendLine("<details><summary>Todas las mediciones (medianas)</summary>");
        sb.AppendLine();
        sb.AppendLine("| Consulta | Frío PROD | Frío PR | Caliente PROD | Caliente PR | SE PROD → PR | Callbacks PROD → PR |");
        sb.AppendLine("|---|---:|---:|---:|---:|---:|---:|");
        foreach (var c in v.Consultas.OrderByDescending(c => (c.Candidato?.FrioMs ?? 0) - (c.Base?.FrioMs ?? 0)))
        {
            sb.AppendLine($"| {Celda($"{c.Tipo}: {c.Nombre}")} | {Ms(c.Base?.FrioMs)} | {Ms(c.Candidato?.FrioMs)} | " +
                          $"{Ms(c.Base?.CalienteMs)} | {Ms(c.Candidato?.CalienteMs)} | " +
                          $"{c.Base?.ConsultasSe.ToString() ?? "–"} → {c.Candidato?.ConsultasSe.ToString() ?? "–"} | " +
                          $"{c.Base?.Callbacks.ToString() ?? "–"} → {c.Candidato?.Callbacks.ToString() ?? "–"} |");
        }
        sb.AppendLine();
        sb.AppendLine("</details>");
        sb.AppendLine();
        sb.AppendLine("<sub>Medido con Puente DAX: traza del servidor (Server Timings) por XMLA, producción y PR intercalados. La traza decide.</sub>");
        return sb.ToString();
    }

    private static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-ES");

    private static string Ms(double? ms) => ms is { } v ? $"{v.ToString("#,0", Es)} ms" : "–";

    private static string Factor(double antes, double despues) =>
        antes <= 0 ? "nuevo coste" : $"×{(despues / antes).ToString("0.0", Es)}";

    private static string Celda(string texto) => texto.Replace("|", "\\|").ReplaceLineEndings(" ");

    private static string Recortar(string texto) => texto.Length <= 300 ? texto : texto[..300] + "…";
}
