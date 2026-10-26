# Publicar somente a Agent Store no Railway

O repositório deve ter esta pasta como raiz. Haseo, chaves de IA, sessão WhatsApp e outros projetos não fazem parte do deploy.

## O que é enviado

Código Go, vitrine incorporada ao binário, Better Auth com seus plugins oficiais, catálogo e imagens de demonstração. `.runtime/`, `.poppy/`, `.env`, bancos, chaves e binários locais estão ignorados no Git e no contexto Docker. Os bancos da hospedagem começam sem importar endereços, pedidos, contas, tokens ou segredos locais.

## Configuração

1. Conectar o repositório GitHub ao Railway e criar um serviço a partir dele.
2. O Dockerfile é detectado; `railway.toml` configura a checagem `/healthz` e reinício em falha.
3. Antes de divulgar, anexar um volume persistente ao serviço em **`/data`**. O SQLite é gravado em `/data/agent-store.db`. Não montar sobre `/app/data`, que contém o catálogo e as fotos.
4. Manter **uma réplica** para este SQLite. O diretório do volume precisa ser gravável pelo processo. A imagem mínima usa o usuário padrão do contêiner, compatível com o volume inicial do Railway.
5. Gerar um domínio Railway com a porta 8080, ou a porta indicada por `PORT`. Não exige domínio comprado.
6. Configurar `AGENT_STORE_PUBLIC_ORIGIN` com o endereço HTTPS exato da loja e `BETTER_AUTH_SECRET` por armazenamento seguro de variáveis, ou `BETTER_AUTH_SECRET_FILE=/data/auth/better-auth.secret` para gerar o segredo criptograficamente no volume persistente com permissão 0600. Não enviar o segredo pelo chat nem colocá-lo no Git. A variável de arquivo só contém o caminho; o valor nunca sai do serviço.
7. Para o primeiro provisionamento do banco de autenticação, definir `AGENT_STORE_AUTH_MIGRATE=true`; revisar/aplicar as migrações antes de versões posteriores. Contas ficam em `/data/auth/better-auth.db`, além do banco comercial existente.
8. Validar o fluxo de compras e persistência em staging com banco descartável. Os testes automatizados não devem comprar no estoque público. Na produção, conferir saúde, vitrine e configuração da autenticação.

O Railway pode fornecer `PORT`; o app escuta em `0.0.0.0` quando ela está definida. Localmente, sem variáveis, continua em `127.0.0.1:8091`. Flags da linha de comando têm precedência.

| Variável | Uso |
| --- | --- |
| `PORT` | Porta HTTP, padrão 8080 na imagem. |
| `AGENT_STORE_DB` | Caminho SQLite, `/data/agent-store.db` na imagem. |
| `AGENT_STORE_ADDR` | Substituição explícita do endereço HTTP, se necessária. |
| `AGENT_STORE_CATALOG` | Catálogo; padrão `data/catalog.json`. |
| `AGENT_STORE_PUBLIC_ORIGIN` | Obrigatória na imagem: origem HTTPS pública exata, sem caminho. |
| `BETTER_AUTH_SECRET` | Segredo forte e estável, configurado no serviço de hospedagem. Alternativa ao arquivo privado. Não publicar. |
| `BETTER_AUTH_SECRET_FILE` | Caminho absoluto em volume persistente; geração atômica e leitura privada quando não há segredo de ambiente. Em produção, escolher explicitamente uma das duas opções. |
| `AGENT_STORE_AUTH_DIR` | Dados do Better Auth, padrão `/data/auth`, no mesmo volume persistente. |
| `AGENT_STORE_AUTH_MIGRATE` | `true` para executar a migração revisada antes da inicialização. |

Ao usar arquivo de segredo, preservar e fazer backup de `/data/auth/better-auth.secret` junto com o banco. Não recriar o segredo em cada deploy nem copiar o segredo local para produção.

O runtime inicia Better Auth em loopback e espera sua saúde antes de iniciar Go. Os dois processos são encerrados juntos. O checkout falha fechado se não conseguir validar a sessão; nunca volta a comprar como visitante.

## Validar a imagem localmente

```bash
docker build -t agent-store:demo .
docker run --rm -p 127.0.0.1:8094:8080 --env-file .env.runtime.test -v agent-store-demo:/data agent-store:demo
```

O volume nomeado mantém pedidos e estoque entre execuções. Ele é separado do SQLite local. Não apague um volume com dados necessários.

O arquivo local `.env.runtime.test` deve ficar fora do Git e conter `AGENT_STORE_PUBLIC_ORIGIN=http://localhost:8094`, um `BETTER_AUTH_SECRET` gerado para esse teste e `AGENT_STORE_AUTH_MIGRATE=true`. O HTTP loopback é exclusivamente para teste local; no Railway usar HTTPS.

## Demonstração pública

Pix, cartão, frete e prazos continuam simulados. Use apenas contato e endereço fictícios. Não há provedor financeiro, cobrança, e-mail ou entrega real. O estoque de demonstração é finito; reservas abertas vencem em 15 minutos e pedidos concluídos consomem unidades. Planeje reposição antes de uma nova rodada pública; não há endpoint público de reset ou administração.

O serviço ainda não oferece proteção contra tráfego abusivo ou operação comercial real. Não compartilhar tokens de checkout ou chaves de idempotência. Para uma campanha com tráfego relevante, definir limites de tráfego e consumo antes da divulgação ampla.

O endereço Railway dispensa comprar domínio. Hospedagem e volume dependem do plano, créditos e uso da conta; endereço gerado não significa hospedagem gratuita.

Referências: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [volumes](https://docs.railway.com/volumes), [domínios](https://docs.railway.com/networking/domains/working-with-domains).
