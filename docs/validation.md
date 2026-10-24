# Validação — 24 de outubro de 2026

Escopo: primeira Agent Store independente, em Go, com vitrine, API HTTP e compra simulada. Pagamento local sem cobrança real, escolhido explicitamente pelo fundador nesta conversa.

## Resultado

- `go test ./...`: passou, incluindo concorrência pela última unidade, rollback de uma reserva parcial, repetição da criação, repetição da conclusão, cancelamento, expiração e persistência após reabrir o banco.
- `go vet ./...`: passou.
- `node --check web/store.js`: passou.
- Teste de navegador em Chromium: passou após corrigir o favicon da página para agentes. Sem erros de console/JavaScript ou respostas HTTP com erro no percurso final.
- Desktop 1440px, celular 390px e tela 320px: verificação sem transbordamento horizontal.
- Jornada visual: três cores, tamanhos indisponíveis, carrinho, checkout Pix simulado, recarga e retomada, conclusão e consulta persistente do pedido, checkout de cartão simulado e cancelamento.
- Cliente Python independente: cotou uma unidade de `sculpt-bordo-42`, retornando 28990 centavos de BRL, frete zero e `demo: true`, sem alterar o estoque principal.
- O Windows respondeu `200 {"demo":true,"status":"ok"}` ao acessar `http://127.0.0.1:8091/healthz`.
- As três imagens foram comparadas por SHA-256 com o catálogo anterior e preservadas sem alteração.
- OpenAPI: JSON válido, parâmetros de caminho e referências locais resolvidos. Não foi feita certificação completa por um validador externo do OpenAPI.

O teste com o detector de corridas do Go não foi executado: este ambiente tem CGO desativado e não possui GCC. O teste de concorrência funcional com duas tentativas pela última unidade passou.

## Evidências visuais

- `screenshots/desktop.png`
- `screenshots/mobile.png`
- `screenshots/order.png`

O teste de compra no navegador usou banco separado da demonstração principal, na porta 8092. A prévia principal ficou na porta 8091 com o estoque inicial. O processo de teste foi encerrado após validar; a prévia principal permaneceu rodando.

## O que isso comprova

Vitrine e clientes HTTP podem usar o mesmo catálogo e a mesma lógica de compra; uma reserva altera o estoque consultável, e o backend controla preços e ações do checkout. A Agent Store já é um sistema separado do Haseo.

## O que continua pendente

Conectar o Haseo à API nova, criar o Company Agent configurável, testar um cliente MCP real e validar o produto com uma empresa. Não houve mudança ou reinício do protótipo WhatsApp, cobrança real, publicação externa ou prova de escala/mercado.


# Atualização visual — vitrine de camisetas

Em 24 de outubro de 2026, o fundador solicitou a substituição da vitrine por um header Autimit e seis cards, sem hero, footer ou banners. Usados Inter local, a paleta #E8E4DE/#FFFFFF/#111111/#8A8A8A e a mesma imagem de camiseta enviada nos seis cards. Arquivo original preservado por SHA-256.

A vitrine agora tem somente adição ao contador local da sacola; não cria pedidos de camiseta. APIs e catálogo de tênis do experimento anterior continuam separados. Removidos os metadados antigos da página inicial.

Validação no Chromium: seis cards; grade de três colunas em 1440px, duas em 820px, uma em 390px; sem transbordamento também em 320px. Hover com scale 1.03, botão acessível por foco e toque, Enter adicionando item, contador persistindo após recarregar. Sem erros de JavaScript/console no percurso. go test, go vet e verificação de sintaxe JavaScript passaram.

Capturas atuais: screenshots/tshirts-desktop.png, screenshots/tshirts-tablet.png, screenshots/tshirts-mobile.png.

# Sacola, checkout AUT e BRL — atualização de 24 de outubro de 2026

A vitrine passou a usar agent-store, AUT T-SHIRT e o preço fictício de R$ 60,00. O produto aut-tshirt tem seis cores ilustrativas e tamanhos P, M, G e GG no backend. Todas as cores continuam com a mesma imagem original.

A sacola agora é clicável e usa itens/variantes, com seleção de tamanho, quantidade e remoção. Cotação e checkout passam pela API; não há mais apenas uma contagem sem produtos. O pagamento continua simulado, com reserva de estoque, cancelamento e pedido persistido.

Movimento: cards entram em sequência, zoom 1.03, feedback no ícone da sacola, painel lateral com abertura/fechamento e transição entre sacola, pagamento e confirmação. A preferência de movimento reduzido é respeitada.

Verificações:
- go test ./..., go vet ./... e node --check web/store.js passaram.
- Teste HTTP garante AUT T-SHIRT com seis cores, 24 variantes e duas unidades no tamanho G por 12000 centavos BRL.
- Chromium: compra completa, tamanho/quantidade/remoção, retomada após recarregar, persistência do mesmo pedido, cancelamento com cartão, teclado, toque e movimento reduzido. Telas 1440, 820, 390 e 320 px, sem transbordamento horizontal. Percurso normal sem erros de console.
- Perda deliberada da resposta de criação: reserva única recuperada com a mesma chave e corpo após recarregar; carrinho bloqueado enquanto a tentativa estava incerta.
- Perda deliberada da resposta de pagamento: consulta recuperou o pedido confirmado e não duplicou o pedido; nova aprovação simulada retornou o mesmo identificador.
- Banco de testes separado na porta 8093; prévia principal na porta 8091, sem consumo de estoque pelos testes.

Capturas: aut-bag-desktop.png, aut-checkout-desktop.png, aut-order-desktop.png e aut-checkout-mobile.png em screenshots/.

Não houve cobrança real, entrega, alteração do Haseo WhatsApp ou publicação externa.

# Detalhes do produto, frete e entrega — 24 de outubro de 2026

Pedido do fundador: retirar adição direta no card, abrir detalhes, manter escolha de tamanho e incluir frete e a jornada de compra antes de conectar o Haseo.

Entrega:
- Cards viraram links acessíveis para /produto/aut-tshirt?cor=..., sem botão de adição no grid.
- Detalhes com cor, tamanho obrigatório P/M/G/GG, quantidade, disponibilidade, estimativa de frete e informações da demonstração.
- Nova etapa de entrega com contato, endereço fictício e fretes padrão/expresso calculados por CEP.
- Total do checkout inclui frete do servidor. O preço do frete não é aceito do cliente. O CEP da entrega deve coincidir com o usado na cotação.
- Pedido persiste contato, endereço e opção/prazo de frete. A migração idempotente do SQLite mantém pedidos anteriores sem endereço.
- API POST /api/v1/shipping-quotes e contrato OpenAPI 0.3.0 atualizados para consumo futuro pelo Haseo. Não houve conexão automática ao Haseo.

Validações:
- go test e go vet passaram. Cobertura de frete/CEP, cotação sem reserva, valores do total, obrigatoriedade de endereço e frete, CEP divergente, rejeição de preço de frete enviado pelo cliente e migração de banco antigo.
- Chromium: grid sem botão, link por Enter, URL direta de produto, escolha explícita de tamanho/quantidade, cálculo no produto, edição da sacola, entrega, alteração de CEP invalidando o frete anterior, total padrão/expresso, pagamento Pix com endereço, retomada e mesmo pedido após recarregar, cancelamento com cartão e compra móvel.
- Telas 1440, 820, 390 e 320 px; sem transbordamento ou erros de console no percurso normal. Movimento reduzido e teclado verificados.
- Teste de respostas perdidas passou com o novo contrato de endereço/frete: a reserva e o pedido continuaram únicos.
- As tentativas de compra usaram banco separado na porta 8093, preservando o estoque da prévia principal.

Frete é simulação determinística local, sem consulta a transportadoras ou validação da existência do CEP. Valores e prazos são fictícios; nenhuma cobrança, e-mail ou entrega real.

Capturas atuais: product-desktop.png, product-mobile.png, delivery-desktop.png, checkout-shipping-desktop.png, checkout-shipping-mobile.png.


# Preparação do deploy público — 24 de outubro de 2026

O fundador escolheu Railway e autorizou usar o repositório público autimit/agent-store. Foi criado um repositório Git local independente contendo somente a loja. O Haseo e demais projetos não fazem parte do conteúdo. Arquivos .env, SQLite local, .runtime e binários foram excluídos do Git e da imagem.

Dockerfile compilado com Go 1.26, CGO desativado e imagem final mínima. O app aceita PORT e caminho do banco por ambiente. railway.toml define verificação de saúde /healthz e reinício em falha.

Validação da imagem Docker: catálogo, frete e pedido Pix simulado com total de 7490 centavos; reinicialização do contêiner e consulta do mesmo pedido comprovaram a persistência no volume separado de teste. go test, go vet e verificação de whitespace dos arquivos passaram.

A validação do endereço público e do provedor será registrada no Linear após a implantação. A demonstração continua sem cobranças ou entregas reais.
