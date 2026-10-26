// Run only against a disposable local database and a disposable Better Auth store.
const {chromium,request}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const {randomBytes,createHash}=require('node:crypto');
const fs=require('node:fs/promises');
const assert=require('node:assert/strict');
const base=process.env.AUTH_TEST_URL || 'http://localhost:8097';
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw new Error('Local fixture required.');
const output=process.env.AUTH_TEST_OUTPUT || '.ui-review/better-auth';
async function capture(page,name,width){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:output+'/'+name+'-'+width+'.png'});
 await fs.writeFile(output+'/'+name+'-'+width+'.aria.txt',await page.locator('body').ariaSnapshot());
}
(async()=>{
 await fs.mkdir(output,{recursive:true});
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH});
 try{
  for(const width of [390,1280]){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
   const agent=await request.newContext();
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/conta');await page.getByRole('button',{name:'Criar conta',exact:true}).waitFor();
   await page.keyboard.press('Tab');await capture(page,'login',width);
   await page.getByRole('button',{name:'Criar conta',exact:true}).click();
   await page.getByLabel('Nome',{exact:true}).waitFor();await capture(page,'signup-empty',width);
   await page.getByLabel('Nome',{exact:true}).fill('Cliente de Teste');
   await page.getByLabel('E-mail',{exact:true}).fill('ui-'+width+'-'+randomBytes(4).toString('hex')+'@example.test');
   await page.getByLabel('Senha',{exact:true}).fill('interface-password-2026');
   await capture(page,'signup',width);
   await page.getByRole('button',{name:'Cadastrar conta',exact:true}).click();
   await page.getByRole('heading',{name:'Sua conta',exact:true}).waitFor();
   await page.reload();await page.getByRole('heading',{name:'Sua conta',exact:true}).waitFor();
   const client=await page.evaluate(async()=>{
    const response=await fetch('/api/auth/oauth2/create-client',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Personal Agent de Teste',redirect_uris:['http://127.0.0.1:9876/callback'],application_type:'native',token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'checkouts:read checkouts:write offline_access',require_pkce:true})});
    if(!response.ok)throw new Error('OAuth client fixture failed: '+response.status);return response.json();
   });
   const verifier=randomBytes(32).toString('base64url');const state=randomBytes(24).toString('base64url');
   const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:9876/callback',response_type:'code',scope:'checkouts:read checkouts:write offline_access',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'consent'});
   await page.route('http://127.0.0.1:9876/callback?**',route=>route.fulfill({status:200,contentType:'text/plain',body:'Callback de teste recebido.'}));
   await page.goto(base+'/api/auth/oauth2/authorize?'+query);
   await page.getByRole('heading',{name:'Conectar agente',exact:true}).waitFor();
   await page.getByRole('button',{name:'Autorizar agente'}).waitFor({state:'visible'});
   await page.getByRole('checkbox',{name:'Criar e cancelar reservas. Não permite pagar.'}).uncheck();
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await capture(page,'consent',width);
   await page.getByRole('button',{name:'Autorizar agente'}).click();await page.waitForURL('http://127.0.0.1:9876/callback?**');
   const callback=new URL(page.url());assert.equal(callback.searchParams.get('state'),state);assert.equal(callback.searchParams.get('iss'),base+'/api/auth');
   const tokenResponse=await agent.post(base+'/api/auth/oauth2/token',{form:{grant_type:'authorization_code',code:callback.searchParams.get('code'),code_verifier:verifier,redirect_uri:'http://127.0.0.1:9876/callback',client_id:client.client_id}});
   if(tokenResponse.status()!==200){const problem=await tokenResponse.json();throw new Error('Token exchange failed: '+tokenResponse.status()+' '+(problem.error_description||problem.message||problem.error));}const tokens=await tokenResponse.json();assert.ok(tokens.refresh_token);assert.ok(!tokens.scope.includes('checkouts:write'));
   await page.goto(base+'/conta');await page.getByRole('button',{name:'Desconectar agente'}).waitFor();
   await capture(page,'connections',width);
   await page.getByRole('button',{name:'Desconectar agente'}).click();await page.getByText('Nenhum agente conectado.',{exact:false}).waitFor();
   const refresh=await agent.post(base+'/api/auth/oauth2/token',{form:{grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id}});assert.equal(refresh.status(),400);
   await page.getByRole('button',{name:'Sair da conta'}).click();await page.getByRole('heading',{name:'Entre na sua conta',exact:true}).waitFor();
   assert.deepEqual(errors,[]);await agent.dispose();await context.close();console.log('PASS width='+width+' signup, reload, OAuth consent, partial scopes, PKCE, disconnect, revocation, logout; no overflow or page errors.');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
