<#
  Arranca los dos puentes de la demo antes/después y abre la presentación.

  Requisitos: los dos Power BI Desktop abiertos, uno con PowerBi\PowerBi.pbip (ANTES) y otro con
  PowerBi-despues\Despues.pbip (DESPUÉS), con los datos ya cargados.

    powershell -ExecutionPolicy Bypass -File .\puente-dax\lanzar-demos.ps1
    ... -Exe "C:\ruta\PuenteDax.exe"     (por defecto: puente-daxin-local, y si no, instalar o el instalado)

  Los puertos de Desktop cambian en cada apertura: el script los averigua cada vez.
  Antes -> puente 5199 (sirve también la presentación). Después -> puente 5200.
#>
param(
    [string]$Exe,
    [string]$Token = 'workshop',
    [int]$PuertoAntes = 5199,
    [int]$PuertoDespues = 5200,
    [switch]$SinNavegador
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

if (-not $Exe) {
    foreach ($c in @((Join-Path $PSScriptRoot 'bin-local\PuenteDax.exe'), (Join-Path $PSScriptRoot 'instalar\PuenteDax.exe'), (Join-Path $env:LOCALAPPDATA 'PuenteDax\PuenteDax.exe'))) {
        if (Test-Path $c) { $Exe = $c; break }
    }
}
if (-not $Exe -or -not (Test-Path $Exe)) { throw 'No encuentro PuenteDax.exe. Pasa -Exe <ruta>.' }

# Para un Desktop: su servidor local de Analysis Services (puerto) y la base de datos del modelo
function Get-Modelo([string]$pbip) {
    $procs = Get-CimInstance Win32_Process -Filter "Name='PBIDesktop.exe'" |
        Where-Object { $_.CommandLine -like "*$pbip*" }
    if (-not $procs) {
        # Respaldo: Desktop abierto sin la ruta en la línea de comandos (Archivo > Abrir); se busca por el título de la ventana
        $titulo = [IO.Path]::GetFileNameWithoutExtension($pbip)
        $ids = Get-Process PBIDesktop -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "$titulo*" } | ForEach-Object Id
        $procs = Get-CimInstance Win32_Process -Filter "Name='PBIDesktop.exe'" | Where-Object { $ids -contains $_.ProcessId }
    }
    if (-not $procs) { throw "No hay ningún Power BI Desktop con $pbip abierto." }
    $desktop = $procs | Select-Object -First 1
    $msmd = Get-CimInstance Win32_Process -Filter "Name='msmdsrv.exe'" | Where-Object { $_.ParentProcessId -eq $desktop.ProcessId } | Select-Object -First 1
    if (-not $msmd) { throw "El Desktop de $pbip no tiene todavía su motor local (¿sigue abriéndose?)." }
    if ($msmd.CommandLine -notmatch '-n (AnalysisServicesWorkspace_[0-9a-f-]+)') { throw 'No reconozco el espacio de trabajo del motor.' }
    $ws = Join-Path $env:LOCALAPPDATA "Microsoft\Power BI Desktop\AnalysisServicesWorkspaces\$($Matches[1])\Data"
    $port = (Get-Content (Join-Path $ws 'msmdsrv.port.txt') -Raw -Encoding Unicode).Trim()
    $db = Get-ChildItem $ws -Directory -Filter '*.db' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    [pscustomobject]@{ Puerto = $port; Base = ($db.Name -replace '\.\d+\.db$', '') }
}

$antes = Get-Modelo 'PowerBi\PowerBi.pbip'
$despues = Get-Modelo 'PowerBi-despues\Despues.pbip'
Write-Host "ANTES   : localhost:$($antes.Puerto)  base $($antes.Base)  -> puente $PuertoAntes"
Write-Host "DESPUES : localhost:$($despues.Puerto)  base $($despues.Base)  -> puente $PuertoDespues"

# Cerrar puentes anteriores (los lanzados desde Herramientas externas apuntan al modelo de su Desktop)
Get-Process PuenteDax -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

Start-Process $Exe -WindowStyle Minimized -ArgumentList @(
    '--www', "`"$repo`"", '--server', "localhost:$($antes.Puerto)", '--database', $antes.Base,
    '--report', "`"$repo\PowerBi\PowerBi.Report`"",
    '--port', $PuertoAntes, '--token', $Token)
Start-Process $Exe -WindowStyle Minimized -ArgumentList @(
    '--server', "localhost:$($despues.Puerto)", '--database', $despues.Base,
    '--port', $PuertoDespues, '--token', $Token, '--allow-origin', "http://127.0.0.1:$PuertoAntes")

# Esperar a que respondan (/api/health es abierta, no necesita token)
foreach ($p in $PuertoAntes, $PuertoDespues) {
    $ok = $false
    for ($i = 0; $i -lt 20 -and -not $ok; $i++) {
        try { Invoke-WebRequest "http://127.0.0.1:$p/api/health" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true }
        catch { Start-Sleep -Seconds 1 }
    }
    if ($ok) { Write-Host "Puente $p listo." } else { Write-Warning "El puente $p no responde (mira su ventana minimizada)." }
}

if (-not $SinNavegador) {
    Write-Host 'Abriendo la presentacion en el navegador...'
    Start-Process "http://127.0.0.1:$PuertoAntes/rendimiento-dax-2.0-datasaturday-madrid-2026.html"
}
