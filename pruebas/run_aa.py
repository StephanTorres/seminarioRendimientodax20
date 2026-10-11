import html, json, re, sys, urllib.request

HTML = r"D:\Presentaciones\2026\10. Datasaturday\seminarioRendimientodax20\rendimiento-dax-2.0-datasaturday-madrid-2026.html"
OUT = sys.argv[1] if len(sys.argv) > 1 else "aa_results.json"
BASE = "http://127.0.0.1:5199"
TOKEN = "workshop"

src = open(HTML, encoding="utf-8").read()

# --- claves de PUENTE_DAX_MODELO -------------------------------------------------
block = re.search(r"window\.PUENTE_DAX_MODELO\s*=\s*\{(.*?)\n\};", src, re.S).group(1)
block = re.sub(r"//[^\n]*", "", block)
keys = {}
for m in re.finditer(r"'([^']+)':\s*(\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|-?\d+)", block):
    v = m.group(2)
    keys[m.group(1)] = v[1:-1] if v[0] in "\"'" else v


def fill(text):
    def rep(m):
        k = m.group(1).strip()
        if k not in keys:
            raise KeyError(k)
        return keys[k]
    return re.sub(r"\{\{([^}]+)\}\}", rep, text)


# --- variantes AA -------------------------------------------------------------------
variants = []
for sec in re.finditer(r'<section class="slide slide-lab" data-lab="(AA \d/5[^"]*)".*?</section>', src, re.S):
    lab = sec.group(1)
    for v in re.finditer(r'<dax-variant label="([^"]+)"[^>]*>(.*?)</dax-variant>', sec.group(0), re.S):
        variants.append({"lab": lab, "label": v.group(1), "dax": html.unescape(fill(v.group(2))).strip()})


def post(path, body, timeout=600):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Puente-Token": TOKEN})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}


WATCH = re.compile(r"'?Fecha'?\[Date(?: \(\d+\))?\]|\[Fecha\]\.\[Date\]|\[Date\]", re.I)


def watch_hit(xmsql):
    sel = re.search(r"\bSELECT\b([\s\S]*?)\bFROM\b", xmsql, re.I)
    if sel and WATCH.search(sel.group(1)):
        return "group"
    return "filter" if WATCH.search(xmsql) else None


res = []
for v in variants:
    r = post("/api/query", {"dax": v["dax"], "clearCache": True, "includePlan": False, "maxRows": 40, "trace": True})
    entry = {"lab": v["lab"], "label": v["label"]}
    if "error" in r:
        entry["error"] = r["error"]
    else:
        t = r["timings"]
        qs = [q for q in t["queries"] if q["type"] not in ("internal",)]
        hits = [watch_hit(q["query"]) for q in qs if q["type"] != "cache"]
        entry.update({
            "totalMs": t["totalMs"], "feMs": t["formulaEngineMs"], "seMs": t["storageEngineMs"],
            "seCpuMs": t["storageEngineCpuMs"], "parallelism": t["parallelism"],
            "seQueries": t["storageEngineQueries"], "cacheHits": t["cacheHits"], "callbacks": t["callbacks"],
            "rows": t["rows"], "kBytes": t["kBytes"],
            "groupByFecha": hits.count("group"), "filterByFecha": hits.count("filter"),
            "columns": r["result"]["columns"], "resultRows": r["result"]["rows"],
        })
    res.append(entry)
    print(entry["lab"], "|", entry["label"], "|", {k: entry.get(k) for k in ("totalMs", "feMs", "seMs", "seQueries", "rows", "kBytes", "callbacks", "groupByFecha", "filterByFecha")} if "error" not in entry else entry["error"][:200], flush=True)

json.dump({"keys": keys, "results": res}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("guardado", OUT, len(res), "variantes")
