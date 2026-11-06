<#
.SYNOPSIS
    Commits de la demo «el PR que no pasa»: una regresión en 'Sales Amount' y su arreglo.

.DESCRIPTION
    -Paso regresion : crea la rama demo/regresion-medida desde origin/main y cambia 'Sales Amount' a un
                      SUMX con ROUND fila a fila (mismo resultado, ~17 veces más lento y con CallbackDataID).
                      Hace commit y push; después se abre el PR en GitHub con el enlace que imprime git.
    -Paso arreglo   : en esa rama, vuelve a las dos SUM (los céntimos ya son enteros: no hay nada que
                      redondear). Commit y push: el check se relanza solo.
    -SinPush        : deja el commit en local (para ensayar).

.EXAMPLE
    ./ci/demo/demo.ps1 -Paso regresion
    ./ci/demo/demo.ps1 -Paso arreglo
#>
param(
    [Parameter(Mandatory)][ValidateSet('regresion', 'arreglo')][string]$Paso,
    [string]$Rama = 'demo/regresion-medida',
    [switch]$SinPush
)

$ErrorActionPreference = 'Stop'
$raiz = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$tmdl = Join-Path $raiz 'PowerBi-despues\PowerBi.SemanticModel\definition\tables\Internet Sales.tmdl'

$bueno = "measure 'Sales Amount' = SUM ( 'Internet Sales'[SalesAmountEntero] ) + SUM ( 'Internet Sales'[SalesAmountCent] ) / 100"
$malo = "measure 'Sales Amount' = SUMX ( 'Internet Sales', ROUND ( 'Internet Sales'[SalesAmountEntero] + 'Internet Sales'[SalesAmountCent] / 100, 2 ) )"

function Cambiar([string]$desde, [string]$hasta) {
    # Lectura y escritura sin tocar finales de línea ni BOM.
    $bytes = [IO.File]::ReadAllBytes($tmdl)
    $texto = [Text.Encoding]::UTF8.GetString($bytes)
    if (-not $texto.Contains($desde)) { throw "No encuentro la medida esperada en $tmdl" }
    [IO.File]::WriteAllText($tmdl, $texto.Replace($desde, $hasta), [Text.UTF8Encoding]::new($false))
}

Push-Location $raiz
try {
    if (git status --porcelain) { throw 'Hay cambios sin confirmar: deja el árbol limpio antes de la demo.' }
    git fetch origin main | Out-Null

    if ($Paso -eq 'regresion') {
        git switch -C $Rama origin/main
        Cambiar $bueno $malo
        git add -- $tmdl
        git commit -m "Sales Amount: redondear a 2 decimales fila a fila" -m "Mismo resultado: los céntimos ya son enteros. Pero ROUND dentro de SUMX obliga al SE a pedir un callback por fila."
    }
    else {
        if ((git branch --show-current) -ne $Rama) { git switch $Rama }
        Cambiar $malo $bueno
        git add -- $tmdl
        git commit -m "Sales Amount: volver a SUM(entero) + SUM(céntimos)/100" -m "El redondeo por fila sobraba: el importe ya está partido en entero y céntimos. Sin callback."
    }

    if (-not $SinPush) {
        git push -u origin $Rama
        Write-Host "`nAbre (o refresca) el PR de $Rama → main en GitHub y mira el check «Rendimiento DAX»." -ForegroundColor Green
    }
}
finally {
    Pop-Location
}
