# agent-store

Loja de demonstração da Autimit, com frontend React/Vite usando o design system Glaze, API em Go e checkout local. **Nenhuma cobrança ou entrega real.**

## Rodar

Requer Node.js 24+ e Go 1.26+ no PATH, ou `AGENT_STORE_GO_BIN` apontando para o executável Go.

```bash
cd agent-store
./dev
```

Loja: http://localhost:8091 · API: http://localhost:8091/openapi.json · Interface para agentes: http://localhost:8091/agents

O processo escuta somente no loopback por padrão. `Ctrl+C` encerra. Não precisa de chave de IA ou pagamento.

```bash
./dev -addr 127.0.0.1:8093 -db /tmp/agent-store-test-fresh.db
```

## Publicar

O projeto inclui Dockerfile e railway.toml. Para publicar apenas esta loja com volume persistente, siga [o guia de deploy no Railway](docs/deploy-railway.md). Bancos e dados locais não entram no Git ou na imagem.

## Compra demonstrativa

- Marca da vitrine: **agent-store**. Produto: **AUT T-SHIRT**, preço fictício de **R$ 60,00**, seis opções de cor e tamanhos P, M, G e GG.
- Os seis cards reutilizam a mesma imagem enviada pelo fundador; os nomes das cores são ilustrativos. O arquivo da imagem foi preservado.
- Os cards são links para `/produto/aut-tshirt?cor=...`. Na página de detalhes, a pessoa escolhe explicitamente cor, tamanho e quantidade antes de adicionar. A sacola também permite editar ou remover itens.
- A cotação usa preços em centavos BRL calculados pelo servidor. O limite da demo é de dez unidades. É possível estimar frete na página de produto e escolher o serviço na etapa de entrega.
- Depois da sacola, preencha contato e endereço fictícios, calcule frete pelo CEP e escolha padrão ou expresso. Continuar para pagamento cria a reserva de 15 minutos. Escolha Pix ou cartão e aprove explicitamente a simulação.
- A confirmação gera um pedido fictício persistido no SQLite. Não há QR Pix pagável, coleta de dados de cartão ou envio real.
- Cancelar libera a reserva; fechar a sacola não cancela. Reservas vencidas são liberadas na próxima operação do catálogo/checkout.

O carrinho fica em `localStorage`. O rascunho de contato/endereço fictício, o checkout e seu token ficam em `sessionStorage` para retomar na mesma aba após recarregar. O contador antigo sem itens não é convertido em SKUs arbitrários.

Se a resposta da criação for perdida, o carrinho fica bloqueado e a próxima tentativa repete a mesma chave e corpo, recuperando o mesmo checkout. Se a resposta de pagamento for perdida, a interface consulta o estado persistido antes de apresentar o resultado.

## Visual e movimento

Glaze oficial do design.how: tema preto e branco, fonte Geist local como fallback previsto pelo sistema, tokens semânticos, cards com shell, campos em pílula e uma ação primária por grupo. Grid 3/2/1 colunas. Os cards levam aos detalhes; a adição só ocorre após escolher tamanho.

Sacola e checkout usam Sheet controlado do Glaze, com foco, Escape, isolamento do conteúdo de fundo e transições que respeitam movimento reduzido. As regras de compra, contratos HTTP, preços e armazenamento continuam no backend Go.

O tema é importado em `src/main.tsx`, com `class="glaze"` no body e `GlazePortalProvider` para overlays. As instruções estão em `.agents/skills/glaze/SKILL.md`; toda alteração de UI deve segui-las. Componentes ficam em `src/components/glaze` e a camada de compra em `src/lib/commerce.ts`.

```bash
npm ci
npm run build
npx eslint -c glaze.eslint.config.mjs .
```

O build gera `web/dist`, incorporado ao binário Go. O Dockerfile compila frontend e backend em estágios separados; Node não roda no servidor final. `./dev` faz o build do frontend antes de iniciar Go.

## Frete e entrega

O frete é uma simulação local, sem transportadora ou consulta externa de endereço. O CEP é validado pelo formato, não pela existência. Para CEP começando por 0–3: padrão R$ 14,90, de 3 a 6 dias úteis; para 4–9: R$ 19,90, de 5 a 9 dias. Expresso custa R$ 10,00 a mais e usa de 1 a 3 dias úteis fictícios. Valores e prazos não são promessas de operação real.

O cliente envia somente `postal_code` e `service_id`; o servidor determina preço e prazo e recalcula no checkout. Contato e endereço são obrigatórios; o CEP deve coincidir com o frete selecionado. Alterar o CEP invalida a opção anterior na interface. A cotação e o endereço ficam salvos com o pedido. Não há envio de e-mail nem rastreamento real.

Foi adicionada uma coluna `delivery` ao banco existente com migração idempotente. Pedidos anteriores continuam legíveis, mesmo sem endereço/frete.

## Dados e persistência

Catálogo em `data/catalog.json`, imagens em `data/images/`, SQLite em `.runtime/agent-store.db`. As quantidades são importadas somente na primeira criação de cada SKU. Reiniciar não repõe estoque. Para uma nova demonstração com estoque inicial, use outro banco em `-db`; não apague o banco de uma sessão em andamento.

O catálogo anterior Sculpt foi preservado como exemplo adicional na API. A vitrine seleciona o produto `aut-tshirt`; o fluxo de camisetas não depende dos SKUs de tênis. O protótipo irmão `../haseo-whatsapp` não foi modificado e ainda usa seu catálogo anterior.

## API para agentes

HTTP/JSON documentado em OpenAPI 3.1.1. `/llms.txt` é um guia textual, sem garantia de descoberta automática ou implementação de um protocolo de agentes.

| Operação | Efeito |
| --- | --- |
| `GET /api/v1/store` | Identidade e políticas. |
| `GET /api/v1/products?q=...` | Catálogo e estoque atual. |
| `GET /api/v1/products/aut-tshirt` | Camiseta, seis cores e 24 variantes. |
| `GET /api/v1/variants/{id}/availability?quantity=1` | Disponibilidade sem reserva. |
| `GET /api/v1/images/{id}` | Imagem por identificador. |
| `POST /api/v1/shipping-quotes` | Opções de frete por itens e CEP, sem reserva. |
| `POST /api/v1/quotes` | Cotação com frete opcional; sem seleção, `shipping_required=true` e total parcial. |
| `POST /api/v1/checkouts` | Reserva; exige `Idempotency-Key`, `shipping` e `delivery`. |
| `GET /api/v1/checkouts/{id}` | Estado do checkout, com seu token. |
| `POST /api/v1/checkouts/{id}/simulate-payment` | Pedido fictício; sem transferência de dinheiro. |
| `POST /api/v1/checkouts/{id}/cancel` | Libera a reserva de checkout aberto. |

Criação retorna `access_token`. Envie `Authorization: Bearer <access_token>` para ler ou operar aquele checkout. Não há listagem pública de pedidos. Chaves de idempotência aleatórias devem ser preservadas junto do corpo da tentativa: repetir ambos retorna o mesmo checkout; mudar o corpo com a mesma chave retorna 409. A retenção dura a vida do banco da demo.

O consumidor deve obter consentimento antes de reservar e autorização explícita para simular o pagamento. O backend não consegue atestar a conversa externa.

```bash
# Cliente HTTP sem LLM: apenas cotação.
python3 scripts/agent-client.py

# Compra explicitamente simulada; consome estoque fictício.
python3 scripts/agent-client.py --simulate-purchase
```

## Verificar

```bash
npm run build
npx eslint -c glaze.eslint.config.mjs .
go test ./...
go vet ./...
```

Os testes de navegador requerem Playwright e Chromium. Usam uma instância com banco descartável novo, na porta 8093, e concluem pedidos simulados; não rodar contra a demonstração principal sem intenção de consumir seu estoque.

```bash
./dev -addr 127.0.0.1:8093 -db /tmp/agent-store-browser-fresh.db
# Em outro terminal; caminhos opcionais quando Playwright já estiver no ambiente.
PLAYWRIGHT_PACKAGE=/caminho/node_modules/playwright \
CHROMIUM_PATH=/caminho/chromium/chrome \
node scripts/verify-browser.cjs

# Mesmo ambiente, teste com perda deliberada de respostas HTTP.
node scripts/verify-recovery.cjs
```

Evidências em `docs/validation.md` e `docs/screenshots/aut-*.png`.

## Limites

MVP local, sem cobrança real, login de cliente, entrega, integração MCP/A2A ou comprovação de escala. O token do checkout fica no banco da demo para permitir replay da criação; trate banco e chaves como dados de acesso. Não inserir dados pessoais ou credenciais financeiras reais.

Para operação pública, ainda são necessários autenticação/autorizações, proteção contra abuso, HTTPS, operação de dados e integração/conciliacão do provedor financeiro e da entrega.

Fonte Geist sob SIL OFL em `public/assets/Geist-OFL.txt`. Contrato baseado em [OpenAPI 3.1.1](https://spec.openapis.org/oas/v3.1.1.html).
