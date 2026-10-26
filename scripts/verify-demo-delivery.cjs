// Run only with disposable auth/commerce databases on loopback.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright');
const {registerAccount}=require('./auth-fixture.cjs');
const origin=process.env.STORE_URL||'http://localhost:8097';
if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Disposable loopback instance required.');
const output='.ui-review/demo-delivery';
async function capture(page,name,width){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:output+'/'+name+'-'+width+'.png'});await fs.writeFile(output+'/'+name+'-'+width+'.aria.txt',await page.locator('body').ariaSnapshot());}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true});
 try{for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:950},reducedMotion:'reduce'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const credentials=await registerAccount(page,origin);
  const expected=await(await context.request.get(origin+'/api/account/demo-delivery')).json();assert.equal(expected.demo,true);
  await page.goto(origin+'/conta');await page.getByRole('heading',{name:'Endereço de demonstração',exact:true}).waitFor();await page.getByText(/Rua da Demonstração,/).waitFor();await capture(page,'account',width);
  await page.goto(origin+'/produto/aut-tshirt?cor=aut-oliva');await page.getByRole('button',{name:'Tamanho '+(width===390?'M':'G'),exact:true}).click();await page.locator('#detail-add').click();await page.locator('#continue-to-delivery:enabled').click();
  await page.locator('#start-checkout:enabled').waitFor();
  for(const [name,value] of Object.entries(expected.delivery))assert.equal(await page.locator('#delivery-'+name).inputValue(),value);
  assert.ok(await page.getByRole('radio',{name:/^Padrão/}).isChecked());
  await capture(page,'prefilled',width);
  // Presets must not replace a partially edited or intentionally blank draft.
  await page.locator('#delivery-street').fill('Rua Editada de Teste');await page.locator('#delivery-complement').fill('');
  await page.goto(origin+'/?sacola=1&etapa=entrega');await page.locator('#start-checkout:enabled').waitFor();
  assert.equal(await page.locator('#delivery-street').inputValue(),'Rua Editada de Teste');assert.equal(await page.locator('#delivery-complement').inputValue(),'');
  const created=page.waitForResponse(r=>r.url()===origin+'/api/v1/checkouts'&&r.request().method()==='POST'&&r.status()===201);
  await page.locator('#start-checkout').click();const checkout=await(await created).json();assert.equal(checkout.delivery.street,'Rua Editada de Teste');assert.equal(checkout.quote.total_cents,7490);
  await page.locator('#simulate-payment:enabled').click();await page.getByText('Simulação concluída',{exact:true}).waitFor();
  // No draft storage in this browser: the same account still gets its preset.
  const second=await browser.newContext();const same=await second.newPage();await same.goto(origin+'/conta');await same.getByLabel('E-mail',{exact:true}).fill(credentials.email);await same.getByLabel('Senha',{exact:true}).fill(credentials.password);await same.getByRole('button',{name:'Entrar na conta',exact:true}).click();
  await same.getByText(/Rua da Demonstração,/).waitFor();assert.deepEqual(await(await second.request.get(origin+'/api/account/demo-delivery')).json(),expected);
  assert.deepEqual(errors,[]);await second.close();await context.close();console.log('PASS '+width+': account preset, automatic delivery/freight, edited and blank draft preserved, simulated order, same-account preset in second browser.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
