// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
// Son 2 tiendas en un mismo sitio: /hombre (Exclusive Store) y /mujer (Exclusive Girl), más una portada en /
// para elegir. Comparten estructura, app.js y styles.css, pero cada una tiene su catálogo, su bolsa y su identidad.
//  1. Lee tienda.config.json (desarrollador), data/ajustes.json (compartido) y data/<tienda>/* (lo edita el cliente en /admin)
//  2. Junta data/<tienda>/productos y categorias (+ data/cupones de esa tienda) en dist/data/catalogo-<tienda>.json
//  3. Escribe index.html (portada) y tienda.html (una vez por tienda) en dist/ reemplazando los %%MARCADORES%%,
//     con los productos dentro del HTML (para Google), canonical, Open Graph, JSON-LD, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  node scripts/serve.mjs (sirve dist/ en http://localhost:5600)
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readData = (file) => {
  if (!existsSync(join(DATA, file))) return {};
  try { return readJson(join(DATA, file)); } catch (e) { console.warn(`⚠️  ${file} está dañado y se ignoró: ${e.message}`); return {}; }
};

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- Fotos livianas ----------
// Tarjetas, portada y entregas usan una copia WebP del ancho justo en dist/img/_opt/. El nombre lleva un hash
// del contenido: el navegador la guarda en caché y una foto reemplazada en /admin se ve al tiro.
// Las originales se mantienen (ficha del producto, Google, redes sociales). Sin sharp se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
const rel = (path) => String(path ?? '').trim().replace(/^\//, '');
function optimizar(src, ancho) {
  const path = rel(src);
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 76 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
const MINI = 640; // ancho de las fotos en las tarjetas (≈300 px en pantalla, x2 para pantallas retina)

// ---------- 1. Datos compartidos ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v, def) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : def);
const config = readJson(join(ROOT, 'tienda.config.json'));
const ajustes = readData('ajustes.json');
const MODOS = Object.keys(config.tiendas || {});
if (!MODOS.length) throw new Error('tienda.config.json no tiene tiendas');

const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5600').replace(/\/$/, '');

const A = {
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  email: str(ajustes.email),
  ciudad: str(ajustes.ciudad),
  region: str(ajustes.region),
  envios: str(ajustes.envios) || 'Envíos a todo Chile',
  empresas_envio: (Array.isArray(ajustes.empresas_envio) ? ajustes.empresas_envio : ['Starken', 'Chilexpress', 'Blue Express']).map(str).filter(Boolean),
  horario_dias: str(ajustes.horario_dias),
  hora_abre: str(ajustes.hora_abre),
  hora_cierra: str(ajustes.hora_cierra),
};
if (!A.whatsapp) throw new Error('Falta el WhatsApp en data/ajustes.json');
if (!/^\d{10,15}$/.test(A.whatsapp) || (A.whatsapp.startsWith('56') && !/^569\d{8}$/.test(A.whatsapp))) {
  throw new Error(`WhatsApp inválido "${A.whatsapp}": usa formato internacional; en Chile son 11 dígitos, ej 56912345678`);
}
const waUrl = (text) => `https://api.whatsapp.com/send?phone=${A.whatsapp}${text ? '&text=' + encodeURIComponent(text) : ''}`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clp = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const abs = (path) => `${SITE}/${rel(path)}`;
const url = (path) => '/' + rel(path); // rutas absolutas: las páginas viven en /hombre/ y /mujer/

function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar todo el catálogo: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}
const byOrder = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');
const lista = (v) => [...new Set((Array.isArray(v) ? v : []).map(str).filter(Boolean))];

// ---------- Códigos de descuento ----------
// Se publican como huella SHA-256 y no como texto: la web comprueba el código que le escriben, pero nadie puede sacar
// la lista mirando el archivo. La sal debe coincidir con CUPON_SAL en app.js.
const CUPON_SAL = 'exclusive-7:';
const normCodigo = (c) => str(c).toUpperCase().replace(/\s+/g, '');
const huella = (c) => createHash('sha256').update(CUPON_SAL + normCodigo(c)).digest('hex');
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // AAAA-MM-DD
const todosLosCupones = readFolder('cupones');

// ---------- Plantillas ----------
const PLANTILLA_TIENDA = readFileSync(join(ROOT, 'tienda.html'), 'utf8');
const PLANTILLA_PORTADA = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', '<!-- SEO:PRODUCTOS -->', '<!-- ENTREGAS:LISTA', '<!-- FRANJA1 -->', '<!-- MAYOR:TABLA -->']) {
  if (!PLANTILLA_TIENDA.includes(marker)) throw new Error(`Falta el marcador ${marker} en tienda.html`);
}

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía;
// <!-- NO:CLAVE --> ... <!-- /NO:CLAVE --> se eliminan si CLAVE tiene valor
function render(text, file, vars, escape) {
  let out = text;
  for (let prev; prev !== out;) { // se repite para resolver bloques anidados
    prev = out;
    out = out
      .replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(vars[key]) ? body : ''))
      .replace(/<!-- NO:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/NO:\1 -->/g, (m, key, body) => (str(vars[key]) ? '' : body));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = vars[key];
    if (v === undefined || v === null) { missing.add(key); return m; }
    return escape && !key.endsWith('_JSON') ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}
const fuentesUrl = (f) => {
  const fam = (nombre, pesos) => `family=${encodeURIComponent(nombre).replace(/%20/g, '+')}:wght@${pesos}`;
  // "extra": la fuente de la otra tienda, para la tarjeta que invita a visitarla
  return `https://fonts.googleapis.com/css2?${fam(f.titulos, f.titulos_pesos || '700')}&${fam(f.texto, '400;500;600;700;800')}${f.extra ? `&family=${f.extra}` : ''}&display=swap`;
};

// Precio por mayor: tramos válidos (desde 2 u., más baratos que el precio normal), de menor a mayor cantidad
function tramos(p, precio) {
  return (Array.isArray(p.mayor) ? p.mayor : [])
    .map((t) => ({ desde: Math.round(num(t && t.desde, 0)), precio: Math.round(num(t && t.precio, 0)) }))
    .filter((t) => t.desde >= 2 && t.precio > 0 && (!precio || t.precio < precio))
    .sort((a, b) => a.desde - b.desde)
    .filter((t, i, arr) => i === arr.findIndex((x) => x.desde === t.desde));
}

// Misma tarjeta que card() en app.js
const card = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.etiqueta ? `<span class="badge">${esc(p.etiqueta)}</span>` : ''}
        ${p.fotos.length ? `<span class="card__more">+${p.fotos.length} ${p.fotos.length === 1 ? 'foto' : 'fotos'}</span>` : ''}
        <img src="${esc(url(p.mini))}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
        ${p.minis[0] ? `<img class="alt" src="${esc(url(p.minis[0]))}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="card__tape" aria-hidden="true"></span>
        <span class="card__sticker" aria-hidden="true">${p.precio > 0 ? clp(p.precio) : '¿Precio?'}</span>
      </button>
      <div class="card__body">
        <p class="card__code">${esc(p.codigo)}</p>
        <h3>${esc(p.nombre)}</h3>
        ${p.tallas.length ? `<ul class="sizes" aria-label="Tallas disponibles">${p.tallas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${p.mayor.length ? `<p class="card__mayor"><span>Por mayor</span> desde ${p.mayor[0].desde} u. · ${clp(p.mayor[p.mayor.length - 1].precio)}–${clp(p.mayor[0].precio)} c/u</p>` : ''}
        <div class="card__foot">
          <span class="price${p.precio > 0 ? '' : ' price--ask'}">${p.precio > 0 ? clp(p.precio) : 'Consultar precio'}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Tienen stock de ${p.nombre}?`))}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm" type="button" data-view="${esc(p.id)}">${p.tallas.length > 1 || p.modelos.length > 1 ? 'Elegir' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`;

const entregaHtml = (e) => `
          <figure class="proof" data-reveal>
            <div class="proof__media">
              ${e.video
                ? `<video data-src="${esc(url(e.archivo))}#t=0.1" muted loop playsinline preload="none" aria-label="${esc(e.descripcion)}"></video>`
                : `<img src="${esc(url(e.archivo))}" alt="${esc(e.descripcion)}" loading="lazy" decoding="async">`}
            </div>
            <figcaption>${e.titulo ? `<strong>${esc(e.titulo)}</strong>` : ''}${e.texto ? `<span>${esc(e.texto)}</span>` : ''}${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">Ver en Instagram</a>` : ''}</figcaption>
          </figure>`;

const ENTREGAS_BASE = {
  hombre: [
    { archivo: 'img/entregas/hombre-entrega-auto.jpg', titulo: 'Día de entregas', texto: 'Pedidos entregados en mano' },
    { archivo: 'img/entregas/hombre-cliente-frecuente.jpg', titulo: 'Cliente frecuente', texto: 'Vuelven y compran por mayor' },
    { archivo: 'img/entregas/hombre-entrega-presencial.jpg', titulo: 'Entregas presenciales', texto: 'Full activos toda la semana' },
  ],
  mujer: [
    { archivo: 'img/entregas/mujer-clientas-chat.jpg', titulo: 'Clientas felices', texto: '100% recomendada' },
    { archivo: 'img/logo-mujer.jpg', titulo: 'Envíos a todo Chile', texto: 'Por la empresa que elijas' },
    { archivo: 'img/entregas/mujer-ofertas.jpg', titulo: 'Ofertas', texto: 'Stock nuevo cada semana' },
  ],
};
const FRANJA_BASE = {
  hombre: ['Detalle y por mayor', 'Envíos a todo Chile', 'Entregas presenciales', 'Mejor calidad y precios'],
  mujer: ['Moda full tendencia', 'Envíos a todo Chile', 'Nuevos modelos', 'Stock limitado'],
};
const VELOCIDAD = { lenta: 1.6, normal: 1, rapida: 0.6 };

// ---------- 2. Cada tienda ----------
const resumen = {};
const sitemap = [`${SITE}/`];

for (const modo of MODOS) {
  const cfg = config.tiendas[modo];
  const T = readData(`${modo}/tienda.json`);
  const flyer = readData(`${modo}/flyer.json`);
  const franjasData = readData(`${modo}/franjas.json`);
  const entregasData = readData(`${modo}/entregas.json`);
  const nombre = str(cfg.nombre);
  const prefijo = str(cfg.prefijo_pedido) || modo.slice(0, 3).toUpperCase();
  const instagram = str(T.instagram).replace(/^@/, '');
  const tiktok = str(T.tiktok).replace(/^@/, '');

  let n = 0;
  const productos = readFolder(`${modo}/productos`)
    .filter((p) => p.visible !== false && typeof p.nombre === 'string' && p.nombre.trim())
    .map((p) => {
      const precio = Math.max(0, Math.round(num(p.precio, 0)));
      return {
        id: p.id,
        nombre: p.nombre.trim(),
        precio,
        foto: rel(p.foto) || str(cfg.logo),
        fotos: (Array.isArray(p.fotos) ? p.fotos : []).map(rel).filter(Boolean),
        // tallas y modelos únicos y sin vacíos; números del CMS se pasan a texto
        tallas: lista(p.tallas),
        modelos: lista(p.modelos),
        mayor: tramos(p, precio),
        descripcion: str(p.descripcion),
        etiqueta: str(p.etiqueta),
        agotado: p.agotado === true,
        orden: num(p.orden, 1000),
      };
    })
    .sort(byOrder)
    .map(({ orden, ...p }) => ({ ...p, codigo: `${prefijo}-${String(++n).padStart(2, '0')}` }));

  await Promise.all(productos.map(async (p) => {
    p.mini = await optimizar(p.foto, MINI);
    p.minis = await Promise.all(p.fotos.map((f) => optimizar(f, MINI)));
  }));
  const ids = new Set(productos.map((p) => p.id));

  const categorias = readFolder(`${modo}/categorias`)
    .filter((c) => c.visible !== false && typeof c.nombre === 'string' && c.nombre.trim())
    .map((c) => ({
      id: c.id,
      nombre: c.nombre.trim(),
      orden: num(c.orden, 1000),
      // se descartan productos borrados u ocultos, y repetidos
      productos: [...new Set(Array.isArray(c.productos) ? c.productos : [])].filter((id) => ids.has(id)),
    }))
    .filter((c) => c.productos.length) // no se muestran categorías vacías
    .sort(byOrder)
    .map(({ orden, ...c }) => c);

  const productosDe = Object.fromEntries(categorias.map((c) => [c.id, c.productos]));
  const vistos = new Set();
  const cupones = todosLosCupones
    .filter((c) => c.activo !== false && normCodigo(c.codigo) && (!c.tienda || c.tienda === 'ambas' || c.tienda === modo))
    .map((c) => {
      const tipo = c.tipo === 'monto' ? 'monto' : 'porcentaje';
      const valor = Math.max(0, Math.round(num(c.valor, 0)));
      const vence = /^\d{4}-\d{2}-\d{2}/.test(str(c.vence)) ? str(c.vence).slice(0, 10) : '';
      // en /admin se eligen categorías y productos de cada tienda por separado; sin ninguno (de ninguna tienda) = toda la tienda
      const cats = lista(c[`categorias_${modo}`]);
      const prods = lista(c[`productos_${modo}`]);
      const todos = MODOS.every((m) => !lista(c[`categorias_${m}`]).length && !lista(c[`productos_${m}`]).length);
      return {
        codigo: normCodigo(c.codigo),
        h: huella(c.codigo),
        titulo: str(c.titulo) || normCodigo(c.codigo),
        tipo,
        valor: tipo === 'porcentaje' ? Math.min(100, valor) : valor,
        minimo: Math.max(0, Math.round(num(c.minimo, 0))),
        vence,
        productos: todos ? null : [...new Set([...cats.flatMap((id) => productosDe[id] || []), ...prods])].filter((id) => ids.has(id)),
        aplica: todos ? 'Toda la tienda' : [...categorias.filter((x) => cats.includes(x.id)).map((x) => x.nombre), ...(prods.length ? ['productos seleccionados'] : [])].join(', '),
      };
    })
    .filter((c) => {
      if (!c.valor) return console.warn(`⚠️  [${modo}] Cupón «${c.titulo}» sin valor de descuento: se omitió`), false;
      if (c.vence && c.vence < hoy) return console.warn(`ℹ️  [${modo}] Cupón «${c.titulo}» vencido el ${c.vence}: se omitió`), false;
      if (c.productos && !c.productos.length) return console.warn(`⚠️  [${modo}] Cupón «${c.titulo}» no tiene productos visibles en esta tienda: se omitió`), false;
      if (vistos.has(c.codigo)) return console.warn(`⚠️  [${modo}] Código ${c.codigo} repetido: se usa solo el primero`), false;
      vistos.add(c.codigo);
      return true;
    })
    .map(({ codigo, ...c }) => c);

  writeFileSync(join(DIST, 'data', `catalogo-${modo}.json`), JSON.stringify({ categorias, productos, cupones }));
  console.log(`✅ ${modo}: ${productos.length} productos, ${categorias.length} categorías, ${cupones.length} códigos activos`);

  // Flyer de ofertas
  const F = { imagen: flyer.mostrar !== false ? rel(flyer.imagen) : '', titulo: str(flyer.titulo) || 'Ofertas', descripcion: str(flyer.descripcion) };
  F.popup = F.imagen && flyer.popup !== false;
  const FLYER_OPT = F.imagen ? await optimizar(F.imagen, 880) : '';

  // Entregas / clientes reales (siempre 3)
  const listaEntregas = Array.isArray(entregasData.entregas) ? entregasData.entregas : [];
  const entregas = await Promise.all(ENTREGAS_BASE[modo].map(async (base, i) => {
    const e = listaEntregas[i] || {};
    const archivo = rel(e.archivo) || base.archivo;
    const video = /\.(mp4|webm|m4v|mov)$/i.test(archivo);
    return {
      archivo: video ? archivo : await optimizar(archivo, 720),
      video,
      titulo: str(e.titulo) || (e.archivo ? '' : base.titulo),
      texto: str(e.texto) || (e.archivo ? '' : base.texto),
      descripcion: str(e.descripcion) || str(e.titulo) || base.titulo,
      link: /^https?:\/\//.test(str(e.link)) ? str(e.link) : '',
    };
  }));

  // Franja de frases en movimiento: se repite hasta ~12 frases por mitad para que el loop no deje huecos
  const f1 = franjasData.franja1 || {};
  const frases = lista(f1.frases).length ? lista(f1.frases) : FRANJA_BASE[modo];
  const vuelta = [];
  while (vuelta.length < 12) vuelta.push(...frases);

  // Portada
  const hero = Array.isArray(cfg.hero) ? cfg.hero : [];
  const heroFoto = (i) => (hero[i] && hero[i].foto) || (productos[i] && productos[i].foto) || cfg.logo;
  const heroAlt = (i) => (hero[i] && hero[i].alt) || (productos[i] && productos[i].nombre) || nombre;
  const HERO = await Promise.all([0, 1, 2].map((i) => optimizar(heroFoto(i), 900)));

  // Tabla estática de precios por mayor (la calculadora de app.js la mejora)
  const conMayor = productos.filter((p) => p.mayor.length && !p.agotado && p.precio > 0);
  const tablaMayor = conMayor.map((p) => `
            <tr><th scope="row">${esc(p.nombre)}</th><td>${clp(p.precio)}</td>${p.mayor.map((t) => `<td>${t.desde}+ · ${clp(t.precio)}</td>`).join('')}</tr>`).join('');

  const precios = productos.map((p) => p.precio).filter((x) => x > 0);
  const pageUrl = `${SITE}/${modo}/`;
  sitemap.push(pageUrl);
  const SEO_TITULO = str(cfg.seo_titulo) || `${nombre} · ${str(cfg.rubro)}`;
  const SEO_DESCRIPCION = str(cfg.seo_descripcion) || str(T.hero_bajada);
  const OG_IMAGE = abs(heroFoto(0));
  const sameAs = [instagram && `https://www.instagram.com/${instagram}/`, tiktok && `https://www.tiktok.com/@${tiktok}`].filter(Boolean);
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': str(cfg.schema_tipo) || 'ClothingStore',
        '@id': `${pageUrl}#tienda`,
        name: nombre,
        description: SEO_DESCRIPCION,
        url: pageUrl,
        logo: abs(cfg.logo),
        image: [OG_IMAGE, abs(cfg.logo)],
        email: A.email || undefined,
        telephone: `+${A.whatsapp}`,
        areaServed: { '@type': 'Country', name: 'Chile' },
        priceRange: precios.length ? `${clp(Math.min(...precios))} – ${clp(Math.max(...precios))}` : undefined,
        currenciesAccepted: 'CLP',
        address: { '@type': 'PostalAddress', addressLocality: A.ciudad || undefined, addressRegion: A.region || undefined, addressCountry: 'CL' },
        sameAs: sameAs.length ? sameAs : undefined,
      },
      {
        '@type': 'ItemList',
        name: `Catálogo ${nombre}`,
        // Google exige precio en los Product: los "Consultar precio" quedan fuera
        itemListElement: productos.filter((p) => p.precio > 0).map((p, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          item: {
            '@type': 'Product',
            name: p.nombre,
            sku: p.codigo,
            image: [p.foto, ...p.fotos].map(abs),
            description: p.descripcion || p.nombre,
            offers: {
              '@type': 'Offer',
              url: `${pageUrl}#catalogo`,
              price: p.precio,
              priceCurrency: 'CLP',
              availability: `https://schema.org/${p.agotado ? 'OutOfStock' : 'InStock'}`,
              seller: { '@id': `${pageUrl}#tienda` },
            },
          },
        })),
      },
    ],
  };
  const otro = MODOS.find((m) => m !== modo);
  const cfgOtro = config.tiendas[otro] || {};
  const head = seoHead(pageUrl, nombre, SEO_TITULO, SEO_DESCRIPCION, OG_IMAGE, jsonLd);

  const VARS = {
    MODO: modo, HOMBRE: modo === 'hombre' ? '1' : '', MUJER: modo === 'mujer' ? '1' : '',
    NOMBRE: nombre, ETIQUETA: str(cfg.etiqueta), RUBRO: str(cfg.rubro), LOGO: url(cfg.logo),
    OTRO: otro || '', OTRO_NOMBRE: str(cfgOtro.nombre), OTRO_ETIQUETA: str(cfgOtro.etiqueta), OTRO_LOGO: url(cfgOtro.logo || cfg.logo),
    SEO_TITULO, SEO_DESCRIPCION,
    INSTAGRAM: instagram, TIKTOK: tiktok, SEGUIDORES: str(T.seguidores),
    IG_DM: instagram ? `https://ig.me/m/${instagram}` : '',
    HERO_TITULO: str(T.hero_titulo), HERO_DESTACADO: str(T.hero_destacado), HERO_BAJADA: str(T.hero_bajada),
    HERO_1: url(HERO[0]), HERO_1_ALT: heroAlt(0), HERO_2: url(HERO[1]), HERO_2_ALT: heroAlt(1), HERO_3: url(HERO[2]), HERO_3_ALT: heroAlt(2),
    DESDE: precios.length ? clp(Math.min(...precios)) : '',
    N_PRODUCTOS: String(productos.length),
    AVISO: str(T.aviso),
    CIUDAD: A.ciudad, ENVIOS: A.envios, EMAIL: A.email,
    FUENTES_URL: fuentesUrl(cfg.fuentes || {}),
    MAYOR: conMayor.length ? '1' : '',
    MAYOR_DESDE: conMayor.length ? String(Math.min(...conMayor.map((p) => p.mayor[0].desde))) : '',
    FLYER: FLYER_OPT ? url(FLYER_OPT) : '', FLYER_POPUP: F.popup ? url(FLYER_OPT) : '', FLYER_TITULO: F.titulo, FLYER_TEXTO: F.descripcion,
    FLYER_WA: waUrl(str(flyer.mensaje_whatsapp) || `Hola! Quiero la oferta ${cfg.emoji || ''}`),
    WA_CONTACTO: waUrl(str(T.mensaje_contacto) || 'Hola! Quiero hacer una consulta'),
    FRANJA_SEG: String(Math.round(vuelta.length * 5 * (VELOCIDAD[f1.velocidad] || 1))),
    ANO: String(new Date().getFullYear()),
    // Solo lo que necesita el navegador (app.js)
    TIENDA_JSON: JSON.stringify({
      modo, nombre, whatsapp: A.whatsapp, instagram, prefijo, emoji: str(cfg.emoji) || '🔥',
      ciudad: A.ciudad, empresas_envio: A.empresas_envio, mensaje: str(T.mensaje_contacto),
    }).replace(/</g, '\\u003c'),
  };

  const html = render(PLANTILLA_TIENDA, 'tienda.html', VARS, true)
    .replace(/<!-- SEO:HEAD[^>]*-->/, head)
    .replace('<!-- SEO:PRODUCTOS -->', productos.map((p) => card(p)).join(''))
    .replace(/<!-- ENTREGAS:LISTA[^>]*-->/, entregas.map(entregaHtml).join(''))
    .replace('<!-- MAYOR:TABLA -->', tablaMayor)
    // la franja lleva sus frases 2 veces seguidas: la animación corre la mitad y vuelve a empezar sin salto
    .replaceAll('<!-- FRANJA1 -->', [...vuelta, ...vuelta].map((t) => `<span>${esc(t)}</span>`).join(''));
  mkdirSync(join(DIST, modo), { recursive: true });
  writeFileSync(join(DIST, modo, 'index.html'), html);

  resumen[modo] = { nombre, instagram, seguidores: str(T.seguidores), hero: HERO[0], heroAlt: heroAlt(0), logo: cfg.logo, desde: VARS.DESDE, n: productos.length };
}

// ---------- 3. Portada (elegir tienda) ----------
function seoHead(pageUrl, nombre, titulo, descripcion, imagen, jsonLd) {
  return `<link rel="canonical" href="${pageUrl}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${pageUrl}">
  <meta property="og:title" content="${esc(titulo)}">
  <meta property="og:description" content="${esc(descripcion)}">
  <meta property="og:image" content="${imagen}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;
}

const H = resumen.hombre || {};
const M = resumen.mujer || {};
const portadaLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: str(config.nombre),
  url: `${SITE}/`,
  hasPart: MODOS.map((m) => ({ '@type': 'WebPage', name: resumen[m].nombre, url: `${SITE}/${m}/` })),
};
const PV = {
  NOMBRE: str(config.nombre),
  SEO_TITULO: str(config.seo_titulo), SEO_DESCRIPCION: str(config.seo_descripcion),
  H_NOMBRE: H.nombre || '', H_INSTAGRAM: H.instagram || '', H_SEGUIDORES: H.seguidores || '', H_FOTO: url(H.hero || ''), H_FOTO_ALT: H.heroAlt || '', H_LOGO: url(H.logo || ''), H_DESDE: H.desde || '',
  M_NOMBRE: M.nombre || '', M_INSTAGRAM: M.instagram || '', M_SEGUIDORES: M.seguidores || '', M_FOTO: url(M.hero || ''), M_FOTO_ALT: M.heroAlt || '', M_LOGO: url(M.logo || ''), M_DESDE: M.desde || '',
  ENVIOS: A.envios,
  FUENTES_URL: `https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&family=Bagel+Fat+One&family=Manrope:wght@500;700&display=swap`,
};
let portada = render(PLANTILLA_PORTADA, 'index.html', PV, true)
  .replace(/<!-- SEO:HEAD[^>]*-->/, seoHead(`${SITE}/`, PV.NOMBRE, PV.SEO_TITULO, PV.SEO_DESCRIPCION, abs(H.hero || M.hero || ''), portadaLd));

// ---------- 4. dist/ ----------
cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(DATA, 'regiones.json'), join(DIST, 'data', 'regiones.json'));
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = readFileSync(join(ROOT, 'styles.css'), 'utf8');
const js = readFileSync(join(ROOT, 'app.js'), 'utf8').replace('%%CUPON_SAL%%', CUPON_SAL);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
const versionar = (html) => html
  .replace('href="/styles.css"', `href="/styles.css?v=${version(css)}"`)
  .replace('src="/app.js"', `src="/app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), versionar(portada));
for (const modo of MODOS) {
  const f = join(DIST, modo, 'index.html');
  writeFileSync(f, versionar(readFileSync(f, 'utf8')));
}
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', { GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/` }, false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
const lastmod = new Date().toISOString().slice(0, 10);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemap.map((u) => `  <url><loc>${u}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}
</urlset>
`);
console.log(`✅ sitio listo en dist/ para ${SITE} (portada + ${MODOS.map((m) => '/' + m + '/').join(' + ')})`);
