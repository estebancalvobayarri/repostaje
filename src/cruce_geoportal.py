"""
Cruza las estaciones de un proveedor con el listado del Geoportal
para obtener su ubicación (coordenadas, dirección) y su precio público.

Uso:
    python3 src/cruce_geoportal.py datos/precios.csv datos/muestras/geoportal.xls datos/pistas_valcarce.csv datos/pistas_dst.csv
    -> estaciones.csv  (una fila por estación, con su ubicación y confianza)

El proveedor no da coordenadas ni un código común con el Geoportal, así que
se busca por municipio (de pistas_*.csv) y se puntúa cada candidata según
cuántas palabras clave aparecen en su rótulo o dirección.

Confianza:
  alta   -> una sola candidata clara en el municipio
  media  -> hay varias candidatas; se elige la de más puntuación
  revisar-> no hay candidata con palabras clave; hay que confirmarla a mano
  no encontrada -> el municipio no aparece en el Geoportal
"""

import csv
import sys
import re
import unicodedata

import pandas as pd


def norm(s) -> str:
    s = "" if pd.isna(s) else str(s)
    s = unicodedata.normalize("NFKD", s.upper())
    return "".join(c for c in s if not unicodedata.combining(c))


def num(s) -> float | None:
    try:
        return float(str(s).replace(",", "."))
    except ValueError:
        return None


def cargar_geoportal(ruta: str) -> pd.DataFrame:
    g = pd.read_excel(ruta, header=3, dtype=str)
    g.columns = [c.strip() for c in g.columns]
    g["_mun"] = g["Municipio"].map(norm)
    g["_loc"] = g["Localidad"].map(norm)
    g["_txt"] = (g["Rótulo"].map(norm) + " " + g["Dirección"].map(norm))
    return g


def limpiar_municipio(s: str) -> set[str]:
    """'EJIDO (EL)' -> {'EJIDO'}; 'VALENCIA / VALENCIA' -> {'VALENCIA'};
    'VANDELLOS I L'HOSPITALET...' se deja entero."""
    s = re.sub(r"\(.*?\)", "", s)
    return {p.strip() for p in s.split("/") if p.strip()}


def candidatas(g: pd.DataFrame, municipio: str) -> pd.DataFrame:
    m = norm(municipio)
    ok = lambda v: m in limpiar_municipio(v)
    return g[g["_mun"].map(ok) | g["_loc"].map(ok)]


def puntuar(texto: str, claves: list[str]) -> int:
    return sum(1 for k in claves if k in texto)


def main(precios_csv, geo_xls, *pistas_csvs):
    g = cargar_geoportal(geo_xls)
    precios = {r["estacion_codigo"]: r for r in csv.DictReader(open(precios_csv, encoding="utf-8"))}
    pistas = [r for f in pistas_csvs for r in csv.DictReader(open(f, encoding="utf-8"))]

    salida = []
    for p in pistas:
        cod = p["estacion_codigo"]
        nombre = precios.get(cod, {}).get("estacion_nombre", "")
        claves = norm(p["palabras_clave"]).split()
        c = candidatas(g, p["municipio"])
        fila = {"proveedor": precios.get(cod, {}).get("proveedor", ""),
                "estacion_codigo": cod, "estacion_nombre": nombre,
                "municipio_buscado": p["municipio"], "candidatas": len(c)}

        if c.empty:
            fila["confianza"] = "no encontrada"
        else:
            c = c.assign(_p=c["_txt"].map(lambda t: puntuar(t, claves)))
            c = c.sort_values("_p", ascending=False)
            mejor = c.iloc[0]
            empatadas = (c["_p"] == mejor["_p"]).sum()
            if mejor["_p"] == 0:
                fila["confianza"] = "revisar"
            elif empatadas == 1 and (len(c) == 1 or mejor["_p"] > c.iloc[1]["_p"]):
                fila["confianza"] = "alta" if mejor["_p"] >= 1 else "media"
            else:
                fila["confianza"] = "media"
            fila.update({
                "rotulo_geoportal": mejor["Rótulo"],
                "direccion": mejor["Dirección"],
                "municipio": mejor["Municipio"],
                "provincia": mejor["Provincia"],
                "latitud": num(mejor["Latitud"]),
                "longitud": num(mejor["Longitud"]),
                "precio_publico_gasoleo_a": num(mejor["Precio gasóleo A"]),
                "precio_adblue": num(mejor["Precio AdBlue"]),
                "horario": mejor["Horario"],
                "otras_candidatas": " | ".join(
                    f'{r["Rótulo"]} ({r["Dirección"]})' for _, r in c.iloc[1:4].iterrows()),
            })
            # Coordenadas fuera de España (p. ej. 0,0): dato erróneo del Geoportal
            if not (27 < (fila["latitud"] or 0) < 44.5 and -19 < (fila["longitud"] or 99) < 5):
                fila["confianza"] = "revisar"
            if fila["confianza"] == "revisar":
                # Sin coincidencia clara: no se da ubicación para que el
                # planificador nunca mande un camión a una estación dudosa.
                for k in ["rotulo_geoportal", "direccion", "latitud", "longitud",
                          "precio_publico_gasoleo_a", "precio_adblue", "horario"]:
                    fila[k] = None
                fila["otras_candidatas"] = " | ".join(
                    f'{r["Rótulo"]} ({r["Dirección"]})' for _, r in c.iloc[:5].iterrows())
        salida.append(fila)

    campos = ["proveedor", "estacion_codigo", "estacion_nombre", "confianza", "rotulo_geoportal",
              "direccion", "municipio", "provincia", "latitud", "longitud",
              "precio_publico_gasoleo_a", "precio_adblue", "horario",
              "municipio_buscado", "candidatas", "otras_candidatas"]
    with open("datos/estaciones.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=campos, extrasaction="ignore")
        w.writeheader()
        w.writerows(salida)

    for nivel in ["alta", "media", "revisar", "no encontrada"]:
        n = sum(1 for s in salida if s["confianza"] == nivel)
        print(f"{nivel:14s} {n}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
