"""
Sitúa en el mapa las estaciones nuevas de Staroil y Andamur cruzándolas con el
listado del Geoportal (rótulo, municipio, localidad, provincia y carretera).

Uso:
    python3 src/ubicar_estaciones.py datos/pendientes_nuevos.tsv datos/muestras/geoportal.xls
    -> datos/ubicadas_nuevas.csv  y  datos/ubicar.sql (UPDATE para Supabase)

Solo da ubicación cuando la coincidencia es clara; lo dudoso queda pendiente.
"""
import csv
import math
import re
import sys
import unicodedata

import pandas as pd

VACIAS = {"DE", "DEL", "LA", "LAS", "LOS", "EL", "Y", "I", "L", "D", "A", "O", "SAN", "SANT", "SANTA"}
GENERICAS = {"STAROIL", "Q8", "ADS", "A8", "PTN", "OIL", "FUEL", "TRUCK", "AREA", "117", "PUERTA", "DIR",
             "MD", "MI", "II", "I", "NORTE", "SUR", "CTRA", "SALIDA", "S", "SERVICE", "PRIMER", "GRUPO",
             "LA", "EL", "DE", "DEL", "LAS", "LOS", "Y"}
MARCAS = {"GALP", "ENI", "ENILIVE", "VALCARCE", "BEROIL", "AVIA", "ANDAMUR", "ALAS", "HAXX", "NIEVES", "EUROCAM",
          "MAGNAOIL", "GM", "SHELL", "AGLA", "DEOIL", "GASPLAY", "ALFA", "ALZ", "BQP", "NOIL", "PETROBIL",
          "STAROIL", "CEPSA", "HAFESA", "NORPETROL", "PETRONIEVES", "AREA", "GHC", "RENOVA", "Q8"}
PROVINCIAS = {"LERIDA": "LLEIDA", "GERONA": "GIRONA", "ALAVA": "ARABA", "GUIPUZCOA": "GIPUZKOA",
              "ACORUNA": "CORUNA", "CORUNA": "CORUNA", "ORENSE": "OURENSE", "ASTURIAS": "ASTURIAS",
              "CANTABRIA": "CANTABRIA", "LARIOJA": "RIOJA", "RIOJA": "RIOJA"}


def norm(s):
    s = "" if s is None or (isinstance(s, float) and math.isnan(s)) else str(s)
    s = unicodedata.normalize("NFD", s.upper())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"\((EL|LA|LOS|LAS|A|O|OS|AS)\)", r" \1 ", s)
    return re.sub(r"[^A-Z0-9]+", " ", s).strip()


def clave(s):
    """'Riba-roja de Túria' y 'RIBAROJA DEL TURIA' -> 'RIBAROJATURIA'."""
    return "".join(w for w in norm(s).split() if w not in VACIAS)


def claves(s):
    return {clave(p) for p in re.split(r"[/]", str(s or "")) if clave(p)}


def prov(s):
    k = clave(s)
    return PROVINCIAS.get(k, k)


def vias(s):
    return {re.sub(r"[^A-Z0-9]", "", v) for v in re.findall(r"[A-Z]{1,3}\s*-?\s*\d{1,4}", norm(s).replace(" ", "-").replace("-", " ")) if v}


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371 * math.asin(math.sqrt(h))


def cargar_geo(ruta):
    g = pd.read_excel(ruta, header=3, dtype=str)
    g.columns = [c.strip() for c in g.columns]
    filas = []
    for _, r in g.iterrows():
        try:
            lat, lon = float(r["Latitud"].replace(",", ".")), float(r["Longitud"].replace(",", "."))
        except (ValueError, AttributeError):
            continue
        if not (27 < lat < 44.5 and -19 < lon < 5):
            continue
        filas.append({
            "lat": lat, "lon": lon, "rotulo": str(r["Rótulo"]), "dir": str(r["Dirección"]),
            "mun": str(r["Municipio"]), "loc": str(r["Localidad"]), "prov": str(r["Provincia"]),
            "k_lugar": claves(r["Municipio"]) | claves(r["Localidad"]),
            "k_prov": {prov(p) for p in str(r["Provincia"]).split("/")},
            "t_rotulo": set(norm(r["Rótulo"]).split()),
            "t_lugar": set(norm(f'{r["Municipio"]} {r["Localidad"]} {r["Dirección"]}').split()),
            "vias": vias(r["Dirección"]),
        })
    return filas


def ubicar(est, geo):
    proveedor, nombre, lugar, provincia, via = est
    tokens = [t for t in norm(nombre).split() if len(t) > 1]
    marca = [t for t in tokens if t in MARCAS]
    propios = [t for t in tokens if t not in GENERICAS and t not in MARCAS]
    k_lugar, k_prov = clave(lugar), prov(provincia)

    if proveedor == "Andamur":
        cand = [g for g in geo if k_lugar in g["k_lugar"] and (not k_prov or k_prov in g["k_prov"])]
        if not cand:   # p. ej. "Varadero, El" o "Boedo (Ledoño)": se busca la palabra del lugar en la provincia
            palabras = {w for w in norm(lugar).split() if w not in VACIAS and len(w) > 3}
            cand = [g for g in geo if k_prov in g["k_prov"] and palabras & g["t_lugar"]]
    else:   # Staroil: el "lugar" puede ser una provincia o una localidad
        cand = [g for g in geo if k_lugar in g["k_prov"] or k_lugar in g["k_lugar"]]
        if propios:
            cand = [g for g in cand if set(propios) & (g["t_lugar"] | g["t_rotulo"])] or cand

    v = vias(via)
    puntos = []
    for g in cand:
        p = 0
        p += 3 * len(set(marca) & g["t_rotulo"])
        p += 2 * len(set(propios) & g["t_rotulo"])
        p += 2 * len(set(propios) & g["t_lugar"])
        p += 1 if v & g["vias"] else 0
        if proveedor == "Staroil" and "STAROIL" in g["t_rotulo"]:
            p += 3
        puntos.append((p, g))
    if not puntos:
        return None, "sin candidatas", 0
    puntos.sort(key=lambda x: -x[0])
    mejor, g = puntos[0]
    empatadas = [x for x in puntos if x[0] == mejor]
    if mejor < 3:
        return None, f"poca coincidencia ({len(cand)} candidatas)", len(cand)
    # Empates entre estaciones juntas (los dos sentidos de una autovía): vale la primera
    if len(empatadas) > 1 and max(km((g["lat"], g["lon"]), (x[1]["lat"], x[1]["lon"])) for x in empatadas) > 3:
        return None, f"{len(empatadas)} candidatas igual de buenas", len(cand)
    conf = "alta" if (set(marca) & g["t_rotulo"] or (proveedor == "Staroil" and "STAROIL" in g["t_rotulo"])) else "media"
    return g, conf, len(cand)


def main(tsv, xls):
    geo = cargar_geo(xls)
    filas = [l.rstrip("\n").split("\t") for l in open(tsv, encoding="utf-8") if l.strip()]
    out, sql = [], []
    for f in filas:
        f += [""] * (5 - len(f))
        g, conf, n = ubicar(f, geo)
        proveedor, nombre, lugar, provincia, via = f
        # Mismo código que genera la función recibir-precios (quita acentos; el resto de signos pasa a "-")
        base = unicodedata.normalize("NFD", (f"{nombre} {lugar}" if proveedor == "Andamur" else nombre).upper())
        codigo = re.sub(r"[^A-Z0-9]+", "-", "".join(c for c in base if not unicodedata.combining(c))).strip("-")
        out.append({"proveedor": proveedor, "nombre": nombre, "lugar": lugar, "provincia": provincia,
                    "resultado": conf, "rotulo": g["rotulo"] if g else "", "direccion": g["dir"] if g else "",
                    "municipio": g["mun"] if g else "", "lat": g["lat"] if g else "", "lon": g["lon"] if g else ""})
        if g:
            q = lambda s: "'" + str(s).replace("'", "''") + "'"
            sql.append(f"update public.estaciones set lat={g['lat']}, lon={g['lon']}, direccion={q(g['dir'].title())}, "
                       f"municipio={q(g['mun'].title())}, confianza={q(conf)} "
                       f"where proveedor={q(proveedor)} and codigo={q(codigo)} and confianza='pendiente';")
    with open("datos/ubicadas_nuevas.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(out[0].keys()))
        w.writeheader(); w.writerows(out)
    open("datos/ubicar.sql", "w", encoding="utf-8").write("\n".join(sql) + "\n")
    from collections import Counter
    print(Counter((o["proveedor"], o["resultado"] if o["resultado"] in ("alta", "media") else "pendiente") for o in out))


if __name__ == "__main__":
    main(*sys.argv[1:3])
