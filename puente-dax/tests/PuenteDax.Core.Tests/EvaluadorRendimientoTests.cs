using PuenteDax.Core;

namespace PuenteDax.Core.Tests;

public class EvaluadorRendimientoTests
{
    private static readonly ReglasRendimiento Reglas = ReglasRendimiento.Leer("""
        regresion:
          factor_max: 1.5
          margen_ms: 150
        deterministas:
          consultas_se_aumento_max: 0
          consultas_se: fallo
          callbacks_nuevos: fallo
        resultados_distintos: aviso
        visuales:
          max_ms_frio: 2000
          excepciones:
            "Tabla lenta": 5000
        medidas:
          modo: todas
          max_ms_frio: 3000
        """);

    private static Medicion M(double frio, int se = 3, int callbacks = 0, string hash = "h", double caliente = 10) =>
        new(frio, caliente, frio, se, callbacks, hash);

    private static ConsultaMedida Visual(Medicion? prod, Medicion? pr, string nombre = "Ventas por país") =>
        new("v1", nombre, TipoConsulta.Visual, prod, pr);

    private static IReadOnlyList<Hallazgo> Evaluar(ConsultaMedida c) =>
        EvaluadorRendimiento.Evaluar(Reglas, new[] { c }).Hallazgos;

    [Fact]
    public void Lee_el_yaml_en_snake_case_y_las_gravedades_en_minusculas()
    {
        Assert.Equal(1.5, Reglas.Regresion.FactorMax);
        Assert.Equal(Gravedad.Fallo, Reglas.Deterministas.CallbacksNuevos);
        Assert.Equal(Gravedad.Aviso, Reglas.ResultadosDistintos);
        Assert.Equal(5000, Reglas.Visuales.Excepciones["tabla lenta"]);
        Assert.Equal(3, Reglas.Ejecuciones.Frio); // valor por defecto
    }

    [Fact]
    public void Igual_que_produccion_aprueba()
    {
        var v = EvaluadorRendimiento.Evaluar(Reglas, new[] { Visual(M(400), M(420)) });
        Assert.True(v.Aprobado);
        Assert.Empty(v.Hallazgos);
    }

    [Fact]
    public void Regresion_necesita_superar_el_factor_y_el_margen()
    {
        // ×3 pero solo +40 ms: ruido, no regresión
        Assert.Empty(Evaluar(Visual(M(20), M(60))));
        // +200 ms pero solo ×1,2: tampoco
        Assert.Empty(Evaluar(Visual(M(1000), M(1200))));
        // ×2 y +400 ms: regresión
        var h = Assert.Single(Evaluar(Visual(M(400), M(800))));
        Assert.Equal(EvaluadorRendimiento.ReglaRegresion, h.Regla);
        Assert.Equal(Gravedad.Fallo, h.Gravedad);
    }

    [Fact]
    public void Callbacks_y_consultas_SE_nuevas_fallan_aunque_el_tiempo_no_cambie()
    {
        var hallazgos = Evaluar(Visual(M(400, se: 2, callbacks: 0), M(400, se: 5, callbacks: 1)));
        Assert.Contains(hallazgos, h => h.Regla == EvaluadorRendimiento.ReglaConsultasSe && h.Gravedad == Gravedad.Fallo);
        Assert.Contains(hallazgos, h => h.Regla == EvaluadorRendimiento.ReglaCallbacks && h.Gravedad == Gravedad.Fallo);
    }

    [Fact]
    public void Menos_consultas_SE_es_una_mejora_no_un_fallo()
    {
        Assert.Empty(Evaluar(Visual(M(800, se: 6), M(300, se: 2))));
    }

    [Fact]
    public void Tiempo_maximo_de_visual_con_excepcion_por_titulo()
    {
        var h = Assert.Single(Evaluar(Visual(M(2500), M(2600))));
        Assert.Equal(EvaluadorRendimiento.ReglaMaximo, h.Regla);
        Assert.Empty(Evaluar(Visual(M(2500), M(2600), nombre: "Tabla lenta")));
    }

    [Fact]
    public void Medida_nueva_solo_se_mide_contra_el_maximo()
    {
        var nueva = new ConsultaMedida("m1", "Ventas nuevas", TipoConsulta.Medida, null, M(3500));
        var h = Assert.Single(Evaluar(nueva));
        Assert.Equal(EvaluadorRendimiento.ReglaMaximo, h.Regla);
    }

    [Fact]
    public void Error_en_el_PR_falla_y_si_ya_fallaba_en_produccion_es_aviso()
    {
        var rota = Visual(M(100), null) with { ErrorCandidato = "La columna 'X' no existe" };
        Assert.Equal(Gravedad.Fallo, Assert.Single(Evaluar(rota)).Gravedad);

        var yaRota = rota with { Base = null, ErrorBase = "La columna 'X' no existe" };
        Assert.Equal(Gravedad.Aviso, Assert.Single(Evaluar(yaRota)).Gravedad);
    }

    [Fact]
    public void Resultado_distinto_es_aviso_y_no_bloquea()
    {
        var v = EvaluadorRendimiento.Evaluar(Reglas, new[] { Visual(M(400, hash: "a"), M(300, hash: "b")) });
        Assert.True(v.Aprobado);
        Assert.Equal(EvaluadorRendimiento.ReglaResultado, Assert.Single(v.Hallazgos).Regla);
    }

    [Fact]
    public void Markdown_cuenta_los_fallos_y_lista_la_regla()
    {
        var v = EvaluadorRendimiento.Evaluar(Reglas, new[] { Visual(M(400), M(900, callbacks: 2)) });
        var md = EvaluadorRendimiento.Markdown(v, "Rendimiento DAX [PROD]", "Rendimiento DAX [PR]");
        Assert.False(v.Aprobado);
        Assert.Contains("❌ Rendimiento DAX: 2 reglas incumplidas", md);
        Assert.Contains("callbacks nuevos", md);
        Assert.Contains("visual: Ventas por país", md);
    }

    [Fact]
    public void Plantilla_de_medida_escapa_el_corchete()
    {
        Assert.Equal("EVALUATE ROW(\"v\", [Ventas [x]]])",
            new MedidasConfig { Plantilla = "EVALUATE ROW(\"v\", [{medida}])" }.Consulta("Ventas [x]"));
    }
}
