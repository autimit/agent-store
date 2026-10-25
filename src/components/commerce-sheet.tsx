import {useCallback, useEffect, useRef, useState, type ReactNode, type ComponentProps} from 'react';
import {Button} from '@/components/glaze/ui/button';
import {Field, FieldError, FieldLabel, FieldLegend, FieldSet, Form} from '@/components/glaze/ui/field';
import {Input} from '@/components/glaze/ui/input';
import {NativeSelect} from '@/components/glaze/ui/select';
import {NumberInput} from '@/components/glaze/ui/number-input';
import {RadioGroup, RadioGroupOption} from '@/components/glaze/ui/radio-group';
import {Sheet, SheetAction, SheetBody, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle} from '@/components/glaze/ui/sheet';
import {Empty, EmptyDescription, EmptyHeader, EmptyTitle} from '@/components/glaze/ui/empty-state';
import {Alert, AlertAction, AlertTitle} from '@/components/glaze/ui/alert';
import {money, type Commerce, type Delivery} from '@/lib/commerce';
import {CheckoutApproval} from '@/components/glaze/blocks/checkout-approval';

const states = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');
const deliveryFields: {name: keyof Delivery; label: string; type?: string; auto?: string; max?: number; optional?: boolean}[] = [
  {name:'full_name',label:'Nome completo',auto:'name'}, {name:'email',label:'E-mail',type:'email',auto:'email',max:254},
  {name:'phone',label:'Telefone',type:'tel',auto:'tel',max:25,optional:true}, {name:'street',label:'Rua / avenida',auto:'address-line1',max:160},
  {name:'number',label:'Número',max:20}, {name:'complement',label:'Complemento',auto:'address-line2',optional:true},
  {name:'neighborhood',label:'Bairro',auto:'address-level3',max:100}, {name:'city',label:'Cidade',auto:'address-level2',max:100},
];
function SummaryRow({label,children,total=false}: {label:string;children:ReactNode;total?:boolean}) {
  return <div className={`flex items-baseline justify-between gap-3 ${total ? 'total-line border-t border-line-faint pt-3 type-label' : 'type-body-sm text-text-2'}`}><span>{label}</span><strong className="shrink-0 font-medium text-text-1">{children}</strong></div>;
}
function Totals({commerce}: {commerce:Commerce}) {
  const quote = commerce.checkout?.quote || commerce.quote;
  return <div id="delivery-totals" className="flex flex-col gap-2">
    <SummaryRow label="Produtos">{money(quote?.subtotal_cents ?? commerce.subtotal)}</SummaryRow>
    <SummaryRow label="Frete">{quote?.shipping_option ? money(quote.shipping_cents) : 'A calcular'}</SummaryRow>
    <SummaryRow label={quote?.shipping_option ? 'Total' : 'Total sem frete'} total>{money(quote?.total_cents ?? commerce.subtotal)}</SummaryRow>
  </div>;
}

export function CommerceSheet({commerce:c,open,onOpenChange}: {commerce:Commerce;open:boolean;onOpenChange:(open:boolean)=>void}) {
  const [step,setStep] = useState<'cart'|'delivery'>('cart');
  const form = useRef<HTMLFormElement>(null);
  const previousOpen = useRef(false);
  const latest = useRef({commerce:c,step});
  latest.current={commerce:c,step};
  const recover = useCallback(async (retry=false) => {
    let current=latest.current.commerce;
    if (current.busy || current.quoteBusy || current.shippingBusy) return;
    const needsProduct=!current.product || retry;
    const needsCheckout=Boolean(current.checkout || current.resuming);
    const needsQuote=current.cart.length>0 && !current.pending;
    if (!needsProduct && !needsCheckout && !needsQuote && !(retry && current.pending)) return;
    current.setError('');
    if (needsProduct && !await current.reloadProduct()) return;
    current=latest.current.commerce;
    if (current.checkout || current.resuming) {await current.refreshCheckout(); return;}
    if (current.pending) {if (retry) await current.startCheckout(); return;}
    if (!current.cart.length) return;
    const postal=current.deliveryDraft.postal_code;
    if (retry && latest.current.step==='delivery' && postal && /^[0-9]{5}-?[0-9]{3}$/.test(postal)) await current.calculateShipping(postal);
    else await current.refreshQuote();
  },[]);
  useEffect(() => {
    if (open && !previousOpen.current) {setStep('cart'); void recover();}
    previousOpen.current = open;
  },[open,recover]);
  const checkout = c.checkout;
  useEffect(() => {
    if (open && c.pending && !c.busy && !checkout) setStep('cart');
  },[open,c.pending,c.busy,checkout]);
  const viewKey=checkout ? `${checkout.id}:${checkout.status}` : step;
  const previousView=useRef(viewKey);
  useEffect(() => {
    if (open && previousView.current!==viewKey) requestAnimationFrame(() => document.getElementById('bag-title')?.focus({preventScroll:true}));
    previousView.current=viewKey;
  },[open,viewKey]);
  const title = checkout ? checkout.status === 'open' ? 'Seu pagamento de teste' : checkout.status === 'completed' ? 'Simulação concluída' : checkout.status === 'canceled' ? 'Reserva cancelada' : 'Reserva expirada' : step === 'delivery' ? 'Entrega e contato' : 'Sua sacola';
  const description = checkout ? 'Nenhuma cobrança ou entrega real.' : step === 'delivery' ? 'Use dados fictícios para experimentar a compra.' : `${c.cartCount} ${c.cartCount === 1 ? 'item' : 'itens'} para revisar antes de continuar.`;
  const setField = (name:keyof Delivery,value:string) => c.setDeliveryDraft(previous => ({...previous,[name]:value}));
  const proceed = () => {c.setError(''); setStep('delivery'); if (c.deliveryDraft.postal_code && /^[0-9]{5}-?[0-9]{3}$/.test(c.deliveryDraft.postal_code)) void c.calculateShipping(c.deliveryDraft.postal_code);};
  const close = () => onOpenChange(false);
  const continueShopping = () => {c.clearCheckout(); setStep('cart'); if (checkout?.status === 'completed') close();};
  const canCreate = Boolean(c.shipping && !c.shippingBusy && !c.busy && !c.resuming);
  const primary:ComponentProps<typeof SheetAction> = checkout
    ? checkout.status==='open'
      ? {id:'simulate-payment',children:`Simular pagamento com ${checkout.payment_method==='pix' ? 'Pix' : 'cartão'}`,disabled:c.busy,onAction:() => c.checkoutAction('simulate-payment')}
      : {id:'continue-shopping',children:checkout.status==='completed' ? 'Continuar comprando' : 'Voltar à sacola',disabled:c.busy,onAction:continueShopping}
    : !c.cart.length
      ? {children:'Explorar camisetas',onAction:close}
      : step==='delivery'
        ? {id:'start-checkout',type:'submit',form:'delivery-form',children:c.busy ? 'Preparando checkout…' : 'Continuar para pagamento',disabled:!canCreate}
        : {id:'continue-to-delivery',children:c.pending ? 'Retomar tentativa' : 'Continuar compra',disabled:c.busy || c.quoteBusy || c.resuming || (!c.quote && !c.pending),onAction:c.pending ? () => c.startCheckout() : proceed};
  return <Sheet open={open} onOpenChange={next => {if (!c.busy) onOpenChange(next);}}>
    <SheetContent id="bag-dialog" showCloseButton={false} finalFocus={() => document.getElementById('open-bag')}>
      <SheetHeader>
        <div className="flex items-start justify-between gap-3"><div className="min-w-0"><SheetTitle id="bag-title" tabIndex={-1}>{title}</SheetTitle><SheetDescription>{description}</SheetDescription></div>
          <SheetClose id="close-bag" render={<Button variant="ghost" size="sm" aria-label="Fechar sacola" disabled={c.busy}/>}>Fechar</SheetClose>
        </div>
      </SheetHeader>
      <SheetBody className="flex flex-col gap-5">
        {c.error && <Alert status="fail"><AlertTitle>{c.error}</AlertTitle><AlertAction><Button variant="secondary" size="sm" disabled={c.busy || c.quoteBusy || c.shippingBusy} onClick={() => {void recover(true);}}>Tentar novamente</Button></AlertAction></Alert>}
        {c.resuming && <p role="status" className="type-body-sm text-text-2">Retomando seu checkout…</p>}
        {!checkout && !c.loading && !c.cart.length && <Empty reason="empty" variant="plain"><EmptyHeader><EmptyTitle>Sua próxima escolha começa por aqui.</EmptyTitle><EmptyDescription>Escolha uma camiseta para experimentar a compra.</EmptyDescription></EmptyHeader></Empty>}
        {!checkout && c.cart.length > 0 && step === 'cart' && <>
          <div aria-label="Seus itens" className="flex flex-col">
            {c.cart.map(item => {const variant=c.product?.variantes.find(v => v.id===item.variant_id); if (!variant) return null; return <article key={item.variant_id} className="rule-row flex gap-3 py-4">
              <img src="/assets/t-shirt.png" alt={`Camiseta AUT, referência da opção ${variant.cor}`} className="w-20 shrink-0 self-start rounded-panel bg-paper object-contain"/>
              <div className="flex min-w-0 flex-1 flex-col gap-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="type-label">AUT T-shirt</h3><p className="type-body-sm text-text-2">{variant.cor}</p></div><span className="shrink-0 type-body-sm">{money(variant.preco_centavos*item.quantity)}</span></div>
                <Field><FieldLabel>Tamanho<span className="sr-only"> da camiseta {variant.cor}</span></FieldLabel><NativeSelect aria-label={`Tamanho da camiseta ${variant.cor}`} value={variant.id} disabled={c.locked} onChange={event => c.changeSize(variant.id,event.target.value)}>{c.product?.variantes.filter(v => v.imagem_id===variant.imagem_id).map(v => <option key={v.id} value={v.id} disabled={!v.disponivel}>{v.tamanho}</option>)}</NativeSelect></Field>
                <Field><FieldLabel>Quantidade<span className="sr-only"> da camiseta {variant.cor}</span></FieldLabel><NumberInput decrementLabel={`Diminuir quantidade, ${variant.cor}`} incrementLabel={`Aumentar quantidade, ${variant.cor}`} aria-label={`Quantidade da camiseta ${variant.cor}`} value={item.quantity} min={1} max={Math.max(1,Math.min(variant.disponivel,10-c.cartCount+item.quantity))} step={1} smallStep={1} largeStep={1} disabled={c.locked} onValueChange={value => {if (value!==null) c.updateQuantity(variant.id,value);}}/></Field>
                <Button variant="ghost" size="sm" className="self-start" disabled={c.locked} aria-label={`Remover camiseta ${variant.cor}`} onClick={() => c.removeItem(variant.id)}>Remover</Button>
              </div>
            </article>;})}
          </div>
          <Totals commerce={c}/><p className="type-caption text-text-2">Frete calculado na próxima etapa. Até 10 itens por sacola.</p>
          {c.pending && <p className="type-body-sm text-text-2">A confirmação anterior não chegou. Retome a mesma tentativa para evitar um pedido duplicado.</p>}
        </>}
        {!checkout && step === 'delivery' && c.cart.length > 0 && <>
          <Button variant="ghost" className="self-start" disabled={c.busy} onClick={() => setStep('cart')}>Voltar à sacola</Button>
          <Form id="delivery-form" ref={form} pending={c.busy} onSubmit={event => {event.preventDefault(); void c.startCheckout(c.deliveryDraft);}}>
            <FieldSet><FieldLegend variant="label">Contato fictício</FieldLegend><div className="flex flex-col gap-4">{deliveryFields.slice(0,3).map(field => <Field key={field.name} name={field.name}>
              <FieldLabel optional={field.optional}>{field.label}</FieldLabel><Input id={`delivery-${field.name}`} name={field.name} type={field.type || 'text'} autoComplete={field.auto || 'off'} required={!field.optional} maxLength={field.max || 120} value={c.deliveryDraft[field.name] || ''} disabled={c.locked} onChange={event => setField(field.name,event.target.value)}/><FieldError/>
            </Field>)}</div></FieldSet>
            <FieldSet><FieldLegend variant="label">Frete simulado</FieldLegend><div className="flex flex-col gap-3">
              <Field name="postal_code"><FieldLabel>CEP</FieldLabel><Input id="delivery-postal_code" name="postal_code" inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" pattern="[0-9]{5}-?[0-9]{3}" maxLength={9} required value={c.deliveryDraft.postal_code || ''} disabled={c.locked} onChange={event => setField('postal_code',event.target.value)}/><FieldError/></Field>
              <Button id="calculate-shipping" variant="secondary" disabled={c.locked || c.shippingBusy} onClick={() => {const input=document.getElementById('delivery-postal_code') as HTMLInputElement|null;if(input?.reportValidity()) void c.calculateShipping(input.value);}}>{c.shippingBusy ? 'Calculando frete…' : 'Calcular frete'}</Button>
              {c.shippingOptions.length>0 && <RadioGroup aria-label="Opções de frete" name="shipping-service" value={c.shipping?.service_id || ''} disabled={c.locked || c.shippingBusy} onValueChange={value => void c.selectShipping(String(value))}>{c.shippingOptions.map(option => <RadioGroupOption key={option.id} value={option.id} label={`${option.name} · ${money(option.price_cents)}`} description={`${option.min_business_days} a ${option.max_business_days} dias úteis · simulado`}/>)}</RadioGroup>}
            </div></FieldSet>
            <FieldSet><FieldLegend variant="label">Endereço fictício</FieldLegend><div className="flex flex-col gap-4">{deliveryFields.slice(3).map(field => <Field key={field.name} name={field.name}><FieldLabel optional={field.optional}>{field.label}</FieldLabel><Input id={`delivery-${field.name}`} name={field.name} autoComplete={field.auto || 'off'} required={!field.optional} maxLength={field.max || 120} value={c.deliveryDraft[field.name] || ''} disabled={c.locked} onChange={event => setField(field.name,event.target.value)}/><FieldError/></Field>)}
              <Field name="state"><FieldLabel>UF</FieldLabel><NativeSelect id="delivery-state" name="state" autoComplete="address-level1" required value={c.deliveryDraft.state || ''} disabled={c.locked} onChange={event => setField('state',event.target.value)}><option value="">Selecione</option>{states.map(uf => <option key={uf} value={uf}>{uf}</option>)}</NativeSelect><FieldError/></Field>
            </div></FieldSet>
            <FieldSet><FieldLegend variant="label">Como você quer testar o pagamento?</FieldLegend><RadioGroup aria-label="Forma de pagamento" name="payment-method" value={c.payment} disabled={c.locked} onValueChange={value => c.setPayment(value as 'pix'|'card')}><RadioGroupOption value="pix" label="Pix" description="Simulado, sem transferência."/><RadioGroupOption value="card" label="Cartão" description="Simulado, sem informar cartão."/></RadioGroup></FieldSet>
          </Form>
          <Totals commerce={c}/><p className="type-caption text-text-2">Ao continuar, os itens ficam reservados por 15 minutos. Frete e prazos são simulados.</p>
        </>}
        {checkout && <><CheckoutApproval checkout={checkout}/><Totals commerce={c}/></>}
      </SheetBody>
      <SheetFooter defaultAction="none" className="flex-wrap">
        {!checkout && c.cart.length>0 && step==='cart' && <SheetClose render={<Button variant="secondary" disabled={c.busy}/>}>Continuar escolhendo</SheetClose>}
        {checkout?.status==='open' && <Button id="cancel-checkout" variant="secondary" disabled={c.busy} onClick={() => {void c.checkoutAction('cancel');}}>Cancelar e liberar estoque</Button>}
        <SheetAction {...primary} close={false} size="default" pending={c.busy} className="max-w-full"/>
      </SheetFooter>
    </SheetContent>
  </Sheet>;
}
