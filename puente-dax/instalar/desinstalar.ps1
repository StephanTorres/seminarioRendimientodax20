<#
.SYNOPSIS
    Quita el Puente DAX: el External Tool de Power BI Desktop y la carpeta del ejecutable.
#>
[CmdletBinding()]
param(
    [string]$Destino = (Join-Path $env:LOCALAPPDATA 'PuenteDax')
)

$ErrorActionPreference = 'Stop'

$commonFiles = ${env:CommonProgramFiles(x86)}
if (-not $commonFiles) { $commonFiles = $env:CommonProgramFiles }
$json = Join-Path $commonFiles 'Microsoft Shared\Power BI Desktop\External Tools\PuenteDax.pbitool.json'

if (Test-Path -LiteralPath $json) {
    $esAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
    if ($esAdmin) {
        Remove-Item -LiteralPath $json -Force
    } else {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait `
            -ArgumentList @('-NoProfile', '-Command', "Remove-Item -LiteralPath '$($json.Replace("'", "''"))' -Force")
    }
}

if (Test-Path -LiteralPath $Destino) {
    Remove-Item -LiteralPath $Destino -Recurse -Force
}

Write-Host 'Puente DAX desinstalado. Reinicia Power BI Desktop para que desaparezca de la cinta.'
