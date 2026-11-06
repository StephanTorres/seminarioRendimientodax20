using YamlDotNet.Serialization;
using YamlDotNet.Serialization.NamingConventions;

namespace PuenteDax.Core;

/// <summary>Qué hacer cuando se incumple una regla.</summary>
public enum Gravedad
{
    Ignorar,
    Aviso,
    Fallo,
}

/// <summary>
/// Reglas del check «Rendimiento DAX» (ci/rendimiento/reglas.yml). Los nombres YAML van en snake_case:
/// FactorMax ↔ factor_max.
/// </summary>
public sealed class ReglasRendimiento
{
    public EjecucionesConfig Ejecuciones { get; set; } = new();
    public RegresionConfig Regresion { get; set; } = new();
    public DeterministasConfig Deterministas { get; set; } = new();
    public Gravedad ResultadosDistintos { get; set; } = Gravedad.Aviso;
    public VisualesConfig Visuales { get; set; } = new();
    public MedidasConfig Medidas { get; set; } = new();

    public static ReglasRendimiento Leer(string yaml) =>
        new DeserializerBuilder()
            .WithNamingConvention(UnderscoredNamingConvention.Instance)
            .Build()
            .Deserialize<ReglasRendimiento?>(yaml) ?? new ReglasRendimiento();

    public static ReglasRendimiento LeerFichero(string path) => Leer(File.ReadAllText(path));
}

public sealed class EjecucionesConfig
{
    /// <summary>Ejecuciones con la caché limpia por consulta y modelo.</summary>
    public int Frio { get; set; } = 3;

    /// <summary>Ejecuciones con la caché caliente por consulta y modelo.</summary>
    public int Caliente { get; set; } = 2;
}

public sealed class RegresionConfig
{
    /// <summary>Es regresión si el PR tarda más de factor_max × producción…</summary>
    public double FactorMax { get; set; } = 1.5;

    /// <summary>…y además al menos margen_ms más (para no fallar por 20 ms frente a 10 ms).</summary>
    public double MargenMs { get; set; } = 150;

    /// <summary>frio · caliente: qué mediana se compara.</summary>
    public string Metrica { get; set; } = "frio";

    public Gravedad Gravedad { get; set; } = Gravedad.Fallo;
}

/// <summary>Métricas que no dependen del ruido de la capacidad: el plan de consulta es el que es.</summary>
public sealed class DeterministasConfig
{
    /// <summary>Consultas al SE que el PR puede añadir respecto a producción (null = no se comprueba).</summary>
    public int? ConsultasSeAumentoMax { get; set; } = 0;

    public Gravedad ConsultasSe { get; set; } = Gravedad.Fallo;

    /// <summary>CallbackDataID que no estaban en producción.</summary>
    public Gravedad CallbacksNuevos { get; set; } = Gravedad.Fallo;
}

public sealed class VisualesConfig
{
    /// <summary>Carpeta con las consultas .dax de los visuales, relativa a reglas.yml.</summary>
    public string Carpeta { get; set; } = "consultas";

    /// <summary>Tiempo máximo en frío de la consulta de cualquier visual.</summary>
    public double? MaxMsFrio { get; set; } = 2000;

    /// <summary>Máximos particulares por id de consulta o por título de visual.</summary>
    public Dictionary<string, double> Excepciones
    {
        get => _excepciones;
        // YamlDotNet crea su propio diccionario: se copia para no distinguir mayúsculas.
        set => _excepciones = new Dictionary<string, double>(value, StringComparer.OrdinalIgnoreCase);
    }

    private Dictionary<string, double> _excepciones = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class MedidasConfig
{
    /// <summary>afectadas (cambiadas y las que dependen de ellas) · todas · ninguna.</summary>
    public string Modo { get; set; } = "afectadas";

    /// <summary>Consulta por medida; {medida} se sustituye por el nombre (sin corchetes).</summary>
    public string Plantilla { get; set; } = "EVALUATE SUMMARIZECOLUMNS('Fecha'[Year], 'Fecha'[Month], \"Valor\", [{medida}])";

    public List<string> Excluir { get; set; } = new();

    /// <summary>Tiempo máximo en frío de cualquier medida (también las nuevas, que no tienen con qué compararse).</summary>
    public double? MaxMsFrio { get; set; }

    public string Consulta(string medida) => Plantilla.Replace("{medida}", medida.Replace("]", "]]"));
}
