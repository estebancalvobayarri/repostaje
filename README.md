# Repostaje

Herramienta para flotas pequeñas y medianas de transporte: reúne los precios
que cada emisor de tarjetas de combustible envía a la empresa (por email o PDF),
los sitúa en el mapa y ayuda al gestor a decidir en qué parada conviene repostar
según la ruta y el combustible que le queda a cada camión.

## Qué hay

| Carpeta / archivo | Para qué sirve |
| --- | --- |
| `src/lector_precios.py` | Lee los PDF de precios de cada proveedor (hoy: Valcarce y DST) y los pasa a un formato común |
| `src/cruce_geoportal.py` | Sitúa cada estación cruzándola con el listado del Geoportal del Ministerio |
| `src/planificador.py` | Prototipo: estaciones cerca de una ruta y coste de repostar en cada una, con el desvío |
| `src/generar_mapa.py` | Genera el mapa web con precios, estaciones y camiones |
| `web/plantilla.html` | La página del mapa (sin datos) |
| `config/camiones.ejemplo.csv` | Formato de la lista de camiones: matrícula, capacidad y consumo |

## Datos privados

El repositorio es público. Los datos reales van en la carpeta `datos/`, que
está excluida y nunca se sube:

```
datos/
  muestras/          PDF de precios recibidos y geoportal.xls del Ministerio
  camiones.csv       la flota real (mismo formato que config/camiones.ejemplo.csv)
  pistas_*.csv       municipio y palabras clave de cada estación de cada proveedor
  estaciones_manual.csv  ubicaciones confirmadas a mano
```

## Uso

Desde la raíz del repositorio:

```
python3 src/lector_precios.py datos/muestras/*.pdf
python3 src/cruce_geoportal.py datos/precios.csv datos/muestras/geoportal.xls datos/pistas_valcarce.csv datos/pistas_dst.csv
python3 src/generar_mapa.py          # crea web/mapa.html
```

Necesita Python 3.10+, `pandas`, `xlrd` y `pdftotext` (poppler-utils).
