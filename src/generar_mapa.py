"""
Genera web/mapa.html con los precios, estaciones y camiones actuales.

Uso (desde la raíz del repositorio):
    python3 src/generar_mapa.py

Lee:  datos/precios.csv, datos/estaciones.csv, datos/estaciones_manual.csv,
      datos/camiones.csv (si no existe, usa config/camiones.ejemplo.csv),
      datos/muestras/geoportal.xls (fondo del mapa)
Crea: web/mapa.html  (mapa estático, solo para uso interno)

La webapp publicada (docs/) ya no usa archivos: lee los precios de Supabase.
"""
import csv
import json
import os

import pandas as pd


PAGINA = """<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0;font:14px system-ui}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
</head>
<body>
{html}
</body>
</html>
"""


def leer(ruta):
    return list(csv.DictReader(open(ruta, encoding="utf-8")))


def num(s):
    return float(str(s).replace(",", "."))


def fondo(ruta_geo):
    g = pd.read_excel(ruta_geo, header=3, dtype=str)
    g.columns = [c.strip() for c in g.columns]
    puntos = []
    for la, lo in zip(g["Latitud"], g["Longitud"]):
        try:
            la, lo = num(la), num(lo)
        except ValueError:
            continue
        if 35.8 < la < 44 and -9.6 < lo < 4.5:  # península y Baleares
            puntos.append([round(lo, 3), round(la, 3)])
    return puntos


def main():
    precios = {r["estacion_codigo"]: r for r in leer("datos/precios.csv")}
    manual = {r["estacion_codigo"]: r for r in leer("datos/estaciones_manual.csv")} \
        if os.path.exists("datos/estaciones_manual.csv") else {}
    est, sin = [], []
    for e in leer("datos/estaciones.csv"):
        p = precios[e["estacion_codigo"]]
        if e["estacion_codigo"] in manual:
            m = manual[e["estacion_codigo"]]
            e.update(latitud=m["latitud"], longitud=m["longitud"], direccion=m["direccion"], confianza="media")
        d = {"id": e["estacion_codigo"], "n": e["estacion_nombre"], "t": e["proveedor"],
             "p": float(p["precio_sin_iva"]), "pi": float(p["precio_con_iva"])}
        if e["confianza"] in ("alta", "media") and e["latitud"]:
            d.update(lat=round(float(e["latitud"]), 5), lon=round(float(e["longitud"]), 5),
                     dir=e["direccion"].title(), mun=e["municipio"].title(),
                     prov=e["provincia"].title(), c=e["confianza"])
            est.append(d)
        else:
            sin.append(d)

    ruta_cam = "datos/camiones.csv" if os.path.exists("datos/camiones.csv") else "config/camiones.ejemplo.csv"
    camiones = [{"m": c["matricula"], "d": c["descripcion"], "cap": int(c["capacidad_litros"]),
                 "con": float(c["consumo_l_100km"])} for c in leer(ruta_cam)]

    datos = {"bg": fondo("datos/muestras/geoportal.xls"), "est": est, "sin": sin,
             "camiones": camiones, "fecha": next(iter(precios.values()))["fecha"]}
    html = open("web/plantilla.html", encoding="utf-8").read()
    html = html.replace("__DATA__", json.dumps(datos, ensure_ascii=False, separators=(",", ":")))
    open("web/mapa.html", "w", encoding="utf-8").write(html)
    print(f"web/mapa.html: {len(est)} estaciones en el mapa, {len(sin)} sin ubicación, "
          f"{len(camiones)} camiones ({ruta_cam})")


if __name__ == "__main__":
    main()
