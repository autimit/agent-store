import {useEffect, useState, type FormEvent} from 'react';
import {Button} from '@/components/glaze/ui/button';
import {Input} from '@/components/glaze/ui/input';
import {Checkbox} from '@/components/glaze/ui/checkbox';
import {Field, FieldLabel, FieldDescription, FieldError} from '@/components/glaze/ui/field';
import {Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter, CardMeta} from '@/components/glaze/ui/card';
import {Alert, AlertTitle} from '@/components/glaze/ui/alert';
import {authClient} from '@/lib/auth-client';
import {money,checkoutReturnPath,clearAccountDraft, type Checkout, type Commerce} from '@/lib/commerce';

type Consent = {id: string; clientId: string; scopes: string[]};
type Purchase={id:string;status:string;total_cents:number;created_at:string};
const descriptions: Record<string,string> = {'checkouts:read':'Consultar seus checkouts, valores e dados de entrega.', 'checkouts:write':'Criar e cancelar reservas. Não permite pagar.', openid:'Identificar sua conta.', profile:'Consultar seu nome.', email:'Consultar seu e-mail.', offline_access:'Manter o acesso até expirar ou você desconectar.'};
function fail(error: {message?: string} | null) {if (error) throw new Error(error.message || 'Não foi possível concluir. Tente novamente.');}
function willRedirect(data: unknown) {return Boolean(data && typeof data === 'object' && 'redirect' in data && data.redirect === true && 'url' in data && typeof data.url === 'string');}

export function Account({commerce}:{commerce:Commerce}) {
  const {data: session, isPending, error: sessionError, refetch} = authClient.useSession();
  const [mode, setMode] = useState<'login'|'signup'>('login');
  const [name,setName] = useState(''); const [email,setEmail] = useState(''); const [password,setPassword] = useState('');
  const [error,setError] = useState(''); const [busy,setBusy] = useState(false);
  const [consents,setConsents] = useState<Consent[]>([]); const [clients,setClients] = useState<Record<string,{name: string; domain: string}>>({});
  const [selected,setSelected] = useState<string[]>([]); const [checkout,setCheckout] = useState<Checkout|null>(null);
  const [purchases,setPurchases]=useState<Purchase[]>([]);
  const query = new URLSearchParams(location.search);
  const returnTo=query.get('returnTo')===checkoutReturnPath?checkoutReturnPath:null;
  const isConsent = location.pathname === '/conta/autorizar'; const clientID = query.get('client_id');
  const requested = query.get('scope') || '';
  const checkoutID = location.pathname.startsWith('/checkout/') ? location.pathname.split('/')[2] : null;
  useEffect(() => {setSelected(requested.split(' ').filter(Boolean));},[requested]);
  useEffect(() => {
    setConsents([]);setClients({});setCheckout(null);setPurchases([]);
    if (!session) return;
    let active=true;
    async function load() {
      try {
        const ids:string[]=[];
        if (isConsent && clientID) ids.push(clientID);
        else if (!checkoutID) {const result=await authClient.oauth2.getConsents(); fail(result.error); const rows=(result.data || []) as Consent[]; if (active) setConsents(rows); ids.push(...rows.map(c=>c.clientId));}
        for (const id of new Set(ids)) {const result=await authClient.oauth2.publicClient({query:{client_id:id}}); fail(result.error); const info=result.data as {client_name?:string;client_uri?:string}|null; let domain='Cliente registrado na loja'; try{domain=new URL(id).host;}catch{if(info?.client_uri)domain=new URL(info.client_uri).host;} if(active)setClients(previous=>({...previous,[id]:{name:info?.client_name||'Agente',domain}}));}
        if(checkoutID){const response=await fetch('/api/account/checkouts/'+encodeURIComponent(checkoutID));if(!response.ok)throw new Error('Checkout não encontrado na sua conta.');const value=await response.json();if(active)setCheckout(value);}
        else if(!isConsent){const response=await fetch('/api/account/checkouts');if(!response.ok)throw new Error('Não foi possível carregar suas compras.');const value=await response.json();if(active)setPurchases(value);}
      } catch(e) {if(active)setError((e as Error).message);}
    }
    void load(); return()=>{active=false;};
  },[session,isConsent,clientID,checkoutID]);
  async function act(action:()=>Promise<void>) {if(busy)return;setBusy(true);setError('');try{await action();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  function login(event:FormEvent) {event.preventDefault();void act(async()=>{
    const result=mode==='signup' ? await authClient.signUp.email({name,email,password}) : await authClient.signIn.email({email,password});fail(result.error);setPassword('');if(!willRedirect(result.data)){await refetch();if(returnTo)location.assign(returnTo);}
  });}
  function consent(accept:boolean) {void act(async()=>{const result=await authClient.oauth2.consent({accept,scope:selected.join(' ')});fail(result.error);});}
  function pay(action:string) {void act(async()=>{const response=await fetch('/api/account/checkouts/'+encodeURIComponent(checkoutID!)+'/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});if(!response.ok)throw new Error('Não foi possível atualizar este checkout. Recarregue para conferir o estado.');setCheckout(await response.json());});}
  const title=!session ? mode==='signup'?'Crie sua conta':'Entre na sua conta' : isConsent?'Conectar agente':checkoutID?'Revise sua compra':'Sua conta';
  return <main id="account-content" className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-8 sm:px-6">
    <div className="flex flex-col gap-2"><h1 className="type-title">{title}</h1><p className="type-body text-text-2">{isConsent?'Escolha o que este agente pode fazer pela sua conta.':'Sua conta e os agentes que você autoriza a usar a loja.'}</p></div>
    {(error || sessionError) && <Alert status="fail"><AlertTitle>{error || 'Não foi possível carregar sua sessão. Tente novamente.'}</AlertTitle></Alert>}
    {isPending && <p role="status" className="type-body text-text-2">Carregando sua conta…</p>}
    {!isPending && !session && <form onSubmit={login}><Card role="group" aria-labelledby="account-form-title"><CardHeader><CardTitle id="account-form-title">Dados de acesso</CardTitle><CardDescription>Crie uma conta na Agent Store ou entre para continuar.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">
      {mode==='signup' && <Field><FieldLabel>Nome</FieldLabel><Input name="name" value={name} onValueChange={setName} autoComplete="name" required maxLength={100} disabled={busy}/><FieldError/></Field>}
      <Field><FieldLabel>E-mail</FieldLabel><Input type="email" name="email" value={email} onValueChange={setEmail} autoComplete="email" required maxLength={254} disabled={busy}/><FieldError/></Field>
      <Field><FieldLabel>Senha</FieldLabel><Input mode="password" name="password" value={password} onValueChange={setPassword} autoComplete={mode==='signup'?'new-password':'current-password'} required minLength={12} maxLength={128} disabled={busy}/><FieldDescription>De 12 a 128 caracteres. A recuperação por e-mail ainda não está configurada.</FieldDescription><FieldError/></Field>
    </CardContent><CardFooter><CardMeta>Agent Store</CardMeta><Button size="sm" type="button" variant="secondary" disabled={busy} onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');}}>{mode==='login'?'Criar conta':'Já tenho conta'}</Button><Button size="sm" type="submit" disabled={busy}>{busy?'Aguarde…':mode==='login'?'Entrar na conta':'Cadastrar conta'}</Button></CardFooter></Card></form>}
    {session && <>
      {returnTo && <a href={returnTo} className="type-body text-text-1 underline">Retomar minha compra</a>}
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="type-body-sm text-text-2">Conectado como <strong className="text-text-1">{session.user.name}</strong></p><Button variant="secondary" size="sm" disabled={busy} onClick={()=>void act(async()=>{const result=await authClient.signOut();fail(result.error);clearAccountDraft();await refetch();})}>Sair da conta</Button></div>
      {isConsent && clientID && <Card role="group" aria-labelledby="consent-title"><CardHeader><CardTitle id="consent-title">{clients[clientID]?.name || 'Carregando agente…'}</CardTitle><CardDescription><span className="break-all">{clients[clientID]?.domain || 'Verificando identidade'}</span> solicita acesso. Confira a identidade antes de autorizar.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4"><p className="type-body-sm text-text-2">Você pode desconectar o agente na sua conta. Nenhuma permissão permite uma cobrança real.</p>{requested.split(' ').filter(Boolean).map(scope=><label key={scope} className="flex items-start gap-3 type-body-sm"><Checkbox checked={selected.includes(scope)} disabled={busy} onCheckedChange={checked=>setSelected(previous=>checked?[...previous,scope]:previous.filter(s=>s!==scope))}/><span>{descriptions[scope]||scope}</span></label>)}</CardContent><CardFooter><CardMeta>Permissões solicitadas</CardMeta><Button size="sm" variant="secondary" disabled={busy} onClick={()=>consent(false)}>Recusar acesso</Button><Button size="sm" disabled={busy||!selected.length||!clients[clientID]} onClick={()=>consent(true)}>Autorizar agente</Button></CardFooter></Card>}
      {checkout && <Card><CardHeader><CardTitle>{checkout.status==='completed'?'Simulação concluída':checkout.status==='open'?'Seu checkout':'Reserva encerrada'}</CardTitle><CardDescription>Nenhuma cobrança ou entrega real.</CardDescription></CardHeader><CardContent className="flex flex-col gap-4">{checkout.quote.items.map(item=><div key={item.variant_id} className="rule-row flex justify-between gap-4 type-body-sm"><span>{item.name} · {item.color} · {item.size} · {item.quantity} un.</span><span>{money(item.total_cents)}</span></div>)}<div className="flex justify-between type-body-sm text-text-2"><span>Frete</span><span>{money(checkout.quote.shipping_cents)}</span></div><div className="flex justify-between type-heading-sm"><span>Total</span><span>{money(checkout.quote.total_cents)}</span></div><p className="type-body-sm text-text-2">{checkout.status==='open'?'Confirme para registrar um pedido fictício. Nenhum valor será cobrado.':checkout.status==='completed'?'Pedido fictício registrado. Nenhum valor foi cobrado.':'Esta reserva foi encerrada.'}</p></CardContent>{checkout.status==='open'&&<CardFooter><CardMeta>Compra de teste</CardMeta><Button size="sm" variant="secondary" disabled={busy} onClick={()=>pay('cancel')}>Cancelar reserva</Button><Button size="sm" disabled={busy} onClick={()=>pay('simulate-payment')}>Simular pagamento</Button></CardFooter>}</Card>}
      {!isConsent&&!checkoutID&&<section className="flex flex-col gap-4" aria-labelledby="connected-title"><h2 id="connected-title" className="type-heading">Agentes conectados</h2>{consents.length?consents.map(c=><div key={c.id} className="rule-row flex flex-col gap-3 py-3"><div className="flex justify-between gap-4"><div className="flex min-w-0 flex-col gap-1"><h3 className="type-heading-sm">{clients[c.clientId]?.name||'Agente'}</h3><p className="break-all type-body-sm text-text-2">{clients[c.clientId]?.domain||c.clientId}</p></div><Button size="sm" variant="secondary" disabled={busy} onClick={()=>void act(async()=>{const result=await authClient.$fetch('/store/disconnect',{method:'POST',body:{id:c.id}});fail(result.error);setConsents(previous=>previous.filter(row=>row.id!==c.id));})}>Desconectar agente</Button></div><p className="type-body-sm text-text-2">{c.scopes.map(scope=>descriptions[scope]||scope).join(' ')}</p></div>):<p className="type-body text-text-2">Nenhum agente conectado. Os agentes que você autorizar aparecerão aqui.</p>}</section>}
    </>}
    {session&&!isConsent&&!checkoutID&&<section className="flex flex-col gap-4" aria-labelledby="purchases-title"><h2 id="purchases-title" className="type-heading">Suas compras</h2>{purchases.length?purchases.map(p=><div key={p.id} className="rule-row flex items-start justify-between gap-4 py-3"><div className="flex flex-col gap-1"><a className="type-label text-text-1 underline" href={'/checkout/'+encodeURIComponent(p.id)}>Ver compra de {new Date(p.created_at).toLocaleDateString('pt-BR')}</a><p className="type-body-sm text-text-2">{p.status==='completed'?'Simulação concluída':p.status==='open'?'Aguardando pagamento de teste':p.status==='canceled'?'Reserva cancelada':'Reserva expirada'}</p></div><span className="type-body-sm text-text-2">{money(p.total_cents)}</span></div>):<p className="type-body text-text-2">Suas compras aparecerão aqui depois que você iniciar um checkout.</p>}</section>}
    {session&&!isConsent&&!checkoutID&&commerce.accountId===session.user.id&&<section className="flex flex-col gap-3" aria-labelledby="demo-address-title"><h2 id="demo-address-title" className="type-heading">Endereço de demonstração</h2>{commerce.deliveryDefault?<><p className="type-body">{commerce.deliveryDefault.street}, {commerce.deliveryDefault.number}<br/>{commerce.deliveryDefault.neighborhood} · {commerce.deliveryDefault.city}, {commerce.deliveryDefault.state}<br/>CEP {commerce.deliveryDefault.postal_code}</p><p className="type-body-sm text-text-2">Endereço fictício preenchido automaticamente na entrega. Você pode editar os dados ao comprar.</p></>:<p role="status" className="type-body-sm text-text-2">{commerce.deliveryDefaultLoading?'Preparando endereço fictício…':'Não foi possível carregar o endereço fictício. Você pode preencher a entrega manualmente.'}</p>}</section>}
    <a className="type-body-sm text-text-2 underline" href="/">Voltar à loja</a>
  </main>;
}
