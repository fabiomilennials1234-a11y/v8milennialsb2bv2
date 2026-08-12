# HANDOFF — Fatia 8: página pública de checkout (SCRUM-289)

**Branch:** `feat/scrum-289-checkout-publico` (a partir de `origin/main`)
**Estado:** esqueleto de pé e verificado. Os estados de pagamento faltam, e faltavam por dependência de terceiro que **já foi resolvida** — ver §5.
**Escrito em:** 2026-08-12, depois de ~18h parado.
**Sem PR aberto**, de propósito: fatia pela metade gera revisão que vai mudar.

---

## 1. O que já está na branch (2 commits, todos verificados)

### Commit 1 — tokens do QR do Pix em `src/index.css`

`--qr-plate` e `--qr-ink`, nos **dois** temas, com valores **idênticos**. Conferidos byte a byte contra o protótipo aprovado.

**Não é descuido, e o comentário no CSS diz por quê:** o Asaas devolve o QR como PNG preto-sobre-branco (`PixPayload.encodedImage`), então na implementação é uma `<img>`, não módulos desenhados. Módulo claro sobre fundo escuro faz leitor de celular errar. A plaqueta é superfície **funcional** e não acompanha o tema — **trocar `--qr-plate` por algo escuro quebra o pagamento, não o visual.**

`--qr-ink` só entra em uso se o QR virar SVG algum dia. Está declarado que **hoje não tem consumidor**, em vez de fingir que está em uso.

### Commit 2 — rota pública + máquina de estados

| Arquivo | O que é |
|---|---|
| `src/App.tsx` | rota `/contratar/:token`, pública, lazy, antes das protegidas |
| `src/modules/billing/lib/checkout-state.ts` | resolvedor puro: resposta da porta → estado de tela |
| `src/modules/billing/pages/CheckoutPublico.tsx` | página; hoje cobre os desfechos que não tocam pagamento |
| `tests/unit/checkout-state.test.ts` | 8 asserções sobre o resolvedor |

Verificação real, colada do terminal:

```
dep-cruise ratchet ... OK (0 novas)
tsc ratchet .......... OK — 0 erros introduzidos
eslint ............... 0 erros nos arquivos novos
build ................ ✓ built in 10.17s
testes ............... 8/8
```

O único warning do eslint é `no-explicit-any` em `App.tsx:33` — **herdado**; as minhas linhas são a 49 e a 262.

---

## 2. Decisões TRAVADAS — não reabrir sem o CTO

1. **Desenho híbrido (#1394, não reabrível).** Pix na nossa página; **cartão via componente HOSPEDADO do Asaas**. Tokenização client-side **não existe** no Asaas (medido em #1378) — não tente. A volta do componente hospedado é **componente de continuidade**, uma trilha só: não é aviso de erro, não é página nova.

2. **Nada de leitura direta do navegador. Tudo por edge function com `service_role`.** Isso deixou de ser preferência de arquitetura: em 11/08 um `SELECT` em `leads` como `anon` derrubou o Postgres no **planejamento** da query (`EXPLAIN` sozinho matava). `anon` com alcance de leitura é superfície de **derrubar o banco**, não só de vazar linha — e esta é a primeira página do produto onde `anon` fala com o servidor de propósito. A recomendação estrutural na mesa do CTO é revogar `anon` em bloco: **se a página contar com leitura direta, ela quebra.**

3. **Polling por hash do token, não realtime.** Mesmo motivo do item 2.

4. **Regra comercial herdada, não recopiada.** Pix só em `semiannual`/`annual`; mensal só cartão. A recusa vem do motor de preço (`_shared/payments/policy.ts` + `org_subscriptions_pix_long_cycle_only`), **não do front**.

5. **Vocabulário do ciclo: `semiannual`.** Já canônico e em prod (PR #1529). `semester` é **recusado** pelos dois CHECK. A coluna `subscription_plans.discount_semester_pct` **mantém o nome** — dívida cosmética nomeada; nome de coluna e vocabulário de valor são coisas separadas, e o `billing_price_engine` já prova isso lendo uma com a outra.

6. **A copy é NOSSA.** A porta pública manda `state`, não frase. Microcopy em dois lugares vira drift na primeira vez que alguém mexe no tom, e a tela precisa de **layout** por estado (ícone, ação secundária, botão de voltar), não de string.

---

## 3. O QUE SÓ EU SEI — o estado derivado fechado

Este é o pedaço que não está em ticket nenhum e é o contrato que negociei com a porta pública.

### 3.1 O que a página consome hoje: `billing-payment-link`

`POST /functions/v1/billing-payment-link` com `{ token }`, **sem JWT** — a autorização é o conhecimento do token.

**Devolve 200 para os QUATRO desfechos conhecidos, inclusive os inválidos.** Link vencido não é incidente, é desfecho esperado, e a página **tem** que renderizar a mensagem. Se a porta devolvesse 404/410, qualquer camada no meio (CDN, proxy, cliente HTTP) poderia virar isso em tela de erro genérica e a mensagem se perderia. **O estado vem sempre no corpo, sempre no mesmo lugar.**

Enum fechado: `valid` | `expired` | `already_paid` | `revoked` | `not_found`.

Lista branca de campos em `link`: `amount_cents`, `expires_at`, `target_kind` (`new_org` | `existing_org`), `display_name`, `plan{name, slug, billing_cycle, cycle_months, seats}`, `totals{…}`, `next_charge_preview_at`.

**Não devolve** `organization_id`, `link_id`, o `quote` cru, nem eco do token. Se faltar campo, **peça o CAMPO, nunca o objeto**.

### 3.2 O estado de tela (`checkout-state.ts`)

`carregando` | `pedido` | `expirado` | `usado` | `revogado` | `nao_encontrado` | `indisponivel`

Duas regras que **não podem** ser perdidas numa refatoração:

- **Estado desconhecido cai em `indisponivel`.** Foi a moeda de troca por não recebermos copy: a porta pode **adicionar** estado sem nos avisar. Sem esse fallback, o dia em que ela evoluir a página de pagamento renderiza branco.
- **`valid` sem o objeto `link` é `indisponivel`, não `pedido` vazio.** Renderizar a moldura do checkout sem preço é pior que assumir a falha — o cliente ficaria olhando um valor que não existe.

`isTerminal()` existe para **não montar o polling** em desfecho fechado: pedir status de link expirado gasta requisição do teto por IP sem chance de a resposta mudar.

### 3.3 O ESTADO DERIVADO que o endpoint de status deve devolver

```
POST /billing-payment-status  { token }
  → { state: "pending" | "paid" | "expired" | "failed", paid_at?: iso }
```

**Quatro valores, fechado, e vocabulário do gateway NÃO vaza para o navegador.**

Por que: a distinção entre `confirmed` e `received` da Asaas é **financeira** (dinheiro confirmado × dinheiro disponível — no cartão são **32 dias** de diferença), não de produto. Se ela vazar para a tela, o dia em que a regra de liberação mudar obriga a mexer no front junto.

**A decisão que mais pesa, e errar aparece como cliente pagando e não recebendo acesso:**

```
PAGO = PAYMENT_CONFIRMED  OU  PAYMENT_RECEIVED — o que chegar PRIMEIRO
```

Medido contra a documentação oficial (está em `.specs/billing/asaas-webhook-capacidades.md`, §4.2 e §5.1):

- **Pix:** `CREATED → RECEIVED`. **Pula o `CONFIRMED`.**
- **Cartão:** `CREATED → CONFIRMED → RECEIVED`, e o `RECEIVED` vem **32 dias** depois (débito: 3).

Marcar pago só no `RECEIVED` → cliente de cartão espera um mês. Só no `CONFIRMED` → cliente de Pix nunca é liberado.

**Orçamento de polling:** 3s nos primeiros 2 min, 10s depois. O teto de 20 req/5 min por IP da porta de link **não serve** aqui (2 min a 3s já dá 40). Precisa de teto próprio dimensionado pelo intervalo. Para o `billing-payment-link` o teto de 20/5min está ótimo — carrego uma vez por sessão.

---

## 4. O que FALTA

| # | Falta | Depende de |
|---|---|---|
| 1 | Estados de pagamento: `pix`, `cartao-antes`, `cartao-incompleto`, `cartao-analise`, `aprovado-nova`, `aprovado-existente`, `recusado`, `mensal` | shape da Fatia 6 — **resolvido**, ver §5 |
| 2 | Endpoint de status + polling | não existe ainda; contrato em §3.3 |
| 3 | Composição do preço na tela (escada base + assentos − ciclo − cupom) | **decisão comercial pendente**, ver §6 |
| 4 | Coleta fiscal (razão social, CNPJ, e-mail fiscal) | endpoint não existe |
| 5 | Provisionamento de org nova (estado `aprovado-nova`) | **não existe função nenhuma** — `create-org-user` cria USUÁRIO em org EXISTENTE |
| 6 | Acentos em `useCouponValidation.ts` (6 strings sem acento) | nada; item desta fatia, copiar do protótipo |
| 7 | Rate limit / mover `validate_coupon` para dentro da fn de checkout | decisão do CTO |

**O protótipo tem 11 estados, não 9** — os dois a mais são `cartao-incompleto` (o componente de continuidade) e `cartao-analise`.

Protótipo aprovado: `~/Dev/mst-ux/scratchpad/proto-checkout-publico.html` + `proto-checkout-publico-LAUDO.md` (o §4 é escrito para esta fatia). **Implementar, não redesenhar.** Se algo não fechar com o contrato, falar com o CTO antes de divergir.

---

## 5. CONTEXTO NOVO — a Fatia 6 ficou pronta (PR #1535)

**Ler `.specs/billing/HANDOFF-FATIA-6.md` antes de construir em cima** (está no git via #1535; no disco, em `~/Dev/mst-eng-c/`).

O que já sei do shape dele:

- A assinatura é gravada por **`billing_apply_paid_subscription`** — RPC `SECURITY DEFINER`, `search_path` fixo, `EXECUTE` **só** para `service_role` (medido com `has_function_privilege` em pgTAP), com gate no corpo além do GRANT.
- O `ON CONFLICT (organization_id) WHERE cancelled_at IS NULL` mora **dentro** da RPC, porque o PostgREST não expressa predicado. Logo: **uma linha viva por org** em `org_subscriptions`.
- `payment_history` continua por upsert no handler, inferindo por `payment_history_asaas_payment_id_key` (índice **total**, medido).
- Teste dele: 37/37.

**RESPONDIDO pelo CTO (2026-08-12, 14:06 — a Fatia 6 MERGEOU):** a assinatura é gravada pela RPC `billing_apply_paid_subscription`, e **a proveniência fica em `org_subscriptions.provider_payment_id`**. Ou seja: o endpoint de status deriva `paid` de `org_subscriptions`, casando pelo `provider_payment_id` da cobrança que este checkout criou. `payment_history` fica como trilha.

Era a minha aposta, mas aposta não entra em código — agora está medido por quem tinha acesso. **Ainda assim, confirmar a coluna no schema real antes de escrever a query:** o handoff da Fatia 6 está na `main`, em `.specs/billing/HANDOFF-FATIA-6.md`.

---

## 5-B. ESCOPO ACRESCENTADO (decisão do CTO, 2026-08-12) — o cliente da Asaas nasce aqui

Medido pelo CTO: `payment_links` **não guarda** e-mail, `cpfCnpj` nem razão social do comprador — só `new_org_name`. E `billing-payment-link` **não cria** cliente na Asaas; só lê rótulo de plano. Mas `_shared/payments/types.ts` **já tem** o contrato (`CustomerInput` com `email`, `ProviderCustomer` com `providerCustomerId`).

**Logo o cliente da Asaas nasce na CRIAÇÃO DA COBRANÇA, que é desta fatia.** E no Brasil a Asaas **exige `cpfCnpj`** para Pix e cartão — então este checkout **obrigatoriamente** coleta esse dado para a cobrança existir. Não é opcional, não é "nice to have" do formulário fiscal.

### O que muda, e é a parte que se perde se ninguém escrever

**O dado não pode só TRANSITAR. Tem que ser PERSISTIDO junto da cobrança.**

Motivo: a **Fatia 9 provisiona DEPOIS** do pagamento confirmar, e precisa do **e-mail** para criar o usuário admin da organização nova. Sem persistir, o dado passa pelo nosso código, vai para a Asaas, e **some** — e a Fatia 9 fica sem como criar o admin.

Desenho é nosso: colunas novas em `payment_link_charges`, ou tabela irmã. **Combinar o shape direto com o Malho** (Fatia 9) — é costura dos dois, não passa pelo CTO.

Ele começa pelo caminho `existing_org`, que **não** depende disso, então não estamos bloqueando ninguém. Mas o `new_org` **espera por nós**.

### FECHADO com o Malho em 2026-08-12 — migration `20270812111845_payment_link_buyers.sql`

**Tabela irmã, e o argumento decisivo não é retenção, é ALCANCE.** `payment_link_charges` é servida pelo PostgREST (`anon` e `authenticated` têm GRANT — o `ALTER DEFAULT PRIVILEGES` do Supabase), e a única coisa entre um usuário logado e a linha é a policy. Numa tabela irmã com `REVOKE`, a PII fica fora do PostgREST **por construção**. O `REVOKE` inclui **`service_role`**: vazar a chave de serviço não entrega um `GET /payment_link_buyers?select=*`; a PII sai só pelas funções `SECURITY DEFINER`.

**Chaveada pelo LINK, não pela cobrança** — divergi da proposta do Malho (`PK = charge_id`) por dois motivos funcionais, e ele leu o porquê:
1. um link admite uma cobrança por método, então chavear por cobrança **duplica a PII** quando o cliente tenta Pix e depois cartão;
2. `provider_customer_id` é do comprador e o cliente da Asaas é **reutilizável** — chaveado pela cobrança, cada método criaria um cliente novo no gateway. É o "entulho no gateway" que `payment_link_charges` existe para impedir, um nível acima.

Contrato:

```
payment_link_buyers(payment_link_id uuid PK → payment_links(id) ON DELETE CASCADE,
                    legal_name, email, tax_id, tax_id_kind, provider,
                    provider_customer_id, created_at, updated_at)
```

Três portas, cada uma devolvendo o **menos** que serve ao seu chamador — todas `service_role`-only:

| função | quem chama | devolve |
|---|---|---|
| `billing_upsert_link_buyer(link, provider, customer_id, legal_name, email, tax_id)` | esta fatia | estado. **Zero PII** |
| `billing_get_link_customer(link)` | esta fatia, antes de criar cobrança | só `provider_customer_id` — é o que faz o 2º método REUSAR o cliente |
| `billing_resolve_charge_buyer(provider_charge_id)` | **Fatia 9** | `buyer_email`, `buyer_legal_name`, alvo. **`tax_id` NÃO sai** |

`tax_id_kind` é **derivado** do valor (11 dígitos → cpf, 14 → cnpj), nunca recebido: parâmetro seria segunda fonte da mesma verdade, e o CHECK só acusaria a divergência com a cobrança já criada.

**Achado grande, e não era desta fatia:** `payment_link_charges.provider_charge_id` **não tinha índice nem unicidade**, e `supabase/functions/asaas-webhook/index.ts` (já na `main`) resolve o link com `.eq("provider_charge_id", …).maybeSingle()`. Duplicata → `maybeSingle()` erra → o handler engole e responde 200 → **organização nunca ativada, em silêncio**, que é o modo de falha contra o qual a Fatia 6 inteira foi desenhada. A migration adiciona `UNIQUE (provider_charge_id)` e, junto, conserta `billing_attach_link_charge`: com **duas** restrições únicas, o `ON CONFLICT ON CONSTRAINT` nomeado deixa de cobrir a retentativa normal (mesmo link, mesmo método, mesma cobrança viola as duas), então o reuso passa a ser procurado ANTES do INSERT.

pgTAP: `supabase/tests/payment_link_buyers_test.sql`, **66/66**, vermelho antes (a asserção de unicidade falha sem a migration — provado, não presumido).

### ⚠️ O AMBIENTE ONDE ISSO FOI MEDIDO NÃO É A `main` — leia antes de confiar no verde

O Postgres local compartilhado (`supabase_db_jsjsmuncfkbsbzqzqhfq`, porta 54322) estava, em 2026-08-12, **7 migrations atrás da `main`**: 91 arquivos `.sql` no repo contra 84 linhas no ledger. Ausentes: `20270811150000` (semiannual canônico), `20270811160000`, **`20270811220000`** (livro de eventos da Fatia 6), `20270812100000` (Fatia 9) e `20270812110000`.

Consequência direta e que se perde se ninguém escrever: **`org_subscriptions.provider_payment_id` NÃO EXISTE naquele banco.** A coluna existe no REPO (`20270811220000:189`) e é ela que o endpoint de status usa para derivar `paid`. Quando eu testar essa parte, eu **injeto** a `20270811220000` na mesma transação revertida — então um verde meu sobre proveniência de pagamento **não é evidência de que o ambiente tinha a coluna**, é evidência de que o contrato fecha quando ela existe.

Registrado também: a `20270812111845` foi aplicada naquele banco **à mão, fora do `schema_migrations`** — os objetos existem e o ledger não os conhece. Sem dano (medi a forma: versão nova, `prefill` presente, zero linhas), mas é a classe do incidente de migration por MCP. Foi o que motivou o `DROP CONSTRAINT IF EXISTS` antes do `ADD`.

**Regra de PII, corrigida na mira.** O `withErrorBoundary` **não** registra o corpo da requisição — loga `function_name`, `organization_id`, `user_id` e `error{name,message,stack}`. O vetor real é mais fácil de cair: **mensagem de erro que alguém constrói com o dado dentro** (`"cliente inválido: cpf 123…"` vira `err.message` e vai inteiro para `runtime_logs`). Regra prática: **nunca interpolar e-mail ou `cpfCnpj` em texto de exceção** — para identificar a linha existe o `charge_id`. E o `redactSecrets` do logger redige por **nome de chave** (`token`, `secret`, `password`, `apikey`…) mais mascaramento de telefone: **não tem `cpf` nem `email` na lista**, então `payloadSnapshot` com chave `buyer_tax_id` passaria em claro. O Malho acrescenta os dois padrões numa fatia própria (vale para o repo inteiro).

### REGRA DURA — PII de comprador

`cpfCnpj` e e-mail são **PII**. **Nunca** em log, em mensagem de erro, ou em telemetria. Mesma disciplina do token: quando não resolve, registrar prefixo de hash, nunca o valor.

Isso vale também para o que o `withErrorBoundary` capturar: o boundary devolve 500 com CORS, e um `console.error(payload)` inteiro num handler de cobrança vaza CPF para `runtime_logs`.

---

## 6. Achados do LAUDO que continuam abertos e NÃO são meus para decidir

- **A ordem dos descontos muda o valor.** Ciclo-depois-cupom dá R$ 1.711,30/mês; os dois somados sobre a base dão R$ 1.677,75. **R$ 402,60 por ano**, e o cliente vê os dois como igualmente legítimos. É decisão comercial e tem que virar código **num lugar só**, como o `policy.ts` fez com a regra do Pix.
- `subscription_plans.discount_volume_pct` / `_min` existem e **não aparecem na tela**. Ou entram na escada como quinta linha, ou são dívida — não deixar silencioso.
- O estado `aprovado-nova` promete *"Sua empresa foi criada"* e *"Enviando seu acesso"*. Se o provisionamento não nascer junto, **o texto muda antes de subir** — promessa que o produto não cumpre é pior que não escrever nada.

---

## 7. Credencial do Asaas

Chave de **SANDBOX** (`aact_hmlg_`, homologação — **não** é produção), em `~/Dev/v8milennialsb2bv2-main/.env` como `ASAAS_API_KEY`, com `ASAAS_API_URL=https://api-sandbox.asaas.com/v3` e `ASAAS_ENV=sandbox`.

**Ela não está neste worktree**, e não deve ser copiada por conta própria: `.env` está no `.gitignore` (linha 41), então não viaja entre worktrees. Se a fatia chegar no ponto de criar cobrança, **pedir ao CTO** que a coloque aqui.

Dois avisos que valem:

1. **Edge function não lê o `.env` da raiz.** Para rodar em prod a chave tem que virar secret do Supabase (`supabase secrets set`). O `.env` serve para dev local e `supabase functions serve`.
2. **É sandbox — não presuma comportamento de produção.** A própria pesquisa registrou que o Sandbox usa IPs de webhook **fora** da allowlist publicada de prod.

---

## 8. Higiene aprendida nesta fatia, para não repetir

- **Commite pesquisa como commita código.** Dois levantamentos meus (`asaas-webhook-capacidades.md`, 34KB, e `definer-org-param-mapa-7.md`) ficaram ~26h **untracked**, existindo só no disco — e deles saíram as quatro restrições que desenharam a Fatia 6 inteira. Levantamento que sustenta decisão já mergeada e vive só num worktree é **indistinguível de levantamento que não foi feito**, no dia em que o worktree sumir. Resgatados pelo CTO em `a6520857`.
- **Timestamp de migration com minuto e segundo reais.** `HH0000` colide quando quatro pessoas escrevem no mesmo dia — a minha `20270811150000` bateu com duas de métricas, e um `db push` futuro pularia as delas **em silêncio**.
- **`run.sh` colidiu 6× num dia entre 3 pessoas**, e um `29` duplicado passou por dois merges sem ninguém ver. A #1524 (manifesto que GERA as listas) resolve; até lá, **combinar o número antes de escrever**.
- **Módulo órfão é código morto.** O dep-cruiser me pegou escrevendo o resolvedor antes de quem o consome. Fechei com a página, não silenciei a regra nem exportei pelo barrel só para calar o aviso.
