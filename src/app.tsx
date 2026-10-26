import {lazy, Suspense, useState} from 'react';
import {Icon, ShoppingBag} from '@/components/glaze/icon';
import {Button} from '@/components/glaze/ui/button';
import {Badge} from '@/components/glaze/ui/badge';
import {Card, CardContent, CardHeader, CardTitle, CardDescription, CardAction, CardLink} from '@/components/glaze/ui/card';
import {Skeleton, SkeletonSwap} from '@/components/glaze/ui/skeleton';
import {Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent} from '@/components/glaze/ui/empty-state';
import {useCommerce, money, type Commerce} from '@/lib/commerce';
import autimitPortal from '@/assets/autimit-portal.svg';
const ProductDetail = lazy(() => import('@/components/product-detail').then(module => ({default: module.ProductDetail})));
import {CommerceSheet} from '@/components/commerce-sheet';
const AgentDocs = lazy(() => import('@/components/agent-docs').then(module => ({default: module.AgentDocs})));
const Account = lazy(() => import('@/components/account').then(module => ({default: module.Account})));

function Catalog({commerce}: {commerce: Commerce}) {
  const fallback = <div className="product-grid grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 sm:gap-10">{Array.from({length: 6}, (_, i) => <Card key={i}><CardContent><Skeleton className="aspect-square w-full"/></CardContent><CardHeader><Skeleton className="h-4 w-24"/></CardHeader></Card>)}</div>;
  return <main id="products" className="mx-auto w-full max-w-256 px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8">
    <h1 className="sr-only">Camisetas AUT</h1>
    <SkeletonSwap loading={commerce.loading} fallback={fallback} label="Carregando camisetas">
      {!commerce.product ? <Empty reason="error"><EmptyHeader><EmptyTitle>Não foi possível carregar as camisetas</EmptyTitle><EmptyDescription>{commerce.error || 'Tente novamente para consultar o catálogo.'}</EmptyDescription></EmptyHeader><EmptyContent><Button variant="secondary" onClick={() => void commerce.reloadProduct()}>Carregar camisetas</Button></EmptyContent></Empty> :
        <div className="product-grid grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 sm:gap-10">
          {commerce.product.imagens.map((image, index) => {
            const variants = commerce.product!.variantes.filter(v => v.imagem_id === image.id);
            return <Card key={image.id} className="product-card group" data-image-id={image.id}>
              <CardContent flush><img src="/assets/t-shirt.png" alt={`Camiseta branca AUT vista de costas, referência da opção ${image.cor}`} width="600" height="750" loading={index > 2 ? 'lazy' : 'eager'} className="aspect-square h-auto w-full object-contain"/></CardContent>
              <CardHeader><CardTitle><CardLink className="product-link" href={`/produto/aut-tshirt?cor=${image.id}`} aria-label={`Ver AUT T-SHIRT, ${image.cor}`}>AUT T-shirt</CardLink></CardTitle><CardDescription>{image.cor}</CardDescription><CardAction><span className="product-price type-body-sm text-text-2">{money(variants[0]?.preco_centavos || 6000)}</span></CardAction></CardHeader>
            </Card>;
          })}
        </div>}
    </SkeletonSwap>
  </main>;
}

function StoreFooter() {
  return <footer className="mt-auto flex justify-center px-4 py-10">
    <img src={autimitPortal} alt="Autimit" width="36" height="24" className="h-6 w-9 object-contain"/>
  </footer>;
}

export function App() {
  const commerce = useCommerce();
  const [bagOpen, setBagOpen] = useState(new URLSearchParams(location.search).get('sacola')==='1');
  const isDocs = location.pathname === '/agents';
  const isProduct = location.pathname.startsWith('/produto/');
  const isAccount = location.pathname.startsWith('/conta') || location.pathname.startsWith('/checkout/');
  function openBag() { setBagOpen(true); }
  return <div className="flex min-h-dvh flex-col bg-page text-text-1">
    <div className="absolute start-0 top-0 z-20"><a href={isAccount ? '#account-content' : isProduct ? '#product-detail' : '#products'} className="sr-only focus:not-sr-only focus:block focus:bg-paper focus:p-3">Ir para o conteúdo</a></div>
    <header className="sticky top-0 z-10 border-b border-line-faint bg-page">
      <div className="mx-auto flex w-full max-w-256 items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <a className="wordmark type-heading-sm" href="/" aria-label="agent-store, início">agent-store</a>
        <a className="ms-auto type-body-sm text-text-2 underline" href="/conta">Sua conta</a>
        <Button variant="secondary" id="open-bag" aria-label={`Abrir sacola, ${commerce.cartCount} ${commerce.cartCount === 1 ? 'item' : 'itens'}`} aria-haspopup="dialog" aria-expanded={bagOpen} aria-controls="bag-dialog" onClick={openBag}><Icon icon={ShoppingBag}/><span>Sacola</span><Badge id="bag-count" aria-hidden="true">{commerce.cartCount}</Badge></Button>
        <span className="sr-only" id="bag-status" role="status">{commerce.cartCount ? `Sacola com ${commerce.cartCount} itens.` : 'Sacola vazia.'}</span>
      </div>
    </header>
    <Suspense fallback={<main className="mx-auto w-full max-w-320 p-6" aria-label="Carregando página"><Skeleton className="h-32 w-full"/></main>}>{isAccount ? <Account commerce={commerce}/> : isDocs ? <AgentDocs/> : isProduct ? <ProductDetail commerce={commerce} openBag={openBag}/> : <Catalog commerce={commerce}/>}</Suspense>
    <StoreFooter/>
    <CommerceSheet commerce={commerce} open={bagOpen} onOpenChange={setBagOpen}/>
  </div>;
}
