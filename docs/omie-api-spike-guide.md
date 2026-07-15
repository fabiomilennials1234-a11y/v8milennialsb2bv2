# Guia do Spike — API Omie (S1 / #1101)

**Por que este doc existe.** O money layer (S2–S9) está construído e em prod, mas os
**mappers** de Cliente/Pedido/NF/Título usam nomes de campo, enum de status e formato de
data **presumidos da documentação** — não confirmados contra uma conta real. Este guia é o
checklist para sair do especulativo. Cada seção aponta o arquivo/função exata que muda se o
campo real diferir. Risco contido: **só os mappers mudam**; tabelas, upserts, edge fns e UI
não dependem dos nomes de campo do ERP.

Depois de confirmar, cole **uma resposta JSON real por endpoint** (pode mascarar CNPJ/nome)
e eu reconcilio os mappers + flipo as capabilities.

---

## 0. Setup (uma vez)

1. Omie → **Painel do Desenvolvedor** → Minhas Aplicações → criar um app → copiar
   **App Key** + **App Secret**.
2. Em prod: Pitstop → **Integrações** → card **Omie** → colar app_key/app_secret →
   "Validar e Conectar". (Valida chamando `ListarClientes` — se conectar, o transporte
   e o cofre estão OK.)
3. Todas as chamadas: `POST https://app.omie.com.br/api/v1/<módulo>/<recurso>/`
   body `{ "call": "<Método>", "app_key": "...", "app_secret": "...", "param": [ {...} ] }`.

Para inspecionar respostas cruas sem a UI: use o painel de testes do Portal do Desenvolvedor,
ou `curl` (exemplo no fim).

---

## 1. Clientes — `ListarClientes`

- Endpoint: `geral/clientes/` · Mapper: `supabase/functions/_shared/erp/omie-mappers.ts` →
  `mapOmieClienteToCanonical` (`OmieClienteRaw`).
- **Array da resposta** que presumo: `clientes_cadastro`. → confirmar nome real.

| Campo canônico | Campo Omie presumido | Confirmar |
|---|---|---|
| externalId | `codigo_cliente_omie` | ☐ |
| externalRef | `codigo_cliente_integracao` | ☐ |
| cnpj | `cnpj_cpf` | ☐ |
| company | `razao_social` | ☐ |
| name | `nome_fantasia` (fallback razao_social) | ☐ |
| email | `email` | ☐ |
| phone | `telefone1_ddd` + `telefone1_numero` | ☐ |

**Confirmar também:** o array vem em `clientes_cadastro`? paginação em `total_de_paginas`?

---

## 2. Pedidos — `ListarPedidos`

- Endpoint: `produtos/pedido/` · Mapper: `mapOmiePedidoToCanonical` (`OmiePedidoRaw`).
- **Array** presumido: `pedido_venda_produto`. → confirmar.

| Campo canônico | Campo Omie presumido (dentro do elemento) | Confirmar |
|---|---|---|
| externalId | `cabecalho.codigo_pedido` | ☐ |
| externalRef | `cabecalho.codigo_pedido_integracao` | ☐ |
| clientExternalId | `cabecalho.codigo_cliente` | ☐ |
| saleValue | `total_pedido.valor_total_pedido` | ☐ |
| productName | `det[0].produto.descricao` (fallback "Pedido Omie <numero>") | ☐ |
| etapa | `cabecalho.etapa` | ☐ |

**Confirmar também:**
- **`etapa` é configurável por org?** Chamar `ListarEtapasPedido`/`pedidoetapas` e colar os
  códigos reais (`00/10/50/60`? outros?). Preciso saber **qual etapa = faturado/realizado**
  (hoje NÃO filtro por etapa — todo pedido vira order; se você quiser contar só faturados,
  esse é o ponto).
- Formato de `data_previsao`/data do pedido (ver §5).

---

## 3. Nota Fiscal — `ListarNF`

- Endpoint: `produtos/nfconsultar/` · Mapper: `mapOmieNfeToCanonical` (`OmieNfeRaw`).
- **Array** presumido: `nfCadastro`. → confirmar (pode ser `nfCabecalho`/estrutura aninhada).

| Campo canônico | Campo Omie presumido | Confirmar |
|---|---|---|
| externalId | `nIdNF` | ☐ |
| chaveNfe | `cChaveNFe` (44 dígitos) | ☐ |
| numero | `nNumeroNF` | ☐ |
| valor | `nValorNF` | ☐ |
| status | `cStatus` | ☐ |
| orderExternalId | `nCodPedido` (liga ao pedido) | ☐ |
| dataEmissao | `dEmissao` (hoje null — ver §5) | ☐ |

**Crítico:** a NF referencia o pedido por **`nCodPedido`** (= `codigo_pedido` do §2)? Se o
link for por outro campo (ex. número do pedido), o badge "Faturado" não casa. Confirmar.

---

## 4. Contas a Receber — `ListarContasReceber`

- Endpoint: `financas/contareceber/` · Mapper: `mapOmieTituloToCanonical` (`OmieTituloRaw`).
- **Array** presumido: `conta_receber_cadastro`. → confirmar.

| Campo canônico | Campo Omie presumido | Confirmar |
|---|---|---|
| externalId | `codigo_lancamento_omie` | ☐ |
| externalRef | `codigo_lancamento_integracao` | ☐ |
| clientExternalId | `codigo_cliente_fornecedor` | ☐ |
| orderExternalId | `nCodPedido` | ☐ |
| valor | `valor_documento` | ☐ |
| vencimento | `data_vencimento` (hoje null — §5) | ☐ |
| status (bruto) | `status_titulo` | ☐ |
| pago | presença de `data_pagamento` | ☐ |

**O MAIS importante — enum `status_titulo`:** listar **TODOS os valores possíveis** que a
Omie retorna (ex.: `ABERTO`, `RECEBIDO`, `ATRASADO`, `VENCIDO`, `PAGO`, `A_VENCER`,
`CANCELADO`…) e me dizer qual mapeia para cada um dos meus 3 status canônicos:

- `pago` ← (quais valores? + quando `data_pagamento` presente)
- `atrasado` ← (quais valores? hoje presumo /atras|vencid/)
- `aberto` ← (o resto)

Meu `deriveTituloStatus` hoje: pago se tem `data_pagamento` OU status casa
`/receb|pago|liquidad/i`; atrasado se `/atras|vencid/i`; senão aberto. **Ajusto conforme o
enum real.** A inadimplência (S9) depende 100% disso.

---

## 5. Formato de datas (dd/mm/yyyy?)

Hoje **todas as datas** (`data_pedido`, `dEmissao`, `data_vencimento`, `data_pagamento`,
`sold_at`) entram como **null** porque presumo `dd/mm/yyyy` e não parseei sem confirmar.
Confirmar o formato exato de **uma** data real → eu adiciono um parser `dd/mm/yyyy → ISO`
nos mappers, e aí `vencimento`/`data_emissao`/`sold_at` param de ser null (melhora
inadimplência-por-vencimento, timeline, e receita por período).

---

## 6. Rate limit (validar comportamento)

Confirmar contra a conta real: 429 em excesso? 425 (bloqueio ~30min) após erros repetidos?
Isso valida o backoff/hard-stop do `OmieClient` antes de ligar o cron escalonado (S10).

---

## 7. O que fazer depois (meu lado, após você colar as respostas)

1. Ajustar os 4 mappers (só nomes de campo/array + `deriveTituloStatus` + parser de data).
2. Rodar `omie-sync-clientes/pedidos/financeiro` on-demand na conta real → validar dados.
3. **Flipar capabilities** `OMIE_CAPABILITIES.fetchNfe→true` e `receivables→true`
   (`src/modules/integrations/lib/erp-provider.ts`) → OmieSettings deixa de mostrar
   "em breve"; badges Faturado/Inadimplente acendem com dado real.
4. Só então: cron escalonado (S10) + webhook (S11).

---

## Apêndice — curl de exemplo

```bash
curl -s -X POST https://app.omie.com.br/api/v1/financas/contareceber/ \
  -H "Content-Type: application/json" \
  -d '{"call":"ListarContasReceber","app_key":"SUA_KEY","app_secret":"SEU_SECRET","param":[{"pagina":1,"registros_por_pagina":5}]}' \
  | jq .
```

Troque o path/call para os outros endpoints (`geral/clientes/`+`ListarClientes`,
`produtos/pedido/`+`ListarPedidos`, `produtos/nfconsultar/`+`ListarNF`).
