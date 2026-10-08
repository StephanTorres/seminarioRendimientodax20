using PuenteDax.Core;

namespace PuenteDax.Core.Tests;

public class ServerTimingsCalculatorTests
{
    private static readonly DateTime Origin = new(2026, 3, 14, 10, 0, 0, DateTimeKind.Utc);

    private static DateTime T(int ms) => Origin.AddMilliseconds(ms);

    private static TraceRecord QueryEnd(int start, int end) => new()
    {
        Kind = TraceKind.QueryEnd,
        StartTime = T(start),
        EndTime = T(end),
        DurationMs = end - start,
        CpuMs = end - start,
    };

    private static TraceRecord Scan(int start, int end, int cpu, string text = "SELECT SUM ( 'Ventas'[Importe] ) FROM 'Ventas';",
        string subclass = TraceSubclass.VertiPaqScan) => new()
    {
        Kind = TraceKind.StorageEngineEnd,
        Subclass = subclass,
        StartTime = T(start),
        EndTime = T(end),
        DurationMs = end - start,
        CpuMs = cpu,
        TextData = text,
    };

    [Fact]
    public void Secuencial_el_FE_son_los_huecos_entre_consultas_SE()
    {
        var t = ServerTimingsCalculator.Calculate(new[]
        {
            Scan(10, 30, 20),
            Scan(50, 60, 10),
            QueryEnd(0, 100),
        });

        Assert.Equal(100, t.TotalMs);
        Assert.Equal(70, t.FormulaEngineMs);
        Assert.Equal(30, t.StorageEngineMs);
        Assert.Equal(30, t.StorageEngineCpuMs);
        Assert.Equal(2, t.StorageEngineQueries);
        Assert.Equal(1.0, t.Parallelism);
    }

    [Fact]
    public void Paralelo_el_SE_no_cuenta_dos_veces_el_solape()
    {
        var t = ServerTimingsCalculator.Calculate(new[]
        {
            Scan(10, 50, 40),
            Scan(20, 60, 40),
            QueryEnd(0, 100),
        });

        Assert.Equal(50, t.FormulaEngineMs);   // 0-10 y 60-100
        Assert.Equal(50, t.StorageEngineMs);   // 10-60 de reloj
        Assert.Equal(80, t.StorageEngineCpuMs);
        Assert.Equal(1.6, t.Parallelism);
    }

    [Fact]
    public void Los_aciertos_de_cache_no_son_consultas_SE()
    {
        var t = ServerTimingsCalculator.Calculate(new[]
        {
            new TraceRecord { Kind = TraceKind.StorageEngineCacheMatch, Subclass = TraceSubclass.VertiPaqCacheExactMatch, StartTime = T(5), EndTime = T(5) },
            Scan(8, 12, 4),
            QueryEnd(0, 20),
        });

        Assert.Equal(1, t.CacheHits);
        Assert.Equal(1, t.StorageEngineQueries);
        Assert.Equal(2, t.Queries.Count);
        Assert.Equal("cache", t.Queries[0].Type);
    }

    [Fact]
    public void Detecta_callbacks_y_lee_filas_y_KB_del_xmSql()
    {
        const string xmSql = "SELECT SUM ( [CallbackDataID ( IF ( 'Internet Sales'[SalesAmount] > 10, 1, 0 ) )] ) FROM 'Internet Sales';\n\n" +
                             "'Estimated size ( volume, marshalling bytes ): 1234, 56789'";
        var t = ServerTimingsCalculator.Calculate(new[] { Scan(2, 40, 120, xmSql), QueryEnd(0, 45) });

        var q = Assert.Single(t.Queries);
        Assert.True(q.Callback);
        Assert.Equal(1234, q.Rows);
        Assert.Equal(1 + 56789 / 1024, q.KBytes);
        Assert.Equal(1, t.Callbacks);
        Assert.Equal(1234, t.Rows);
    }

    [Theory]
    [InlineData("'Estimated size ( volume, marshalling bytes ) : 1234, 56789'", 1234L, 56L)]
    [InlineData("[Estimated size (volume, marshalling bytes): 37, 592]", 37L, 1L)]
    public void Lee_los_dos_formatos_de_Estimated_size(string text, long rows, long kbytes)
    {
        var (r, kb) = ServerTimingsCalculator.EstimatedSizeOf("SELECT ...;\r\n\r\n" + text);
        Assert.Equal(rows, r);
        Assert.Equal(kbytes, kb);
    }

    [Fact]
    public void Simplifica_los_identificadores_internos_del_xmSql()
    {
        const string raw = "SELECT [Period Definition (139)].[Period (1438)] AS [Period Definition (139)$Period (1438)] FROM [Period Definition (139)];";
        Assert.Equal(
            "SELECT [Period Definition].[Period] AS [Period Definition$Period] FROM [Period Definition];",
            ServerTimingsCalculator.SimplifyXmSql(raw));
    }

    [Theory]
    [InlineData("SELECT 'Clientes'[Condiciones de pago] FROM 'Clientes';", false)]
    [InlineData("SELECT [Cond ( 'Ventas'[Importe] > 0 )] FROM 'Ventas';", true)]
    [InlineData("SELECT [RoundValueCallback ( 'Ventas'[Importe] )] FROM 'Ventas';", true)]
    [InlineData("SELECT SUM ( 'Ventas'[Importe] ) FROM 'Ventas';", false)]
    public void Callback_con_limites_de_palabra(string xmSql, bool expected) =>
        Assert.Equal(expected, ServerTimingsCalculator.ContainsCallback(xmSql));

    [Fact]
    public void El_batch_resta_sus_consultas_internas()
    {
        var t = ServerTimingsCalculator.Calculate(new[]
        {
            new TraceRecord { Kind = TraceKind.StorageEngineBegin, Subclass = TraceSubclass.BatchVertiPaqScan, StartTime = T(5) },
            Scan(10, 20, 10),
            Scan(5, 30, 30, subclass: TraceSubclass.BatchVertiPaqScan),
            QueryEnd(0, 50),
        });

        Assert.Equal(2, t.StorageEngineQueries);
        Assert.Equal(30, t.StorageEngineCpuMs);     // 10 interna + (30 - 10) del batch
        Assert.Equal(25, t.FormulaEngineMs);        // 0-5 y 30-50
        Assert.Equal(25, t.StorageEngineMs);
        var batch = t.Queries.Single(q => q.Type == "batch");
        Assert.Equal(15, batch.DurationMs);         // 25 - 10 de la interna
        Assert.True(t.Queries.Single(q => q.Type == "scan").InBatch);
    }

    [Fact]
    public void Las_internas_cuentan_en_el_barrido_pero_no_como_consulta()
    {
        var t = ServerTimingsCalculator.Calculate(new[]
        {
            Scan(10, 40, 30, subclass: TraceSubclass.VertiPaqScanInternal),
            Scan(10, 40, 30),
            QueryEnd(0, 60),
        });

        Assert.Equal(1, t.StorageEngineQueries);
        Assert.Equal(30, t.FormulaEngineMs);
        Assert.Contains(t.Queries, q => q.Type == "internal");
    }

    [Fact]
    public void Corrige_EndTime_cuando_viene_igual_al_inicio()
    {
        var odd = Scan(10, 10, 5) with { DurationMs = 20 };
        var t = ServerTimingsCalculator.Calculate(new[] { odd, QueryEnd(0, 50) });

        Assert.Equal(30, t.FormulaEngineMs);
        Assert.Equal(20, t.StorageEngineMs);
    }

    [Fact]
    public void Offsets_relativos_al_inicio_de_la_consulta()
    {
        var t = ServerTimingsCalculator.Calculate(new[] { Scan(12, 20, 8), QueryEnd(0, 30) });
        Assert.Equal(12, t.Queries[0].StartOffsetMs);
        Assert.Equal(1, t.Queries[0].Line);
    }

    [Fact]
    public void Recoge_planes_y_ExecutionMetrics()
    {
        var t = ServerTimingsCalculator.Calculate(new[]
        {
            new TraceRecord { Kind = TraceKind.QueryPlan, Subclass = TraceSubclass.LogicalPlan, TextData = "AddColumns: RelLogOp" },
            new TraceRecord { Kind = TraceKind.QueryPlan, Subclass = TraceSubclass.PhysicalPlan, TextData = "AddColumns: IterPhyOp" },
            QueryEnd(0, 10),
            new TraceRecord { Kind = TraceKind.ExecutionMetrics, TextData = "{\"durationMs\":10}" },
        });

        Assert.Equal("AddColumns: RelLogOp", t.LogicalPlan);
        Assert.Equal("AddColumns: IterPhyOp", t.PhysicalPlan);
        Assert.Equal("{\"durationMs\":10}", t.ExecutionMetrics);
        Assert.Equal(10, t.FormulaEngineMs);
        Assert.Equal(0, t.StorageEngineMs);
        Assert.Null(t.Parallelism);
    }

    [Fact]
    public void Sin_QueryEnd_no_hay_medicion()
    {
        Assert.Throws<InvalidOperationException>(() => ServerTimingsCalculator.Calculate(new[] { Scan(0, 5, 5) }));
    }

    [Fact]
    public void Consultas_SE_que_empiezan_antes_de_la_consulta_no_dan_FE_negativo()
    {
        var t = ServerTimingsCalculator.Calculate(new[] { Scan(-3, 4, 7), QueryEnd(0, 10) });
        Assert.True(t.FormulaEngineMs >= 0);
        Assert.Equal(10, t.FormulaEngineMs + t.StorageEngineMs);
    }
}

public class BenchmarkTests
{
    [Fact]
    public void Mediana_por_tipo_de_cache()
    {
        var runs = new[]
        {
            new BenchmarkRun(Benchmark.Cold, 1, 10, 4, 6, 3, 0),
            new BenchmarkRun(Benchmark.Cold, 2, 30, 10, 20, 3, 0),
            new BenchmarkRun(Benchmark.Cold, 3, 20, 8, 12, 3, 0),
            new BenchmarkRun(Benchmark.Warm, 1, 5, 4, 1, 0, 3),
            new BenchmarkRun(Benchmark.Warm, 2, 7, 6, 1, 0, 3),
        };

        var s = Benchmark.Summarize(runs);

        Assert.Equal(20, s.Cold!.MedianTotalMs);
        Assert.Equal(10, s.Cold.MinTotalMs);
        Assert.Equal(30, s.Cold.MaxTotalMs);
        Assert.Equal(6, s.Warm!.MedianTotalMs);
        Assert.Equal(2, s.Warm.Runs);
    }

    [Fact]
    public void Sin_ejecuciones_calientes_no_hay_estadistica_caliente()
    {
        var s = Benchmark.Summarize(new[] { new BenchmarkRun(Benchmark.Cold, 1, 10, 4, 6, 3, 0) });
        Assert.Null(s.Warm);
    }
}
