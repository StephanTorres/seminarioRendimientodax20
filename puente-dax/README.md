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

## Uso en las diapositivas

```html
<script src="http://127.0.0.1:5199/lab/dax-lab.js"></script>

<dax-lab label="AA v1 · SAMEPERIODLASTYEAR" cold="5" warm="5">
  EVALUATE
  SUMMARIZECOLUMNS ( 'Date'[Calendar Year], "AA", [Ventas AA v1] )
</dax-lab>

<dax-benchmark></dax-benchmark>
```

| Atributo de `<dax-lab>` | Para qué |
|---|---|
| `label` | Nombre de la variante (también en la plantilla benchmark) |
| `cold`, `warm` | Ejecuciones del botón Benchmark (3 y 3 por defecto) |
| `plan` | Marca de inicio la casilla de plan de consulta |
| `rows` | Filas del resultado a enseñar (20) |
| `bridge`, `token` | Solo si no se usan los valores por defecto |
| `recorded` | URL de una medición grabada (plan B si el puente falla) |

- **Botones:** ▶ Frío (limpia caché), ▶ Caliente, ⏱ Benchmark, ⤓ guardar la medición en JSON.
- **Teclado:** `Ctrl+Enter` ejecuta en frío. Mientras escribes en el widget, las teclas no mueven
  las diapositivas; `Esc` devuelve el control a la presentación.
- **`<dax-benchmark>`:** la plantilla *benchmark* del workshop, rellenada sola con cada medición.
  Se guarda en el navegador; *Copiar* la deja lista para pegar en Excel.
- **Plan B sin puente:** guarda la medición con ⤓ durante la preparación y pégala dentro del widget.
  Funciona incluso abriendo la slide como fichero:

  ```html
  <dax-lab label="AA v1">
    EVALUATE …
    <script type="application/json" data-recorded>{ …contenido del JSON guardado… }</script>
  </dax-lab>
  ```

**Token:** las páginas servidas por el propio puente (`--www`, o `/lab/demo.html`) lo obtienen
solas. Abiertas como fichero o desde otro servidor, el widget lo pide una vez (sale en la consola
del puente) o se fija con `-Token` al instalar.

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
- Solo ejecuta consultas DAX de lectura y `ClearCache` sobre el modelo conectado.
- Al cerrar (Ctrl+C) elimina la traza del servidor.

## Desarrollo

| Ruta | Contenido |
|---|---|
| `src/PuenteDax.Core` | Cálculo FE/SE, callbacks, filas/KB, benchmark. Sin dependencias: se prueba en cualquier SO |
| `tests/PuenteDax.Core.Tests` | Tests del cálculo con eventos sintéticos (`dotnet test`) |
| `src/PuenteDax.Bridge` | API HTTP, traza AMO, ejecución ADOMD, simulador, descubrimiento de Desktop |
| `web/` | `dax-lab.js` (widgets) y `demo.html`, embebidos en el `.exe` (`/lab/…`) |
| `instalar/` | Instalador como External Tool, desinstalador e icono |

En Linux/macOS compila y funciona en modo `--mock`. La conexión real a Power BI Desktop solo es posible
en Windows (ver INVESTIGACION.md).
