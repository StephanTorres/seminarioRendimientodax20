"""Despliega la definición TMDL del modelo en un modelo YA PUBLICADO del workspace (solo metadatos).

Los modelos «[PROD]» y «[PR]» se publican una vez desde Power BI Desktop, con sus datos. Este script
actualiza su definición (medidas, grupos de cálculo, columnas y tablas calculadas) con fabric-cicd y
después lanza un refresco «calculate», que recalcula lo calculado sin ir al origen: en el servicio no
hay acceso al SQL Server de las demos.

Uso:
    python ci/desplegar.py --modelo "Rendimiento DAX [PR]"
Variables de entorno: FABRIC_TENANT_ID, FABRIC_CLIENT_ID, FABRIC_CLIENT_SECRET, FABRIC_WORKSPACE_ID.
"""

import argparse
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import requests
from azure.identity import ClientSecretCredential
from fabric_cicd import FabricWorkspace, publish_all_items

RAIZ = Path(__file__).resolve().parent.parent
ORIGEN = RAIZ / "PowerBi-despues" / "PowerBi.SemanticModel"
POWERBI = "https://api.powerbi.com/v1.0/myorg"


def credencial() -> ClientSecretCredential:
    return ClientSecretCredential(
        tenant_id=os.environ["FABRIC_TENANT_ID"],
        client_id=os.environ["FABRIC_CLIENT_ID"],
        client_secret=os.environ["FABRIC_CLIENT_SECRET"],
    )


def preparar(origen: Path, modelo: str, destino: Path) -> None:
    """Copia el .SemanticModel con el nombre del elemento publicado (fabric-cicd lo busca por nombre y tipo)."""
    carpeta = destino / f"{modelo}.SemanticModel"
    # .pbi lleva la caché y ajustes locales de Desktop: no forman parte de la definición.
    shutil.copytree(origen, carpeta, ignore=shutil.ignore_patterns(".pbi"))
    plataforma = carpeta / ".platform"
    datos = json.loads(plataforma.read_text(encoding="utf-8"))
    datos["metadata"]["displayName"] = modelo
    plataforma.write_text(json.dumps(datos, indent=2, ensure_ascii=False), encoding="utf-8")


def refrescar_calculate(cred: ClientSecretCredential, workspace_id: str, modelo: str, espera_s: int = 900) -> None:
    """Refresco mejorado de tipo calculate: recalcula columnas y tablas calculadas sin leer el origen."""
    token = cred.get_token("https://analysis.windows.net/powerbi/api/.default").token
    cabeceras = {"Authorization": f"Bearer {token}"}
    modelos = requests.get(f"{POWERBI}/groups/{workspace_id}/datasets", headers=cabeceras, timeout=60)
    modelos.raise_for_status()
    ids = [m["id"] for m in modelos.json()["value"] if m["name"] == modelo]
    if not ids:
        sys.exit(f"No encuentro el modelo «{modelo}» en el workspace")
    url = f"{POWERBI}/groups/{workspace_id}/datasets/{ids[0]}/refreshes"

    r = requests.post(url, headers=cabeceras, json={"type": "calculate", "retryCount": 1}, timeout=60)
    r.raise_for_status()
    print(f"Refresco calculate lanzado ({r.headers.get('RequestId', '')})")

    limite = time.monotonic() + espera_s
    while time.monotonic() < limite:
        time.sleep(10)
        ultimo = requests.get(url, headers=cabeceras, params={"$top": 1}, timeout=60).json()["value"][0]
        estado = ultimo.get("status")
        if estado == "Completed":
            print("Refresco calculate completado")
            return
        if estado in ("Failed", "Disabled", "Cancelled"):
            sys.exit(f"El refresco calculate terminó en {estado}: {ultimo.get('serviceExceptionJson', '')}")
    sys.exit("El refresco calculate no terminó a tiempo")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--modelo", required=True, help="Nombre del modelo publicado, p. ej. «Rendimiento DAX [PR]»")
    p.add_argument("--origen", default=str(ORIGEN), help="Carpeta .SemanticModel del PBIP")
    p.add_argument("--workspace-id", default=os.environ.get("FABRIC_WORKSPACE_ID"))
    p.add_argument("--sin-calculate", action="store_true", help="No lanzar el refresco calculate")
    args = p.parse_args()
    if not args.workspace_id:
        sys.exit("Falta --workspace-id o FABRIC_WORKSPACE_ID")

    cred = credencial()
    with tempfile.TemporaryDirectory() as tmp:
        preparar(Path(args.origen), args.modelo, Path(tmp))
        workspace = FabricWorkspace(
            workspace_id=args.workspace_id,
            repository_directory=tmp,
            item_type_in_scope=["SemanticModel"],
            token_credential=cred,
        )
        # Ojo: nunca unpublish_all_orphan_items. En el workspace conviven [PROD] y [PR] y borraría el otro.
        publish_all_items(workspace)

    if not args.sin_calculate:
        refrescar_calculate(cred, args.workspace_id, args.modelo)


if __name__ == "__main__":
    main()
