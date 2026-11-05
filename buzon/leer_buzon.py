"""
Fuelfy · lector del buzón de precios (fuelfy@fuelfy.app, Hostinger)

Lo ejecuta GitHub Actions cada 5 minutos. Entra por IMAP en el buzón, y por cada
email de la bandeja de entrada:
  1. averigua de qué empresa es por la dirección a la que se envió
     (precios-<alias>@fuelfy.app, que llega gracias al catch-all de Hostinger),
  2. manda texto, HTML y PDFs adjuntos a la app (función recibir-precios),
  3. lo mueve a la carpeta «Procesados» (o «Sin empresa» si no es de ninguna).
Si la app no responde, el email se queda en la bandeja y se reintenta en la siguiente pasada.

Variables de entorno (secretos de GitHub): IMAP_PASSWORD, INGESTA_TOKEN.
Opcionales: IMAP_HOST, IMAP_USER, API, DOMINIO.
Solo usa la biblioteca estándar de Python.
"""
import base64
import email
import email.policy
import imaplib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from email.utils import getaddresses, parsedate_to_datetime

IMAP_HOST = os.environ.get('IMAP_HOST', 'imap.hostinger.com')
IMAP_USER = os.environ.get('IMAP_USER', 'fuelfy@fuelfy.app')
API = os.environ.get('API', 'https://sqtgnlfsydcecpxtumol.supabase.co/functions/v1/recibir-precios')
DOMINIO = os.environ.get('DOMINIO', 'fuelfy.app')
MAX_ADJUNTO = 8 * 1024 * 1024
CABECERAS_DESTINO = ['Delivered-To', 'X-Original-To', 'Envelope-To', 'X-Envelope-To', 'X-Forwarded-To',
                     'X-Forwarded-For', 'X-Rcpt-To', 'To', 'Cc', 'Received']


def llamar(cuerpo, token):
    req = urllib.request.Request(API, data=json.dumps(cuerpo).encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'x-ingesta-token': token})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode() or '{}')
    except urllib.error.HTTPError as e:
        try:
            datos = json.loads(e.read().decode() or '{}')
        except ValueError:
            datos = {}
        return e.code, datos
    except (urllib.error.URLError, TimeoutError) as e:
        return 0, {'error': str(e)}


def alias_del_email(msg, aliases):
    """Busca en las cabeceras de destino una dirección precios-<alias>@dominio de una empresa conocida."""
    patron = re.compile(r'precios-([a-z0-9_-]+)@' + re.escape(DOMINIO), re.I)
    for cab in CABECERAS_DESTINO:
        for valor in msg.get_all(cab, []) or []:
            for m in patron.finditer(str(valor)):
                a = m.group(1).lower()
                if a in aliases:
                    return a
    return None


def contenido(msg):
    """Texto, HTML y adjuntos (PDF y similares). Incluye el contenido de emails reenviados como adjunto."""
    textos, htmls, adjuntos = [], [], []

    def recorrer(parte):
        if parte.get_content_type() == 'message/rfc822':
            for sub in parte.iter_parts():
                recorrer(sub)
            return
        if parte.is_multipart():
            for sub in parte.iter_parts():
                recorrer(sub)
            return
        tipo = parte.get_content_type()
        nombre = parte.get_filename()
        if nombre or parte.get_content_disposition() == 'attachment':
            datos = parte.get_payload(decode=True) or b''
            if datos and len(datos) < MAX_ADJUNTO:
                adjuntos.append({'nombre': nombre or 'adjunto', 'tipo': tipo, 'base64': base64.b64encode(datos).decode()})
            return
        if tipo == 'text/plain':
            textos.append(parte.get_content())
        elif tipo == 'text/html':
            htmls.append(parte.get_content())

    recorrer(msg)
    return '\n\n'.join(textos), '\n'.join(htmls), adjuntos


def carpeta(imap, nombre):
    """Nombre real de la carpeta (Hostinger suele usar INBOX.<nombre>); la crea si no existe."""
    _, lista = imap.list()
    sep = '.'
    for linea in lista or []:
        m = re.search(rb'\(.*?\) "(.)" ', linea)
        if m:
            sep = m.group(1).decode()
            break
    for candidato in (f'INBOX{sep}{nombre}', nombre):
        if imap.select(f'"{candidato}"', readonly=True)[0] == 'OK':
            return candidato
    for candidato in (f'INBOX{sep}{nombre}', nombre):
        if imap.create(f'"{candidato}"')[0] == 'OK':
            return candidato
    raise RuntimeError(f'No se ha podido crear la carpeta {nombre}')


def mover(imap, uid, destino, tiene_move):
    if tiene_move:
        imap.uid('MOVE', uid, f'"{destino}"')
    else:
        imap.uid('COPY', uid, f'"{destino}"')
        imap.uid('STORE', uid, '+FLAGS', r'(\Deleted)')


def main():
    password, token = os.environ.get('IMAP_PASSWORD'), os.environ.get('INGESTA_TOKEN')
    if not password or not token:
        # Hasta que se guarden los secretos en GitHub no hay nada que hacer (y no se marca como fallo)
        print('Faltan los secretos IMAP_PASSWORD o INGESTA_TOKEN: no se lee el buzón.')
        return

    codigo, datos = llamar({'accion': 'alias'}, token)
    if codigo != 200:
        sys.exit(f'La app no responde ({codigo}): {datos}')
    aliases = {a.lower() for a in datos.get('aliases', [])}

    imap = imaplib.IMAP4_SSL(IMAP_HOST, 993)
    imap.login(IMAP_USER, password)
    tiene_move = 'MOVE' in (imap.capabilities or ())
    procesados, sin_empresa = carpeta(imap, 'Procesados'), carpeta(imap, 'Sin empresa')
    # Diagnóstico: carpetas del buzón y cuántos emails tiene cada una
    _, lista = imap.list()
    for linea in lista or []:
        nombre = linea.decode(errors='replace').rsplit(' ', 1)[-1].strip('"')
        st, n = imap.status(f'"{nombre}"', '(MESSAGES)')
        print(f'  carpeta {nombre}: {n[0].decode(errors="replace") if st == "OK" else "?"}')
    imap.select('INBOX')
    _, uids = imap.uid('SEARCH', None, 'ALL')
    uids = (uids[0] or b'').split()
    print(f'{len(uids)} email(s) en la bandeja de entrada')

    resumen = {'ok': 0, 'sin_empresa': 0, 'reintentar': 0}
    for uid in uids:
        _, partes = imap.uid('FETCH', uid, '(BODY.PEEK[])')
        crudo = next((p[1] for p in partes if isinstance(p, tuple)), None)
        if not crudo:
            continue
        msg = email.message_from_bytes(crudo, policy=email.policy.default)
        asunto = str(msg.get('Subject', ''))
        alias = alias_del_email(msg, aliases)
        if not alias:
            print(f'  · Sin empresa: «{asunto[:80]}» → carpeta Sin empresa')
            mover(imap, uid, sin_empresa, tiene_move)
            resumen['sin_empresa'] += 1
            continue
        texto, html, adjuntos = contenido(msg)
        try:
            fecha = parsedate_to_datetime(msg['Date']).isoformat() if msg['Date'] else None
        except (TypeError, ValueError):
            fecha = None
        codigo, datos = llamar({'alias': alias, 'remitente': str(msg.get('From', '')), 'asunto': asunto, 'fecha': fecha,
                                'texto': texto, 'html': html, 'adjuntos': adjuntos}, token)
        if codigo == 0 or codigo >= 500:
            print(f'  · {alias}: «{asunto[:80]}» → la app no responde ({codigo}); se reintentará')
            resumen['reintentar'] += 1
            continue
        print(f'  · {alias}: «{asunto[:80]}» → {codigo} {json.dumps(datos, ensure_ascii=False)[:300]}')
        mover(imap, uid, procesados, tiene_move)
        resumen['ok'] += 1

    imap.expunge()
    imap.logout()
    print('Resumen:', resumen)


if __name__ == '__main__':
    main()
