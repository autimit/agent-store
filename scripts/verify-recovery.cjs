// Deliberately loses HTTP responses against a disposable local demo database.
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE || 'playwright');
const origin = process.env.STORE_URL || 'http://127.0.0.1:8093';
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 950 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    const availability = async () => (await (await page.request.get(origin + '/api/v1/variants/aut-azul-gg/availability')).json()).available;
    const before = await availability();
    await page.goto(origin + '/produto/aut-tshirt?cor=aut-azul', { waitUntil: 'networkidle' });
    await page.getByRole('button', {name:'Tamanho GG', exact:true}).click(); await page.locator('#detail-add').click();
    await page.locator('#continue-to-delivery:enabled').waitFor(); await page.locator('#continue-to-delivery').click();
    for (const [name,value] of Object.entries({full_name:'Cliente Demo',email:'demo@example.test',postal_code:'01001000',street:'Rua de Teste',number:'100',neighborhood:'Centro',city:'São Paulo'})) await page.locator('#delivery-'+name).fill(value);
    await page.locator('#delivery-state').selectOption('SP'); await page.locator('#calculate-shipping').click();
    await page.locator('#start-checkout:enabled').waitFor();
    let original, createCount = 0; const keys = [];
    await page.route('**/api/v1/checkouts', async route => {
      keys.push(route.request().headers()['idempotency-key']);
      const response = await route.fetch();
      const c = await response.json();
      createCount += 1;
      if (createCount === 1) { original = c; await route.abort('failed'); }
      else { assert.equal(c.id, original.id); await route.fulfill({ response }); }
    });
    await page.locator('#start-checkout').click();
    await page.getByRole('button', { name: 'Retomar tentativa de checkout', exact: true }).waitFor();
    assert.equal(await availability(), before - 1);
    assert(await page.locator('.quantity-button').first().isDisabled());
    assert(await page.locator('select').first().isDisabled());
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#open-bag').click();
    await page.getByRole('button', { name: 'Retomar tentativa de checkout', exact: true }).click();
    await page.locator('#simulate-payment:enabled').waitFor();
    assert.equal(createCount, 2);
    assert.equal(keys[0], keys[1]);
    assert.equal(await availability(), before - 1);
    let completed;
    await page.route('**/api/v1/checkouts/*/simulate-payment', async route => {
      const response = await route.fetch(); completed = await response.json(); await route.abort('failed');
    });
    await page.locator('#simulate-payment').click();
    await page.getByText('SIMULAÇÃO CONCLUÍDA', { exact: true }).waitFor();
    assert.equal(await page.locator('.order-reference code').getAttribute('data-order-id'), completed.order_id);
    assert.equal(await page.locator('#sheet-error').textContent(), '');
    assert.equal(await page.locator('#bag-count').textContent(), '0');
    const repeated = await page.request.post(origin + '/api/v1/checkouts/' + original.id + '/simulate-payment', { headers: { Authorization: 'Bearer ' + original.access_token }, data: {} });
    assert.equal((await repeated.json()).order_id, completed.order_id);
    assert.equal(await availability(), before - 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ result: 'PASS', checks: ['lost creation response', 'pending cart locked', 'reload and idempotent recovery', 'one stock reservation', 'lost payment response', 'confirmed order recovered', 'no duplicate order'] }));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
