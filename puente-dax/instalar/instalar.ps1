<#
.SYNOPSIS
    Instala el Puente DAX como External Tool de Power BI Desktop.

.DESCRIPTION
    1. Copia PuenteDax.exe (y su icono) a %LOCALAPPDATA%\PuenteDax. No necesita permisos.
    2. Registra PuenteDax.pbitool.json en la carpeta External Tools de Power BI Desktop.
       Esa carpeta está en Archivos de programa: este paso pide elevación (UAC).

    Después, en Power BI Desktop: cinta "Herramientas externas" > "Puente DAX".
    Desktop arranca el puente ya conectado al modelo abierto (%server% y %database%).

.PARAMETER Token
    Token fijo que usarán las diapositivas. Si no se indica, se genera uno.

.PARAMETER Www
    Carpeta que servirá el puente en http://127.0.0.1:<Puerto>/ (por ejemplo, la de las diapositivas).

.PARAMETER Puerto
    Puerto HTTP del puente. Por defecto 5199.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Www "C:\charlas\rendimiento-dax"
#>
[CmdletBinding()]
param(
    [string]$Token,
    [string]$Www,
    [int]$Puerto = 5199,
    [string]$Destino = (Join-Path $env:LOCALAPPDATA 'PuenteDax')
)

$ErrorActionPreference = 'Stop'

$exeOrigen = Join-Path $PSScriptRoot 'PuenteDax.exe'
if (-not (Test-Path -LiteralPath $exeOrigen)) {
    throw "No encuentro PuenteDax.exe junto a este script ($PSScriptRoot)."
}
if ($Www -and -not (Test-Path -LiteralPath $Www -PathType Container)) {
    throw "La carpeta indicada en -Www no existe: $Www"
}
if (-not $Token) {
    $Token = -join ((1..8) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
}

# 1) Ejecutable e icono en el perfil del usuario (sin elevación).
New-Item -ItemType Directory -Force -Path $Destino | Out-Null
Copy-Item -LiteralPath $exeOrigen -Destination $Destino -Force
$icono = Join-Path $PSScriptRoot 'puentedax.png'
if (Test-Path -LiteralPath $icono) { Copy-Item -LiteralPath $icono -Destination $Destino -Force }
$exe = Join-Path $Destino 'PuenteDax.exe'

# 2) Definición del External Tool (mismo formato que usa DAX Studio).
$argumentos = "--server `"%server%`" --database `"%database%`" --port $Puerto --token $Token --open"
if ($Www) { $argumentos += " --www `"$((Resolve-Path -LiteralPath $Www).Path)`"" }

$iconData = ''
if (Test-Path -LiteralPath $icono) {
    $iconData = 'image/png;base64,' + [Convert]::ToBase64String([IO.File]::ReadAllBytes($icono))
}

$definicion = [ordered]@{
    version     = '1.0'
    name        = 'Puente DAX'
    description = 'Mide consultas DAX desde las diapositivas: FE, SE, callbacks y planes.'
    path        = $exe
    arguments   = $argumentos
    iconData    = $iconData
}
$json = $definicion | ConvertTo-Json -Depth 3
$temporal = Join-Path $env:TEMP 'PuenteDax.pbitool.json'
[IO.File]::WriteAllText($temporal, $json, (New-Object System.Text.UTF8Encoding $false))

$commonFiles = ${env:CommonProgramFiles(x86)}
if (-not $commonFiles) { $commonFiles = $env:CommonProgramFiles }
$carpetaTools = Join-Path $commonFiles 'Microsoft Shared\Power BI Desktop\External Tools'
$destinoJson = Join-Path $carpetaTools 'PuenteDax.pbitool.json'

# 3) Copia a External Tools: directa si ya somos administrador; si no, elevamos solo este paso.
$esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if ($esAdmin) {
    New-Item -ItemType Directory -Force -Path $carpetaTools | Out-Null
    Copy-Item -LiteralPath $temporal -Destination $destinoJson -Force
} else {
    Write-Host 'Pidiendo permisos de administrador para registrar el External Tool...'
    $q = { param($texto) $texto.Replace("'", "''") }   # comillas simples dentro de -Command
    $comando = "New-Item -ItemType Directory -Force -Path '$(& $q $carpetaTools)' | Out-Null; " +
               "Copy-Item -LiteralPath '$(& $q $temporal)' -Destination '$(& $q $destinoJson)' -Force"
    $proceso = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $comando)
    if ($proceso.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $destinoJson)) {
        throw 'No se pudo registrar el External Tool (¿se canceló la elevación?).'
    }
}
Remove-Item -LiteralPath $temporal -Force

Write-Host ''
Write-Host 'Puente DAX instalado.' -ForegroundColor Green
Write-Host "  Ejecutable   : $exe"
Write-Host "  External Tool: $destinoJson"
Write-Host "  Dirección    : http://127.0.0.1:$Puerto/"
Write-Host "  Token        : $Token   (las slides servidas por el puente no lo piden)"
if ($Www) { Write-Host "  Sirve        : $Www" }
Write-Host ''
Write-Host 'Reinicia Power BI Desktop y busca "Puente DAX" en la cinta Herramientas externas.'
