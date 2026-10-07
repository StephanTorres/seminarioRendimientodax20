# Investigación: medir FE/SE/callbacks desde las diapositivas

Objetivo: ejecutar consultas DAX contra Power BI Desktop **sin salir de las diapositivas** y enseñar
las mismas métricas que DAX Studio (Server Timings, Query Plan), para que la sala no se disperse
saltando entre herramientas.

## 1. Conclusión

Es viable y no requiere nada oculto: todo sale de **eventos de traza estándar de Analysis Services**,
que DAX Studio ya usa. La única pieza obligatoria es un **puente local en Windows**, porque:

- El navegador no habla el protocolo de Analysis Services (XMLA binario sobre TCP).
- ADOMD.NET solo conecta por TCP a un Analysis Services local **desde Windows**. Microsoft lo
  confirma en [Q&A](https://learn.microsoft.com/en-us/answers/questions/233745/can-adomd-net-core-connect-to-an-ssas-endpoint-fro),
  y además Desktop usa autenticación integrada de Windows. Por eso **Docker no sirve** aquí
  (ver § 9).

Lo complicado no es acceder a los eventos, sino **calcular bien FE y SE** cuando las consultas SE van
en paralelo. Se ha reimplementado el algoritmo de DAX Studio y se ha cubierto con tests.

## 2. De dónde saca DAX Studio cada número

Revisado en el código de DAX Studio (commit `a4add2e`): `QueryTraceEngine.cs`,
`TraceEventFactory.cs`, `ServerTimesModel.cs`, `TraceStorageEngineExtensions.cs`,
`ConnectionManager.cs`, `ADOTabularDatabase.cs`, `PowerBIHelper.cs`.

| Evento (ID) | Para qué |
|---|---|
| `QueryBegin` (9) | Inicio de la consulta; su `ActivityID` agrupa todos los eventos de la petición |
| `QueryEnd` (10) | **Duración total** de la consulta |
| `VertiPaqSEQueryBegin` (82) | Marca el inicio de los *batches* |
| `VertiPaqSEQueryEnd` (83) | Cada consulta SE: xmSQL, duración, CPU, inicio/fin |
| `VertiPaqSEQueryCacheMatch` (85) | Aciertos de la caché del SE |
| `DirectQueryEnd` (99) | Consultas SQL en DirectQuery (cuentan como SE) |
| `DAXQueryPlan` (112) | Planes lógico (`DAXVertiPaqLogicalPlan`) y físico (`DAXVertiPaqPhysicalPlan`) |
| `ExecutionMetrics` (136) | Resumen JSON por petición, en motores recientes ([anuncio](https://powerbi.microsoft.com/en-gb/blog/new-executionmetrics-event-in-azure-log-analytics-for-power-bi-semantic-models/)) |
| `DiscoverBegin` | Solo como latido para saber que la traza ya está activa |

Subclases relevantes de `VertiPaqSEQueryEnd`: `VertiPaqScan` (consulta visible), `VertiPaqScanInternal`
(interna, oculta por defecto), `BatchVertiPaqScan` (agrupa consultas) y `VertiPaqCacheExactMatch`.

**Ojo:** el **FE no emite eventos**. Su tiempo se deduce de los huecos en los que no hay ninguna
consulta SE en curso. La documentación de DAX Studio lo explica en
[Server Timings](https://daxstudio.org/docs/features/traces/server-timings-trace/).

## 3. Cómo se arranca la traza

1. Conexión ADOMD al modelo; se guarda su `SessionID`.
2. Conexión AMO (`Microsoft.AnalysisServices.Server`) con `SessionId=<la misma sesión>`.
3. `server.Traces.Add(...)` con los eventos anteriores. **Las columnas disponibles cambian según la
   versión del motor**; se consultan en `$SYSTEM.DISCOVER_TRACE_EVENT_CATEGORIES` y solo se piden
   las que existen. Si no, `trace.Update()` falla.
4. Filtro XML: `SessionID = <sesión>` **o** `EventClass = ExecutionMetrics`, porque ese evento no lleva `SessionID`.
5. `trace.Update(CreateOrReplace)` → `trace.Start()`.
6. La traza **tarda en activarse**. Se lanzan peticiones *discover* (`MDSCHEMA_CUBES`) hasta recibir el
   primer evento, con un tiempo máximo de espera.
7. Al cerrar: `Stop()` + `Drop()`. Si no, la traza queda viva en el servidor.

Para separar la consulta de otras: el puente antepone un comentario único `/* puente:<guid> */` al DAX.
Toma el `ActivityID` de su `QueryBegin`/`QueryEnd` y se queda con los eventos de ese `ActivityID`.
Tras el `QueryEnd`, espera hasta 1 s a que llegue `ExecutionMetrics`.

El plan de consulta se pide solo cuando hace falta (casilla *plan*): añade eventos a la traza, que se
reconfigura (≈1–2 s).

**Caché fría:** comando XMLA `<ClearCache><Object><DatabaseID>…</DatabaseID></Object></ClearCache>`
por ADOMD, igual que DAX Studio.

## 4. Cálculo de FE y SE (`ServerTimingsCalculator`)

Mismo criterio que `ServerTimesModel.ProcessResults` de DAX Studio. Según el código, el algoritmo de
paralelismo es de Marco Russo (2022); SQLBI lo explica en
[Analyzing the parallelism of storage engine operations](https://www.sqlbi.com/articles/analyzing-the-parallelism-of-storage-engine-operations-in-dax-studio/).

1. **Normaliza** eventos con `EndTime` o `Duration` incoherentes.
2. **FE por barrido**: se ordenan inicios y fines de las consultas SE dentro de la consulta. El FE es la
   suma de los tramos con nivel 0, es decir, sin ninguna SE activa.
3. **SE neto**: suma de duraciones descontando el solape con la consulta SE que termina más tarde.
   Los batches restan duración y CPU de sus consultas internas.
4. Total = `QueryEnd.Duration`. Si `SE neto + FE < Total`, entonces SE = SE neto y FE = Total − SE.
   Si no, SE = Total − FE.
5. **Paralelismo** = CPU del SE / duración del SE.

Cubierto por 20 tests: secuencial, paralelo, caché, batch, internas, normalización, offsets, planes y
métricas.

## 5. Callbacks, filas y KB

- **Callback:** el texto xmSQL contiene `CallbackDataID`, `LogAbsValueCallback`, `RoundValueCallback`,
  `EncodeCallback`, `MinMaxColumnPositionCallback` o `Cond`. DAX Studio busca `Cond` como subcadena.
  Aquí se exige palabra completa para no marcar columnas como *Condiciones de pago*.
- **Filas y KB:** el xmSQL termina con el tamaño estimado. Hay **dos formatos** según la versión:
  `'Estimated size ( volume, marshalling bytes ) : 1234, 56789'` y
  `[Estimated size (volume, marshalling bytes): 37, 592]`. Se aceptan ambos (KB = 1 + bytes/1024, como DAX Studio).
- **Nombres:** el xmSQL real lleva identificadores internos (`[Period (1438)]`). Se quitan para que se
  lea en clase, como hace la opción de simplificar de DAX Studio.

## 6. Localizar Power BI Desktop

- **Como External Tool (recomendado):** Desktop pasa `%server%` (host:puerto) y `%database%` al
  ejecutable ([documentación](https://learn.microsoft.com/en-gb/power-BI/transform-model/desktop-external-tools-register)).
  El `.pbitool.json` sigue el mismo formato que el de DAX Studio (`version`, `name`, `description`,
  `path`, `arguments`, `iconData` como `image/png;base64,…`). Va en
  `Common Files (x86)\Microsoft Shared\Power BI Desktop\External Tools`, que requiere administrador.
- **Sin External Tool:** fichero `msmdsrv.port.txt` en
  `%LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\*\Data\`. En la versión Store
  está en `%LOCALAPPDATA%\Packages\Microsoft.MicrosoftPowerBIDesktop_*\LocalState\…`, y antes en
  `%USERPROFILE%\Microsoft\Power BI Desktop Store App\…`. Puede quedar de sesiones cerradas: se
  comprueba que el puerto escucha. DAX Studio, en cambio, recorre los procesos `msmdsrv` y su tabla TCP.

## 7. Navegador ↔ puente

- **CORS:** se admiten `file://` (origen `null`), orígenes locales y los indicados con `--allow-origin`.
- **Chrome *Local Network Access*:** una web **pública** que llama a `localhost` dispara un permiso del
  navegador ([Chrome](https://developer.chrome.com/blog/local-network-access)). Se evita sirviendo las
  slides desde el propio puente (`--www`) o abriéndolas como fichero. Por compatibilidad con la antigua
  *Private Network Access*, el puente responde `Access-Control-Allow-Private-Network: true`.
- **Token:** obligatorio en la API. Las páginas servidas por el puente lo obtienen de
  `/api/session-token`, que solo responde si `Sec-Fetch-Site: same-origin` (cabecera que pone el
  navegador y que una web externa no puede falsificar).
- **DNS rebinding:** se rechaza cualquier `Host` que no sea `localhost`/`127.0.0.1`.
- **`fetch()` de ficheros locales** no funciona en páginas abiertas como `file://`. Por eso el plan B
  (medición grabada) se puede **incrustar** en la propia slide.

## 8. Instalación elegida

`PuenteDax.exe` **autocontenido de un solo fichero** (≈57 MB, no requiere .NET), más `instalar.ps1`,
que lo copia al perfil y registra el External Tool. Un clic en la cinta de Desktop arranca el puente ya
conectado al modelo abierto.

## 9. ¿Y Docker?

Descartado para este caso:

- ADOMD.NET no conecta desde Linux a un Analysis Services local por TCP, y Desktop usa
  autenticación integrada de Windows.
- Desktop escucha en el `localhost` de Windows; un contenedor lo ve por otra interfaz.
- Un contenedor Windows serían varios GB para el mismo problema de red.

Solo tendría sentido para el modo simulado (pruebas) o para atacar modelos publicados en
Fabric/Premium por el endpoint XMLA (HTTPS + Entra ID), que no es el escenario del workshop.

## 10. Alternativas evaluadas

| Opción | Pros | Contras |
|---|---|---|
| `dscmd benchmark` de DAX Studio ([docs](https://daxstudio.org/docs/features/command-line/commands/benchmark-command/)) | Cero código de trazas; frío/caliente con `--cold`/`--warm`; CSV | Solo tiempos: sin xmSQL, callbacks ni planes |
| Semantic Link en notebooks de Fabric (`create_trace_connection`) | Trazas desde Python | Para modelos publicados, no Desktop; Microsoft lo describe como *best effort* |
| Servidores MCP de Power BI | Útiles para el apartado de IA | No están pensados para incrustar métricas en una slide |
| **Puente propio** (elegido) | Todas las métricas, widget a medida, plantilla benchmark automática | Hay que mantenerlo y validarlo contra DAX Studio |

## 11. Licencia

DAX Studio es **Ms-RL** (Microsoft Reciprocal License), que es recíproca a nivel de fichero. El puente
**no copia ficheros de DAX Studio**: es una reimplementación propia del mismo procedimiento, basada en
la lectura de su código y su documentación. Conviene citarlo en las slides como referencia.

## 12. Qué está probado y qué no

**Probado aquí (Linux):**
- 20 tests del cálculo FE/SE.
- Compilación sin avisos, incluida la parte AMO/ADOMD.
- Publicación del `.exe` win-x64.
- API en modo simulado: token, CORS, `Host`, benchmark y traspaso de modelo entre instancias.
- Widget de punta a punta con Playwright: frío/caliente, callback resaltado, benchmark, plan, plantilla
  automática, teclado aislado de las slides, token desde `file://` y plan B grabado.

**El workflow de GitHub Actions comprueba en Windows:** tests, publicación, `--help`, modo simulado y
que AMO/ADOMD cargan en el `.exe` de un solo fichero (fallo esperado de conexión, no de ensamblados).

**Sin probar (necesita tu Windows con Power BI Desktop):**

- [ ] El External Tool aparece en la cinta y arranca conectado al modelo abierto.
- [ ] La traza se activa (mensaje "Traza activa en … ms" en la consola).
- [ ] Una consulta sencilla da Total/FE/SE coherentes con DAX Studio. Mismo DAX, caché fría, 3 veces.
- [ ] Una consulta con callback (`SUMX` + `IF`) sale marcada en rojo, como en DAX Studio.
- [ ] En caliente aparecen aciertos de caché.
- [ ] Una consulta con muchas consultas SE en paralelo da un SE parecido al de DAX Studio.
- [ ] La casilla *plan* trae los planes lógico y físico.
- [ ] El ExecutionMetrics llega (pestaña *Métricas*).
- [ ] Al cerrar con Ctrl+C la traza desaparece. Con DAX Studio: `SELECT * FROM $SYSTEM.DISCOVER_TRACES`.
- [ ] El traspaso de modelo al pulsar el botón desde un segundo `.pbix`.

## 13. Riesgos y límites

- **Versiones del motor:** columnas y subclases cambian. Se mitiga pidiendo solo columnas soportadas,
  pero un cambio de formato del xmSQL (como el de *Estimated size*) puede requerir ajustes.
- **Precisión:** los milisegundos dependen de la máquina. Para comparar variantes, usa siempre el
  benchmark (mediana de varias ejecuciones) y la misma máquina.
- **La traza añade algo de coste**, sobre todo con el plan activado. Para tiempos finos, mide sin plan.
- **Una consulta a la vez:** el puente serializa las peticiones de una misma sesión.
- **RLS:** no implementado. DAX Studio lo hace con `Roles`/`EffectiveUserName` en la conexión. Sería la
  siguiente mejora para la demo de ORs en RLS del bloque 6.
