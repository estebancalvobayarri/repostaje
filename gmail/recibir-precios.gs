/**
 * Repostaje en ruta · lector del buzón de precios (Google Apps Script)
 *
 * Cada 5 minutos busca en este Gmail SOLO los emails enviados a las direcciones
 * de reenvío de las empresas (buzon+alias@gmail.com), los manda a la app para
 * que lea los precios y los archiva en la etiqueta "Repostaje/<alias>".
 * No lee ni toca ningún otro email.
 *
 * Instalación:
 *   1. script.google.com → Nuevo proyecto → pega este archivo.
 *   2. Pon la clave en TOKEN (te la da el administrador de la app).
 *   3. Ejecuta "instalar" una vez y acepta los permisos.
 */
const API = 'https://sqtgnlfsydcecpxtumol.supabase.co/functions/v1/recibir-precios';
const TOKEN = 'PEGA_AQUI_LA_CLAVE';
const DIAS = 3;            // antigüedad máxima de los emails que se revisan
const MAX_INTENTOS = 3;    // si la app falla, se reintenta en las siguientes pasadas

function revisarPrecios() {
  const props = PropertiesService.getScriptProperties();
  const hechos = JSON.parse(props.getProperty('hechos') || '{}');   // id del mensaje -> intentos o 'ok'
  const { buzon, aliases } = llamar({ accion: 'alias' }).datos;
  const [local, dominio] = buzon.split('@');

  for (const alias of aliases) {
    const dir = `${local}+${alias}@${dominio}`;
    const hilos = GmailApp.search(`(to:${dir} OR deliveredto:${dir}) newer_than:${DIAS}d`, 0, 50);
    for (const hilo of hilos) {
      for (const m of hilo.getMessages()) {
        const id = m.getId();
        if (hechos[id] === 'ok' || (hechos[id] || 0) >= MAX_INTENTOS) continue;
        const destino = `${m.getTo()} ${m.getCc()} ${m.getHeader('Delivered-To') || ''}`.toLowerCase();
        if (!destino.includes(`+${alias}@`)) continue;
        if (Date.now() - m.getDate().getTime() > DIAS * 864e5) continue;

        const adjuntos = m.getAttachments({ includeInlineImages: false })
          .filter((a) => a.getSize() < 8 * 1024 * 1024)
          .map((a) => ({ nombre: a.getName(), tipo: a.getContentType(), base64: Utilities.base64Encode(a.getBytes()) }));
        const r = llamar({
          alias, remitente: m.getFrom(), asunto: m.getSubject(), fecha: m.getDate().toISOString(),
          texto: m.getPlainBody(), html: m.getBody(), adjuntos,
        });
        Logger.log(`${alias} · ${m.getSubject()} → ${r.codigo} ${JSON.stringify(r.datos)}`);
        if (r.codigo >= 500 || r.codigo === 0) hechos[id] = (hechos[id] || 0) + 1;   // se reintenta
        else { hechos[id] = 'ok'; hilo.addLabel(etiqueta(`Repostaje/${alias}`)); }
      }
    }
  }
  // Se recuerdan solo los últimos 1.000 mensajes
  const ids = Object.keys(hechos);
  if (ids.length > 1000) ids.slice(0, ids.length - 1000).forEach((k) => delete hechos[k]);
  props.setProperty('hechos', JSON.stringify(hechos));
}

function llamar(cuerpo) {
  try {
    const r = UrlFetchApp.fetch(API, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'x-ingesta-token': TOKEN }, payload: JSON.stringify(cuerpo),
    });
    let datos = {};
    try { datos = JSON.parse(r.getContentText()); } catch (e) { datos = { texto: r.getContentText().slice(0, 300) }; }
    if (cuerpo.accion === 'alias' && r.getResponseCode() !== 200) throw new Error('La app no responde: ' + r.getContentText());
    return { codigo: r.getResponseCode(), datos };
  } catch (e) {
    if (cuerpo.accion === 'alias') throw e;
    return { codigo: 0, datos: { error: String(e) } };
  }
}

function etiqueta(nombre) {
  return GmailApp.getUserLabelByName(nombre) || GmailApp.createLabel(nombre);
}

/** Ejecutar una vez: programa la revisión cada 5 minutos y hace la primera. */
function instalar() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === 'revisarPrecios').forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('revisarPrecios').timeBased().everyMinutes(5).create();
  revisarPrecios();
}

/** Para dejar de revisar el buzón. */
function desinstalar() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
}
