// Full browser journey. Both auth and commerce must use disposable local databases.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {randomBytes}=require('node:crypto');
const {chromium,request}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright');
const {registerAccount}=require('./auth-fixture.cjs');
const origin=process.env.STORE_URL||'http://localhost:8097';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Disposable loopback fixture required.');
const output='.ui-review/account-checkout';
const password='checkout-fixture-password-2026';
async function capture(page,name,width){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:output+'/'+name+'-'+width+'.png'});await fs.writeFile(output+'/'+name+'-'+width+'.aria.txt',await page.locator('body').ariaSnapshot());}
async function fillDelivery(page,email){
 for(const [name,value] of Object.entries({full_name:'Cliente de Teste',email,postal_code:'01001000',street:'Rua de Teste',number:'100',neighborhood:'Centro',city:'São Paulo'}))await page.locator('#delivery-'+name).fill(value);
 await page.locator('#delivery-state').selectOption('SP');await page.locator('#calculate-shipping').click();await page.locator('#start-checkout:enabled').waitFor();await page.getByRole('radio',{name:/^Expresso/}).click();await page.locator('#start-checkout:enabled').waitFor();assert.ok(await page.getByRole('radio',{name:/^Expresso/}).isChecked());
}
(async()=>{
 await fs.mkdir(output,{recursive:true});const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});const anonymous=await request.newContext();
 try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const email='buyer-'+randomBytes(8).toString('hex')+'@example.test';const size=width===390?'M':'G';
  await page.goto(origin+'/produto/aut-tshirt?cor=aut-oliva');await page.getByRole('button',{name:'Tamanho '+size,exact:true}).click();await page.locator('#detail-add').click();
  await page.getByRole('button',{name:'Entrar para continuar',exact:true}).waitFor();await capture(page,'guest-bag',width);
  const stockPath=origin+'/api/v1/variants/aut-oliva-'+size.toLowerCase()+'/availability';const before=(await(await anonymous.get(stockPath)).json()).available;
  const guest=await anonymous.post(origin+'/api/v1/checkouts',{headers:{Origin:origin,'Idempotency-Key':'anonymous-attempt-00001'},data:{}});assert.equal(guest.status(),401);assert.equal((await(await anonymous.get(stockPath)).json()).available,before);
  await page.getByRole('button',{name:'Entrar para continuar',exact:true}).click();await page.waitForURL('**/conta?returnTo=*');
  await page.getByRole('button',{name:'Criar conta',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Cliente de Teste');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await capture(page,'login-return',width);
  const signup=page.waitForResponse(r=>r.url().endsWith('/api/auth/sign-up/email'));
  await page.getByRole('button',{name:'Cadastrar conta',exact:true}).click();const signupResponse=await signup;
  if(signupResponse.status()!==200){const problem=await signupResponse.json();throw new Error('Signup failed '+signupResponse.status()+': '+(problem.message||problem.code));}
  await page.waitForURL(origin+'/?sacola=1&etapa=entrega',{waitUntil:'domcontentloaded'}).catch(async e=>{await capture(page,'return-failed',width);console.error('Return state:',await page.locator('main').ariaSnapshot());console.error('Page errors:',errors);throw e;});await page.getByRole('heading',{name:'Entrega e contato',exact:true}).waitFor();assert.equal(await page.locator('#bag-count').textContent(),'1');
  await fillDelivery(page,email);
  // Expire the browser session before reservation: preserve the draft and express shipping.
  await context.clearCookies();await page.locator('#start-checkout').click();await page.waitForURL('**/conta?returnTo=*');await page.getByLabel('E-mail',{exact:true}).fill(email);await page.getByLabel('Senha',{exact:true}).fill(password);await page.getByRole('button',{name:'Entrar na conta',exact:true}).click();await page.waitForURL(origin+'/?sacola=1&etapa=entrega');
  await page.locator('#start-checkout:enabled').waitFor();assert.equal(await page.locator('#delivery-full_name').inputValue(),'Cliente de Teste');assert.equal(await page.locator('#delivery-email').inputValue(),email);assert.ok(await page.getByRole('radio',{name:/^Expresso/}).isChecked());await capture(page,'restored-delivery',width);
  const created=page.waitForResponse(r=>r.url()===origin+'/api/v1/checkouts'&&r.request().method()==='POST'&&r.status()===201);
  await page.locator('#start-checkout').click();const checkout=await(await created).json();assert.equal(checkout.quote.total_cents,8490);await page.locator('#simulate-payment:enabled').waitFor();await capture(page,'owned-reservation',width);assert.equal((await(await anonymous.get(stockPath)).json()).available,before-1);
  const noSession=await anonymous.get(origin+'/api/v1/checkouts/'+checkout.id,{headers:{Authorization:'Bearer '+checkout.access_token}});assert.equal(noSession.status(),401);
  const bob=await browser.newContext();const other=await bob.newPage();await registerAccount(other,origin);
  const foreign=await bob.request.get(origin+'/api/account/checkouts/'+checkout.id);assert.equal(foreign.status(),404);
  for(const action of ['cancel','simulate-payment']){const denied=await bob.request.post(origin+'/api/v1/checkouts/'+checkout.id+'/'+action,{headers:{Origin:origin,Authorization:'Bearer '+checkout.access_token},data:{}});assert.equal(denied.status(),404);}
  const others=await(await bob.request.get(origin+'/api/account/checkouts')).json();assert.deepEqual(others,[]);await bob.close();
  // Another browser logged into the SAME account can resume through account ownership.
  const second=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});const same=await second.newPage();await same.goto(origin+'/conta');await same.getByLabel('E-mail',{exact:true}).fill(email);await same.getByLabel('Senha',{exact:true}).fill(password);await same.getByRole('button',{name:'Entrar na conta',exact:true}).click();
  await same.locator('a[href="/checkout/'+checkout.id+'"]').waitFor();await capture(same,'my-purchases',width);await same.locator('a[href="/checkout/'+checkout.id+'"]').click();await same.getByRole('button',{name:'Simular pagamento',exact:true}).click();await same.getByText('Simulação concluída',{exact:true}).waitFor();await capture(same,'completed',width);
  await page.reload();await page.getByText('Simulação concluída',{exact:true}).waitFor();assert.equal(await page.locator('#bag-count').textContent(),'0');
  await same.goto(origin+'/conta');await same.getByRole('button',{name:'Sair da conta',exact:true}).click();await same.getByRole('heading',{name:'Entre na sua conta',exact:true}).waitFor();const afterLogout=await second.request.get(origin+'/api/account/checkouts/'+checkout.id);assert.equal(afterLogout.status(),401);
  assert.deepEqual(errors,[]);await context.close();await second.close();console.log('PASS '+width+': guest denied, login return, draft/shipping recovery after expiry, owned reserve, other-account denial even with token, same-account second browser, payment, history and logout.');
 }
 }finally{await anonymous.dispose();await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
