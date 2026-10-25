import {useEffect, useRef, useState} from 'react';
import {Icon, ArrowLeft, ArrowRight, Truck} from '@/components/glaze/icon';
import {Button} from '@/components/glaze/ui/button';
import {Chip} from '@/components/glaze/ui/chip';
import {Field, FieldLabel} from '@/components/glaze/ui/field';
import {Input} from '@/components/glaze/ui/input';
import {NumberInput} from '@/components/glaze/ui/number-input';
import {Card, CardContent} from '@/components/glaze/ui/card';
import {Collapsible, CollapsibleTrigger, CollapsibleContent, CollapsibleGroup} from '@/components/glaze/ui/collapsible';
import {Alert, AlertTitle} from '@/components/glaze/ui/alert';
import {Skeleton, SkeletonSwap} from '@/components/glaze/ui/skeleton';
import {api, money, type Commerce, type ShippingOption} from '@/lib/commerce';

export function ProductDetail({commerce, openBag}: {commerce: Commerce; openBag: () => void}) {
  const [color, setColor] = useState(new URLSearchParams(location.search).get('cor') || 'aut-oliva');
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState<number | null>(1);
  const [postal, setPostal] = useState(commerce.deliveryDraft.postal_code || '');
  const [options, setOptions] = useState<ShippingOption[]>([]);
  const [shippingBusy, setShippingBusy] = useState(false);
  const [shippingError, setShippingError] = useState('');
  const shippingVersion = useRef(0);
  const product = commerce.product;
  const image = product?.imagens.find(i => i.id === color) || product?.imagens[0];
  const variants = product?.variantes.filter(v => v.imagem_id === image?.id) || [];
  const chosen = variants.find(v => v.tamanho === size);
  const available = chosen && chosen.disponivel > 0;
  useEffect(() => { document.title = 'AUT T-shirt · agent-store'; }, []);
  async function calculateShipping(event: React.FormEvent) {
    event.preventDefault();
    const v = chosen || variants.find(v => v.disponivel > 0);
    if (!v) { setShippingError('Esta opção está indisponível.'); return; }
    const serial = ++shippingVersion.current;
    setShippingBusy(true); setShippingError('');
    try {
      const response = await api<{postal_code: string; options: ShippingOption[]}>('/api/v1/shipping-quotes', {method:'POST', body:JSON.stringify({items:[{variant_id:v.id,quantity:quantity || 1}],postal_code:postal})});
      if (serial !== shippingVersion.current) return;
      setOptions(response.options); commerce.setDeliveryDraft({...commerce.deliveryDraft, postal_code:response.postal_code});
    } catch (e) { if (serial === shippingVersion.current) setShippingError(e instanceof Error ? e.message : 'Não foi possível calcular o frete.'); }
    finally { if (serial === shippingVersion.current) setShippingBusy(false); }
  }
  return <main id="product-detail" className="product-detail mx-auto w-full max-w-320 px-4 pb-12 pt-6 sm:px-6 lg:px-8">
    <a className="back-to-store mb-6 inline-flex items-center gap-2 type-body-sm text-text-2" href="/"><Icon icon={ArrowLeft}/>Todas as camisetas</a>
    <div className="detail-layout grid items-start gap-8 lg:grid-cols-2 lg:gap-12">
      <Card className="detail-image"><CardContent flush><img id="detail-image" src="/assets/t-shirt.png" alt={`Camiseta AUT, referência ilustrativa da opção ${image?.cor || 'Oliva'}`} width="600" height="750" fetchPriority="high" className="aspect-square h-auto w-full bg-paper object-contain"/></CardContent></Card>
      <section className="detail-info flex min-w-0 flex-col gap-6" aria-labelledby="detail-title">
        <div className="flex items-start justify-between gap-4"><div className="flex flex-col gap-2"><h1 id="detail-title" className="type-title">AUT T-shirt</h1><p id="detail-color-name" className="type-body text-text-2">{image?.cor || 'Oliva'}</p></div><span id="detail-price" className="type-heading-sm">{money((chosen || variants[0])?.preco_centavos || 6000)}</span></div>
        <p className="type-body text-text-2">O essencial, do seu jeito. Escolha a cor, encontre seu tamanho e confira as opções de entrega.</p>
        <SkeletonSwap loading={commerce.loading} fallback={<Skeleton className="h-32 w-full"/>} label="Carregando opções">
          {!product ? <Alert status="fail"><AlertTitle>{commerce.error || 'Não foi possível carregar as opções.'}</AlertTitle><Button variant="secondary" size="sm" onClick={() => void commerce.reloadProduct()}>Carregar opções</Button></Alert> : <>
            <div className="flex flex-col gap-3"><h2 className="type-label">Cor</h2><div id="detail-colors" className="flex flex-wrap gap-2" role="group" aria-label="Cor da camiseta">{product.imagens.map(option => <Chip key={option.id} aria-label={`Cor ${option.cor}`} pressed={option.id === image?.id} onPressedChange={() => { setColor(option.id); setSize(''); setQuantity(1); history.replaceState(null,'',`/produto/aut-tshirt?cor=${option.id}`); }}><span>{option.cor}</span></Chip>)}</div></div>
            <div className="mt-6 flex flex-col gap-3"><h2 className="type-label">Tamanho</h2><div id="detail-sizes" className="flex flex-wrap gap-2" role="group" aria-label="Tamanho da camiseta">{variants.map(v => <Chip key={v.id} className="detail-size" disabled={v.disponivel === 0} aria-label={`Tamanho ${v.tamanho}${v.disponivel === 0 ? ', indisponível' : ''}`} pressed={v.tamanho === size} onPressedChange={() => { setSize(v.tamanho); setQuantity(1); }}>{v.tamanho}</Chip>)}</div></div>
          </>}
        </SkeletonSwap>
        <Field className="max-w-40"><FieldLabel>Quantidade</FieldLabel><NumberInput decrementLabel="Diminuir quantidade" incrementLabel="Aumentar quantidade" id="detail-quantity" value={quantity} onValueChange={setQuantity} min={1} max={Math.min(10, chosen?.disponivel || 10)} step={1} smallStep={1} largeStep={1} locale="pt-BR"/></Field>
        <p id="detail-stock" className="type-body-sm text-text-2" role="status">{available ? `${chosen.disponivel} unidades disponíveis neste tamanho.` : chosen ? 'Tamanho indisponível.' : 'Escolha seu tamanho para conferir a disponibilidade.'}</p>
        <div className="flex flex-col items-start gap-3"><Button size="lg" id="detail-add" disabled={!available || commerce.locked || !quantity} onClick={() => { if (chosen && quantity && commerce.addItem(chosen.id, quantity)) openBag(); }}>{commerce.locked ? 'Você tem uma compra em andamento' : available ? 'Adicionar à sacola' : 'Escolha seu tamanho'}<Icon icon={ArrowRight}/></Button>{commerce.locked && <Button variant="secondary" id="detail-resume" onClick={openBag}>Retomar compra em andamento</Button>}</div>
        {commerce.error && <Alert status="fail"><AlertTitle>{commerce.error}</AlertTitle></Alert>}
        <section className="flex flex-col gap-3 border-t border-line-faint pt-6" aria-labelledby="shipping-title"><h2 id="shipping-title" className="flex items-center gap-2 type-heading-sm"><Icon icon={Truck}/>Entrega</h2><form id="detail-shipping-form" onSubmit={calculateShipping} className="flex flex-col items-start gap-3 sm:flex-row sm:items-end"><Field className="w-full max-w-56"><FieldLabel>Seu CEP</FieldLabel><Input id="detail-postal-code" name="postal_code" value={postal} onChange={e => { setPostal(e.target.value); ++shippingVersion.current; setOptions([]); setShippingBusy(false); }} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} pattern="[0-9]{5}-?[0-9]{3}" required/></Field><Button variant="secondary" type="submit" disabled={shippingBusy}>{shippingBusy ? 'Calculando frete…' : 'Calcular frete'}</Button></form><div id="detail-shipping-options" className="flex flex-col gap-2" role="status">{options.map(option => <div key={option.id} className="shipping-estimate flex flex-wrap justify-between gap-2 type-body-sm"><span>{option.name} · {option.min_business_days} a {option.max_business_days} dias úteis</span><strong className="type-label">{money(option.price_cents)}</strong></div>)}{shippingError && <p>{shippingError}</p>}</div><p className="type-caption text-text-2">Frete e prazos simulados. Sem cobrança ou entrega real.</p></section>
        <CollapsibleGroup variant="plain"><Collapsible><CollapsibleTrigger>Sobre esta peça</CollapsibleTrigger><CollapsibleContent>Produto conceitual AUT para a demonstração da agent-store. As seis opções usam a mesma fotografia ilustrativa. Composição, medidas e materiais não foram cadastrados.</CollapsibleContent></Collapsible><Collapsible><CollapsibleTrigger>Sobre a demonstração</CollapsibleTrigger><CollapsibleContent>Você pode escolher tamanho, calcular frete, preencher um endereço fictício e concluir um pedido de teste com Pix ou cartão simulado. Nenhum valor será cobrado ou produto enviado.</CollapsibleContent></Collapsible></CollapsibleGroup>
      </section>
    </div>
  </main>;
}
