import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes, createHash} from 'node:crypto';
import {getMigrations} from 'better-auth/db/migration';
import {createStoreAuth} from './config.mjs';

const origin='http://localhost:8095';
function cookies(response){return response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');}
test('production keeps its generated secret private and preserves secure sessions across restart',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'agent-store-production-auth-'));
  const prior={NODE_ENV:process.env.NODE_ENV,BETTER_AUTH_SECRET:process.env.BETTER_AUTH_SECRET,BETTER_AUTH_SECRET_FILE:process.env.BETTER_AUTH_SECRET_FILE};
  let instance;
  try{
    process.env.NODE_ENV='production';delete process.env.BETTER_AUTH_SECRET;delete process.env.BETTER_AUTH_SECRET_FILE;
    assert.throws(()=>createStoreAuth({directory,origin:'https://store.example.test'}),/Configure BETTER_AUTH_SECRET/);
    process.env.BETTER_AUTH_SECRET_FILE=join(directory,'better-auth.secret');
    instance=createStoreAuth({directory,origin:'https://store.example.test',migrating:true});
    await(await getMigrations(instance.auth.options)).runMigrations();await instance.auth.$context;
    const firstSecret=readFileSync(process.env.BETTER_AUTH_SECRET_FILE);
    assert.ok(firstSecret.length>=32);assert.equal(statSync(process.env.BETTER_AUTH_SECRET_FILE).mode&0o777,0o600);
    const response=await instance.auth.handler(new Request('https://store.example.test/api/auth/sign-up/email',{method:'POST',headers:{Origin:'https://store.example.test','Content-Type':'application/json','X-Agent-Store-Client-IP':'192.0.2.30'},body:JSON.stringify({name:'Production fixture',email:'production@example.test',password:'production-fixture-password-2026'})}));
    assert.equal(response.status,200);
    const sessionCookie=response.headers.getSetCookie().find(value=>value.includes('session_token='));
    assert.ok(sessionCookie);assert.match(sessionCookie,/; Secure/i);assert.match(sessionCookie,/; HttpOnly/i);assert.match(sessionCookie,/; SameSite=Lax/i);
    instance.database.close();instance=undefined;
    instance=createStoreAuth({directory,origin:'https://store.example.test'});await instance.auth.$context;
    assert.ok(firstSecret.equals(readFileSync(process.env.BETTER_AUTH_SECRET_FILE)));
    const restored=await instance.auth.handler(new Request('https://store.example.test/api/auth/get-session',{headers:{Cookie:sessionCookie.split(';')[0],'X-Agent-Store-Client-IP':'192.0.2.30'}}));
    assert.equal(restored.status,200);assert.equal((await restored.json()).user.email,'production@example.test');
  }finally{
    instance?.database.close();
    for(const [key,value] of Object.entries(prior)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    rmSync(directory,{recursive:true,force:true});
  }
});
test('Better Auth owns signup, login, OAuth PKCE, consent, refresh and revocation',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'agent-store-better-auth-'));
  const {auth,database}=createStoreAuth({directory,origin,migrating:true});
  try {
    const migration=await getMigrations(auth.options);await migration.runMigrations();await auth.$context;
    async function request(path,{body,cookie,form,redirect='manual'}={}){
      const headers={'Origin':origin,'X-Agent-Store-Client-IP':'192.0.2.10'};if(cookie)headers.Cookie=cookie;
      if(body)headers['Content-Type']='application/json';if(form)headers['Content-Type']='application/x-www-form-urlencoded';
      return auth.handler(new Request(origin+'/api/auth'+path,{method:body||form?'POST':'GET',headers,body:body?JSON.stringify(body):form?new URLSearchParams(form).toString():undefined,redirect}));
    }
    let response=await request('/sign-up/email',{body:{name:'Cliente de Teste',email:'cliente@example.test',password:'integration-password-2026'}});
    assert.equal(response.status,200);const cookie=cookies(response);assert.ok(cookie.includes('session_token='));
    response=await request('/get-session',{cookie});const session=await response.json();assert.equal(session.user.email,'cliente@example.test');
    response=await request('/sign-in/email',{body:{email:'cliente@example.test',password:'incorrect-password-2026'}});assert.equal(response.status,401);
    response=await request('/sign-in/email',{body:{email:'cliente@example.test',password:'integration-password-2026'}});assert.equal(response.status,200);
    const headers=new Headers({Cookie:cookie,Origin:origin});
    const client=await auth.api.createOAuthClient({headers,body:{client_name:'Integration Personal Agent',redirect_uris:['http://127.0.0.1:9876/callback'],application_type:'native',token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],scope:'checkouts:read checkouts:write offline_access',require_pkce:true}});
    const verifier=randomBytes(32).toString('base64url');const challenge=createHash('sha256').update(verifier).digest('base64url');
    const query=new URLSearchParams({client_id:client.client_id,redirect_uri:'http://127.0.0.1:9876/callback',response_type:'code',scope:'checkouts:read checkouts:write offline_access',state:'test-state',code_challenge:challenge,code_challenge_method:'S256',prompt:'consent'});
    response=await request('/oauth2/authorize?'+query,{cookie});assert.equal(response.status,302);
    const consentURL=new URL(response.headers.get('Location'),origin);assert.equal(consentURL.pathname,'/conta/autorizar');
    const signedNames=new Set(consentURL.searchParams.getAll('ba_param'));const signedQuery=new URLSearchParams();for(const [key,value] of consentURL.searchParams){if(key==='sig'||key==='ba_param'||signedNames.has(key))signedQuery.append(key,value);}
    response=await request('/oauth2/consent',{cookie,body:{accept:true,scope:'checkouts:read offline_access',oauth_query:signedQuery.toString()}});
    if(response.status!==200){const problem=await response.json();assert.fail('Consent failed: '+(problem.error_description||problem.message||problem.error));}const consent=await response.json();const callback=new URL(consent.url);assert.equal(callback.searchParams.get('state'),'test-state');assert.equal(callback.searchParams.get('iss'),origin+'/api/auth');
    const code=callback.searchParams.get('code');assert.ok(code);
    response=await request('/oauth2/token',{form:{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:'http://127.0.0.1:9876/callback',client_id:client.client_id}});
    assert.equal(response.status,200);const tokens=await response.json();assert.ok(tokens.access_token);assert.ok(tokens.refresh_token);assert.ok(!tokens.scope.includes('checkouts:write'));
    response=await request('/oauth2/token',{form:{grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id,scope:'checkouts:write'}});assert.equal(response.status,400);
    response=await request('/oauth2/token',{form:{grant_type:'refresh_token',refresh_token:tokens.refresh_token,client_id:client.client_id}});assert.equal(response.status,200);const refreshed=await response.json();
    response=await request('/oauth2/revoke',{form:{token:refreshed.refresh_token||tokens.refresh_token,token_type_hint:'refresh_token',client_id:client.client_id}});assert.equal(response.status,200);
    response=await request('/oauth2/token',{form:{grant_type:'refresh_token',refresh_token:refreshed.refresh_token||tokens.refresh_token,client_id:client.client_id}});assert.equal(response.status,400);
    response=await request('/oauth2/token',{form:{grant_type:'authorization_code',code,code_verifier:verifier,redirect_uri:'http://127.0.0.1:9876/callback',client_id:client.client_id}});assert.equal(response.status,400);
    // Start a fresh, live grant: disconnect must revoke tokens, not only erase consent.
    response=await request('/oauth2/authorize?'+query,{cookie});const again=new URL(response.headers.get('Location'),origin);
    const names2=new Set(again.searchParams.getAll('ba_param'));const signed2=new URLSearchParams();for(const [key,value] of again.searchParams){if(key==='sig'||key==='ba_param'||names2.has(key))signed2.append(key,value);}
    response=await request('/oauth2/consent',{cookie,body:{accept:true,scope:'checkouts:read offline_access',oauth_query:signed2.toString()}});assert.equal(response.status,200);const againCallback=new URL((await response.json()).url);
    response=await request('/oauth2/token',{form:{grant_type:'authorization_code',code:againCallback.searchParams.get('code'),code_verifier:verifier,redirect_uri:'http://127.0.0.1:9876/callback',client_id:client.client_id}});assert.equal(response.status,200);const liveTokens=await response.json();assert.ok(liveTokens.refresh_token);
    response=await request('/oauth2/get-consents',{cookie});const consents=await response.json();assert.equal(consents.length,1);
    response=await request('/sign-up/email',{body:{name:'Outra pessoa',email:'outra@example.test',password:'other-password-2026'}});assert.equal(response.status,200);const otherCookie=cookies(response);
    response=await request('/store/disconnect',{cookie:otherCookie,body:{id:consents[0].id}});assert.equal(response.status,404);
    response=await request('/store/disconnect',{cookie,body:{id:consents[0].id}});assert.equal(response.status,200);
    response=await request('/oauth2/get-consents',{cookie});assert.equal((await response.json()).length,0);
    response=await request('/oauth2/token',{form:{grant_type:'refresh_token',refresh_token:liveTokens.refresh_token,client_id:client.client_id}});assert.equal(response.status,400);
    const row=database.prepare('SELECT password FROM account WHERE userId=?').get(session.user.id);assert.ok(row.password);assert.notEqual(row.password,'integration-password-2026');
    response=await request('/sign-out',{cookie,body:{}});assert.equal(response.status,200);
    response=await request('/get-session',{cookie});assert.equal(await response.json(),null);
  }finally{database.close();rmSync(directory,{recursive:true,force:true});}
});
