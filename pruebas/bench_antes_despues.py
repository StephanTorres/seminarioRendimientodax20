import json, statistics as st, sys, urllib.request

QUERIES = {
    "Ventas por año (Sales Amount)": "EVALUATE SUMMARIZECOLUMNS ( 'Fecha'[Year], \"v\", [Sales Amount] ) ORDER BY 'Fecha'[Year]",
    "Ventas por año y categoría": "EVALUATE SUMMARIZECOLUMNS ( 'Fecha'[Year], 'Product'[English Product Category Name], \"v\", [Sales Amount] )",
    "Coste, impuesto y transporte por año": "EVALUATE SUMMARIZECOLUMNS ( 'Fecha'[Year], \"c\", [Total Cost], \"t\", [Tax Amount], \"f\", [Freight] ) ORDER BY 'Fecha'[Year]",
    "Dólares por año (Total Sales Currency Dolar)": "EVALUATE SUMMARIZECOLUMNS ( 'Fecha'[Year], \"d\", [Total Sales Currency Dolar] ) ORDER BY 'Fecha'[Year]",
    "Euros por año (Total Sales Currency Euro)": "EVALUATE SUMMARIZECOLUMNS ( 'Fecha'[Year], \"e\", [Total Sales Currency Euro] ) ORDER BY 'Fecha'[Year]",
    "Dólares por año y mes": "EVALUATE SUMMARIZECOLUMNS ( 'Fecha'[Year], 'Fecha'[Month], \"d\", [Total Sales Currency Dolar] )",
}


def post(base, path, body):
    req = urllib.request.Request(base + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Puente-Token": "workshop"})
    try:
        with urllib.request.urlopen(req, timeout=1800) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}


res = {}
for modelo, base in (("ANTES", "http://127.0.0.1:5199"), ("DESPUES", "http://127.0.0.1:5200")):
    res[modelo] = {}
    for nombre, dax in QUERIES.items():
        r = post(base, "/api/benchmark", {"dax": dax, "cold": 3, "warm": 3})
        if "error" in r:
            res[modelo][nombre] = {"error": r["error"][:200]}
            print(modelo, nombre, "ERROR", r["error"][:150], flush=True)
            continue
        cold = [x for x in r["runs"] if x["cache"] == "cold"]
        warm = [x for x in r["runs"] if x["cache"] == "warm"]
        e = {"frio": [x["totalMs"] for x in cold], "frio_med": st.median(x["totalMs"] for x in cold),
             "fe": st.median(x["formulaEngineMs"] for x in cold), "se": st.median(x["storageEngineMs"] for x in cold),
             "seq": cold[0]["storageEngineQueries"], "caliente_med": st.median(x["totalMs"] for x in warm)}
        res[modelo][nombre] = e
        print(modelo, "|", nombre.encode("ascii", "replace").decode(), "|", e, flush=True)
json.dump(res, open(sys.argv[1], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
