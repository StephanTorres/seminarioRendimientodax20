# Puente DAX

Mide consultas DAX contra **Power BI Desktop** desde una página web (las diapositivas del
workshop) y enseña lo mismo que la pestaña *Server Timings* de DAX Studio: Total, FE, SE,
CPU del SE y paralelismo, consultas SE, aciertos de caché, **callbacks**, filas/KB del xmSQL
y, si se pide, los planes lógico y físico.

```
Diapositiva (<dax-lab>) ──HTTP──▶ PuenteDax.exe ──ADOMD.NET──▶ Analysis Services de Power BI Desktop
                                       └──── traza AMO (SE, FE, planes) ◀──┘
```

La investigación que hay detrás (eventos, cálculo FE/SE, alternativas, riesgos) está en
[INVESTIGACION.md](INVESTIGACION.md).

## Instalación (Windows)

1. Descarga el artefacto **PuenteDax-win-x64** del último run del workflow *Puente DAX*
   (pestaña *Actions* del repositorio) y descomprímelo. Contiene `PuenteDax.exe` (autocontenido:
   no necesita instalar .NET), `instalar.ps1`, `desinstalar.ps1` y el icono.
2. Ejecuta, en esa carpeta:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Token workshop -Www "C:\ruta\a\las\slides"
   ```

   - Copia el ejecutable a `%LOCALAPPDATA%\PuenteDax`.
   - Registra `PuenteDax.pbitool.json` en
     `C:\Program Files (x86)\Common Files\Microsoft Shared\Power BI Desktop\External Tools`
     (pide permisos de administrador solo para este paso).
   - `-Www` es opcional: la carpeta que servirá el puente (las diapositivas).
3. Reinicia Power BI Desktop: aparece **Puente DAX** en la cinta *Herramientas externas*.
   Al pulsarlo, Desktop arranca el puente conectado al modelo abierto y abre el navegador.

Si pulsas el botón desde otro `.pbix` con el puente ya abierto, el nuevo arranque le pasa el
modelo al que ya corre y se cierra.

Para compilarlo tú: `dotnet publish src/PuenteDax.Bridge -c Release -r win-x64 -o publish/PuenteDax`.

## Las demos del workshop, dentro de la presentación

`rendimiento-dax-2.0-datasaturday-madrid-2026.html` (raíz del repositorio) lleva las demos integradas:
detrás de cada portada **DEMO** vienen sus diapositivas de **Laboratorio** (15 en total) y, al final,
una diapositiva **Backstage** para preparar la charla. En las portadas, cada demo va marcada como
**▶ AQUÍ** (se hace en la presentación) o **⧉ DESKTOP** (hay que pasar a Power BI Desktop).

| Bloque | Laboratorios |
|---|---|
| 1 · VertiPaq | Diccionario y encoding (analizador VertiPaq) · Antes y después de los 5 pasos (foto y comparación) · Columna de alta cardinalidad |
| 2 · Medir | Frío, caliente y benchmark |
| 3 · Tiempo | Dimensión tiempo (DAX en vivo, PQ y T-SQL al lado) · Año anterior (6 variantes) · Acumulado anual (5 variantes) |
| 4 · Idioma y moneda | Multi-idioma · Multi-moneda |
| 5 · Motor | DAX Fusion vertical/horizontal · Callbacks · Materialización |
| 6 · Seguridad y UDF | RLS con ORs (consulta con el rol aplicado) · UDF `VAL` frente a `EXPR` |

**Cómo usarla:**

1. Abre el `.pbix` de la demo y pulsa **Puente DAX** en *Herramientas externas* (instalado con
   `-Www` apuntando a la carpeta del repositorio), o arranca
   `PuenteDax.exe --www <carpeta del repositorio> --open`. Abre
   `http://127.0.0.1:5199/rendimiento-dax-2.0-datasaturday-madrid-2026.html`.
2. Ve a **Backstage** (`End`):
   - **▶ Comprobar** verifica que existen en tu modelo las tablas, columnas, medidas y roles de
     `window.PUENTE_DAX_MODELO`, el bloque de configuración del final del HTML. Por defecto apunta
     a AdventureWorksDW; las claves en rojo se corrigen allí (es lo único que hay que tocar).
   - **▶ Probar demos** ejecuta una vez cada variante de todas las diapositivas y dice cuáles fallan.
3. Ensaya las demos: cada medición **en vivo** queda grabada en el navegador. Pulsa
   **⤓ grabaciones.js** y deja el fichero junto al HTML: es el plan B. Si el puente falla durante la
   charla, cada laboratorio enseña su medición grabada (marcada **GRABADO**), incluso abriendo el
   HTML como fichero.

Durante la charla: clic en la variante → **▶ Frío** / **▶ Caliente** / **⏱ Benchmark**. Tras pulsar un
botón, las flechas y el espacio siguen moviendo las diapositivas; mientras se escribe en el editor,
no (`Esc` devuelve el teclado a la presentación, `Ctrl+Enter` ejecuta en frío).

## Widgets para otras diapositivas

```html
<script src="http://127.0.0.1:5199/lab/dax-lab.js"></script>
<script>window.PUENTE_DAX_MODELO = { 'Ventas.Importe': "'Internet Sales'[SalesAmount]" };</script>

<dax-lab label="AA" cold="5" warm="5">
  <dax-variant label="AA · v1">
    EVALUATE SUMMARIZECOLUMNS ( 'Date'[CalendarYear], "Ventas", SUM ( {{Ventas.Importe}} ) )
  </dax-variant>
  <dax-variant label="AA · con rol" role="Zona norte">…</dax-variant>
</dax-lab>

<dax-benchmark filter="AA ·"></dax-benchmark>
<dax-vertipaq focus="Ventas.Importe" snapshot="antes"></dax-vertipaq>
<dax-model-check></dax-model-check>
```

| Elemento | Para qué |
|---|---|
| `<dax-lab>` | Consulta con Server Timings. Atributos: `label`, `cold`/`warm` (Benchmark, 3 y 3), `plan`, `rows` (20), `compact`, `fill`, `editor-height`, `panel-height`, `bridge`, `token`, `recorded` |
| `<dax-variant>` | Variantes dentro de un `<dax-lab>` (pestañas). `label`, `note`, `role` y `user` (la consulta se ejecuta con ese rol o `EffectiveUserName`, como «Ver como» de Desktop) |
| `<dax-benchmark>` | Plantilla *benchmark* rellenada sola. `filter="Prefijo ·"` (varios con `\|`), `export` añade el botón ⤓ grabaciones.js. *Copiar* la deja lista para Excel |
| `<dax-vertipaq>` | Tamaños, cardinalidades y encoding (VertiPaq Analyzer). `focus` (claves o columnas a destacar), `top`, `table`, `snapshot` (nombre de la foto), `exact` (cardinalidad leyendo los datos) |
| `<dax-model-check>` | Comprueba `PUENTE_DAX_MODELO` y prueba todas las demos de la página |

- **Plantillas:** `{{Clave}}` en el DAX (y en `role`/`user`) se sustituye por
  `window.PUENTE_DAX_MODELO[Clave]`. Si falta una clave, la pestaña sale con borde discontinuo y el
  widget lo avisa en lugar de ejecutar.
- **Plan B, por orden:** grabación incrustada en la variante
  (`<script type="application/json" data-recorded>…</script>`, lo que guarda el botón ⤓),
  `window.PUENTE_DAX_RECORDINGS` (el `grabaciones.js` exportado), las mediciones en vivo guardadas en
  el navegador y el atributo `recorded="url"`.

**Token:** las páginas servidas por el propio puente (`--www`, o `/lab/demo.html`) lo obtienen
solas. Abiertas como fichero o desde otro servidor, el widget lo pide una vez (sale en la consola
del puente) o se fija con `-Token` al instalar.

### API

| Ruta | Qué hace |
|---|---|
| `GET /api/health` | Estado y modelo conectado |
| `GET /api/instances` | Power BI Desktop abiertos |
| `POST /api/connect` | `{ server, database }` |
| `POST /api/query` | `{ dax, clearCache, includePlan, maxRows, trace, role, effectiveUser }` → resultado y Server Timings |
| `POST /api/benchmark` | `{ dax, cold, warm }` → ejecuciones y medianas |
| `GET /api/model-stats` | Estadísticas VertiPaq del modelo (`?exact=true` lee cardinalidades de los datos) |

## Opciones de `PuenteDax.exe`

```
--server <host:puerto>   Instancia de Power BI Desktop (como External Tool: %server%)
--database <nombre>      Modelo (%database%)
--port <n>               Puerto HTTP (5199)
--token <texto>          Token de la API (si no, aleatorio)
--www <carpeta>          Sirve esa carpeta en http://127.0.0.1:<puerto>/
--allow-origin <url>     Origen web adicional autorizado (repetible)
--mock                   Modo simulado, sin Power BI (para preparar slides)
--open                   Abre el navegador al arrancar
```

## Seguridad

- Escucha solo en `127.0.0.1` y rechaza peticiones cuyo `Host` no sea `localhost`/`127.0.0.1`
  (defensa frente a DNS rebinding).
- La API exige el token (`X-Puente-Token`). CORS solo admite `file://`, orígenes locales y los
  que se añadan con `--allow-origin`.
- Solo ejecuta consultas DAX de lectura, `ClearCache` y lecturas de metadatos/DMV sobre el modelo conectado.
- Al cerrar (Ctrl+C) elimina la traza del servidor.

## Desarrollo

| Ruta | Contenido |
|---|---|
| `src/PuenteDax.Core` | Cálculo FE/SE, callbacks, filas/KB, benchmark. Sin dependencias: se prueba en cualquier SO |
| `tests/PuenteDax.Core.Tests` | Tests del cálculo con eventos sintéticos (`dotnet test`) |
| `src/PuenteDax.Bridge` | API HTTP, traza AMO, ejecución ADOMD, simulador, descubrimiento de Desktop |
| `web/` | `dax-lab.js` (widgets) y `demo.html`, embebidos en el `.exe` (`/lab/…`) |

Dependencias: `Microsoft.AnalysisServices` y `Microsoft.AnalysisServices.AdomdClient` (Microsoft),
`Dax.Model.Extractor` y `Dax.ViewModel` (VertiPaq Analyzer, licencia MIT) para las estadísticas del modelo.
| `instalar/` | Instalador como External Tool, desinstalador e icono |

En Linux/macOS compila y funciona en modo `--mock`. La conexión real a Power BI Desktop solo es posible
en Windows (ver INVESTIGACION.md).
