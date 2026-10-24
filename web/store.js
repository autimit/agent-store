'use strict';

const $ = selector => document.querySelector(selector);
const CART_KEY = 'agent-store.cart.v2';
const CHECKOUT_KEY = 'agent-store.checkout.v2';
const ATTEMPT_KEY = 'agent-store.checkout-attempt.v2';
const DELIVERY_KEY = 'agent-store.delivery-draft.v1';
const dialog = $('#bag-dialog');
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const state = { product: null, cart: [], checkout: null, token: '', payment: 'pix', working: false, pending: false, resuming: false, version: 0, cartCleared: false, shipping: null, shippingResult: null, shippingVersion: 0, delivery: null, deliveryDraft: {}, detailColor: new URLSearchParams(location.search).get('cor') || 'aut-oliva', detailSize: '', detailShippingVersion: 0 };
const timers = new WeakMap();
let closing = false;

function read(key, fallback, storage = localStorage) { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } }
function write(key, value, storage = localStorage) { try { storage.setItem(key, JSON.stringify(value)); } catch {} }
function remove(key, storage = localStorage) { try { storage.removeItem(key); } catch {} }
function element(tag, className, text) { const e = document.createElement(tag); if (className) e.className = className; if (text !== undefined) e.textContent = text; return e; }
function variant(id) { return state.product?.variantes.find(v => v.id === id); }
function locked() { return state.working || state.pending || state.resuming || state.checkout?.status === 'open'; }
function errorMessage(message) { $('#sheet-error').textContent = message; }
function saveCart() { write(CART_KEY, state.cart); renderCount(); }
function persistCheckout() { write(CHECKOUT_KEY, { id: state.checkout.id, token: state.token, cartCleared: state.cartCleared }, sessionStorage); }
function renderCount() {
  const count = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  $('#bag-count').textContent = String(count);
  $('#bag-status').textContent = count ? `Sacola com ${count} ${count === 1 ? 'item' : 'itens'}.` : 'Sacola vazia.';
  $('#open-bag').setAttribute('aria-label', `Abrir sacola, ${count} ${count === 1 ? 'item' : 'itens'}`);
}
function renderCards() {
  document.querySelectorAll('.product-card[data-image-id]').forEach(card => {
    const variants = state.product?.variantes.filter(v => v.imagem_id === card.dataset.imageId) || [];
    if (variants.length) card.querySelector('.product-price').textContent = money(variants[0].preco_centavos);
  });
  renderProduct();
}
function invalidateShipping() { state.shipping = null; state.shippingResult = null; ++state.shippingVersion; }
async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, signal: AbortSignal.timeout(12000) }); }
  catch { throw new Error('Não foi possível conectar à loja. Tente novamente.'); }
  let data;
  try { data = await response.json(); } catch { const e = new Error('Resposta inesperada da loja. Tente novamente.'); e.status = response.status; throw e; }
  if (!response.ok) { const e = new Error(data.error?.message || 'Não foi possível concluir.'); e.status = response.status; e.code = data.error?.code; throw e; }
  return data;
}
async function loadProduct() {
  state.product = await api('/api/v1/products/aut-tshirt');
  state.cart = state.cart.filter(item => variant(item.variant_id));
  saveCart(); renderCards();
}
function reveal() { $('#sheet-content').classList.remove('view-enter'); requestAnimationFrame(() => $('#sheet-content').classList.add('view-enter')); }
function prepare(title, step) {
  dialog.scrollTop = 0;
  $('#bag-title').textContent = title; $('#sheet-step').textContent = step;
  $('#sheet-content').replaceChildren(); $('#sheet-actions').replaceChildren(); errorMessage('');
}
function button(label, className, action, id) {
  const b = element('button', className, label); b.type = 'button'; if (id) b.id = id; b.addEventListener('click', action); return b;
}
function summaryLine(label, value, strong = false) {
  const row = element('div', `summary-line${strong ? ' total-line' : ''}`); row.append(element('span', '', label), element(strong ? 'strong' : 'span', '', value)); return row;
}
function openBag() {
  if (closing) return;
  if (!dialog.open) { dialog.showModal(); $('#open-bag').setAttribute('aria-expanded', 'true'); }
}
function closeBag() {
  if (!dialog.open || closing) return;
  closing = true; dialog.classList.add('is-closing');
  setTimeout(() => { dialog.close(); dialog.classList.remove('is-closing'); closing = false; $('#open-bag').setAttribute('aria-expanded', 'false'); }, reducedMotion.matches ? 0 : 200);
}
function focusControl(key) { const control = [...dialog.querySelectorAll('[data-control]')].find(e => e.dataset.control === key); control?.focus({ preventScroll: true }); }
function updateItem(id, change, focusKey) {
  if (locked()) return;
  const item = state.cart.find(i => i.variant_id === id); if (!item) return;
  invalidateShipping(); item.quantity += change; state.cart = state.cart.filter(i => i.quantity > 0); saveCart(); renderCart(focusKey);
}
async function renderCart(focusKey) {
  const version = ++state.version;
  prepare('Sua sacola', '01 / REVISAR ITENS');
  const content = $('#sheet-content'), actions = $('#sheet-actions');
  if (!state.product) { content.append(element('p', 'empty-bag', 'Não foi possível carregar a loja.')); actions.append(button('Tentar novamente', 'primary-pill', async () => { try { await loadProduct(); renderCart(); } catch (e) { errorMessage(e.message); } })); return; }
  if (!state.cart.length) {
    content.append(element('div', 'empty-bag', 'Sua próxima escolha começa por aqui.'));
    actions.append(button('Explorar camisetas', 'primary-pill', closeBag)); reveal(); return;
  }
  const list = element('div', 'bag-items');
  for (const item of state.cart) {
    const v = variant(item.variant_id); if (!v) continue;
    const row = element('article', 'bag-item');
    const image = element('img', 'bag-item-image'); image.src = '/assets/t-shirt.png'; image.alt = `Camiseta AUT, referência da opção ${v.cor}`; image.width = 96; image.height = 112;
    const detail = element('div', 'bag-item-detail');
    detail.append(element('h3', '', 'AUT T-SHIRT'), element('p', 'item-color', v.cor));
    const sizeLabel = element('label', 'size-label', 'Tamanho'); const size = element('select'); size.setAttribute('aria-label', `Tamanho da camiseta ${v.cor}`); size.dataset.control = `size:${v.id}`; size.disabled = locked();
    state.product.variantes.filter(option => option.imagem_id === v.imagem_id).forEach(option => {
      const opt = element('option', '', option.tamanho); opt.value = option.id; opt.selected = option.id === v.id; opt.disabled = option.disponivel === 0; size.append(opt);
    });
    size.addEventListener('change', () => {
      if (locked()) return; invalidateShipping();
      const existing = state.cart.find(i => i.variant_id === size.value && i !== item);
      if (existing) { existing.quantity += item.quantity; state.cart = state.cart.filter(i => i !== item); } else item.variant_id = size.value;
      saveCart(); renderCart(`size:${size.value}`);
    }); sizeLabel.append(size); detail.append(sizeLabel);
    const quantity = element('div', 'quantity-control');
    const minus = button('−', 'quantity-button', () => updateItem(v.id, -1, `minus:${v.id}`)); minus.setAttribute('aria-label', `Diminuir quantidade, ${v.cor}`); minus.dataset.control = `minus:${v.id}`; minus.disabled = locked();
    const plus = button('+', 'quantity-button', () => updateItem(v.id, 1, `plus:${v.id}`)); plus.setAttribute('aria-label', `Aumentar quantidade, ${v.cor}`); plus.dataset.control = `plus:${v.id}`; plus.disabled = locked() || state.cart.reduce((sum, i) => sum + i.quantity, 0) >= 10 || item.quantity >= v.disponivel;
    quantity.append(minus, element('span', 'quantity-value', item.quantity), plus);
    const removeButton = button('Remover', 'remove-item', () => { if (locked()) return; invalidateShipping(); state.cart = state.cart.filter(i => i !== item); saveCart(); renderCart(); }); removeButton.setAttribute('aria-label', `Remover camiseta ${v.cor}`); removeButton.disabled = locked();
    const bottom = element('div', 'bag-item-bottom'); bottom.append(quantity, removeButton); detail.append(bottom);
    row.append(image, detail, element('span', 'item-price', money(v.preco_centavos * item.quantity))); list.append(row);
  }
  content.append(list);
  const totals = element('div', 'bag-totals');
  const subtotal = state.cart.reduce((sum, i) => sum + variant(i.variant_id).preco_centavos * i.quantity, 0);
  totals.append(summaryLine('Subtotal', money(subtotal)), summaryLine('Frete', 'Calcule na próxima etapa'), summaryLine('Total sem frete', money(subtotal), true));
  actions.append(totals);
  const continueButton = button(state.pending ? 'Retomar tentativa de checkout' : 'Continuar para entrega', 'primary-pill', state.pending ? startCheckout : renderDelivery, state.pending ? 'start-checkout' : 'continue-to-delivery'); continueButton.disabled = true;
  actions.append(continueButton, element('p', 'demo-note', 'Escolha o frete na próxima etapa. A reserva só é criada ao confirmar a entrega.'));
  reveal(); if (focusKey) focusControl(focusKey);
  if (state.pending) { continueButton.disabled = state.working; errorMessage('A resposta da última tentativa ficou incerta. Retome para recuperar o mesmo checkout, sem duplicar a reserva.'); return; }
  try {
    const quote = await api('/api/v1/quotes', { method: 'POST', body: JSON.stringify({ items: state.cart }) });
    if (state.version !== version) return;
    totals.replaceChildren(summaryLine('Subtotal', money(quote.subtotal_cents)), summaryLine('Frete', 'Calcule na próxima etapa'), summaryLine('Total sem frete', money(quote.total_cents), true)); continueButton.disabled = state.working;
  } catch (e) { if (state.version === version) errorMessage(e.message); }
}
function renderCheckout() {
  const c = state.checkout; if (!c) return;
  ++state.version;
  const completed = c.status === 'completed', open = c.status === 'open';
  prepare(completed ? 'Pedido confirmado' : open ? 'Seu checkout' : 'Vamos recomeçar?', completed ? '04 / TUDO CERTO' : '03 / PAGAMENTO DE TESTE');
  const content = $('#sheet-content'), actions = $('#sheet-actions');
  if (completed) content.append(element('div', 'success-symbol', '✓'));
  content.append(element('span', 'checkout-status', completed ? 'SIMULAÇÃO CONCLUÍDA' : open ? 'ITENS RESERVADOS' : c.status === 'expired' ? 'RESERVA EXPIRADA' : 'RESERVA CANCELADA'));
  content.append(element('h3', 'checkout-heading', completed ? 'Uma boa escolha.' : open ? `Tudo pronto para testar ${c.payment_method === 'pix' ? 'o Pix' : 'o cartão'}.` : 'Seu estoque foi liberado.'));
  content.append(element('p', 'checkout-description', completed ? 'Seu pedido foi salvo nesta demonstração. Nenhum valor foi cobrado e nenhum produto será enviado.' : open ? 'Este pagamento é simulado. Não é necessário enviar dinheiro ou informar dados de cartão.' : 'Volte à sacola para conferir a disponibilidade e criar um novo checkout.'));
  const list = element('div', 'checkout-items');
  for (const item of c.quote.items) { const row = element('div', 'checkout-item'); const name = element('div', '', `${item.quantity}× ${item.name}`); name.append(element('small', '', `${item.color} · ${item.size}`)); row.append(name, element('span', '', money(item.total_cents))); list.append(row); }
  content.append(list);
  renderDeliverySummary(content, c);
  if (open) {
    const expiry = element('p', 'reservation-expiry'); expiry.append(element('span', '', 'Reserva válida até '), element('strong', '', new Date(c.expires_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))); content.append(expiry);
  }
  if (completed) {
    const reference = element('div', 'order-reference');
    const number = element('code', '', 'AS-' + c.order_id.slice(-8).toUpperCase()); number.dataset.orderId = c.order_id;
    reference.append(element('span', '', 'Seu pedido de demonstração'), number); content.append(reference);
  }
  actions.append(summaryLine('Produtos', money(c.quote.subtotal_cents)), summaryLine('Frete', money(c.quote.shipping_cents)), summaryLine('Total de demonstração', money(c.quote.total_cents), true));
  if (open) {
    actions.append(button(`Simular pagamento com ${c.payment_method === 'pix' ? 'Pix' : 'cartão'}`, 'primary-pill', () => checkoutAction('simulate-payment'), 'simulate-payment'));
    actions.append(button('Cancelar e liberar estoque', 'secondary-pill', () => checkoutAction('cancel'), 'cancel-checkout'));
  } else {
    actions.append(button(completed ? 'Continuar comprando' : 'Voltar à sacola', 'primary-pill', () => {
      state.checkout = null; state.token = ''; remove(CHECKOUT_KEY, sessionStorage); renderCards();
      if (completed) closeBag(); else renderCart();
    }, 'continue-shopping'));
  }
  actions.append(element('p', 'demo-note', 'Pix e cartão são simulados. Sem cobrança ou entrega real.'));
  if (state.working) actions.querySelectorAll('button').forEach(b => { b.disabled = true; }); reveal();
}
async function startCheckout() {
  if (state.working) return;
  state.working = true; state.pending = true; renderCards();
  dialog.querySelectorAll('select, input, .quantity-button, .remove-item').forEach(control => { control.disabled = true; });
  $('#start-checkout').disabled = true; $('#start-checkout').textContent = 'Preparando seu checkout…'; errorMessage('');
  let attempt = read(ATTEMPT_KEY, null, sessionStorage);
  if (!attempt) {
    const items = state.cart.map(i => ({ variant_id: i.variant_id, quantity: i.quantity })).sort((a, b) => a.variant_id.localeCompare(b.variant_id));
    attempt = { key: crypto.randomUUID(), body: JSON.stringify({ items, payment_method: state.payment, shipping: state.shipping, delivery: state.delivery }) }; write(ATTEMPT_KEY, attempt, sessionStorage);
  }
  try {
    const c = await api('/api/v1/checkouts', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, body: attempt.body });
    state.checkout = c; state.token = c.access_token; state.cartCleared = false; state.pending = false; remove(ATTEMPT_KEY, sessionStorage);
    if (c.status === 'completed') { state.cart = []; state.cartCleared = true; saveCart(); }
    persistCheckout(); await loadProduct();
  } catch (e) {
    if (e.status >= 400 && e.status < 500) { state.pending = false; remove(ATTEMPT_KEY, sessionStorage); }
    state.working = false;
    if (state.checkout) { renderCheckout(); } else if (state.pending) { await renderCart(); } else { renderDelivery(); }
    errorMessage(e.message); renderCards(); return;
  } finally { state.working = false; renderCards(); }
  renderCheckout(); $('#bag-title').focus({ preventScroll: true });
}
async function refreshCheckout() {
  if (!state.checkout) return;
  const c = await api(`/api/v1/checkouts/${encodeURIComponent(state.checkout.id)}`, { headers: { Authorization: `Bearer ${state.token}` } });
  state.checkout = c;
  if (c.status === 'completed' && !state.cartCleared) { state.cart = []; state.cartCleared = true; saveCart(); }
  persistCheckout();
}
async function checkoutAction(action) {
  if (state.working || !state.checkout) return;
  state.working = true; renderCards(); $('#sheet-actions').querySelectorAll('button').forEach(b => { b.disabled = true; }); errorMessage('');
  let error = '';
  try {
    state.checkout = await api(`/api/v1/checkouts/${encodeURIComponent(state.checkout.id)}/${action}`, { method: 'POST', headers: { Authorization: `Bearer ${state.token}` }, body: '{}' });
    if (state.checkout.status === 'completed') { state.cart = []; state.cartCleared = true; saveCart(); }
    persistCheckout(); await loadProduct();
  } catch (e) {
    error = e.message;
    try {
      await refreshCheckout();
      if ((action === 'simulate-payment' && state.checkout.status === 'completed') || (action === 'cancel' && state.checkout.status === 'canceled')) error = '';
    } catch {}
  }
  finally { state.working = false; renderCards(); renderCheckout(); if (error) errorMessage(error); $('#bag-title').focus({ preventScroll: true }); }
}
async function showCurrentBag() {
  openBag();
  if (state.resuming) {
    prepare('Retomar checkout', 'SUA COMPRA EM ANDAMENTO');
    $('#sheet-content').append(element('p', 'checkout-description', 'Estamos recuperando sua compra para manter a mesma reserva.'));
    try { await refreshCheckout(); state.resuming = false; renderCards(); renderCheckout(); }
    catch (e) {
      if (e.status === 404) { state.resuming = false; state.checkout = null; remove(CHECKOUT_KEY, sessionStorage); renderCards(); await renderCart(); }
      else $('#sheet-actions').append(button('Tentar recuperar checkout', 'primary-pill', showCurrentBag));
      errorMessage(e.message);
    }
  } else if (state.checkout) {
    renderCheckout();
    try { await refreshCheckout(); renderCheckout(); await loadProduct(); } catch (e) { errorMessage(e.message); }
  } else await renderCart();
}
$('#open-bag').addEventListener('click', showCurrentBag);
$('#close-bag').addEventListener('click', closeBag);
dialog.addEventListener('cancel', event => { event.preventDefault(); closeBag(); });
dialog.addEventListener('click', event => { if (event.target !== dialog) return; const box = dialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeBag(); });

function renderProduct() {
  if (!$('#product-detail') || !state.product) return;
  const images = state.product.imagens;
  const image = images.find(i => i.id === state.detailColor) || images[0]; state.detailColor = image.id;
  const variants = state.product.variantes.filter(v => v.imagem_id === image.id);
  const chosen = variants.find(v => v.tamanho === state.detailSize);
  $('#detail-image').src = '/assets/t-shirt.png'; $('#detail-image').alt = `Camiseta AUT, referência ilustrativa da opção ${image.cor}`;
  $('#detail-color-name').textContent = image.cor; $('#detail-price').textContent = money((chosen || variants[0]).preco_centavos);
  $('#detail-colors').replaceChildren();
  for (const option of images) {
    const b = button(option.cor, `color-option${option.id === image.id ? ' selected' : ''}`, () => {
      state.detailColor = option.id; state.detailSize = ''; $('#detail-quantity').value = '1';
      history.replaceState(null, '', `/produto/aut-tshirt?cor=${encodeURIComponent(option.id)}`); renderProduct();
      [...$('#detail-colors').children].find(e => e.dataset.color === option.id)?.focus({ preventScroll: true });
    }); b.dataset.color = option.id; b.setAttribute('aria-pressed', String(option.id === image.id)); b.setAttribute('aria-label', `Cor ${option.cor}`); $('#detail-colors').append(b);
  }
  $('#detail-sizes').replaceChildren();
  for (const v of variants) {
    const b = button(v.tamanho, `detail-size${v.tamanho === state.detailSize ? ' selected' : ''}`, () => {
      state.detailSize = v.tamanho; $('#detail-quantity').value = '1'; renderProduct();
      [...$('#detail-sizes').children].find(e => e.dataset.size === v.tamanho)?.focus({ preventScroll: true });
    }); b.dataset.size = v.tamanho; b.disabled = v.disponivel === 0; b.setAttribute('aria-label', `Tamanho ${v.tamanho}${v.disponivel === 0 ? ', indisponível' : ''}`); b.setAttribute('aria-pressed', String(v.tamanho === state.detailSize)); $('#detail-sizes').append(b);
  }
  const valid = chosen && chosen.disponivel > 0;
  $('#detail-quantity').max = String(Math.min(valid ? chosen.disponivel : 10, 10));
  $('#detail-stock').textContent = valid ? `${chosen.disponivel} unidades disponíveis neste tamanho.` : chosen ? 'Tamanho indisponível.' : 'Escolha seu tamanho para conferir a disponibilidade.';
  $('#detail-add').disabled = !valid || locked();
  $('#detail-add').textContent = locked() ? 'Você tem uma compra em andamento' : valid ? 'Adicionar à sacola' : 'Escolha seu tamanho';
  $('#detail-resume').hidden = !locked();
  if (!$('#detail-postal-code').value && state.deliveryDraft.postal_code) $('#detail-postal-code').value = state.deliveryDraft.postal_code;
}
function addSelectedProduct() {
  const v = state.product?.variantes.find(v => v.imagem_id === state.detailColor && v.tamanho === state.detailSize);
  const quantity = Number($('#detail-quantity').value);
  if (!v || locked()) return;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(10, v.disponivel)) { $('#detail-message').textContent = 'Confira a quantidade disponível para este tamanho.'; return; }
  const item = state.cart.find(i => i.variant_id === v.id);
  if (state.cart.reduce((sum, i) => sum + i.quantity, 0) + quantity > 10 || (item?.quantity || 0) + quantity > v.disponivel) { $('#detail-message').textContent = 'A sacola já contém a quantidade disponível. Ajuste os itens para continuar.'; showCurrentBag(); return; }
  if (state.checkout) { state.checkout = null; state.token = ''; remove(CHECKOUT_KEY, sessionStorage); }
  invalidateShipping(); if (item) item.quantity += quantity; else state.cart.push({ variant_id: v.id, quantity });
  saveCart(); $('#detail-message').textContent = 'Camiseta adicionada à sacola.';
  $('#open-bag').classList.remove('bag-bump'); requestAnimationFrame(() => $('#open-bag').classList.add('bag-bump')); showCurrentBag();
}
async function calculateDetailShipping(event) {
  event.preventDefault();
  if (!state.product) return;
  const postal = $('#detail-postal-code'), output = $('#detail-shipping-options');
  if (!postal.reportValidity()) return;
  const v = state.product.variantes.find(v => v.imagem_id === state.detailColor && v.tamanho === state.detailSize) || state.product.variantes.find(v => v.imagem_id === state.detailColor && v.disponivel > 0);
  if (!v) { output.textContent = 'Esta opção está indisponível.'; return; }
  const serial = ++state.detailShippingVersion;
  output.textContent = 'Calculando opções…';
  try {
    const q = await api('/api/v1/shipping-quotes', { method: 'POST', body: JSON.stringify({ items: [{ variant_id: v.id, quantity: Math.max(1, Number($('#detail-quantity').value) || 1) }], postal_code: postal.value }) });
    if (serial !== state.detailShippingVersion) return;
    output.replaceChildren();
    for (const option of q.options) { const row = element('div', 'shipping-estimate'); row.append(element('span', '', `${option.name} · ${option.min_business_days} a ${option.max_business_days} dias úteis`), element('strong', '', money(option.price_cents))); output.append(row); }
    state.deliveryDraft.postal_code = q.postal_code; write(DELIVERY_KEY, state.deliveryDraft, sessionStorage);
  } catch (e) { if (serial === state.detailShippingVersion) output.textContent = e.message; }
}
const deliveryFields = ['full_name', 'email', 'phone', 'postal_code', 'street', 'number', 'complement', 'neighborhood', 'city', 'state'];
function captureDelivery(form) {
  const data = new FormData(form), draft = {};
  deliveryFields.forEach(name => { draft[name] = String(data.get(name) || '').trim(); });
  state.deliveryDraft = draft; write(DELIVERY_KEY, draft, sessionStorage); return draft;
}
function deliveryField(name, label, type = 'text', required = true, auto = '', max = 120) {
  const wrapper = element('label', `delivery-field field-${name}`); wrapper.append(element('span', '', label));
  let input;
  if (name === 'state') {
    input = element('select'); input.append(element('option', '', 'Selecione'));
    input.firstChild.value = '';
    'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ').forEach(uf => { const option = element('option', '', uf); option.value = uf; input.append(option); });
  } else { input = element('input'); input.type = type; input.maxLength = max; }
  input.name = name; input.id = `delivery-${name}`; input.required = required;
  input.autocomplete = auto || 'off'; input.value = state.deliveryDraft[name] || '';
  if (name === 'postal_code') { input.inputMode = 'numeric'; input.pattern = '[0-9]{5}-?[0-9]{3}'; input.placeholder = '00000-000'; input.maxLength = 9; }
  wrapper.append(input); return wrapper;
}
function renderDelivery() {
  if (locked() || !state.cart.length) { renderCart(); return; }
  const version = ++state.version;
  prepare('Entrega e contato', '02 / CALCULAR ENTREGA');
  const content = $('#sheet-content'), actions = $('#sheet-actions');
  const back = button('← Voltar à sacola', 'inline-back', () => renderCart()); content.append(back, element('p', 'delivery-intro', 'Use dados fictícios para experimentar a compra. Não haverá cobrança ou envio.'));
  const form = element('form', 'delivery-form'); form.id = 'delivery-form';
  const contact = element('div', 'delivery-fields'); contact.append(deliveryField('full_name', 'Nome completo', 'text', true, 'name'), deliveryField('email', 'E-mail', 'email', true, 'email', 254), deliveryField('phone', 'Telefone (opcional)', 'tel', false, 'tel', 25));
  form.append(contact);
  const postalRow = element('div', 'delivery-postal-row'); postalRow.append(deliveryField('postal_code', 'CEP', 'text', true, 'postal-code', 9));
  const calculate = button('Calcular frete', 'secondary-pill', calculateShipping, 'calculate-shipping'); postalRow.append(calculate); form.append(postalRow);
  const options = element('div', 'shipping-options'); options.id = 'shipping-options'; options.setAttribute('aria-live', 'polite'); form.append(options);
  const address = element('div', 'delivery-fields'); address.append(deliveryField('street', 'Rua / avenida', 'text', true, 'address-line1', 160), deliveryField('number', 'Número', 'text', true, 'off', 20), deliveryField('complement', 'Complemento (opcional)', 'text', false, 'address-line2'), deliveryField('neighborhood', 'Bairro', 'text', true, 'address-level3', 100), deliveryField('city', 'Cidade', 'text', true, 'address-level2', 100), deliveryField('state', 'UF', 'text', true, 'address-level1')); form.append(address);
  const methods = element('fieldset', 'payment-methods'); methods.append(element('legend', '', 'Como você quer testar o pagamento?'));
  for (const [value, title] of [['pix', 'Pix'], ['card', 'Cartão']]) {
    const label = element('label', 'payment-choice'), input = element('input'); input.type = 'radio'; input.name = 'payment-method'; input.value = value; input.checked = state.payment === value;
    input.addEventListener('change', () => { state.payment = value; }); label.append(input, element('span', '', title), element('small', '', 'Simulado')); methods.append(label);
  }
  form.append(methods); content.append(form);
  const totals = element('div', 'bag-totals'); totals.id = 'delivery-totals';
  const subtotal = state.cart.reduce((sum, item) => sum + variant(item.variant_id).preco_centavos * item.quantity, 0);
  totals.append(summaryLine('Produtos', money(subtotal)), summaryLine('Frete', 'A calcular'), summaryLine('Total sem frete', money(subtotal), true)); actions.append(totals);
  const submit = button('Continuar para pagamento', 'primary-pill', () => {}, 'start-checkout'); submit.type = 'submit'; submit.setAttribute('form', form.id); submit.disabled = true;
  actions.append(submit, element('p', 'demo-note', 'Frete e prazos simulados. Ao continuar, os itens ficam reservados por 15 minutos.'));
  form.addEventListener('input', event => {
    captureDelivery(form);
    if (event.target.name === 'postal_code') { invalidateShipping(); submit.disabled = true; options.replaceChildren(element('p', 'shipping-hint', 'Calcule novamente para este CEP.')); totals.replaceChildren(summaryLine('Produtos', money(subtotal)), summaryLine('Frete', 'A calcular'), summaryLine('Total sem frete', money(subtotal), true)); }
  });
  form.addEventListener('change', () => captureDelivery(form));
  form.addEventListener('submit', event => {
    event.preventDefault(); const draft = captureDelivery(form);
    if (!state.shipping || state.shipping.postal_code !== draft.postal_code.replace('-', '')) { errorMessage('Calcule o frete e escolha uma opção antes de continuar.'); return; }
    state.delivery = draft; startCheckout();
  });
  async function selectShipping(postal, serviceID) {
    const serial = ++state.shippingVersion; submit.disabled = true; state.shipping = null;
    const selection = { postal_code: postal, service_id: serviceID };
    try {
      const quote = await api('/api/v1/quotes', { method: 'POST', body: JSON.stringify({ items: state.cart, shipping: selection }) });
      if (state.version !== version || serial !== state.shippingVersion) return;
      state.shipping = selection;
      totals.replaceChildren(summaryLine('Produtos', money(quote.subtotal_cents)), summaryLine(`Frete ${quote.shipping_option.name.toLowerCase()}`, money(quote.shipping_cents)), summaryLine('Total', money(quote.total_cents), true)); submit.disabled = false;
    } catch (e) { if (state.version === version && serial === state.shippingVersion) errorMessage(e.message); }
  }
  async function calculateShipping() {
    const postal = form.elements.postal_code; if (!postal.reportValidity()) return;
    const serial = ++state.shippingVersion; state.shipping = null; submit.disabled = true; calculate.disabled = true; errorMessage(''); options.replaceChildren(element('p', 'shipping-hint', 'Calculando opções…'));
    try {
      const quote = await api('/api/v1/shipping-quotes', { method: 'POST', body: JSON.stringify({ items: state.cart, postal_code: postal.value }) });
      if (state.version !== version || serial !== state.shippingVersion) return;
      options.replaceChildren();
      for (const [index, option] of quote.options.entries()) {
        const label = element('label', 'shipping-choice'), radio = element('input'); radio.type = 'radio'; radio.name = 'shipping-service'; radio.value = option.id; radio.checked = index === 0;
        const title = element('span', '', option.name); title.append(element('small', '', `${option.min_business_days} a ${option.max_business_days} dias úteis · simulado`)); label.append(radio, title, element('strong', '', money(option.price_cents))); options.append(label);
        radio.addEventListener('change', () => selectShipping(quote.postal_code, option.id));
      }
      await selectShipping(quote.postal_code, quote.options[0].id);
    } catch (e) { if (state.version === version && serial === state.shippingVersion) { options.replaceChildren(); errorMessage(e.message); } }
    finally { calculate.disabled = false; }
  }
  reveal(); $('#bag-title').focus({ preventScroll: true });
  if (state.deliveryDraft.postal_code && /^[0-9]{5}-?[0-9]{3}$/.test(state.deliveryDraft.postal_code)) calculateShipping();
}
function renderDeliverySummary(content, checkout) {
  const delivery = checkout.delivery; if (!delivery) return;
  const box = element('section', 'delivery-summary'); box.append(element('h4', '', 'Entrega demonstrativa'), element('strong', '', delivery.full_name), element('p', '', `${delivery.street}, ${delivery.number}${delivery.complement ? ' · ' + delivery.complement : ''}`), element('p', '', `${delivery.neighborhood} · ${delivery.city} / ${delivery.state}`), element('p', '', `CEP ${delivery.postal_code.replace(/^(\d{5})(\d{3})$/, '$1-$2')}`));
  if (checkout.quote.shipping_option) { const option = checkout.quote.shipping_option; box.append(element('p', 'delivery-method-summary', `${option.name} · ${option.min_business_days} a ${option.max_business_days} dias úteis (simulação)`)); }
  content.append(box);
}
$('#detail-add')?.addEventListener('click', addSelectedProduct);
$('#detail-resume')?.addEventListener('click', showCurrentBag);
$('#detail-shipping-form')?.addEventListener('submit', calculateDetailShipping);
$('#detail-postal-code')?.addEventListener('input', () => { ++state.detailShippingVersion; $('#detail-shipping-options').replaceChildren(); });

async function boot() {
  state.deliveryDraft = read(DELIVERY_KEY, {}, sessionStorage);
  const cart = read(CART_KEY, []);
  state.cart = Array.isArray(cart) ? cart.filter(i => i && typeof i.variant_id === 'string' && i.variant_id.startsWith('aut-') && Number.isInteger(i.quantity) && i.quantity > 0 && i.quantity <= 10).slice(0, 10).map(i => ({ variant_id: i.variant_id, quantity: i.quantity })) : [];
  const attempt = read(ATTEMPT_KEY, null, sessionStorage); state.pending = Boolean(attempt?.key && attempt?.body);
  renderCount();
  try {
    await loadProduct();
    const saved = read(CHECKOUT_KEY, null, sessionStorage);
    if (saved?.id && saved?.token) {
      state.checkout = { id: saved.id }; state.token = saved.token; state.cartCleared = Boolean(saved.cartCleared); state.resuming = true;
      try { await refreshCheckout(); state.resuming = false; }
      catch (e) { if (e.status === 404) { state.resuming = false; state.checkout = null; state.token = ''; remove(CHECKOUT_KEY, sessionStorage); } }
    }
    renderCards();
  } catch (e) { $('#bag-status').textContent = e.message; }
}
boot();
