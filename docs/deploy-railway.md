# Publicar somente a Agent Store no Railway

O repositório deve ter esta pasta como raiz. Haseo, chaves de IA, sessão WhatsApp e outros projetos não fazem parte do deploy.

## O que é enviado

Código Go, vitrine incorporada ao binário, catálogo e imagens de demonstração. `.runtime/`, `.env`, bancos e binários locais estão ignorados no Git e no contexto Docker. O banco da hospedagem começa novo, sem importar endereços, pedidos ou tokens locais.

## Configuração

1. Conectar o repositório GitHub ao Railway e criar um serviço a partir dele.
2. O Dockerfile é detectado; `railway.toml` configura a checagem `/healthz` e reinício em falha.
3. Antes de divulgar, anexar um volume persistente ao serviço em **`/data`**. O SQLite é gravado em `/data/agent-store.db`. Não montar sobre `/app/data`, que contém o catálogo e as fotos.
4. Manter **uma réplica** para este SQLite. O diretório do volume precisa ser gravável pelo processo. A imagem mínima usa o usuário padrão do contêiner, compatível com o volume inicial do Railway.
5. Gerar um domínio Railway com a porta 8080, ou a porta indicada por `PORT`. Não exige domínio comprado.
6. Conferir vitrine, produto, imagens, cotação de frete e uma compra simulada com dados fictícios. Reiniciar a implantação e verificar a persistência do mesmo pedido.

O Railway pode fornecer `PORT`; o app escuta em `0.0.0.0` quando ela está definida. Localmente, sem variáveis, continua em `127.0.0.1:8091`. Flags da linha de comando têm precedência.

| Variável | Uso |
| --- | --- |
| `PORT` | Porta HTTP, padrão 8080 na imagem. |
| `AGENT_STORE_DB` | Caminho SQLite, `/data/agent-store.db` na imagem. |
| `AGENT_STORE_ADDR` | Substituição explícita do endereço HTTP, se necessária. |
| `AGENT_STORE_CATALOG` | Catálogo; padrão `data/catalog.json`. |

## Validar a imagem localmente

```bash
docker build -t agent-store:demo .
docker run --rm -p 127.0.0.1:8094:8080 -v agent-store-demo:/data agent-store:demo
```

O volume nomeado mantém pedidos e estoque entre execuções. Ele é separado do SQLite local. Não apague um volume com dados necessários.

## Demonstração pública

Pix, cartão, frete e prazos continuam simulados. Use apenas contato e endereço fictícios. Não há provedor financeiro, cobrança, e-mail ou entrega real. O estoque de demonstração é finito; reservas abertas vencem em 15 minutos e pedidos concluídos consomem unidades. Planeje reposição antes de uma nova rodada pública; não há endpoint público de reset ou administração.

O serviço ainda não oferece proteção contra tráfego abusivo ou operação comercial real. Não compartilhar tokens de checkout ou chaves de idempotência. Para uma campanha com tráfego relevante, definir limites de tráfego e consumo antes da divulgação ampla.

O endereço Railway dispensa comprar domínio. Hospedagem e volume dependem do plano, créditos e uso da conta; endereço gerado não significa hospedagem gratuita.

Referências: [Dockerfiles](https://docs.railway.com/builds/dockerfiles), [volumes](https://docs.railway.com/volumes), [domínios](https://docs.railway.com/networking/domains/working-with-domains).
