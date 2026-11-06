"""Extrae las consultas DAX de los visuales de una exportación del Analizador de rendimiento.

Genera un fichero .dax por visual en ci/rendimiento/consultas, con cabecera de metadatos que lee
«PuenteDax.exe ci». El visualId de la exportación es el nombre de la carpeta del visual en el PBIR,
así que la página se saca del informe.

Uso:
    python ci/rendimiento/extraer-consultas.py pruebas/PowerBIPerformanceData.json PowerBi-despues/PowerBi.Report
"""

import json
import re
import sys
import unicodedata
from pathlib import Path


def slug(texto: str) -> str:
    texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", texto.lower()).strip("-")[:50]


def paginas_por_visual(informe: Path) -> dict:
    resultado = {}
    for pagina in (informe / "definition" / "pages").glob("*/page.json"):
        nombre = json.loads(pagina.read_text(encoding="utf-8")).get("displayName", pagina.parent.name)
        for visual in (pagina.parent / "visuals").glob("*"):
            resultado[visual.name] = nombre
    return resultado


def main(exportacion: str, informe: str, destino: str) -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    eventos = json.loads(Path(exportacion).read_text(encoding="utf-8-sig"))["events"]
    por_id = {e["id"]: e for e in eventos}
    paginas = paginas_por_visual(Path(informe))

    def visual_de(evento):
        # Execute DAX Query → Execute Semantic Query → Query → Visual Container Lifecycle
        for _ in range(20):
            if evento is None or evento["name"] == "Visual Container Lifecycle":
                return evento
            evento = por_id.get(evento.get("parentId"))
        return None

    salida = Path(destino)
    salida.mkdir(parents=True, exist_ok=True)
    for viejo in salida.glob("*.dax"):
        viejo.unlink()

    vistos = set()
    for e in eventos:
        if e["name"] != "Execute DAX Query":
            continue
        dax = e["metrics"]["QueryText"].strip()
        visual = visual_de(e)
        m = visual["metrics"] if visual else {}
        visual_id = m.get("visualId", "sin-visual")
        if visual_id in vistos:  # el mismo visual refrescado dos veces
            continue
        vistos.add(visual_id)
        pagina = paginas.get(visual_id, "(sin página)")
        titulo = m.get("visualTitle") or m.get("visualType", "visual")
        nombre = f"{slug(pagina)}__{slug(titulo)}__{visual_id[:6]}.dax"
        cabecera = (
            f"// visual: {titulo}\n"
            f"// pagina: {pagina}\n"
            f"// tipo: {m.get('visualType', '')}\n"
            f"// visualId: {visual_id}\n"
        )
        (salida / nombre).write_text(cabecera + dax + "\n", encoding="utf-8")
        print(f"{pagina} / {titulo} → {nombre}")
    print(f"{len(vistos)} consultas en {salida}")


if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else str(Path(__file__).parent / "consultas"))
