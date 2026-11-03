"""
Lector de precios de proveedores de combustible.

Lee los PDF de precios que envían los proveedores y los convierte a un
formato común (CSV), para poder compararlos entre sí y con la ruta.

Uso:
    python3 src/lector_precios.py datos/muestras/*.pdf
    -> genera datos/precios.csv con todas las estaciones de todos los PDF

Cada proveedor tiene su propio formato, así que hay un "lector" por
proveedor. Para añadir uno nuevo: escribir una función leer_<proveedor>()
y registrarla en LECTORES con un texto que lo identifique.
"""

import csv
import re
import subprocess
import unicodedata
import sys
from dataclasses import dataclass, asdict, fields
from datetime import datetime


@dataclass
class Precio:
    proveedor: str
    cliente_codigo: str
    cliente_nombre: str
    fecha: str            # AAAA-MM-DD, día en que se aplica el precio
    estacion_codigo: str
    estacion_nombre: str
    precio_sin_iva: float  # €/litro, el coste real para la empresa
    precio_con_iva: float  # €/litro
    archivo: str


def texto_pdf(ruta: str) -> str:
    """Extrae el texto del PDF respetando columnas."""
    return subprocess.run(
        ["pdftotext", "-layout", ruta, "-"],
        capture_output=True, text=True, check=True,
    ).stdout


def sin_acentos(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))


def numero(texto: str) -> float:
    """'1,234' -> 1.234"""
    return float(texto.replace(".", "").replace(",", "."))


# ---------------------------------------------------------------------------
# Proveedor: Valcarce Tarjeta Transporte
# ---------------------------------------------------------------------------

LINEA_ESTACION_VALCARCE = re.compile(
    r"^\s*(\d{6})\s+(.+?)\s+(\d+,\d{3})\s+(\d+,\d{3})\s*$"
)


def leer_valcarce(texto: str, archivo: str) -> list[Precio]:
    fecha = re.search(r"Precios de compra:\s*(\d{2}/\d{2}/\d{4})", texto)
    cliente = re.search(r"^\s*(\d+)\s+-\s+(.+?)\s*$", texto, re.MULTILINE)
    if not fecha or not cliente:
        raise ValueError(f"{archivo}: no encuentro la fecha o el cliente")

    fecha_iso = datetime.strptime(fecha.group(1), "%d/%m/%Y").date().isoformat()
    precios = []
    for linea in texto.splitlines():
        m = LINEA_ESTACION_VALCARCE.match(linea)
        if not m:
            continue
        codigo, nombre, sin_iva, con_iva = m.groups()
        precios.append(Precio(
            proveedor="Valcarce",
            cliente_codigo=cliente.group(1),
            cliente_nombre=cliente.group(2),
            fecha=fecha_iso,
            estacion_codigo=codigo,
            estacion_nombre=re.sub(r"\s{2,}", " ", nombre).strip(),
            precio_sin_iva=numero(sin_iva),
            precio_con_iva=numero(con_iva),
            archivo=archivo,
        ))
    return precios


# ---------------------------------------------------------------------------
# Proveedor: DST Fuel Card (email con tabla, puede llegar reenviado)
# ---------------------------------------------------------------------------

LINEA_ESTACION_DST = re.compile(
    r"^\s*(\S.+?)\s{2,}(\d+,\d{3})\s*€\s+(\d+,\d{3})\s*€\s*$"
)


def leer_dst(texto: str, archivo: str) -> list[Precio]:
    fecha = re.search(r"Fecha entrada en vigor GAS[ÓO]LEO A:\s*(\d{2}/\d{2}/\d{4})", texto)
    if not fecha:
        raise ValueError(f"{archivo}: no encuentro la fecha de entrada en vigor")
    fecha_iso = datetime.strptime(fecha.group(1), "%d/%m/%Y").date().isoformat()
    # El email no trae código de cliente; el destinatario sirve de referencia
    cliente = re.search(r"De: hola@dstfuelcard\.eu.*?Para:\s*(\S+@\S+)", texto, re.S)

    precios = []
    for linea in texto.splitlines():
        m = LINEA_ESTACION_DST.match(linea)
        if not m:
            continue
        nombre, sin_iva, con_iva = m.groups()
        nombre = re.sub(r"\s{2,}", " ", nombre).strip()
        precios.append(Precio(
            proveedor="DST",
            cliente_codigo="",
            cliente_nombre=cliente.group(1).lower() if cliente else "",
            fecha=fecha_iso,
            # Sin código propio: se usa el nombre normalizado como identificador
            estacion_codigo="DST-" + re.sub(r"[^A-Z0-9]+", "-", sin_acentos(nombre.upper())).strip("-"),
            estacion_nombre=nombre,
            precio_sin_iva=numero(sin_iva),
            precio_con_iva=numero(con_iva),
            archivo=archivo,
        ))
    return precios


# Texto que identifica a cada proveedor -> función que lo lee
LECTORES = {
    "VALCARCE TARJETA TRANSPORTE": leer_valcarce,
    "DSTFUELCARD.EU": leer_dst,
}


def leer_pdf(ruta: str) -> list[Precio]:
    texto = texto_pdf(ruta)
    for marca, lector in LECTORES.items():
        if marca in texto.upper():
            precios = lector(texto, ruta)
            comprobar(precios, ruta)
            return precios
    raise ValueError(f"{ruta}: proveedor no reconocido todavía")


def comprobar(precios: list[Precio], ruta: str) -> None:
    """Avisos para revisar a mano si algo no cuadra."""
    if not precios:
        print(f"AVISO {ruta}: no se ha leído ninguna estación", file=sys.stderr)
    for p in precios:
        if not 0.5 < p.precio_sin_iva < 3:
            print(f"AVISO {p.estacion_codigo}: precio raro {p.precio_sin_iva}",
                  file=sys.stderr)
        # El precio con IVA debe ser aprox. el sin IVA x 1,21
        if abs(p.precio_sin_iva * 1.21 - p.precio_con_iva) > 0.005:
            print(f"AVISO {p.estacion_codigo}: el IVA no cuadra "
                  f"({p.precio_sin_iva} -> {p.precio_con_iva})", file=sys.stderr)


def guardar_csv(precios: list[Precio], ruta: str) -> None:
    with open(ruta, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=[c.name for c in fields(Precio)])
        w.writeheader()
        for p in precios:
            w.writerow(asdict(p))


def main(rutas: list[str]) -> None:
    todos = []
    for ruta in rutas:
        precios = leer_pdf(ruta)
        print(f"{ruta}: {len(precios)} estaciones de {precios[0].proveedor} "
              f"para el {precios[0].fecha}")
        todos.extend(precios)

    guardar_csv(todos, "datos/precios.csv")

    todos.sort(key=lambda p: p.precio_sin_iva)
    print("\nMás baratas (sin IVA):")
    for p in todos[:5]:
        print(f"  {p.precio_sin_iva:.3f}  {p.estacion_nombre} ({p.proveedor})")
    print("Más caras (sin IVA):")
    for p in todos[-3:]:
        print(f"  {p.precio_sin_iva:.3f}  {p.estacion_nombre} ({p.proveedor})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
