// ===== CONFIGURACIÓN =====
// Un solo app.js para las 2 tiendas. Los datos de la tienda actual (hombre o mujer) los escribe
// scripts/build.mjs dentro de la página, en <script id="tiendaData">.
const TIENDA = (() => { try { return JSON.parse(document.getElementById('tiendaData').textContent); } catch (e) { return {}; } })();
const MODO = TIENDA.modo || 'hombre';
const WHATSAPP_NUMBER = TIENDA.whatsapp;
const EMOJI = TIENDA.emoji || '🔥';
const CALMA = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const MOUSE = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const ENTREGAS = {
  presencial: 'Entrega presencial (coordinamos el punto)',
  retiro: 'Retiro (lo coordinamos por WhatsApp)',
  envio: 'Envío',
};
const PAGOS = {
  transferencia: '🏦 *Pago:* Transferencia',
  efectivo: '💵 *Pago:* Efectivo al recibir',
  tarjeta: '💳 *Pago:* Débito o crédito',
};

// Buscadores oficiales de sucursales (ninguna de las 3 empresas tiene una API pública sin contrato)
const COURIERS = {
  Starken: 'https://www.starken.cl/sucursales',
  Chilexpress: 'https://centrodeayuda.chilexpress.cl/sucursales',
  'Blue Express': 'https://www.blue.cl/lockers-puntos/encuentra-tu-punto',
};
const EMPRESAS = (TIENDA.empresas_envio || []).filter((e) => COURIERS[e]);

// Productos, categorías y códigos se editan desde /admin y se publican en /data/catalogo-<tienda>.json
let PRODUCTS = [];
let FILTERS = [['todos', 'Todos']];
let REGIONES = [];
let CUPONES = [];

const SORTS = {
  destacados: null,
  'precio-asc': (a, b) => a.price - b.price,
  'precio-desc': (a, b) => b.price - a.price,
};
const MAX_QTY = 60; // alcanza para pedidos por mayor
const SURTIDAS = 'Surtidas'; // talla de los pedidos por mayor armados en la calculadora

// ===== UTILIDADES =====
const clp = (n) => '$' + Math.round(n).toLocaleString('es-CL');
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const findProduct = (id) => PRODUCTS.find((p) => p.id === id);
const priceText = (p) => (p.price > 0 ? clp(p.price) : 'Consultar precio');
const src = (s) => '/' + String(s || '').replace(/^\//, '');
// Se usa api.whatsapp.com y no wa.me: la redirección de wa.me rompe los emojis (llegan como �)
const waUrl = (text) =>
  `https://api.whatsapp.com/send?phone=${WHATSAPP_NUMBER}${text ? '&text=' + encodeURIComponent(text) : ''}`;

// Precio por mayor: el precio por unidad baja según cuántas unidades del mismo modelo lleva (mezclando tallas)
const unitPrice = (p, qty) => p.mayor.reduce((u, t) => (qty >= t.desde ? t.precio : u), p.price);
const mayorTexto = (p) => p.mayor.map((t) => `${t.desde}+ u. ${clp(t.precio)}`).join(' · ');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('is-on');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('is-on'), 2400);
}

// Fotos con otra proporción que el marco 4:5 (fotos cuadradas, flyers) se muestran completas,
// sin recortar, sobre un fondo difuminado de la misma imagen
function fitImage(img) {
  const box = img.closest('.card__img, .pm__frame');
  if (!box || !img.naturalWidth || img.classList.contains('alt')) return;
  const r = img.naturalHeight / img.naturalWidth;
  const fit = r > 1.45 || r < 1.1;
  box.classList.toggle('is-fit', fit);
  if (fit) box.style.setProperty('--fit-bg', `url("${img.currentSrc || img.src}")`);
}
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG') fitImage(e.target); }, true);
const fitAll = (root) => root.querySelectorAll('.card__img img, .pm__frame img').forEach((img) => { if (img.complete) fitImage(img); });
fitAll(document);

function lockScroll() {
  const open = ['#productModal', '#bag', '#promoModal'].some((s) => { const el = $(s); return el && el.classList.contains('is-open'); });
  document.body.style.overflow = open ? 'hidden' : '';
}

// ===== APARECER AL HACER SCROLL =====
const revealer = 'IntersectionObserver' in window && !CALMA
  ? new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (!isIntersecting) return;
    target.classList.add('is-in');
    revealer.unobserve(target);
  }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 })
  : null;
function reveal(root = document) {
  root.querySelectorAll('[data-reveal]:not(.is-in), .card:not(.is-in)').forEach((el, i) => {
    if (!revealer) { el.classList.add('is-in'); return; }
    if (el.classList.contains('card')) el.style.setProperty('--d', `${(i % 4) * 70}ms`); // cascada por fila
    revealer.observe(el);
  });
}

// ===== CATÁLOGO =====
const grid = $('#productGrid');
const filters = $('#filters');
let currentCat = 'todos';

function renderFilters(active) {
  const count = (k) => (k === 'todos' ? PRODUCTS.length : PRODUCTS.filter((p) => p.tags.includes(k)).length);
  filters.innerHTML = FILTERS
    .filter(([k]) => count(k) > 0) // oculta categorías vacías
    .map(([k, label]) => `<button class="tab ${k === active ? 'is-active' : ''}" role="tab" aria-selected="${k === active}" data-cat="${esc(k)}">${esc(label)}<span class="tab__n">${count(k)}</span></button>`)
    .join('');
}

// Misma tarjeta que escribe scripts/build.mjs en el HTML (para Google)
const card = (p) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.name)}">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.badge ? `<span class="badge">${esc(p.badge)}</span>` : ''}
        ${p.gallery.length > 1 ? `<span class="card__more">+${p.gallery.length - 1} ${p.gallery.length === 2 ? 'foto' : 'fotos'}</span>` : ''}
        <img src="${esc(p.thumb)}" alt="${esc(p.name)}" loading="lazy" decoding="async">
        ${p.thumbs[1] ? `<img class="alt" src="${esc(p.thumbs[1])}" alt="" loading="lazy" decoding="async">` : ''}
        <span class="card__tape" aria-hidden="true"></span>
        <span class="card__sticker" aria-hidden="true">${p.price > 0 ? clp(p.price) : '¿Precio?'}</span>
      </button>
      <div class="card__body">
        <p class="card__code">${esc(p.code)}</p>
        <h3>${esc(p.name)}</h3>
        ${p.sizes.length ? `<ul class="sizes" aria-label="Tallas disponibles">${p.sizes.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${p.mayor.length ? `<p class="card__mayor"><span>Por mayor</span> desde ${p.mayor[0].desde} u. · ${clp(p.mayor[p.mayor.length - 1].precio)}–${clp(p.mayor[0].precio)} c/u</p>` : ''}
        <div class="card__foot">
          <span class="price${p.price > 0 ? '' : ' price--ask'}">${priceText(p)}</span>
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(waUrl(`Hola! ¿Tienen stock de ${p.name}?`))}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm" type="button" data-view="${esc(p.id)}">${p.sizes.length > 1 || p.models.length > 1 ? 'Elegir' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`;

function renderProducts(cat = currentCat) {
  currentCat = cat;
  let list = cat === 'todos' ? PRODUCTS : PRODUCTS.filter((p) => p.tags.includes(cat));
  const sort = SORTS[$('#sort').value];
  if (sort) list = [...list].sort(sort);
  $('#count').innerHTML = `Mostrando <strong>${list.length}</strong> ${list.length === 1 ? 'modelo' : 'modelos'}`;
  grid.innerHTML = list.map(card).join('');
  fitAll(grid);
  reveal(grid);
}

filters.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-cat]');
  if (!btn) return;
  renderFilters(btn.dataset.cat);
  renderProducts(btn.dataset.cat);
});
$('#sort').addEventListener('change', () => renderProducts());

// ===== FICHA DE PRODUCTO =====
const pModal = $('#productModal');
let current = null;
let photo = 0;
let pick = { size: '', model: '', qty: 1 };
let lastFocus = null;

function showPhoto(i) {
  const g = current.gallery;
  photo = (i + g.length) % g.length;
  $('#pmImg').src = g[photo];
  fitImage($('#pmImg'));
  $('#pmThumbs').querySelectorAll('button').forEach((b, k) => b.classList.toggle('is-active', k === photo));
}

const radios = (list, sel, attr) => list
  .map((t) => `<button type="button" role="radio" aria-checked="${t === sel}" data-${attr}="${esc(t)}">${esc(t)}</button>`)
  .join('');
function renderPicks() {
  $('#pmSizes').innerHTML = radios(current.sizes, pick.size, 'size');
  $('#pmModels').innerHTML = radios(current.models, pick.model, 'model');
}

function openProduct(id) {
  const p = findProduct(id);
  if (!p) return;
  lastFocus = document.activeElement;
  current = p;
  pick = { size: p.sizes.length === 1 ? p.sizes[0] : '', model: p.models.length === 1 ? p.models[0] : '', qty: 1 };

  $('#pmImg').alt = p.name;
  $('#pmThumbs').innerHTML = p.gallery.length > 1
    ? p.thumbs.map((s, i) => `<button type="button" data-photo="${i}" aria-label="Foto ${i + 1}"><img src="${esc(s)}" alt="" loading="lazy"></button>`).join('')
    : '';
  pModal.classList.toggle('has-gallery', p.gallery.length > 1);
  showPhoto(0);
  $('#pmCat').textContent = [p.code, ...FILTERS.filter(([k]) => p.tags.includes(k)).map(([, l]) => l)].join(' · ');
  $('#pmName').textContent = p.name;
  $('#pmPrice').textContent = priceText(p);
  $('#pmMayor').hidden = !p.mayor.length;
  $('#pmMayor').innerHTML = p.mayor.length
    ? `<strong>Precio por mayor</strong><span>${p.mayor.map((t) => `<b>${t.desde}+</b> ${clp(t.precio)} c/u`).join('')}</span><small>Se aplica solo en tu bolsa al llegar a la cantidad (puedes mezclar tallas).</small>`
    : '';
  $('#pmDesc').textContent = p.desc;
  $('#pmModelsWrap').hidden = !p.models.length;
  $('#pmSizesWrap').hidden = !p.sizes.length;
  $('#pmSizeHint').textContent = p.sizes.length === 1 ? '· única disponible' : '';
  renderPicks();
  $('#pmQty').textContent = '1';
  $('#pmError').hidden = true;
  $('#pmAdd').hidden = p.agotado;
  document.querySelector('.pm__qty').hidden = p.agotado;
  $('#pmAsk').href = waUrl(`Hola! Quiero consultar por ${p.name} (${p.code}) ${EMOJI}`);

  pModal.classList.add('is-open');
  pModal.setAttribute('aria-hidden', 'false');
  lockScroll();
  $('#pmAdd').hidden ? $('#pmAsk').focus() : pModal.querySelector('.modal__close').focus();
}

function closeProduct() {
  if (!pModal.classList.contains('is-open')) return;
  pModal.classList.remove('is-open');
  pModal.setAttribute('aria-hidden', 'true');
  lockScroll();
  if (lastFocus && !bagEl.classList.contains('is-open')) lastFocus.focus();
}

pModal.addEventListener('click', (e) => {
  const t = e.target;
  if (t.closest('[data-close]')) { closeProduct(); return; }
  const thumb = t.closest('[data-photo]');
  if (thumb) showPhoto(Number(thumb.dataset.photo));
  const step = t.closest('[data-step-photo]');
  if (step) showPhoto(photo + Number(step.dataset.stepPhoto));
  const size = t.closest('[data-size]');
  if (size) { pick.size = size.dataset.size; $('#pmError').hidden = true; renderPicks(); }
  const model = t.closest('[data-model]');
  if (model) {
    pick.model = model.dataset.model;
    $('#pmError').hidden = true;
    renderPicks();
    // cada modelo corresponde a la foto del mismo número (modelo 2 = foto 2)
    const i = current.models.indexOf(pick.model);
    if (i >= 0 && i < current.gallery.length) showPhoto(i);
  }
  const q = t.closest('[data-qty]');
  if (q) {
    pick.qty = Math.min(MAX_QTY, Math.max(1, pick.qty + Number(q.dataset.qty)));
    $('#pmQty').textContent = pick.qty;
  }
});

// Deslizar la foto con el dedo en el celular
let touchX = null;
$('#pmImg').addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
$('#pmImg').addEventListener('touchend', (e) => {
  if (touchX === null || current.gallery.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 40) showPhoto(photo + (dx < 0 ? 1 : -1));
  touchX = null;
});

$('#pmAdd').addEventListener('click', () => {
  const falta = [current.models.length && !pick.model && 'el modelo', current.sizes.length && !pick.size && 'tu talla'].filter(Boolean);
  if (falta.length) {
    $('#pmError').textContent = `Elige ${falta.join(' y ')} para agregarlo a la bolsa.`;
    $('#pmError').hidden = false;
    return;
  }
  addToBag(current.id, pick.size, pick.model, pick.qty);
  closeProduct();
  toast(`${current.name}${pick.model ? ` · ${pick.model}` : ''}${pick.size ? ` · talla ${pick.size}` : ''} agregado a tu bolsa`);
});

// ===== BOLSA =====
// Cada tienda tiene su propia bolsa, guardada en este navegador para no perderla al recargar
const bagEl = $('#bag');
const BAG_KEY = `ex7Bag-${MODO}`;
let BAG = [];
try { BAG = JSON.parse(localStorage.getItem(BAG_KEY) || '[]'); } catch (e) { BAG = []; }
if (!Array.isArray(BAG)) BAG = [];
BAG = BAG.filter((l) => l && l.id).map((l) => ({ id: l.id, size: l.size || '', model: l.model || '', qty: Math.max(1, Number(l.qty) || 1) }));

function saveBag() {
  try { localStorage.setItem(BAG_KEY, JSON.stringify(BAG)); } catch (e) {}
}

const sameLine = (a, b) => a.id === b.id && a.size === b.size && a.model === b.model;
function addToBag(id, size, model, qty) {
  const nueva = { id, size, model, qty };
  const line = BAG.find((l) => sameLine(l, nueva));
  if (line) line.qty = Math.min(MAX_QTY, line.qty + qty);
  else BAG.push(nueva);
  saveBag();
  renderBag(true);
  burst();
}

// Productos borrados o agotados desde el panel se descartan solos. Si una talla o modelo dejó de existir, se marca.
// El precio por unidad considera el total de unidades del mismo producto (precio por mayor).
function bagLines() {
  const lines = BAG.map((l) => ({ ...l, p: findProduct(l.id) })).filter((l) => l.p && !l.p.agotado);
  const unidades = {};
  lines.forEach((l) => { unidades[l.id] = (unidades[l.id] || 0) + l.qty; });
  return lines.map((l) => {
    const unit = l.p.price ? unitPrice(l.p, unidades[l.id]) : 0;
    return {
      ...l,
      unit,
      sub: unit * l.qty,
      mayor: l.p.price > 0 && unit < l.p.price,
      sinTalla: !!l.size && l.size !== SURTIDAS && !l.p.sizes.includes(l.size),
      sinModelo: !!l.model && !l.p.models.includes(l.model),
    };
  });
}
const bagTotal = () => bagLines().reduce((s, l) => s + l.sub, 0);
const aCotizar = () => bagLines().some((l) => !l.p.price);

// ===== CÓDIGOS DE DESCUENTO =====
// Se crean en /admin → Códigos de descuento. El catálogo trae solo su huella SHA-256 (no el código en texto):
// aquí se calcula la huella de lo que escribe el cliente y se compara. La sal la escribe scripts/build.mjs.
const CUPON_SAL = '%%CUPON_SAL%%';
const CUPON_KEY = `ex7Cupon-${MODO}`;
let CUPON = null; // { codigo, c } del código aplicado
const normCodigo = (c) => String(c || '').toUpperCase().replace(/\s+/g, '');
const hoyChile = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' });
const fechaCL = (iso) => iso.split('-').reverse().join('-');

async function huella(codigo) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(CUPON_SAL + normCodigo(codigo)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const cuponTexto = (c) => (c.tipo === 'monto' ? `${clp(c.valor)} de descuento` : `${c.valor}% de descuento`);
const aplicaA = (c, id) => !c.productos || c.productos.includes(id);

// Descuento del código aplicado sobre la bolsa actual
function descuento() {
  if (!CUPON) return null;
  const c = CUPON.c;
  const base = bagLines().filter((l) => l.p.price && aplicaA(c, l.id)).reduce((s, l) => s + l.sub, 0);
  if (!base) return { c, monto: 0, motivo: 'no-aplica' };
  if (c.minimo && base < c.minimo) return { c, monto: 0, motivo: 'minimo', falta: c.minimo - base };
  const monto = c.tipo === 'monto' ? Math.min(c.valor, base) : Math.round((base * c.valor) / 100);
  return { c, monto, base };
}
const totalFinal = () => bagTotal() - ((descuento() || {}).monto || 0);

async function aplicarCupon(codigo, silencioso) {
  const code = normCodigo(codigo);
  if (!code) return;
  let c = null;
  try {
    const h = await huella(code);
    c = CUPONES.find((x) => x.h === h && !(x.vence && x.vence < hoyChile())) || null;
  } catch (e) {
    console.error(e); // crypto.subtle solo existe en https o localhost
  }
  CUPON = c ? { codigo: code, c } : null;
  try { c ? localStorage.setItem(CUPON_KEY, code) : localStorage.removeItem(CUPON_KEY); } catch (e) {}
  if (!c && !silencioso) {
    const st = $('#cuponStatus');
    st.hidden = false;
    st.className = 'coupon__status is-bad';
    st.innerHTML = '<strong>Código no válido</strong><small>No existe o ya no está vigente. Revisa que esté bien escrito.</small>';
    return;
  }
  if (c && !silencioso) $('#fCupon').value = '';
  renderBag();
}

function quitarCupon() {
  CUPON = null;
  try { localStorage.removeItem(CUPON_KEY); } catch (e) {}
  $('#cuponStatus').hidden = true;
  renderBag();
}

function renderCupon() {
  const st = $('#cuponStatus');
  const d = descuento();
  $('#cuponForm').hidden = !!CUPON;
  if (!d) { if (!st.classList.contains('is-bad')) st.hidden = true; return; }
  const c = d.c;
  const detalle = [cuponTexto(c), c.aplica !== 'Toda la tienda' ? `en ${c.aplica}` : 'en toda la tienda', c.minimo ? `compra mínima ${clp(c.minimo)}` : '', c.vence ? `válido hasta el ${fechaCL(c.vence)}` : '']
    .filter(Boolean).join(' · ');
  const aviso = d.motivo === 'no-aplica'
    ? '<em>Este código no aplica a los productos de tu bolsa.</em>'
    : d.motivo === 'minimo' ? `<em>Te faltan ${clp(d.falta)} en productos de esta promo para usarlo.</em>` : '';
  st.hidden = false;
  st.className = `coupon__status ${d.monto ? 'is-ok' : 'is-warn'}`;
  st.innerHTML = `
    <span class="coupon__badge"><svg class="ic"><use href="#i-check"/></svg>Código válido</span>
    <strong>${esc(CUPON.codigo)} · ${esc(c.titulo)}</strong>
    <small>${esc(detalle)}</small>
    ${aviso}
    <button type="button" class="coupon__rm" data-quitar-cupon>Quitar código</button>`;
}

function renderBag(bump) {
  const lines = bagLines();
  const units = lines.reduce((s, l) => s + l.qty, 0);
  const n = $('#bagCount');
  n.hidden = !units;
  n.textContent = units;
  if (bump) { n.classList.remove('bump'); void n.offsetWidth; n.classList.add('bump'); }
  const fab = $('.fab');
  fab.hidden = !units;
  $('#fabLabel').textContent = `Mi bolsa (${units}) · ${clp(totalFinal())}`;

  $('#bagList').innerHTML = lines.map((l, i) => `
    <li class="bag-item">
      <img src="${esc(l.p.thumb || l.p.img)}" alt="">
      <div class="bag-item__main">
        <h4>${esc(l.p.name)}</h4>
        <small>${[
          l.model && `${esc(l.model)}${l.sinModelo ? ' <em>(ya no disponible)</em>' : ''}`,
          l.size && (l.size === SURTIDAS ? 'Tallas surtidas' : `Talla ${esc(l.size)}${l.sinTalla ? ' <em>(ya no disponible)</em>' : ''}`),
          l.p.price ? `${clp(l.unit)} c/u` : 'A cotizar',
        ].filter(Boolean).join(' · ')}</small>
        ${l.mayor ? '<span class="tag-off tag-off--mayor">Precio por mayor</span>' : ''}
        ${CUPON && l.p.price && aplicaA(CUPON.c, l.id) ? `<span class="tag-off">Código ${esc(CUPON.codigo)}</span>` : ''}
        <div class="qty">
          <button type="button" data-line="${i}" data-step="-1" aria-label="Menos">−</button>
          <span>${l.qty}</span>
          <button type="button" data-line="${i}" data-step="1" aria-label="Más">+</button>
        </div>
      </div>
      <div class="bag-item__side">
        <strong>${l.p.price ? clp(l.sub) : '—'}</strong>
        <button type="button" class="bag-item__rm" data-remove="${i}" aria-label="Quitar ${esc(l.p.name)}"><svg class="ic"><use href="#i-trash"/></svg></button>
      </div>
    </li>`).join('');
  $('#bagEmpty').hidden = !!lines.length;
  $('#couponBox').hidden = !lines.length || !CUPONES.length;
  renderCupon();
  $('#bagTitle').textContent = lines.length ? `Tu pedido (${units})` : 'Tu pedido';
  updateOrder();
}

$('#bagList').addEventListener('click', (e) => {
  const lines = bagLines();
  const step = e.target.closest('[data-step]');
  const rm = e.target.closest('[data-remove]');
  const line = step ? lines[step.dataset.line] : rm ? lines[rm.dataset.remove] : null;
  if (!line) return;
  const idx = BAG.findIndex((l) => sameLine(l, line));
  if (rm || BAG[idx].qty + Number(step.dataset.step) < 1) BAG.splice(idx, 1);
  else BAG[idx].qty = Math.min(MAX_QTY, BAG[idx].qty + Number(step.dataset.step));
  saveBag();
  renderBag();
});

function openBag(encargo) {
  closeProduct();
  renderBag();
  if (encargo) $('#encargoBox').open = true;
  bagEl.classList.add('is-open');
  bagEl.setAttribute('aria-hidden', 'false');
  lockScroll();
  (encargo ? $('#fEncargo') : bagEl.querySelector('.modal__close')).focus();
}
function closeBag() {
  bagEl.classList.remove('is-open');
  bagEl.setAttribute('aria-hidden', 'true');
  lockScroll();
}

// ===== PEDIDO =====
const form = $('#orderForm');
const fRegion = $('#fRegion');
const fComuna = $('#fComuna');
const radio = (name) => (form.querySelector(`input[name="${name}"]:checked`) || {}).value || '';

// Empresas de envío (las elige el dueño en /admin → Ajustes)
$('#fCourier').innerHTML = EMPRESAS
  .map((e, i) => `<label><input type="radio" name="courier" value="${esc(e)}"${i ? '' : ' checked'}><span>${esc(e)}</span></label>`)
  .join('');
$('#fCourier').style.setProperty('--n', Math.max(1, EMPRESAS.length));

function fillRegiones() {
  fRegion.innerHTML = '<option value="">Elige tu región</option>' +
    REGIONES.map((r, i) => `<option value="${i}">${esc(r.region)}</option>`).join('');
}
fRegion.addEventListener('change', () => {
  const r = REGIONES[fRegion.value];
  fComuna.disabled = !r;
  fComuna.innerHTML = r
    ? '<option value="">Elige tu comuna</option>' + r.comunas.map((c) => `<option>${esc(c)}</option>`).join('')
    : '<option value="">Primero la región</option>';
});

function readOrder() {
  const envio = radio('entrega') === 'envio';
  const r = REGIONES[fRegion.value];
  return {
    entrega: radio('entrega'),
    envio,
    nombre: $('#fNombre').value.trim(),
    sector: $('#fSector').value.trim(),
    region: r ? r.region : '',
    comuna: fComuna.value,
    courier: radio('courier'),
    modo: radio('modo'),
    sucursal: $('#fSucursal').value.trim(),
    direccion: $('#fDireccion').value.trim(),
    pago: radio('pago'),
    nota: $('#fNota').value.trim(),
    encargo: $('#fEncargo').value.trim(),
  };
}

// Código corto para identificar el pedido en el chat (ej: EXH-4K7Q)
const orderCode = () => `${TIENDA.prefijo || 'EX'}-` + Date.now().toString(36).slice(-4).toUpperCase();
let CODE = orderCode();

// *texto* = negrita y _texto_ = cursiva en WhatsApp
function buildMessage(o) {
  const lines = bagLines();
  const d = descuento();
  const L = [`${EMOJI} *PEDIDO ${String(TIENDA.nombre || '').toUpperCase()} · ${CODE}* ${EMOJI}`, '━━━━━━━━━━━━━━━'];
  if (lines.length) {
    L.push('🛒 *Productos*');
    lines.forEach((l, i) => {
      const detalle = [l.model, l.size && (l.size === SURTIDAS ? 'Tallas surtidas' : `Talla ${l.size}`), `x${l.qty}`].filter(Boolean).join(' · ');
      const off = d && d.monto && l.p.price && aplicaA(d.c, l.id) ? ' 🏷️' : '';
      L.push(`${i + 1}. *${l.p.name}* (${l.p.code}) · ${detalle} — ${l.p.price ? clp(l.sub) : '_a cotizar_'}${off}`);
      if (l.mayor) L.push(`   _Precio por mayor: ${clp(l.unit)} c/u_`);
    });
  }
  if (o.encargo) L.push(`📝 *Encargo:* _${o.encargo}_`);
  L.push('━━━━━━━━━━━━━━━');
  L.push(`🙋 *Nombre:* ${o.nombre || '_(por completar)_'}`);
  if (o.envio) {
    L.push(`🚚 *Entrega:* Envío por ${o.courier || '_(por definir)_'} · ${o.modo === 'domicilio' ? 'a domicilio' : 'retiro en sucursal'}`);
    L.push(`📍 *Destino:* ${o.comuna ? `${o.comuna}, ${o.region}` : '_(por completar)_'}`);
    if (o.modo === 'domicilio') L.push(`🏠 *Dirección:* ${o.direccion || '_(por completar)_'}`);
    else L.push(`🏢 *Sucursal:* ${o.sucursal || '_(por completar)_'}`);
  } else {
    L.push(`🤝 *Entrega:* ${ENTREGAS[o.entrega] || ENTREGAS.presencial}`);
    if (o.sector && o.entrega !== 'retiro') L.push(`📍 *Punto:* ${o.sector}`);
  }
  L.push(PAGOS[o.pago] || PAGOS.transferencia);
  if (o.nota) L.push(`💬 *Comentario:* _${o.nota}_`);
  L.push('━━━━━━━━━━━━━━━');
  if (lines.length) {
    if (d && d.monto) {
      L.push(`🧾 *Subtotal:* ${clp(bagTotal())}`);
      L.push(`🎟️ *Código ${CUPON.codigo}* _(${d.c.titulo} · ${d.c.tipo === 'monto' ? clp(d.c.valor) : d.c.valor + '%'})_: −${clp(d.monto)}`);
    }
    L.push(`💰 *TOTAL: ${clp(totalFinal())}*`);
    const extras = [aCotizar() && 'productos a cotizar', o.envio && 'envío a coordinar'].filter(Boolean);
    if (extras.length) L.push(`_(+ ${extras.join(' y ')})_`);
    L.push('');
    L.push(MODO === 'mujer' ? '¡Hola! Quiero confirmar stock de este pedido 🎀' : '¡Hola familia! Quiero confirmar stock de este pedido 🙌');
  } else {
    L.push(MODO === 'mujer' ? '¡Hola! Quiero cotizar este encargo 🎀' : '¡Hola familia! Quiero cotizar este encargo 🙌');
  }
  return L.join('\n');
}

// Vista previa con el formato de WhatsApp
const formatPreview = (text) => esc(text)
  .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
  .replace(/(^|\s|\(|—\s)_([^_\n]+)_/gm, '$1<em>$2</em>');

function updateOrder() {
  const o = readOrder();
  const lines = bagLines();
  document.querySelectorAll('[data-envio]').forEach((el) => { el.hidden = !o.envio; });
  document.querySelectorAll('[data-local]').forEach((el) => { el.hidden = o.envio; });
  document.querySelectorAll('[data-sector]').forEach((el) => { el.hidden = o.envio || o.entrega === 'retiro'; });
  document.querySelectorAll('[data-modo]').forEach((el) => { el.hidden = el.dataset.modo !== o.modo; });
  // efectivo solo se puede en entregas presenciales
  if (o.envio && o.pago === 'efectivo') form.querySelector('input[name="pago"][value="transferencia"]').checked = true;

  const loc = $('#fLocator');
  loc.hidden = o.modo !== 'sucursal' || !COURIERS[o.courier];
  if (COURIERS[o.courier]) {
    loc.href = COURIERS[o.courier];
    loc.innerHTML = `<svg class="ic"><use href="#i-ext"/></svg> Ver sucursales de ${esc(o.courier)}${o.comuna ? ` en ${esc(o.comuna)}` : ''}`;
  }

  $('#bagTotal').textContent = lines.length ? clp(totalFinal()) : '—';
  const d = descuento();
  $('#bagSums').hidden = !(d && d.monto);
  if (d && d.monto) {
    $('#bagSums').innerHTML = `<span>Subtotal</span><span>${clp(bagTotal())}</span><span>Código ${esc(CUPON.codigo)}</span><span class="off">−${clp(d.monto)}</span>`;
  }
  $('#bagTotalLabel').textContent = aCotizar() ? 'Total (sin productos a cotizar)' : 'Total';
  const surtidas = lines.some((l) => l.size === SURTIDAS);
  $('#bagHint').textContent = [
    o.envio
      ? 'El costo del envío se cotiza por WhatsApp según tu comuna y la empresa que elijas.'
      : o.entrega === 'retiro'
        ? 'Coordinamos contigo por WhatsApp el lugar y horario del retiro.'
        : 'Agendamos la entrega contigo por WhatsApp.',
    surtidas ? 'Pedido por mayor: escribe en «Comentario» cuántas unidades quieres de cada talla.' : '',
  ].filter(Boolean).join(' ');
  $('#msgPreview').innerHTML = formatPreview(buildMessage(readOrder()));
}

form.addEventListener('input', updateOrder);
form.addEventListener('change', updateOrder);

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const o = readOrder();
  const missing = [];
  if (!bagLines().length && !o.encargo) missing.push('agrega un producto o escribe tu encargo');
  if (!o.nombre) missing.push('tu nombre');
  if (o.envio) {
    if (!o.comuna) missing.push('región y comuna');
    if (!o.courier) missing.push('la empresa de envío');
    if (o.modo === 'domicilio' && !o.direccion) missing.push('la dirección');
    if (o.modo === 'sucursal' && !o.sucursal) missing.push('la sucursal donde retiras');
  }
  const err = $('#formError');
  if (missing.length) {
    err.textContent = 'Falta: ' + missing.join(', ') + '.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  window.open(waUrl(buildMessage(o)), '_blank', 'noopener');
  CODE = orderCode(); // el próximo pedido lleva otro código
  updateOrder();
});

$('#cuponBtn').addEventListener('click', () => aplicarCupon($('#fCupon').value));
$('#fCupon').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCupon($('#fCupon').value); } });
$('#fCupon').addEventListener('input', () => { const st = $('#cuponStatus'); if (st.classList.contains('is-bad')) st.hidden = true; });
$('#couponBox').addEventListener('click', (e) => { if (e.target.closest('[data-quitar-cupon]')) quitarCupon(); });

// ===== CALCULADORA POR MAYOR (solo tienda de hombre) =====
const calc = $('#mayorCalc');
let calcId = '';
function renderCalc() {
  if (!calc) return;
  const lista = PRODUCTS.filter((p) => p.mayor.length && p.price > 0 && !p.agotado);
  calc.hidden = !lista.length;
  if (!lista.length) return;
  if (!findProduct(calcId) || !lista.includes(findProduct(calcId))) calcId = lista[0].id;
  const p = findProduct(calcId);
  const qty = Number($('#calcQty').value);
  const unit = unitPrice(p, qty);
  $('#calcProds').innerHTML = lista.map((x) => `
    <button type="button" role="radio" aria-checked="${x.id === calcId}" data-calc="${esc(x.id)}">
      <img src="${esc(x.thumb)}" alt="" loading="lazy"><span>${esc(x.name)}</span>
    </button>`).join('');
  const tramos = [{ desde: 1, precio: p.price }, ...p.mayor];
  $('#calcTiers').innerHTML = tramos.map((t, i) => {
    const hasta = tramos[i + 1] ? tramos[i + 1].desde - 1 : null;
    const on = qty >= t.desde && (hasta === null || qty <= hasta);
    return `<li class="${on ? 'is-on' : ''}"><span>${t.desde}${hasta === null ? '+' : hasta > t.desde ? `–${hasta}` : ''} u.</span><strong>${clp(t.precio)}</strong></li>`;
  }).join('');
  $('#calcQtyOut').textContent = qty;
  $('#calcUnit').textContent = clp(unit);
  $('#calcTotal').textContent = clp(unit * qty);
  const ahorro = (p.price - unit) * qty;
  const sig = p.mayor.find((t) => t.desde > qty);
  $('#calcAhorro').textContent = ahorro > 0
    ? `Te ahorras ${clp(ahorro)} vs. precio al detalle${sig ? ` · desde ${sig.desde} u. baja a ${clp(sig.precio)}` : ''}`
    : sig ? `Desde ${sig.desde} unidades pagas ${clp(sig.precio)} c/u` : '';
  $('#calcWa').href = waUrl(`Hola familia! Quiero cotizar por mayor: ${qty} x ${p.name} (${p.code}) a ${clp(unit)} c/u = ${clp(unit * qty)} 🥇`);
  $('#calcQty').style.setProperty('--p', `${((qty - 1) / (Number($('#calcQty').max) - 1)) * 100}%`);
}
if (calc) {
  $('#calcQty').addEventListener('input', renderCalc);
  $('#calcProds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-calc]');
    if (b) { calcId = b.dataset.calc; renderCalc(); }
  });
  $('#calcAdd').addEventListener('click', () => {
    const p = findProduct(calcId);
    if (!p) return;
    const qty = Number($('#calcQty').value);
    addToBag(p.id, p.sizes.length ? SURTIDAS : '', '', qty);
    toast(`${qty} x ${p.name} agregados a tu bolsa (tallas surtidas)`);
  });
}

// ===== EVENTOS GENERALES =====
document.addEventListener('click', (e) => {
  const view = e.target.closest('[data-view]');
  if (view) { openProduct(view.dataset.view); return; }
  if (e.target.closest('[data-encargo]')) { openBag(true); return; }
  if (e.target.closest('[data-open-bag]')) { openBag(); return; }
  if (e.target.closest('[data-close-bag]')) closeBag();
});
document.addEventListener('keydown', (e) => {
  if (pModal.classList.contains('is-open') && current && current.gallery.length > 1) {
    if (e.key === 'ArrowLeft') showPhoto(photo - 1);
    if (e.key === 'ArrowRight') showPhoto(photo + 1);
  }
  if (e.key !== 'Escape') return;
  if (pModal.classList.contains('is-open')) closeProduct();
  else closeBag();
});

// ===== CAMBIO DE TIENDA (switch Hombre / Mujer) =====
// Una cortina del color de la otra tienda cubre la pantalla desde el switch y la página nueva la recoge al cargar
const wipe = $('#wipe');
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-switch]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  const destino = a.dataset.switch;
  try { localStorage.setItem('ex7-modo', destino); } catch (err) {}
  if (destino === MODO) { e.preventDefault(); window.scrollTo({ top: 0, behavior: CALMA ? 'auto' : 'smooth' }); return; }
  if (CALMA || !wipe) return;
  e.preventDefault();
  const r = a.getBoundingClientRect();
  wipe.style.setProperty('--x', `${r.left + r.width / 2}px`);
  wipe.style.setProperty('--y', `${r.top + r.height / 2}px`);
  wipe.dataset.to = destino;
  document.documentElement.classList.add('is-leaving');
  try { sessionStorage.setItem('ex7-wipe', destino); } catch (err) {}
  setTimeout(() => { location.href = a.href; }, 560);
});
if (document.documentElement.classList.contains('is-arriving')) {
  try { sessionStorage.removeItem('ex7-wipe'); } catch (err) {}
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.classList.remove('is-arriving')));
}
// Al volver con "atrás" desde la otra tienda, la página no debe quedar tapada
window.addEventListener('pageshow', () => document.documentElement.classList.remove('is-leaving', 'is-arriving'));

// ===== MENÚ QUE SE VUELVE VIDRIO + REFLEJO QUE SIGUE EL SCROLL =====
const topBar = $('#top');
let ticking = false;
function onScroll() {
  ticking = false;
  const y = window.scrollY;
  topBar.classList.toggle('is-scrolled', y > 12);
  // la cinta reflectante (hombre) "brilla" al mover la página, como la luz de un auto sobre el reflectante
  if (MODO === 'hombre' && !CALMA) document.documentElement.style.setProperty('--sheen', `${(y * 0.12) % 200}%`);
}
window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
onScroll();

// ===== PORTADA: tarjetas que rotan (hombre) y fotos dentro del espejo (mujer) =====
function ciclo(el, paso) {
  if (!el || CALMA) return;
  let visible = true;
  let timer = null;
  const correr = () => { clearInterval(timer); if (visible && !document.hidden) timer = setInterval(paso, 3600); };
  if ('IntersectionObserver' in window) new IntersectionObserver(([en]) => { visible = en.isIntersecting; correr(); }).observe(el);
  document.addEventListener('visibilitychange', correr);
  correr();
}
const stack = $('#heroStack');
ciclo(stack, () => {
  const first = stack.querySelector('.stack__card');
  first.classList.add('is-out');
  setTimeout(() => { first.classList.remove('is-out'); stack.insertBefore(first, stack.querySelector('.stack__tag')); }, 520);
});
const mirror = $('#heroMirror');
ciclo(mirror, () => {
  const imgs = [...mirror.querySelectorAll('.mirror__glass img')];
  const i = imgs.findIndex((im) => im.classList.contains('is-on'));
  imgs[i].classList.remove('is-on');
  imgs[(i + 1) % imgs.length].classList.add('is-on');
});

// Botón que se acerca al mouse (solo con mouse)
if (MOUSE && !CALMA) {
  document.querySelectorAll('[data-magnet]').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.18}px, ${(e.clientY - r.top - r.height / 2) * 0.28}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });
}

// Al agregar a la bolsa: la de mujer suelta lazos y corazones; la de hombre, un destello en el botón
function burst() {
  if (CALMA) return;
  const btn = $('.bagbtn');
  const r = btn.getBoundingClientRect();
  if (MODO !== 'mujer') { btn.classList.remove('is-flash'); void btn.offsetWidth; btn.classList.add('is-flash'); return; }
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('span');
    s.className = 'burst';
    s.textContent = i % 3 ? '♥' : '🎀';
    s.style.left = `${r.left + r.width / 2}px`;
    s.style.top = `${r.top + r.height / 2}px`;
    s.style.setProperty('--dx', `${Math.round((Math.random() - 0.5) * 160)}px`);
    s.style.setProperty('--dy', `${Math.round(40 + Math.random() * 110)}px`);
    s.style.setProperty('--r', `${Math.round((Math.random() - 0.5) * 90)}deg`);
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 1000);
  }
}

// ===== FLYER EN VENTANA EMERGENTE (una vez por visita) =====
const promo = $('#promoModal');
if (promo) {
  const key = 'flyer-visto:' + promo.dataset.flyer; // un flyer nuevo se vuelve a mostrar
  const seen = () => { try { return sessionStorage.getItem(key); } catch { return null; } };
  const closePromo = () => {
    promo.classList.remove('is-open');
    promo.setAttribute('aria-hidden', 'true');
    lockScroll();
  };
  promo.addEventListener('click', (e) => { if (e.target.closest('[data-promo-close]')) closePromo(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && promo.classList.contains('is-open')) closePromo(); });
  if (!seen()) {
    setTimeout(() => {
      if (pModal.classList.contains('is-open') || bagEl.classList.contains('is-open')) return; // no interrumpir una compra en curso
      try { sessionStorage.setItem(key, '1'); } catch {}
      promo.classList.add('is-open');
      promo.setAttribute('aria-hidden', 'false');
      lockScroll();
      promo.querySelector('.modal__close').focus();
    }, 1500);
  }
}

// ===== VIDEOS DE ENTREGAS: se descargan al acercarse a la sección y solo se reproducen en pantalla =====
const reelVideos = document.querySelectorAll('.proof video');
const loadVideo = (v) => { if (v.dataset.src) { v.src = v.dataset.src; delete v.dataset.src; } };
if (reelVideos.length && 'IntersectionObserver' in window) {
  const near = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); near.unobserve(target); }
  }), { rootMargin: '600px 0px' });
  const io = new IntersectionObserver((entries) => entries.forEach(({ target, isIntersecting }) => {
    if (isIntersecting) { loadVideo(target); target.play().catch(() => {}); } else target.pause();
  }), { threshold: 0.25 });
  reelVideos.forEach((v) => { near.observe(v); io.observe(v); });
} else {
  reelVideos.forEach((v) => { loadVideo(v); v.autoplay = true; v.play().catch(() => {}); });
}

// ===== CARGA DEL CATÁLOGO =====
async function loadProducts() {
  fetch('/data/regiones.json')
    .then((r) => r.json())
    .then((d) => { REGIONES = Array.isArray(d.regiones) ? d.regiones : []; fillRegiones(); })
    .catch((e) => console.error(e));
  try {
    const res = await fetch(`/data/catalogo-${MODO}.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const categorias = Array.isArray(data.categorias) ? data.categorias : [];

    // producto -> categorías a las que pertenece (la categoría es la que dice qué productos tiene)
    const tagsOf = {};
    categorias.forEach((c) => (c.productos || []).forEach((id) => (tagsOf[id] = tagsOf[id] || []).push(c.id)));

    FILTERS = [['todos', 'Todos'], ...categorias.map((c) => [c.id, c.nombre])];
    CUPONES = Array.isArray(data.cupones) ? data.cupones : [];
    PRODUCTS = (data.productos || []).map((p) => {
      const img = src(p.foto);
      const fotos = Array.isArray(p.fotos) ? p.fotos.map(src) : [];
      // versiones livianas que genera el build (si faltan, se usan las originales)
      const minis = Array.isArray(p.minis) && p.minis.length === fotos.length ? p.minis.map(src) : fotos;
      const thumb = p.mini ? src(p.mini) : img;
      return {
        id: p.id,
        code: p.codigo || '',
        name: p.nombre,
        price: Number(p.precio) || 0,
        img,
        gallery: [img, ...fotos],
        thumb,
        thumbs: [thumb, ...minis],
        desc: p.descripcion || '',
        sizes: Array.isArray(p.tallas) ? p.tallas.map(String) : [],
        models: Array.isArray(p.modelos) ? p.modelos.map(String) : [],
        mayor: Array.isArray(p.mayor) ? p.mayor : [],
        tags: tagsOf[p.id] || [],
        badge: p.etiqueta || '',
        agotado: !!p.agotado,
      };
    });
  } catch (e) {
    console.error(e);
    reveal();
    return; // conserva el HTML que ya escribió el build
  }
  // sin precios cargados, ordenar por precio no tiene sentido
  if (!PRODUCTS.some((p) => p.price > 0)) document.querySelector('.sort').hidden = true;
  renderFilters('todos');
  renderProducts('todos');
  renderCalc();
  renderBag();
  // vuelve a validar el código que quedó guardado (pudo vencer o apagarse en /admin)
  let guardado = '';
  try { guardado = localStorage.getItem(CUPON_KEY) || ''; } catch (e) {}
  if (guardado && CUPONES.length) aplicarCupon(guardado, true);
}

reveal();
updateOrder();
loadProducts();
