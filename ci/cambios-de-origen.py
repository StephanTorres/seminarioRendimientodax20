"""¿El PR toca algo que necesita leer el origen (particiones, columnas importadas, Power Query)?

El CI solo despliega metadatos y nunca refresca desde el SQL Server de las demos: esos cambios no se
pueden medir. Este script los lista para avisar en el resumen del PR (no bloquea por sí mismo; si el
modelo queda sin datos, las consultas fallarán y eso sí bloquea).

Uso:
    python ci/cambios-de-origen.py origin/main [carpeta .SemanticModel]
Escribe Markdown en la salida (vacía si no hay cambios de origen).
"""

import re
import subprocess
import sys
from pathlib import Path

MODELO = "PowerBi-despues/PowerBi.SemanticModel/definition"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, encoding="utf-8", check=True).stdout


def contenido(ref: str, ruta: str) -> list:
    try:
        return git("show", f"{ref}:{ruta}").splitlines()
    except subprocess.CalledProcessError:
        return []  # fichero nuevo o borrado


def objeto(lineas: list, n: int) -> str:
    """Cabecera del objeto (nivel de una tabulación) que contiene la línea n (base 1)."""
    for i in range(min(n, len(lineas)) - 1, -1, -1):
        linea = lineas[i]
        if linea.startswith("\t") and not linea.startswith("\t\t") and linea.strip():
            return linea.strip()
        if not linea.startswith("\t") and linea.strip():
            return linea.strip()  # table / expression / ref…
    return ""


def es_de_origen(ruta: str, cabecera: str) -> bool:
    if ruta.endswith("expressions.tmdl"):
        return True  # parámetros y consultas de Power Query
    if cabecera.startswith("partition "):
        return True
    # Columna importada: «column X» sin «=»; las calculadas son «column X = …».
    return cabecera.startswith("column ") and "=" not in cabecera


def main(base: str, modelo: str) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    diff = git("diff", "--unified=0", f"{base}...HEAD", "--", modelo)
    hallazgos = set()
    ruta = None
    viejo, nuevo = [], []
    for linea in diff.splitlines():
        if linea.startswith("diff --git"):
            ruta = linea.split(" b/", 1)[1]
            viejo, nuevo = contenido(base, ruta), contenido("HEAD", ruta)
        elif linea.startswith("@@") and ruta and ruta.endswith(".tmdl"):
            m = re.match(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@", linea)
            ini_v, n_v, ini_n, n_n = int(m[1]), int(m[2] or 1), int(m[3]), int(m[4] or 1)
            for lineas, ini, n in ((viejo, ini_v, n_v), (nuevo, ini_n, n_n)):
                for k in range(ini, ini + n):
                    cabecera = objeto(lineas, k)
                    if es_de_origen(ruta, cabecera):
                        hallazgos.add((Path(ruta).name, cabecera or "(fichero)"))
    if hallazgos:
        print("### ⚠️ Cambios que necesitan refrescar desde el origen\n")
        print("El CI solo despliega metadatos: estos cambios no se pueden medir y pueden dejar consultas sin datos.\n")
        for fichero, cabecera in sorted(hallazgos):
            print(f"- `{fichero}` · `{cabecera}`")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else MODELO)
