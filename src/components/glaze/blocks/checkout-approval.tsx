import {SheetField, SheetSection} from '@/components/glaze/ui/sheet';
import {money, type Checkout} from '@/lib/commerce';

export function CheckoutApproval({checkout}: {checkout:Checkout}) {
  const completed=checkout.status==='completed', open=checkout.status==='open';
  const delivery=checkout.delivery, shipping=checkout.quote.shipping_option;
  return <>
    <SheetSection title={completed ? 'Uma boa escolha.' : open ? `Tudo pronto para testar ${checkout.payment_method==='pix' ? 'o Pix' : 'o cartão'}.` : 'Seu estoque foi liberado.'}>
      <SheetField label="Pedido">{completed ? 'Seu pedido foi salvo nesta demonstração. Nenhum valor foi cobrado e nenhum produto será enviado.' : open ? 'Este pagamento é simulado. Não envie dinheiro nem informe dados de cartão.' : 'Confira a disponibilidade para criar um novo checkout.'}</SheetField>
      {checkout.quote.items.map(item => <SheetField key={item.variant_id} label={<><span className="block">{item.quantity}× AUT T-shirt</span><span className="block text-text-2">{item.color} · {item.size}</span></>}>{money(item.total_cents)}</SheetField>)}
    </SheetSection>
    {delivery && <SheetSection title="Entrega demonstrativa" className="delivery-summary">
      <SheetField label="Contato">{delivery.full_name}</SheetField>
      <SheetField label="Endereço"><p>{delivery.street}, {delivery.number}{delivery.complement ? ` · ${delivery.complement}` : ''}</p><p>{delivery.neighborhood} · {delivery.city} / {delivery.state}</p><p>CEP {delivery.postal_code.replace(/^(\d{5})(\d{3})$/, '$1-$2')}</p></SheetField>
      {shipping && <SheetField label="Frete">{shipping.name} · {shipping.min_business_days} a {shipping.max_business_days} dias úteis (simulação)</SheetField>}
    </SheetSection>}
    {open && <p className="type-body-sm text-text-2">Reserva válida até {new Date(checkout.expires_at).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}.</p>}
    {completed && checkout.order_id && <div className="order-reference flex flex-col gap-1 type-body-sm"><span className="text-text-2">Seu pedido de demonstração</span><code data-order-id={checkout.order_id} className="mono break-all">AS-{checkout.order_id.slice(-8).toUpperCase()}</code></div>}
  </>;
}
