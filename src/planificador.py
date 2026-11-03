"""
Planificador de repostaje (prototipo).

Para una ruta, busca las estaciones de las tarjetas de la empresa que
quedan cerca del recorrido y calcula el coste real de repostar en cada una,
sumando el combustible gastado en el desvío.

Uso:
    python3 planificador.py

Limitaciones de este prototipo:
- La ruta se describe con puntos de paso (autopistas habituales), no con un
  navegador real. La distancia de desvío es una estimación: distancia en
  línea recta a la ruta x 2 (ida y vuelta) x 1,3 (factor de carretera).
- Solo usa estaciones con ubicación confirmada (confianza alta o media).
"""

import csv
import math

LITROS_A_REPOSTAR = 600       # litros por repostaje
CONSUMO_L_100KM = 35          # consumo de un camión articulado
DESVIO_MAX_KM = 15            # distancia máxima en línea recta a la ruta
FACTOR_CARRETERA = 1.3

RUTAS = {
    "Puerto de Valencia → El Prat de Llobregat (AP-7)": [
        # Google Maps: 345 km, 3 h 35 min
        ("Puerto de Valencia", 39.445, -0.317),
        ("Sagunto", 39.680, -0.270),
        ("Castellón", 39.990, -0.080),
        ("Benicarló", 40.420, 0.420),
        ("L'Ametlla de Mar", 40.880, 0.800),
        ("L'Hospitalet de l'Infant", 40.990, 0.920),
        ("Tarragona", 41.130, 1.200),
        ("El Vendrell", 41.220, 1.530),
        ("Sitges", 41.240, 1.800),
        ("Castelldefels", 41.280, 1.980),
        ("El Prat de Llobregat", 41.320, 2.095),
    ],
    "Riba-roja de Túria → Cartagena (A-7 / A-35 / A-33 / A-30)": [
        # Recorrido que propone Google Maps (279 km, 2 h 42 min)
        ("Riba-roja de Túria", 39.544, -0.571),
        ("Torrent", 39.420, -0.500),
        ("Alginet", 39.260, -0.470),
        ("Xàtiva", 39.000, -0.520),
        ("Moixent (A-35)", 38.895, -0.725),
        ("Almansa", 38.870, -1.100),
        ("Yecla", 38.610, -1.120),
        ("Jumilla", 38.470, -1.330),
        ("Molina de Segura", 38.050, -1.210),
        ("Murcia", 37.990, -1.130),
        ("Cartagena", 37.625, -0.997),
    ],
}


def km(a, b):
    """Distancia en km entre dos puntos (lat, lon)."""
    la1, lo1, la2, lo2 = map(math.radians, [a[0], a[1], b[0], b[1]])
    h = (math.sin((la2 - la1) / 2) ** 2 +
         math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2)
    return 2 * 6371 * math.asin(math.sqrt(h))


def a_xy(p, ref):
    """Proyección local plana en km alrededor de ref."""
    x = (p[1] - ref[1]) * 111.32 * math.cos(math.radians(ref[0]))
    y = (p[0] - ref[0]) * 110.57
    return x, y


def posicion_en_ruta(punto, ruta):
    """Devuelve (km recorridos hasta el punto más cercano, distancia a la ruta)."""
    mejor = None
    recorrido = 0.0
    for (_, *a), (_, *b) in zip(ruta, ruta[1:]):
        ax, ay = 0.0, 0.0
        bx, by = a_xy(b, a)
        px, py = a_xy(punto, a)
        largo2 = bx * bx + by * by
        t = max(0.0, min(1.0, (px * bx + py * by) / largo2))
        cx, cy = t * bx, t * by
        dist = math.hypot(px - cx, py - cy)
        tramo = math.sqrt(largo2)
        if mejor is None or dist < mejor[1]:
            mejor = (recorrido + t * tramo, dist)
        recorrido += tramo
    return mejor[0], mejor[1], recorrido


def cargar_estaciones():
    precios = {r["estacion_codigo"]: r for r in csv.DictReader(open("datos/precios.csv", encoding="utf-8"))}
    # Ubicaciones confirmadas a mano (p. ej. con Google Maps) mandan sobre el cruce automático
    manual = {r["estacion_codigo"]: r for r in csv.DictReader(open("datos/estaciones_manual.csv", encoding="utf-8"))}
    estaciones = []
    for e in csv.DictReader(open("datos/estaciones.csv", encoding="utf-8")):
        if e["estacion_codigo"] in manual:
            m = manual[e["estacion_codigo"]]
            e.update(latitud=m["latitud"], longitud=m["longitud"], direccion=m["direccion"], confianza="media")
        if e["confianza"] not in ("alta", "media") or not e["latitud"]:
            continue
        p = precios[e["estacion_codigo"]]
        estaciones.append({
            "proveedor": e["proveedor"],
            "nombre": e["estacion_nombre"],
            "direccion": e["direccion"],
            "confianza": e["confianza"],
            "lat": float(e["latitud"]),
            "lon": float(e["longitud"]),
            "precio": float(p["precio_sin_iva"]),
        })
    return estaciones


def planificar(nombre_ruta, ruta, estaciones):
    filas = []
    total = None
    for e in estaciones:
        pk, dist, total = posicion_en_ruta((e["lat"], e["lon"]), ruta)
        if dist > DESVIO_MAX_KM:
            continue
        # Áreas de autopista con un solo sentido: descartar la del sentido contrario
        hacia_norte = ruta[-1][1] > ruta[0][1]
        nombre = e["nombre"].upper()
        if (hacia_norte and nombre.endswith(" SUR")) or (not hacia_norte and nombre.endswith(" NORTE")):
            continue
        desvio_km = dist * 2 * FACTOR_CARRETERA
        coste_desvio = desvio_km * CONSUMO_L_100KM / 100 * e["precio"]
        coste = LITROS_A_REPOSTAR * e["precio"] + coste_desvio
        filas.append({**e, "pk": pk, "desvio_km": desvio_km,
                      "coste_desvio": coste_desvio, "coste_total": coste})

    filas.sort(key=lambda f: f["coste_total"])
    print(f"\n=== {nombre_ruta} — {total:.0f} km aprox. ===")
    if not filas:
        print("  Ninguna estación de las tarjetas cerca de la ruta.")
        return filas
    mejor = filas[0]["coste_total"]
    for f in filas:
        print(f"  km {f['pk']:4.0f} | {f['proveedor']:8s} | {f['nombre']:42s} | "
              f"{f['precio']:.3f} €/l | desvío {f['desvio_km']:4.1f} km "
              f"({f['coste_desvio']:4.1f} €) | total {f['coste_total']:7.2f} € | "
              f"+{f['coste_total'] - mejor:5.2f} € vs mejor")
    return filas


def main():
    estaciones = cargar_estaciones()
    salida = []
    for nombre, ruta in RUTAS.items():
        for f in planificar(nombre, ruta, estaciones):
            salida.append({"ruta": nombre, **{k: (round(v, 3) if isinstance(v, float) else v)
                                              for k, v in f.items()}})
    with open("datos/recomendaciones.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(salida[0].keys()))
        w.writeheader()
        w.writerows(salida)


if __name__ == "__main__":
    main()
