# Genera los textos legales de Fuelfy en docs/legal/. Los datos que faltan van marcados.
import os
import pathlib
OUT = str(pathlib.Path(__file__).resolve().parent.parent / 'docs' / 'legal')
F = lambda k, t: f'<mark class="falta" data-dato="{k}">[{t}]</mark>'
# Datos del titular (5/11/2026)
TIT, NIF, DOM = 'Esteban Calvo Bayarri', '24394566F', 'Calle Quart 120, 46008 Valencia (España)'
EMAIL = '<a href="mailto:hola@fuelfy.app">hola@fuelfy.app</a>'
FECHA = '6 de noviembre de 2026'
VERSION = '1.0'
LOGO = '<svg width="34" height="28" viewBox="0 0 120 100" aria-hidden="true"><defs><clipPath id="lg"><rect x="19" y="18" width="26" height="24" rx="6"/></clipPath></defs><rect x="10" y="8" width="44" height="80" rx="11" fill="#FFFFFF"/><rect x="19" y="18" width="26" height="24" rx="6" fill="#12263F"/><rect x="19" y="31" width="26" height="11" fill="#F2A900" clip-path="url(#lg)"/><path d="M54 30C76 30 84 42 80 56" fill="none" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="round"/><path d="M80 56C76 70 86 84 102 85" fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="0.5 9"/><circle cx="109" cy="85" r="7.5" fill="#F2A900"/></svg>'
PAGINAS = [('aviso-legal.html', 'Aviso legal'), ('privacidad.html', 'Privacidad y cookies'), ('condiciones.html', 'Condiciones de uso y contratación')]

def pagina(archivo, titulo, cuerpo, descripcion, version=VERSION, fecha=FECHA):
    nav = ''.join(f'<li><a href="{a}"{" aria-current=\"page\"" if a == archivo else ""}>{t}</a></li>' for a, t in PAGINAS)
    return f'''<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{titulo} · Fuelfy</title>
<meta name="description" content="{descripcion}">
<link rel="icon" href="../iconos/icono-192.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap">
<link rel="stylesheet" href="legal.css">
</head>
<body>
<header class="cab"><div class="cab-in">
  <a href="../" aria-label="Fuelfy, volver a la app">{LOGO}<span class="wm">fuelfy<i>.</i></span></a>
  <a class="volver" href="../">Volver a Fuelfy</a>
</div></header>
<nav class="textos" aria-label="Textos legales"><ul>{nav}</ul></nav>
<main><article>
<h1>{titulo}</h1>
<p class="fecha">Versión {version} · Última actualización: {fecha}</p>
{cuerpo}
</article></main>
<footer>Fuelfy · Repostaje inteligente para flotas · {TIT}</footer>
</body>
</html>
'''

aviso = f'''
<h2>1. Titular de la web</h2>
<p>En cumplimiento de la Ley 34/2002, de servicios de la sociedad de la información y de comercio electrónico (LSSI), estos son los datos del titular de Fuelfy (fuelfy.app):</p>
<ul>
  <li><b>Titular:</b> {TIT}</li>
  <li><b>NIF:</b> {NIF}</li>
  <li><b>Domicilio:</b> {DOM}</li>
  <li><b>Email:</b> {EMAIL}</li>
</ul>

<h2>2. Qué es Fuelfy</h2>
<p>Fuelfy es una aplicación web para empresas de transporte por carretera. Lee los precios del gasóleo que cada empresa recibe de sus tarjetas de carburante, los muestra en un mapa y ayuda al gestor de flota a elegir dónde repostar en cada ruta. Es un servicio para empresas y profesionales, no para consumidores.</p>

<h2>3. Uso de la web</h2>
<p>Para usar la aplicación hace falta un usuario que da de alta el titular o el gestor de cada empresa. Quien entra se compromete a usarla de forma lícita, a no intentar acceder a datos de otras empresas, a no sobrecargar ni dañar el servicio y a guardar en secreto su contraseña. La contratación del servicio se rige por las <a href="condiciones.html">Condiciones de uso y contratación</a>.</p>

<h2>4. Propiedad intelectual</h2>
<p>La marca Fuelfy, su logotipo, el diseño de la aplicación y su código pertenecen al titular. No se pueden copiar, modificar ni distribuir sin su permiso. Los mapas son de © colaboradores de OpenStreetMap; los nombres y precios de las estaciones proceden de los emails de los proveedores de cada empresa y de datos públicos del Ministerio para la Transición Ecológica.</p>

<h2>5. Enlaces a otros servicios</h2>
<p>La aplicación abre servicios de terceros, como Google Maps para ver una estación o una ruta, y WhatsApp para que el gestor envíe la ruta a su conductor. Esos servicios tienen sus propias condiciones y políticas de privacidad, de las que Fuelfy no es responsable.</p>

<h2>6. Responsabilidad</h2>
<p>El titular procura que la web funcione sin interrupciones y que la información sea correcta, pero no puede garantizarlo en todo momento. Los precios, rutas, distancias, tiempos y ahorros que muestra la aplicación son orientativos: dependen de la información que envían los proveedores y de servicios de rutas de terceros, y son una aproximación teórica. La decisión final sobre dónde repostar es siempre de la empresa usuaria.</p>

<h2>7. Ley aplicable</h2>
<p>Esta web se rige por la ley española. Para cualquier conflicto, y salvo que la ley disponga otra cosa, las partes se someten a los juzgados y tribunales del domicilio del titular.</p>
'''

privacidad = f'''
<div class="resumen">
<p><b>En resumen:</b> Fuelfy solo trata los datos necesarios para que las empresas de transporte usen el servicio. No vende datos, no muestra publicidad y no usa cookies de análisis ni de publicidad. La base de datos está en la Unión Europea (Fráncfort, Alemania) y los cobros los gestiona Stripe.</p>
</div>

<h2>1. Quién es el responsable</h2>
<p>{TIT}, con NIF {NIF} y domicilio en {DOM}. Para cualquier cuestión sobre tus datos puedes escribir a {EMAIL}.</p>
<p>Fuelfy trata datos en dos papeles distintos:</p>
<ul>
  <li><b>Como responsable</b>, de los datos de contacto y facturación de las empresas clientes y de sus gestores, para gestionar la relación comercial.</li>
  <li><b>Como encargado del tratamiento</b>, de los datos que cada empresa introduce en la aplicación (sus usuarios, camiones, rutas y los emails de precios que reenvía). En ese caso la responsable es la empresa cliente, y Fuelfy solo los trata siguiendo sus instrucciones, según el <a href="condiciones.html#encargo">Anexo de encargo del tratamiento</a>.</li>
</ul>

<h2>2. Qué datos se tratan</h2>
<div class="tabla"><table>
<thead><tr><th>Datos</th><th>Ejemplos</th><th>De dónde salen</th></tr></thead>
<tbody>
<tr><td>Cuenta de usuario</td><td>Email, nombre, rol (gestor o conductor), fecha del último acceso</td><td>Los da de alta el titular o el gestor de la empresa</td></tr>
<tr><td>Empresa y facturación</td><td>Razón social, CIF, dirección fiscal, email para las facturas, forma de pago, camiones dados de alta y de baja, importes, facturas y cobros</td><td>La empresa cliente; las facturas y los cobros, Stripe</td></tr>
<tr><td>Flota</td><td>Matrícula, descripción, capacidad del depósito y consumo de cada camión</td><td>El gestor, en la pestaña Flota</td></tr>
<tr><td>Rutas enviadas</td><td>Origen, destino, kilómetros, estación elegida, litros, precio, ahorro estimado y el usuario que la envió</td><td>Se guardan al pulsar «Enviar por WhatsApp»</td></tr>
<tr><td>Emails de precios</td><td>El contenido de los emails que la empresa reenvía desde sus proveedores, que puede incluir nombres, firmas y teléfonos de quien los envía</td><td>Los reenvíos de la empresa a su dirección de Fuelfy</td></tr>
<tr><td>Solicitudes de prueba</td><td>Nombre, empresa, email, teléfono, número de camiones, tarjetas que usa y el mensaje que escriba</td><td>El formulario de prueba de la web</td></tr>
<tr><td>Datos técnicos</td><td>Sesión iniciada y preferencias guardadas en el navegador</td><td>El propio navegador</td></tr>
</tbody></table></div>
<p>Fuelfy no pide ni trata datos especialmente protegidos, ni la ubicación en tiempo real de los camiones. El mensaje de WhatsApp lo envía el gestor desde su propio teléfono u ordenador: Fuelfy prepara el texto pero no lo envía ni lo lee.</p>

<h2>3. Para qué y con qué base legal</h2>
<ul>
  <li><b>Prestar el servicio</b> (mostrar precios, calcular rutas, guardar envíos e informes de ahorro): ejecución del contrato con la empresa cliente (art. 6.1.b del RGPD).</li>
  <li><b>Facturar y cobrar</b> (con Stripe) y <b>cumplir obligaciones fiscales y contables</b>: ejecución del contrato y obligación legal (art. 6.1.b y 6.1.c).</li>
  <li><b>Responder a las solicitudes de prueba</b> y dar de alta a la empresa: medidas precontractuales a petición de quien la envía (art. 6.1.b).</li>
  <li><b>Mantener la seguridad</b> del servicio y evitar accesos indebidos: interés legítimo (art. 6.1.f).</li>
  <li><b>Avisos del servicio</b> (invitaciones, recuperación de contraseña, fin del periodo de prueba): ejecución del contrato.</li>
</ul>
<p>No se toman decisiones automatizadas con efectos jurídicos sobre las personas ni se elaboran perfiles.</p>

<h2>4. Cuánto tiempo se guardan</h2>
<ul>
  <li>Los datos de la aplicación, incluidos los emails de precios guardados en el buzón de Fuelfy, mientras la empresa siga siendo cliente. Al darse de baja se borran en un plazo de 30 días, después de darle la opción de descargar sus rutas.</li>
  <li>Las solicitudes de prueba que no acaban en alta, un año como máximo.</li>
  <li>El historial de altas y bajas de camiones, 6 meses.</li>
  <li>Las facturas y los datos de facturación, el tiempo que exigen las leyes fiscales y mercantiles (hasta 6 años).</li>
</ul>

<h2>5. Con quién se comparten</h2>
<p>No se venden ni se ceden datos a terceros. Para funcionar, Fuelfy usa estos proveedores, que actúan como encargados o subencargados del tratamiento:</p>
<div class="tabla"><table>
<thead><tr><th>Proveedor</th><th>Para qué</th><th>Dónde</th></tr></thead>
<tbody>
<tr><td>Supabase</td><td>Base de datos, usuarios y funciones del servidor</td><td>Unión Europea (Fráncfort)</td></tr>
<tr><td>Hostinger</td><td>Buzón fuelfy@fuelfy.app, que recibe y guarda los emails de precios que reenvían las empresas</td><td>UE y otros países</td></tr>
<tr><td>Stripe (Stripe Payments Europe, Ltd.)</td><td>Facturas, cobros y cálculo del IVA, con los datos de facturación de la empresa cliente</td><td>Irlanda y EE. UU.</td></tr>
<tr><td>GitHub (Microsoft)</td><td>Alojamiento de la web</td><td>EE. UU.</td></tr>
<tr><td>Komoot (Photon)</td><td>Buscar direcciones al escribir el origen y el destino</td><td>Alemania</td></tr>
<tr><td>OSRM / FOSSGIS</td><td>Calcular rutas a partir de las coordenadas</td><td>Alemania</td></tr>
<tr><td>OpenStreetMap Foundation</td><td>Imágenes del mapa</td><td>Reino Unido</td></tr>
<tr><td>Google Fonts, jsDelivr y unpkg</td><td>Tipografía y librerías de la web</td><td>UE y EE. UU.</td></tr>
</tbody></table></div>
<p>A los servicios de direcciones, rutas y mapas solo les llega lo necesario para responder (el texto buscado o unas coordenadas, y la dirección IP del navegador), nunca datos de la cuenta. Stripe trata los datos de facturación para cobrar por cuenta de Fuelfy y, en lo que le exige la normativa de pagos (por ejemplo, prevenir el fraude), como responsable propio, según su <a href="https://stripe.com/es/privacy" rel="noopener">política de privacidad</a>. Cuando un proveedor está fuera del Espacio Económico Europeo, la transferencia se ampara en una decisión de adecuación de la Comisión Europea (como el Marco de Privacidad de Datos UE-EE. UU. o la del Reino Unido) o en cláusulas contractuales tipo.</p>

<h2>6. Tus derechos</h2>
<p>Puedes pedir acceso a tus datos, su rectificación o supresión, oponerte a su tratamiento, pedir que se limite o que se te entreguen en un formato portable, escribiendo a {EMAIL}. Si los datos los gestiona tu empresa (por ejemplo, eres gestor o conductor de una empresa cliente), Fuelfy trasladará tu petición a tu empresa y la ayudará a atenderla.</p>
<p>Si crees que no se han respetado tus derechos, puedes reclamar ante la Agencia Española de Protección de Datos (<a href="https://www.aepd.es" rel="noopener">aepd.es</a>).</p>

<h2 id="cookies">7. Cookies y almacenamiento en el navegador</h2>
<p>Fuelfy no usa cookies de análisis, de publicidad ni de redes sociales. Solo guarda en el navegador lo imprescindible para funcionar:</p>
<ul>
  <li>La <b>sesión iniciada</b>, para no tener que entrar cada vez.</li>
  <li><b>Preferencias</b> como el último camión elegido, el nivel de combustible o la distancia a la ruta.</li>
</ul>
<p>Al ser técnicas y necesarias para el servicio que pides, no necesitan consentimiento (art. 22.2 de la LSSI) y por eso no aparece un aviso de cookies. Se borran al cerrar sesión o al borrar los datos del navegador.</p>

<h2>8. Seguridad</h2>
<p>Las conexiones van cifradas (https), las contraseñas no se guardan en claro y cada empresa solo puede ver sus propios datos: la base de datos lo comprueba en cada consulta.</p>

<h2>9. Cambios</h2>
<p>Si esta política cambia de forma importante, se avisará dentro de la aplicación y, si hace falta, se pedirá una nueva aceptación.</p>
'''

condiciones = f'''
<div class="resumen">
<p><b>En resumen:</b></p>
<ul>
  <li>Empiezas con 14 días de prueba gratis, sin tarjeta. Después eliges plan: Esencial (20 €), Pro (30 €) o Flota (25 €, con descuentos desde el camión 75), por camión y mes, sin IVA.</li>
  <li>Pagando mes a mes, se cobra a mes vencido el máximo de camiones que has tenido en servicio a la vez, y te puedes dar de baja cuando quieras. Con contrato anual tienes dos meses gratis, y lo pagas de una vez o en 12 cuotas mensuales.</li>
  <li>Garantía de ahorro en los planes Pro y Flota: si en los tres primeros meses el informe no muestra un ahorro de al menos 3 veces la cuota, te devolvemos lo pagado.</li>
  <li>Tus datos son tuyos: los puedes descargar y se borran tras la baja.</li>
  <li>Los precios vienen de tus proveedores y las rutas y ahorros son estimaciones: la decisión de dónde repostar es tuya.</li>
</ul>
</div>

<h2>1. Partes y objeto</h2>
<p>Estas condiciones regulan el uso y la contratación de Fuelfy entre {TIT} (en adelante, «el titular»), con NIF {NIF} y domicilio en {DOM}, y la empresa o profesional del transporte que lo contrata (en adelante, «el cliente»). Fuelfy es un servicio exclusivamente para empresas y profesionales; no se ofrece a consumidores.</p>
<p>Al aceptarlas dentro de la aplicación, el usuario declara que tiene capacidad para obligar al cliente.</p>

<h2>2. El servicio</h2>
<p>Fuelfy permite al cliente:</p>
<ul>
  <li>Reenviar a una dirección propia los emails de precios de sus tarjetas de carburante, para que la aplicación los lea y los muestre en un mapa.</li>
  <li>Gestionar su flota de camiones y planificar dónde repostar en cada ruta según el combustible y los precios.</li>
  <li>Preparar el mensaje con la ruta y la parada para enviarlo al conductor por WhatsApp desde su propio dispositivo.</li>
  <li>Consultar informes del ahorro estimado y descargarlos, según el plan contratado (apartado 5).</li>
</ul>
<p>El titular puede mejorar y cambiar las funciones de la aplicación. Si un cambio elimina una función importante, avisará con antelación razonable.</p>

<h2>3. Alta y usuarios</h2>
<p>El titular da de alta a la empresa y a su primer gestor. El gestor puede invitar a otros usuarios de su empresa y es responsable de quién tiene acceso. Cada usuario debe guardar su contraseña en secreto y avisar si sospecha de un uso indebido.</p>

<h2>4. Periodo de prueba</h2>
<p>El cliente puede usar Fuelfy gratis durante 14 días naturales desde el alta, con todas las funciones del plan Pro y sin dar ningún medio de pago, salvo que acuerde por escrito con el titular un plazo distinto. La fecha de fin se ve dentro de la aplicación. La prueba no obliga a contratar: al terminar, el cliente elige plan y forma de pago o deja de usar el servicio, sin coste. El mes en que termina la prueba no se cobra; el cobro empieza el mes siguiente.</p>

<h2 id="precio">5. Planes y precio</h2>
<p>Después de la prueba, el precio es por camión y mes, según el plan que elija el cliente. A los importes se les suma el IVA que corresponda (hoy, el 21 %).</p>
<div class="tabla"><table class="planes">
<thead><tr><th></th><th>Esencial</th><th>Pro</th><th>Flota</th></tr></thead>
<tbody>
<tr><td>Pago mensual, por camión (sin IVA)</td><td>20,00 €</td><td>30,00 €</td><td>25,00 €</td></tr>
<tr><td>Contrato anual, por camión y año (sin IVA)</td><td>200,00 €</td><td>300,00 €</td><td>250,00 €</td></tr>
<tr><td>Contrato anual en 12 cuotas, por camión y mes (sin IVA)</td><td>16,67 €</td><td>25,00 €</td><td>20,83 €</td></tr>
<tr><td>Pensado para</td><td>Autónomos y flotas de 2 a 5 camiones</td><td>Flotas de 5 a 49 camiones</td><td>Flotas de 50 camiones o más</td></tr>
<tr><td>Mínimo que se factura</td><td>2 camiones</td><td>5 camiones</td><td>50 camiones</td></tr>
</tbody></table></div>
<p>Los precios de Pro y Flota de la tabla son los de sus primeros camiones; los siguientes tienen descuento por volumen (ver más abajo).</p>
<ul>
  <li><b>Esencial:</b> mapa de precios en ruta, recomendación de la mejor parada para cada camión, planificación del repostaje con la ruta completa y el nivel del depósito, y avisos al conductor. Un usuario gestor.</li>
  <li><b>Pro:</b> todo lo de Esencial, más el informe mensual de ahorro, usuarios ilimitados y exportación de datos.</li>
  <li><b>Flota:</b> todo lo de Pro, más varias cuentas (sedes o centros de coste), administrador de cuenta y soporte prioritario. Si el titular y el cliente firman un presupuesto o contrato particular, este prevalece sobre estas condiciones en lo que las contradiga.</li>
</ul>
<h3>Descuento por volumen (plan Pro)</h3>
<p>En el plan Pro, los primeros 25 camiones pagan el precio completo y, del camión 26 al 49, cada camión paga un 10 % menos (27,00 € al mes, o 270,00 € al año). A partir de 50 camiones se aplica el plan Flota.</p>
<p>Por ejemplo, con 30 camiones en Pro pagando mes a mes: 25 × 30,00 € + 5 × 27,00 € = 885,00 € al mes, más IVA.</p>
<h3>Descuento por volumen (plan Flota)</h3>
<p>En el plan Flota, los primeros 74 camiones pagan el precio completo; del camión 75 al 99, cada camión paga un 20 % menos (20,00 € al mes, o 200,00 € al año), y desde el camión 100, un 30 % menos (17,50 € al mes, o 175,00 € al año).</p>
<p>Por ejemplo, con 100 camiones en Flota pagando mes a mes: 74 × 25,00 € + 25 × 20,00 € + 1 × 17,50 € = 2.367,50 € al mes, más IVA.</p>
<h3 id="anual">Contrato anual</h3>
<p>Con contrato anual, el cliente se compromete a 12 meses por el número de camiones que indique, paga 10 meses y tiene 2 gratis. Puede pagarlo de dos formas, con el mismo importe total:</p>
<ul>
  <li><b>De una vez:</b> una factura por adelantado al empezar cada año de servicio.</li>
  <li><b>En 12 cuotas:</b> el importe del año dividido en 12 cuotas mensuales iguales, que se cobran por adelantado el día 1 de cada mes con cargo automático en la tarjeta o la cuenta que el cliente indique. Cada cuota se redondea al céntimo.</li>
</ul>
<p>Durante los 12 meses no se puede reducir el número de camiones contratados. Si durante ese año pone en servicio más camiones de los pagados, cada mes se facturan a mes vencido los camiones de más (el máximo del mes menos los pagados), cada uno al precio mensual del tramo en el que cae: por ejemplo, con 30 camiones pagados en Pro, el camión 31 paga 27,00 € al mes. A los camiones de más no se les aplican los dos meses gratis.</p>
<h3 id="fundadoras">Oferta «Flotas fundadoras»</h3>
<p>Las 15 primeras empresas que contraten el plan Pro o el plan Flota con contrato anual (pagado de una vez o en 12 cuotas) tienen un 25 % de descuento sobre el precio de su plan (con el descuento por volumen, si corresponde), en lugar de los dos meses gratis del contrato anual; los dos descuentos no se suman. El 25 % se aplica también a los camiones de más que se facturen cada mes. Las 15 plazas son en total, entre los dos planes. A cambio, la empresa acepta una breve entrevista mensual sobre su uso de Fuelfy y que el titular publique su caso. El descuento se mantiene mientras la empresa renueve su contrato anual sin interrupción.</p>
<h3>Cambios de precio</h3>
<p>El titular puede cambiar los precios avisando al cliente con al menos 30 días de antelación. Si el cliente no está de acuerdo, puede darse de baja antes de que el cambio se aplique. A quien tenga contrato anual, el cambio no le afecta hasta su siguiente renovación.</p>

<h2>6. Cómo se cuenta y se cobra</h2>
<ul>
  <li>Cuenta cada camión marcado «en servicio» en la pestaña Flota. Los camiones de baja no pagan.</li>
  <li><b>Pago mensual:</b> se cobra <b>a mes vencido</b> el <b>máximo de camiones que el cliente ha tenido en servicio a la vez durante el mes</b>, con el mínimo de su plan. Un camión dado de alta a mitad de mes cuenta ese mes entero; uno dado de baja deja de contar el mes siguiente.</li>
  <li><b>Contrato anual pagado de una vez:</b> se cobra por adelantado al empezar cada año de servicio, como se explica en el apartado 5.</li>
  <li><b>Contrato anual en 12 cuotas:</b> cada cuota se cobra por adelantado el día 1 de cada mes, con cargo automático. Mientras el cliente no haya guardado su medio de pago, cada cuota se paga como el resto de facturas.</li>
  <li>El titular emitirá una factura por cada cobro con el detalle de plan, camiones, descuentos e IVA. Salvo el cargo automático de las cuotas, el pago se hará por domiciliación bancaria, transferencia o tarjeta, según se acuerde, en los 15 días siguientes a la factura.</li>
</ul>

<h3 id="garantia">Garantía de ahorro</h3>
<p>Si en los tres primeros meses de pago de los planes Pro o Flota (incluida la oferta «Flotas fundadoras») el informe de ahorro de la aplicación no muestra un ahorro estimado de al menos 3 veces lo que el cliente ha pagado por esos tres meses, el titular le devuelve lo pagado por el servicio. Si pagó el año de una vez, se le devuelve el pago anual completo; si lo paga en cuotas, se le devuelven las cuotas pagadas y no se le cobran las siguientes ni la penalización del apartado 8. Para pedirlo, el cliente debe escribir a {EMAIL} en los 30 días siguientes al final del tercer mes; la devolución se hace en los 30 días siguientes y la suscripción termina. El cálculo es el del informe de la aplicación (apartado 10), que solo cuenta las rutas enviadas desde Fuelfy.</p>

<h2>7. Impago</h2>
<p>Si una factura no se paga a su vencimiento, el titular lo avisará al cliente. Si pasados 7 días sigue sin pagarse, podrá limitar la cuenta a modo consulta: se podrán ver el mapa, la flota y los informes, pero no enviar nuevas rutas. Los datos no se borran por un impago, y el servicio se restablece en cuanto se paga.</p>
<p>Con contrato anual en cuotas, si una cuota sigue sin pagarse 30 días después de su vencimiento, el titular podrá dar por terminado el contrato. En ese caso el cliente deberá, además de lo vencido, la penalización por baja anticipada del apartado 8.</p>

<h2>8. Duración y baja</h2>
<ul>
  <li>Con pago mensual, el servicio se renueva solo cada mes. El cliente puede darse de baja en cualquier momento escribiendo a {EMAIL}. La baja tiene efecto al final del mes en curso, que se factura con normalidad; no hay permanencia ni penalización.</li>
  <li>Con contrato anual, el servicio se renueva solo por otros 12 meses, en la misma forma de pago y por los mismos camiones, salvo que el cliente avise antes de la fecha de renovación.</li>
  <li>Si lo pagó de una vez y se da de baja antes de terminar el año, el servicio sigue activo hasta el final del periodo pagado y no se devuelve la parte no usada, salvo lo previsto en la garantía de ahorro.</li>
  <li>Si lo paga en 12 cuotas, tiene una permanencia de 12 meses. Si se da de baja antes de que terminen, deberá en concepto de penalización el 100 % de las cuotas que falten hasta el final del contrato, que se facturan de una vez. El servicio sigue activo hasta esa fecha.</li>
  <li>El titular puede dar por terminado el servicio avisando con 30 días de antelación, o de inmediato si el cliente incumple gravemente estas condiciones.</li>
  <li>Antes de la baja, el cliente puede descargar sus rutas en CSV. Pasados 30 días desde la baja, sus datos se borran, salvo lo que la ley obligue a conservar (por ejemplo, las facturas).</li>
</ul>

<h2>9. Obligaciones del cliente</h2>
<ul>
  <li>Reenviar a Fuelfy solo emails de precios que tenga derecho a usar, y tener informadas a las personas cuyos datos aparezcan en ellos o en la aplicación (por ejemplo, sus gestores y conductores).</li>
  <li>Mantener al día los datos de sus camiones, sobre todo si están en servicio o de baja.</li>
  <li>Usar el servicio de forma lícita, sin compartir usuarios con terceros ajenos a la empresa ni intentar acceder a datos de otros clientes.</li>
</ul>

<h2>10. Información de terceros y responsabilidad</h2>
<ul>
  <li><b>Precios:</b> vienen de los emails que envían los proveedores del cliente. Fuelfy los lee y los muestra tal cual; no responde de errores, retrasos o cambios de precio de los proveedores ni de que un email no llegue o no pueda leerse.</li>
  <li><b>Ubicación de estaciones:</b> se obtiene cruzando los datos de los proveedores con el listado público del Ministerio. Las marcadas como «por confirmar» pueden no estar en el punto exacto.</li>
  <li><b>Rutas y tiempos:</b> son una aproximación teórica, calculada con servicios de rutas de terceros. El tiempo es una estimación para camión, pero no tiene en cuenta restricciones de peso, altura o circulación, ni el tráfico real. La ruta y las paradas definitivas las decide la empresa usuaria y su conductor.</li>
  <li><b>Ahorro:</b> es una estimación que compara la parada elegida con la media de las otras paradas habilitadas de la ruta, por los litros previstos. No comprueba lo que se repostó de verdad.</li>
</ul>
<p>La decisión de dónde y cuánto repostar es siempre del cliente y de sus conductores. El titular procura que el servicio esté disponible y funcione bien, pero no garantiza que no haya interrupciones. Salvo dolo o culpa grave, la responsabilidad total del titular frente al cliente se limita a lo que el cliente haya pagado por el servicio en los 12 meses anteriores al hecho que la cause, y no incluye lucro cesante ni daños indirectos.</p>

<h2>11. Propiedad intelectual</h2>
<p>La aplicación, la marca y el código son del titular; el cliente recibe un derecho de uso mientras el servicio esté activo. Los datos del cliente (flota, rutas, informes) son del cliente.</p>

<h2>12. Protección de datos</h2>
<p>Para prestar el servicio, el titular trata por cuenta del cliente los datos personales que este introduce en la aplicación. Ese tratamiento se rige por el <a href="#encargo">Anexo de encargo del tratamiento</a>, que forma parte de estas condiciones. El resto se explica en la <a href="privacidad.html">Política de privacidad</a>.</p>

<h2>13. Cambios en estas condiciones</h2>
<p>Si estas condiciones cambian, el titular lo avisará dentro de la aplicación con al menos 14 días de antelación y pedirá aceptar la nueva versión. Si el cliente no la acepta, puede darse de baja antes de que entre en vigor.</p>

<h2>14. Ley aplicable y jurisdicción</h2>
<p>Estas condiciones se rigen por la ley española. Para cualquier conflicto, las partes se someten a los juzgados y tribunales del domicilio del titular.</p>

<h2 id="encargo">Anexo. Encargo del tratamiento de datos</h2>
<p>De acuerdo con el artículo 28 del Reglamento General de Protección de Datos (RGPD), el cliente (responsable del tratamiento) encarga al titular (encargado del tratamiento) el tratamiento de los datos personales necesarios para prestar el servicio, en estos términos:</p>
<h3>Objeto, duración y finalidad</h3>
<p>Alojar y tratar los datos que el cliente introduce o reenvía a Fuelfy, solo para prestarle el servicio descrito en estas condiciones, mientras el servicio esté activo y hasta su devolución o borrado tras la baja.</p>
<h3>Datos y personas afectadas</h3>
<ul>
  <li>Datos identificativos y de contacto de los usuarios del cliente (nombre, email, rol).</li>
  <li>Datos de actividad: rutas enviadas, con el usuario que las envió y la matrícula del camión.</li>
  <li>Datos de contacto que aparezcan en los emails de precios reenviados (por ejemplo, nombre, cargo o teléfono de quien firma).</li>
</ul>
<p>Personas afectadas: empleados y colaboradores del cliente y personas de contacto de sus proveedores.</p>
<h3>Obligaciones del encargado</h3>
<ol>
  <li>Tratar los datos solo siguiendo las instrucciones documentadas del cliente, que son estas condiciones y el uso que el cliente hace de la aplicación.</li>
  <li>Garantizar que las personas autorizadas a tratarlos se han comprometido a guardar confidencialidad.</li>
  <li>Aplicar medidas de seguridad adecuadas: cifrado de las comunicaciones, contraseñas protegidas, separación de los datos de cada cliente y copias de seguridad del proveedor de base de datos.</li>
  <li>Recurrir solo a los subencargados indicados en la <a href="privacidad.html">Política de privacidad</a> (Supabase, Hostinger, GitHub y los servicios de mapas, rutas, tipografía y librerías de la web). El cliente autoriza su uso. El titular avisará de cualquier cambio con antelación para que el cliente pueda oponerse.</li>
  <li>Ayudar al cliente a atender los derechos de las personas afectadas y a cumplir sus obligaciones de seguridad.</li>
  <li>Avisar al cliente sin dilación indebida, y en todo caso en un plazo máximo de 48 horas, de cualquier brecha de seguridad que afecte a sus datos.</li>
  <li>Al terminar el servicio, permitir al cliente descargar sus datos y borrarlos en un plazo de 30 días, salvo los que deba conservar por ley.</li>
  <li>Poner a disposición del cliente la información necesaria para demostrar el cumplimiento de estas obligaciones.</li>
</ol>
<h3>Obligaciones del cliente</h3>
<p>Ser responsable de que los datos que introduce o reenvía se han obtenido de forma lícita, de informar a las personas afectadas y de atender sus derechos con la ayuda del encargado.</p>
'''

os.makedirs(OUT, exist_ok=True)
# Las condiciones llevan su propia versión: cambian los planes y precios (8/11/2026)
VERSION_COND, FECHA_COND = '2.0', '13 de noviembre de 2026'   # 13/11: contrato anual en 12 cuotas y permanencia
VERSION_PRIV, FECHA_PRIV = '1.1', '9 de noviembre de 2026'   # 1.1: Stripe y Hostinger en lugar de Gmail; solicitudes de prueba
for archivo, titulo, cuerpo, desc, ver, fec in [
    ('aviso-legal.html', 'Aviso legal', aviso, 'Datos del titular de Fuelfy y condiciones de uso de la web.', VERSION, FECHA),
    ('privacidad.html', 'Privacidad y cookies', privacidad, 'Qué datos trata Fuelfy, para qué, con quién se comparten y cómo ejercer tus derechos.', VERSION_PRIV, FECHA_PRIV),
    ('condiciones.html', 'Condiciones de uso y contratación', condiciones, 'Planes, precio, cobro, prueba, baja y responsabilidades del servicio Fuelfy para empresas de transporte.', VERSION_COND, FECHA_COND),
]:
    open(os.path.join(OUT, archivo), 'w').write(pagina(archivo, titulo, cuerpo, desc, ver, fec))
print('ok')
