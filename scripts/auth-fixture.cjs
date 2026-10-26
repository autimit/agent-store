const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
async function registerAccount(page,origin){
 if(!['localhost','127.0.0.1'].includes(new URL(origin).hostname))throw new Error('Purchase tests require a disposable loopback instance.');
 const credentials={name:'Cliente de Teste',email:'fixture-'+randomBytes(8).toString('hex')+'@example.test',password:'fixture-password-2026'};
 let response;
 for(let attempt=0;attempt<3;attempt++){
  response=await page.request.post(origin+'/api/auth/sign-up/email',{headers:{Origin:origin},data:credentials});
  if(response.status()!==429)break;
  const seconds=Number(response.headers()['retry-after']||60);assert.ok(seconds>0&&seconds<=60,'Unexpected fixture retry window');
  await new Promise(resolve=>setTimeout(resolve,Math.min(60000,seconds*1000+250)));
 }
 assert.equal(response.status(),200,'Could not register the local account fixture');
 const body=await response.json();return {...credentials,id:body.user.id};
}
module.exports={registerAccount};
