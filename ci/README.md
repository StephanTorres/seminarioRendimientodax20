# Check «Rendimiento DAX» en los pull requests

Cada PR que toca el modelo `PowerBi-despues/PowerBi.SemanticModel` se despliega en el modelo
**`[PR]`** del workspace y se mide con traza (Puente DAX, Server Timings por XMLA) frente a **`[PROD]`**.
Si incumple [`rendimiento/reglas.yml`](rendimiento/reglas.yml), el check falla y la regla de rama de `main`
bloquea el merge. Al hacer merge, el workflow despliega en `[PROD]`, que pasa a ser la nueva línea base.

```
PR ─► Actions (SPN) ─► fabric-cicd: TMDL de la rama ─► [PR]   (solo metadatos + refresco «calculate»)
                    └► PuenteDax.exe ci: [PROD] y [PR] intercalados, frío y caliente ─► reglas.yml ─► ✅ / ❌
push a main ─► fabric-cicd ─► [PROD]
```

| Fichero | Qué hace |
|---|---|
| [`../.github/workflows/rendimiento-dax.yml`](../.github/workflows/rendimiento-dax.yml) | El workflow (job **Rendimiento DAX**) |
| [`desplegar.py`](desplegar.py) | Despliega el TMDL en un modelo ya publicado y lanza un refresco `calculate` |
| [`cambios-de-origen.py`](cambios-de-origen.py) | Avisa si el PR toca particiones, columnas importadas o Power Query |
| [`rendimiento/reglas.yml`](rendimiento/reglas.yml) | Umbrales y gravedades |
| [`rendimiento/consultas/*.dax`](rendimiento/consultas) | Consultas de los visuales (una por visual) |
| [`rendimiento/extraer-consultas.py`](rendimiento/extraer-consultas.py) | Las genera desde una exportación del Analizador de rendimiento |
| `puente-dax/src/PuenteDax.Bridge/CiRunner.cs` | `PuenteDax.exe ci`: mide y evalúa (reglas en `PuenteDax.Core`) |

## Por qué así

- **Sin refresco desde el origen.** Los datos vienen de un SQL Server local (`A01P0717`), al que el servicio no
  llega. Los dos modelos se publican **una vez desde Desktop con sus datos** y el CI solo cambia metadatos
  (medidas, grupos de cálculo, columnas y tablas calculadas). Los cambios que necesitan el origen se avisan.
- **Un único workspace** (no se pueden crear más): `[PROD]` y `[PR]` conviven en él. Ventaja: misma capacidad
  y mismo momento; se miden intercalados y el ruido afecta a los dos por igual.
- **Métricas deterministas** (consultas al SE, callbacks) además de la duración, que en una capacidad
  compartida es ruidosa. La regla de duración pide factor **y** margen absoluto.

## Preparación (una vez)

1. **Tenant** (admin de Fabric): *Service principals can use Fabric APIs* activado para el SPN o su grupo.
   Capacidad con **XMLA en lectura/escritura**.
2. **Workspace**: añadir el SPN (App Registration) como **Miembro** (o Admin).
3. **Publicar los modelos**: abrir `PowerBi-despues/Despues.pbip` en Desktop → Publicar en el workspace →
   renombrar el modelo a `Rendimiento DAX [PROD]`. Repetir y renombrar a `Rendimiento DAX [PR]`.
   (El informe que se publica con ellos se puede borrar o dejar.)
4. **GitHub** → Settings → Secrets and variables → Actions:
   - Secretos: `FABRIC_TENANT_ID`, `FABRIC_CLIENT_ID`, `FABRIC_CLIENT_SECRET`
   - Variables: `FABRIC_WORKSPACE_ID`, `FABRIC_WORKSPACE_NAME`, `MODELO_PROD` = `Rendimiento DAX [PROD]`,
     `MODELO_PR` = `Rendimiento DAX [PR]`
5. **Repo público** y regla de rama en `main`: *Require a pull request* + *Require status checks to pass* →
   **Rendimiento DAX** + *Require branches to be up to date*.

## Probar en local

```powershell
dotnet build puente-dax/src/PuenteDax.Bridge -c Release
$exe = 'puente-dax/src/PuenteDax.Bridge/bin/Release/net8.0/PuenteDax.exe'

# Dos Power BI Desktop abiertos: puertos en %LOCALAPPDATA%\Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\*\Data\msmdsrv.port.txt
& $exe ci --reglas ci/rendimiento/reglas.yml --base-servidor localhost:<PUERTO_PROD> --pr-servidor localhost:<PUERTO_PR>

# Contra el servicio con el service principal
$env:FABRIC_TENANT_ID = '…'; $env:FABRIC_CLIENT_ID = '…'; $env:FABRIC_CLIENT_SECRET = '…'
& $exe ci --reglas ci/rendimiento/reglas.yml --servidor 'powerbi://api.powerbi.com/v1.0/myorg/<Workspace>' `
  --base 'Rendimiento DAX [PROD]' --pr 'Rendimiento DAX [PR]' --resumen resumen.md

python ci/desplegar.py --modelo 'Rendimiento DAX [PR]'    # mismas variables + FABRIC_WORKSPACE_ID
```

Código de salida de `PuenteDax.exe ci`: `0` aprobado · `1` alguna regla con gravedad `fallo` · `2` error de uso o conexión.

Para regenerar las consultas de los visuales tras cambiar el informe: grabar en Desktop con el Analizador de
rendimiento, exportar y `python ci/rendimiento/extraer-consultas.py <export.json> PowerBi-despues/PowerBi.Report`.

## Guion de la demo

La regresión: `Sales Amount` pasa de `SUM(entero) + SUM(céntimos)/100` a `SUMX` con `ROUND` fila a fila.
Mismo resultado (los céntimos ya son enteros), pero medido en local sobre el modelo «después» (año × color):

| `Sales Amount` | Frío | Caliente | Callbacks |
|---|---:|---:|---:|
| Dos `SUM` (actual) | 126 ms | 6 ms | 0 |
| `SUMX` + `ROUND` por fila | 2 120 ms | 2 000 ms | 1 |

1. `./ci/demo/demo.ps1 -Paso regresion` → crea `demo/regresion-medida` desde `origin/main`, commit y push →
   abrir el PR → check **❌** y comentario con la tabla (regresión ×17 y callback nuevo).
2. `./ci/demo/demo.ps1 -Paso arreglo` → commit con el arreglo y push → el check se relanza solo → **✅**.
3. Merge → el workflow despliega en `[PROD]`.

Ensayo sin push: `-SinPush`.

Para repetirla: volver a desplegar `main` en `[PR]` (`python ci/desplegar.py --modelo 'Rendimiento DAX [PR]'`
desde `main`) y recrear la rama. **Plan B**: grabación y capturas del ensayo de la víspera.
