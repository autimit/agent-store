import {useEffect, useRef, useSyncExternalStore} from 'react';

export type Image = {id: string; cor: string; url: string; apelidos?: string[]};
export type Variant = {id: string; cor: string; tamanho: string; preco_centavos: number; disponivel: number; imagem_id: string};
export type Product = {id: string; nome: string; categoria: string; descricao: string; imagens: Image[]; variantes: Variant[]};
export type CartItem = {variant_id: string; quantity: number};
export type Delivery = {full_name: string; email: string; phone: string; postal_code: string; street: string; number: string; complement: string; neighborhood: string; city: string; state: string};
export type ShippingOption = {id: string; name: string; price_cents: number; min_business_days: number; max_business_days: number};
export type ShippingSelection = {postal_code: string; service_id: string};
export type Line = {variant_id: string; name: string; color: string; size: string; image_url: string; quantity: number; unit_price_cents: number; total_cents: number};
export type Quote = {items: Line[]; subtotal_cents: number; shipping_cents: number; total_cents: number; currency: string; demo: boolean; shipping_required: boolean; shipping_option?: ShippingOption; postal_code?: string};
export type Checkout = {id: string; access_token?: string; status: 'open' | 'completed' | 'canceled' | 'expired'; payment_method: 'pix' | 'card'; payment_status: string; quote: Quote; created_at: string; expires_at: string; order_id?: string; real_payment: boolean; delivery?: Delivery};
type ShippingResult = {postal_code: string; options: ShippingOption[]};
type Attempt = {key: string; body: string};
type SavedCheckout = {id: string; token: string; cartCleared: boolean};
export type APIError = Error & {status?: number; code?: string};
const CART_KEY = 'agent-store.cart.v2';
const CHECKOUT_KEY = 'agent-store.checkout.v2';
const ATTEMPT_KEY = 'agent-store.checkout-attempt.v2';
const DELIVERY_KEY = 'agent-store.delivery-draft.v1';
const fields: (keyof Delivery)[] = ['full_name', 'email', 'phone', 'postal_code', 'street', 'number', 'complement', 'neighborhood', 'city', 'state'];
export const money = (cents: number) => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format(cents / 100);
function read<T>(key: string, fallback: T, session = false): T { try { return JSON.parse((session ? sessionStorage : localStorage).getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
function write(key: string, value: unknown, session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); } catch { /* The in-memory purchase remains usable when storage is unavailable. */ } }
function remove(key: string, session = false) { try { (session ? sessionStorage : localStorage).removeItem(key); } catch { /* Storage can be unavailable in private contexts. */ } }
function message(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'; }
function status(error: unknown) { return (error as APIError)?.status; }
function normalizeDelivery(value: Partial<Delivery>): Delivery { return Object.fromEntries(fields.map(name => [name, String(value[name] || '').trim()])) as Delivery; }
function savedAttempt(): Attempt | null { const value = read<Attempt | null>(ATTEMPT_KEY, null, true); return typeof value?.key === 'string' && typeof value?.body === 'string' ? value : null; }
function initialCart(): CartItem[] {
  const value = read<unknown>(CART_KEY, []);
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is CartItem => item && typeof item.variant_id === 'string' && item.variant_id.startsWith('aut-') && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 10).slice(0, 10).map(item => ({variant_id: item.variant_id, quantity: item.quantity}));
}
export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    const headers = new Headers(options.headers);
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    response = await fetch(path, {...options, headers, signal: options.signal || AbortSignal.timeout(12000)});
  } catch { throw new Error('Não foi possível conectar à loja. Tente novamente.'); }
  let data: T & {error?: {message?: string; code?: string}};
  try { data = await response.json(); } catch { const error: APIError = new Error('Resposta inesperada da loja. Tente novamente.'); error.status = response.status; throw error; }
  if (!response.ok) { const error: APIError = new Error(data.error?.message || 'Não foi possível concluir.'); error.status = response.status; error.code = data.error?.code; throw error; }
  return data;
}

type State = {
  product: Product | null; loading: boolean; error: string; busy: boolean; pending: boolean; resuming: boolean;
  cart: CartItem[]; checkout: Checkout | null; payment: 'pix' | 'card'; deliveryDraft: Partial<Delivery>;
  shipping: ShippingSelection | null; shippingOptions: ShippingOption[]; shippingBusy: boolean;
  quote: Quote | null; quoteBusy: boolean;
};
class CommerceStore {
  private state: State = {product: null, loading: true, error: '', busy: false, pending: Boolean(savedAttempt()), resuming: false, cart: initialCart(), checkout: null, payment: 'pix', deliveryDraft: read<Partial<Delivery>>(DELIVERY_KEY, {}, true), shipping: null, shippingOptions: [], shippingBusy: false, quote: null, quoteBusy: false};
  private listeners = new Set<() => void>();
  private token = '';
  private cartCleared = false;
  private checkoutID = '';
  private shippingVersion = 0;
  private quoteVersion = 0;
  private booted = false;
  private attempt = savedAttempt();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private patch(value: Partial<State>) { this.state = {...this.state, ...value}; this.listeners.forEach(listener => listener()); }
  private isLocked() { return this.state.busy || this.state.pending || this.state.resuming || this.state.checkout?.status === 'open'; }
  private variant(id: string) { return this.state.product?.variantes.find(item => item.id === id); }
  private invalidateShipping() { ++this.shippingVersion; ++this.quoteVersion; this.patch({shipping: null, shippingOptions: [], shippingBusy: false, quote: null, quoteBusy: false}); }
  private persistCheckout() { if (this.state.checkout) write(CHECKOUT_KEY, {id: this.state.checkout.id, token: this.token, cartCleared: this.cartCleared}, true); }
  private acceptCheckout(checkout: Checkout) {
    this.checkoutID = checkout.id;
    if (checkout.access_token) this.token = checkout.access_token;
    if (checkout.status === 'completed' && !this.cartCleared) { this.cartCleared = true; write(CART_KEY, []); this.patch({cart: []}); }
    this.patch({checkout}); this.persistCheckout();
  }
  boot = async () => {
    if (this.booted) return;
    this.booted = true;
    const saved = read<SavedCheckout | null>(CHECKOUT_KEY, null, true);
    if (typeof saved?.id === 'string' && typeof saved.token === 'string') {
      this.checkoutID = saved.id; this.token = saved.token; this.cartCleared = Boolean(saved.cartCleared); this.patch({resuming: true});
    }
    await this.reloadProduct();
    if (this.checkoutID) await this.refreshCheckout();
    this.patch({loading: false});
  };
  reloadProduct = async () => {
    try {
      const product = await api<Product>('/api/v1/products/aut-tshirt');
      const cart = this.state.cart.filter(item => product.variantes.some(v => v.id === item.variant_id));
      write(CART_KEY, cart); this.patch({product, cart, loading: false});
      if (cart.length && !this.state.checkout && !this.state.pending && !this.state.resuming) await this.refreshQuote();
      return true;
    } catch (error) { this.patch({error: message(error), loading: false}); return false; }
  };
  setError = (error: string) => this.patch({error});
  setPayment = (payment: 'pix' | 'card') => { if (!this.isLocked()) this.patch({payment}); };
  setDeliveryDraft = (value: Partial<Delivery> | ((previous: Partial<Delivery>) => Partial<Delivery>)) => {
    if (this.isLocked()) return;
    const deliveryDraft = typeof value === 'function' ? value(this.state.deliveryDraft) : value;
    if (deliveryDraft.postal_code !== this.state.deliveryDraft.postal_code) this.invalidateShipping();
    write(DELIVERY_KEY, deliveryDraft, true); this.patch({deliveryDraft});
  };
  private commitCart(cart: CartItem[]) {
    this.invalidateShipping(); write(CART_KEY, cart); this.patch({cart, error: ''});
    void this.refreshQuote();
  }
  setCart = (value: CartItem[] | ((previous: CartItem[]) => CartItem[])) => {
    if (this.isLocked()) return false;
    const cart = typeof value === 'function' ? value(this.state.cart) : value;
    if (cart.reduce((sum, item) => sum + item.quantity, 0) > 10 || cart.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || !this.variant(item.variant_id) || item.quantity > this.variant(item.variant_id)!.disponivel)) {
      this.patch({error: 'Confira a quantidade disponível e o limite de 10 itens por sacola.'}); return false;
    }
    this.commitCart(cart.map(item => ({...item}))); return true;
  };
  updateQuantity = (id: string, quantity: number) => {
    if (this.isLocked()) return false;
    if (quantity === 0) return this.removeItem(id);
    return this.setCart(this.state.cart.map(item => item.variant_id === id ? {...item, quantity} : item));
  };
  changeSize = (id: string, nextID: string) => {
    if (this.isLocked()) return false;
    const current = this.state.cart.find(item => item.variant_id === id), next = this.variant(nextID);
    if (!current || !next || next.imagem_id !== this.variant(id)?.imagem_id) return false;
    if (id === nextID) return true;
    const cart = this.state.cart.map(item => ({...item}));
    const existing = cart.find(item => item.variant_id === nextID);
    if (existing) { existing.quantity += current.quantity; return this.setCart(cart.filter(item => item.variant_id !== id)); }
    return this.setCart(cart.map(item => item.variant_id === id ? {...item, variant_id: nextID} : item));
  };
  removeItem = (id: string) => { if (this.isLocked()) return false; this.commitCart(this.state.cart.filter(item => item.variant_id !== id)); return true; };
  addItem = (id: string, quantity = 1) => {
    if (this.isLocked()) return false;
    const variant = this.variant(id);
    if (!variant || !Number.isInteger(quantity) || quantity < 1 || quantity > Math.min(10, variant.disponivel)) { this.patch({error: 'Confira a quantidade disponível para este tamanho.'}); return false; }
    const cart = this.state.cart.map(item => ({...item})), existing = cart.find(item => item.variant_id === id);
    if (existing) existing.quantity += quantity; else cart.push({variant_id: id, quantity});
    if (!this.setCart(cart)) return false;
    if (this.state.checkout) this.clearCheckout();
    return true;
  };
  refreshQuote = async () => {
    if (!this.state.cart.length || this.state.checkout || this.state.pending || this.state.resuming) { this.patch({quote: null, quoteBusy: false}); return false; }
    const serial = ++this.quoteVersion;
    this.patch({quoteBusy: true});
    try {
      const quote = await api<Quote>('/api/v1/quotes', {method: 'POST', body: JSON.stringify({items: this.state.cart})});
      if (serial !== this.quoteVersion) return false;
      this.patch({quote, quoteBusy: false}); return true;
    } catch (error) { if (serial === this.quoteVersion) this.patch({quote: null, quoteBusy: false, error: message(error)}); return false; }
  };
  private quoteShipping = async (postal: string, serviceID: string, serial: number) => {
    const selection = {postal_code: postal, service_id: serviceID};
    const quote = await api<Quote>('/api/v1/quotes', {method: 'POST', body: JSON.stringify({items: this.state.cart, shipping: selection})});
    if (serial !== this.shippingVersion) return false;
    this.patch({shipping: selection, quote, shippingBusy: false}); return true;
  };
  calculateShipping = async (postal: string) => {
    if (this.isLocked() || !this.state.cart.length) return false;
    const serial = ++this.shippingVersion; ++this.quoteVersion;
    this.patch({shipping: null, shippingOptions: [], shippingBusy: true, quote: null, quoteBusy: false, error: ''});
    try {
      const result = await api<ShippingResult>('/api/v1/shipping-quotes', {method: 'POST', body: JSON.stringify({items: this.state.cart, postal_code: postal})});
      if (serial !== this.shippingVersion) return false;
      this.patch({shippingOptions: result.options});
      return await this.quoteShipping(result.postal_code, result.options[0].id, serial);
    } catch (error) { if (serial === this.shippingVersion) this.patch({shippingBusy: false, error: message(error)}); return false; }
  };
  selectShipping = async (serviceID: string) => {
    if (this.isLocked() || !this.state.shippingOptions.some(option => option.id === serviceID)) return false;
    const postal = this.state.shipping?.postal_code || String(this.state.deliveryDraft.postal_code || '').replace('-', '');
    const serial = ++this.shippingVersion;
    this.patch({shipping: null, shippingBusy: true, error: ''});
    try { return await this.quoteShipping(postal, serviceID, serial); }
    catch (error) { if (serial === this.shippingVersion) this.patch({shippingBusy: false, error: message(error)}); return false; }
  };
  startCheckout = async (delivery?: Partial<Delivery>) => {
    if (this.state.busy || this.state.resuming || this.state.checkout?.status === 'open') return false;
    let attempt = this.attempt || savedAttempt();
    if (!attempt) {
      const clean = normalizeDelivery(delivery || this.state.deliveryDraft);
      if (!this.state.shipping || this.state.shipping.postal_code !== clean.postal_code.replace('-', '')) { this.patch({error: 'Calcule o frete e escolha uma opção antes de continuar.'}); return false; }
      const items = this.state.cart.map(item => ({variant_id: item.variant_id, quantity: item.quantity})).sort((a, b) => a.variant_id.localeCompare(b.variant_id));
      attempt = {key: crypto.randomUUID(), body: JSON.stringify({items, payment_method: this.state.payment, shipping: this.state.shipping, delivery: clean})};
      this.attempt = attempt; write(ATTEMPT_KEY, attempt, true);
    }
    this.patch({busy: true, pending: true, error: ''});
    try {
      const checkout = await api<Checkout>('/api/v1/checkouts', {method: 'POST', headers: {'Idempotency-Key': attempt.key}, body: attempt.body});
      this.cartCleared = false; this.patch({pending: false}); this.attempt = null; remove(ATTEMPT_KEY, true); this.acceptCheckout(checkout);
      await this.reloadProduct(); return true;
    } catch (error) {
      const code = status(error);
      if (code && code >= 400 && code < 500) { this.attempt = null; remove(ATTEMPT_KEY, true); this.patch({pending: false}); }
      this.patch({error: message(error)}); return false;
    } finally { this.patch({busy: false}); }
  };
  refreshCheckout = async () => {
    const id = this.state.checkout?.id || this.checkoutID;
    if (!id || !this.token) return false;
    try {
      const checkout = await api<Checkout>(`/api/v1/checkouts/${encodeURIComponent(id)}`, {headers: {Authorization: `Bearer ${this.token}`}});
      this.acceptCheckout(checkout); this.patch({resuming: false}); return true;
    } catch (error) {
      if (status(error) === 404) { this.checkoutID = ''; this.token = ''; remove(CHECKOUT_KEY, true); this.patch({checkout: null, resuming: false}); }
      this.patch({error: message(error)}); return false;
    }
  };
  checkoutAction = async (action: 'simulate-payment' | 'cancel') => {
    if (this.state.busy || !this.state.checkout) return false;
    this.patch({busy: true, error: ''});
    try {
      const checkout = await api<Checkout>(`/api/v1/checkouts/${encodeURIComponent(this.state.checkout.id)}/${action}`, {method: 'POST', headers: {Authorization: `Bearer ${this.token}`}, body: '{}'});
      this.acceptCheckout(checkout); await this.reloadProduct(); return true;
    } catch (error) {
      const recovered = await this.refreshCheckout();
      if (recovered && ((action === 'simulate-payment' && this.state.checkout?.status === 'completed') || (action === 'cancel' && this.state.checkout?.status === 'canceled'))) { this.patch({error: ''}); await this.reloadProduct(); return true; }
      this.patch({error: message(error)}); return false;
    } finally { this.patch({busy: false}); }
  };
  clearCheckout = () => {
    if (this.state.busy || this.state.resuming || this.state.pending || this.state.checkout?.status === 'open') return false;
    this.checkoutID = ''; this.token = ''; this.cartCleared = false; remove(CHECKOUT_KEY, true); this.patch({checkout: null, error: ''});
    this.invalidateShipping(); void this.refreshQuote(); return true;
  };
}
export function useCommerce() {
  const controller = useRef<CommerceStore | null>(null);
  if (!controller.current) controller.current = new CommerceStore();
  const store = controller.current;
  const state = useSyncExternalStore(store.subscribe, store.snapshot, store.snapshot);
  useEffect(() => { void store.boot(); }, [store]);
  const cartCount = state.cart.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = state.cart.reduce((sum, item) => sum + (state.product?.variantes.find(v => v.id === item.variant_id)?.preco_centavos || 0) * item.quantity, 0);
  return {...state, cartCount, subtotal, locked: state.busy || state.pending || state.resuming || state.checkout?.status === 'open', setError: store.setError, setPayment: store.setPayment, setDeliveryDraft: store.setDeliveryDraft, setCart: store.setCart, updateQuantity: store.updateQuantity, changeSize: store.changeSize, removeItem: store.removeItem, addItem: store.addItem, calculateShipping: store.calculateShipping, selectShipping: store.selectShipping, startCheckout: store.startCheckout, checkoutAction: store.checkoutAction, clearCheckout: store.clearCheckout, reloadProduct: store.reloadProduct, refreshQuote: store.refreshQuote, refreshCheckout: store.refreshCheckout};
}
export type Commerce = ReturnType<typeof useCommerce>;
