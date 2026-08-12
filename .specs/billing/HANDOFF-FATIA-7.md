# Handoff — Fatia 7 do billing (SCRUM-288): montagem do pacote e geração do link no Master

**Escrito em 2026-08-12 por quem construiu, para quem retomar — provavelmente eu mesmo depois de um `/clear`, sem lembrar de nada.**
Leia inteiro antes de escrever a primeira linha. Metade do valor daqui é o que **não** fazer.

- **Branch:** `feat/scrum-288-master-montagem-link`
- **Worktree:** `/Users/gabrielaureliogipp/Dev/mst-eng-a`
- **Commits meus:** `9ddbc309` (a fatia) e `b94b7854` (correção de teste da Fatia 5, que veio junto por empilhamento)
- **Ticket:** https://milennialstech-1785256858036.atlassian.net/browse/SCRUM-288
- **Nada foi aplicado em produção.** O apply é botão do CTO.

---

## ⚠ CORREÇÃO DE FATO — inserida em 2026-08-12 14:2x pelo orquestrador, DEPOIS que este handoff foi escrito

Três coisas registradas acima **mudaram ou estavam erradas**. Leia isto antes de agir por qualquer uma delas.

### 1. ✅ RESOLVIDO em 2026-08-12 — a migration colidia; foi RENUMERADA para `20270812120000`.

**Estado atual:** `supabase/migrations/20270812120000_payment_links_package.sql` (+ rollback pareado).
Rebase sobre `origin/main` **feito**, guarda local **verde**. O texto abaixo fica como registro do porquê.

**E o que quase passou batido, medido pelo orquestrador:** o guarda
`scripts/check-migration-versions.sh` (#1538, mergeado 14:27) roda **do checkout**. Branch sem rebase roda
o guarda **velho** e ganha verde numa colisão real. Pior: a metade (b) do guarda lê `git ls-tree HEAD` —
**árvore commitada**, não o índice. Renomear e não commitar mantém o FAIL apontando o nome antigo.
Ordem que funciona: **rebase → renumera → COMMITA → roda o guarda**.

`20270811160000_payment_links_package.sql` (versão antiga desta branch) tinha **o mesmo prefixo de 14 dígitos** de
`20270811160000_payment_history_receipt_period_method.sql`, que **já está na `main` E no ledger de produção**.

Consequência, e é a pior possível: o `supabase db push` chaveia `schema_migrations` pela versão. Ele veria
`20270811160000` como já aplicada e **pularia o seu arquivo em silêncio**. A Fatia 7 mergearia, o CI ficaria
verde, e a mudança de schema **nunca chegaria em produção**. É a causa-raiz do incidente #640 (2026-06-01),
documentada no cabeçalho de `scripts/check-migration-versions.sh`.

**Renumere para um prefixo livre antes de qualquer `db push`.** Ocupados nesta janela: `…120000`, `…130000`,
`…140000`, `…150000`, `…160000`, `…170000`, `…220000`, e `20270812000000` a `…040000`, mais `20270812100000`.
`20270812110000` **também está ocupado** (`copilot_model_defaults_gpt41_mini`, em ref que ainda não mergeou) e
`20270812111845` é do colega em `mst-eng-b` (`payment_link_buyers`) — nenhum dos dois aparece em `origin/main`,
então o guarda não os enxerga. Comando que enxerga **qualquer ref**, e é como `20270812120000` foi escolhida:

```bash
git log --all --name-only --diff-filter=A --pretty=format: -- 'supabase/migrations/2027081*' \
  | sed 's#.*/##' | grep -E '^[0-9]{14}' | sort -u
```

Esta é a **quinta** colisão do mesmo tipo em dois dias. As outras quatro foram renumeradas nos PRs #1497,
#1531, #1532 e #1536.

### 2. "A migration de ciclo só existe em prod" — NÃO É MAIS VERDADE.

`20270811150000_billing_cycle_semiannual_canonical` **está na `main`** desde o merge do PR #1529 (2026-08-11
19:43). Medido: 2 ocorrências em `origin/main`. Não trate como divergência repo↔prod.

### 3. "Dois blocos numerados 29 no `run.sh` da `main`" — JÁ CORRIGIDO.

`origin/main` não tem prefixo de item duplicado. A numeração vigente, por decreto: 29 `payment_links`,
30 `rls_inv6`, 31 `billing_cycle`, 32 **seu**, 33 `payment_history`, 34 `payment_webhook_ledger`.
**Combine o próximo número antes de escrever** — foi a sétima fonte de conflito do dia.

### 4. Contexto que mudou enquanto você estava parado

- **Fatia 5 completa na `main`**: PRs #1520, #1523 e #1529 mergeados.
- **Fatia 6 mergeada** (2026-08-12 14:06, PR #1535): o webhook do Asaas. A assinatura é gravada pela RPC
  `billing_apply_paid_subscription` (service_role-only, com `ON CONFLICT … WHERE cancelled_at IS NULL` dentro).
  Handoff dela em `.specs/billing/HANDOFF-FATIA-6.md`, na `main`.
- **`#1533` (boleto) mergeado.** Rebaseie esta branch sobre a `main` — era a dependência que você anotou.
- **Jira está fora do ar** nesta sessão. O link do SCRUM-288 acima não abre; o estado vive no GitHub.

### 5. E sobre a sua própria armadilha nº 3 — "saída vazia lida como aprovação"

Ela pegou o orquestrador **duas vezes** no mesmo dia, depois de ler o seu relato: uma coleta de log vazia
comparada com `comm` devolveu "nenhuma falha nova" quando o significado era "o log ainda não existe".
A regra que ficou, e vale para você: **contar as linhas coletadas antes de interpretar qualquer comparação.**
Coleta vazia é hipótese sobre a **medição**, nunca sobre o mundo.

---

## 1. Onde isto se encaixa

A **Fatia 5** (SCRUM-286, PR #1520, **já mergeada**) criou o link de pagamento no banco: tabela `payment_links`, tabela `payment_link_charges` e quatro funções (`billing_create_payment_link`, `billing_revoke_payment_link`, `billing_resolve_payment_link`, `billing_attach_link_charge`).

A **Fatia 7** é a **tela do Master** que chama essas funções. O CTO foi explícito ao me dar: *"se o contrato que você desenhou não servir à tela, é agora que aparece"*.

**Apareceu.** Ver seção 3.

---

## 2. O que JÁ ESTÁ FEITO (nos dois commits)

### 2.1 `supabase/migrations/20270812120000_payment_links_package.sql` — **NÃO TESTADA**

⚠️ **Esta migration nunca rodou.** Foi escrita numa janela em que o banco local estava sendo derrubado de propósito por outro agente (isolamento de um segfault). **A primeira coisa a fazer ao retomar é aplicá-la e rodar o teste.** Ver seção 5.

Ela estende `payment_links` com o que a tela produz e não tinha onde morar:

| Coluna | Por quê |
|---|---|
| `package_features`, `package_limits` (jsonb, NOT NULL, default `{}`) | o pacote montado. Espelha `org_subscriptions.features` / `.limits`, que é o destino — gravar lá vira cópia direta |
| `manual_discount_cents`, `manual_discount_reason`, `manual_discount_by` | concessão sem motivo registrado não é auditável |
| `customer_legal_name`, `customer_tax_id`, `customer_email` | o billing não tinha **nenhum** cadastro fiscal (medido) |

E troca a assinatura de `billing_create_payment_link` para receber tudo isso.

### 2.2 `supabase/functions/billing-quote/index.ts` — typecheck Deno limpo, **nunca deployada**

Edge function fina que cota o pacote. Master-gate no padrão de `create-gestor` (anon key em `Authorization`, JWT real em `X-User-JWT`).

### 2.3 `src/modules/billing/lib/package-diff.ts` + teste — **23/23 verdes**

Módulo puro com a regra que erra calado. Roda com:
```bash
npx vitest run src/modules/billing/lib/package-diff.test.ts
```

### 2.4 `PlanFeatureCard` (modificado) e `PlanLimitRow` (novo) — typecheck limpo

---

## 3. As DECISÕES, e por que cada uma — não desfaça sem ler

### 3.1 A lacuna do contrato virou migration própria, não emenda da Fatia 5
A Fatia 5 estava aprovada em três voltas e mergeada. A lacuna apareceu quando a tela foi escrita, e **é assim que ela deve aparecer no repositório**.

### 3.2 O fiscal fica no LINK, não em tabela de cliente
Tabela de cliente precisa de dono, e no alvo `new_org` **a organização ainda não existe** — é o link que vai criá-la. O link é a única entidade presente nos dois alvos no momento da proposta.
**Consequência aceita:** duas propostas para o mesmo cliente repetem o cadastro. É o preço de não inventar dono para um dado que ainda não tem um.

### 3.3 Caminho servidor do preço = EDGE FUNCTION, não wrapper RPC
`billing_quote_price` é `service_role`-only **de propósito**. Um wrapper `SECURITY DEFINER` alcançável por `authenticated` reabriria a fronteira que separou as 23 RPCs fechadas em 11/08 das que ficaram. **Uma fronteira que se abre "só desta vez" não é fronteira.**

### 3.4 SEM rate limit na edge, e isso é medido
Eu havia afirmado ao CTO que a edge seria "o lugar natural do rate limit". **Retratei-me:** `billing_quote_price` é `STABLE` e lê duas linhas. O problema real é round-trip a cada pixel de slider → **debounce no hook**. Se a cotação ficar cara um dia (gateway, imposto por município), o rate limit entra na edge.

### 3.5 O AUTOR do desconto sai de `auth.uid()`, nunca de parâmetro
Id de autor vindo do chamador é a forma exata das 23 RPCs fechadas. E o **motivo** é `CHECK`, não convenção de tela: "obrigatório" escrito só no formulário some no primeiro caminho alternativo.

### 3.6 O operador digita o PREÇO FINAL, não o desconto
O motor deriva quanto aquilo representa. Se a tela subtraísse, seria a tela calculando preço — **a regra que esta fatia mais precisa não quebrar**.

### 3.7 NÃO reusar o caminho de escrita do `PlanEditor`
`PlanEditor` salva via `useUpdatePlan` → **`subscription_plans`**, o catálogo. Reusá-lo faria o Master **editar o plano de todas as orgs** achando que customiza uma proposta. Reuse `PlanFeatureCard` e o vocabulário visual; **não** o save.

### 3.8 O diff é DERIVADO, nunca persistido
Decisão do Prisma. Gravar o diff o congelaria: mudar o plano base depois deixaria a proposta mentindo sobre o que concedeu. O que se grava é o **pacote**.

### 3.9 ILIMITADO (`-1`) é TETO, não o número −1
Comparado como número, `-1 < 50000` e **a proposta mais generosa apareceria marcada como "a menos"**. Está em `limitDirection()` com dois testes de regressão e mutante confirmado.

### 3.10 UM comparador só
`PlanLimitRow` chegou com o seu próprio e eu removi. Duas cópias divergem: o card diria "a mais" e a contagem do topo "a menos".

---

## 4. O DESENHO DA TELA — respondido pelo Prisma, protótipo em disco

**Protótipo:** `/Users/gabrielaureliogipp/Dev/mst-ux/scratchpad/proto-scrum288-diff-plano.html`
(HTML único, duplo clique. Alternador de tema e 6 cenários lado a lado.) **Abra antes de escrever componente.**

- **Marca no card + UMA linha de contagem no topo.** Painel de resumo separado foi **reprovado** — duplica a lista e vira duas verdades para manter em sincronia.
- **Interruptor "Ver só as diferenças"** na própria linha resolve "onde vs quanto" sem segunda superfície.
- **Dois pesos para três eixos, pela DIREÇÃO:** `--warning` (a mais) e `--silver` (a menos). Nada de ouro — ouro é dinheiro e ação primária.
- **"A mais" pesa mais** porque o operador **sabe** o que está tirando (o cliente reclama) e **não percebe** o que acrescentou. E feature ligada também é **permissão**.
- **Texto do selo em `--foreground`, nunca `text-warning`** — warning sobre o creme do tema claro dá ~2,3:1 e reprova AA. Matiz marca, foreground fala. Seta up/down porque **cor não pode ser sinal único**.
- **Borda de 3px SEMPRE presente**, transparente quando não há marca — senão a lista treme 3px ao mexer num switch.
- **Números: `base 5 → 12`**, nunca delta.

### As três regras do filtro (já implementadas em `package-diff.ts`)
- **R1.** Com o filtro LIGADO, **nada sai** da lista. Item que volta ao base fica, remarcado `settled`. Diferença nova entra.
- **R2.** Desligar e religar tira retrato novo — único jeito de um item sair, e é ato deliberado.
- **R3.** O interruptor só some com **zero diferenças E filtro desligado**.

**Por quê:** com o filtro ligado, *todo* card visível é uma diferença — mexer em qualquer um o faria sumir, a lista refluiria debaixo do dedo e **desfazer ficaria impossível**, porque o card recém-clicado não estaria mais na tela.

---

## 5. O QUE FALTA — em ordem

0. **Já feito (2026-08-12):** rebase sobre `origin/main`, renumeração para `20270812120000`, guarda local verde.
   **Não aplique nada sem antes ler a issue #1548** — o ledger de prod tem um **vão** (a `20270811140000`,
   que é a base desta migration, nunca subiu, embora a `150000` e a `160000` tenham subido). O plano de
   subida inteiro está lá; aplicar fora dessa ordem repete o defeito que a renumeração acabou de evitar.

1. ✅ **FEITO** — a `20270812120000` foi aplicada no banco LOCAL (psql, `--single-transaction`, URL explícita;
   sem `db push`, sem tocar prod) e o `payment_links_test.sql` está **40 ok / 0 not ok**. O RED previsto
   apareceu e foi consertado: `has_function_privilege` resolve por assinatura EXATA, e a função saiu de 8
   para 16 parâmetros. Detalhe que importa: as **chamadas** continuaram passando (os parâmetros novos têm
   `DEFAULT`) — só a asserção que nomeia tipos quebrou, e ela morria com `ERROR` depois de 32 `ok`. Como a
   suíte roda `no_plan()`, abortar no meio **não produz `not ok`**: conte os `ok`, não confie na ausência de
   vermelho. Procedimento original, para quem precisar refazer do zero:
   ```bash
   export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
   supabase db reset      # avise o Malho antes: o banco local é compartilhado
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     --no-psqlrc --quiet -t -A --variable ON_ERROR_STOP=1 \
     --file supabase/tests/payment_links_test.sql
   ```
   Espere quebrar: a assinatura de `billing_create_payment_link` mudou e o teste da Fatia 5 chama a antiga. **Isso é RED legítimo** — o teste precisa passar os parâmetros novos.

   **Onde esta migration entra na fila de prod (issue #1548):** ela vem **depois** da `20270811140000`
   (Fatia 5), que **ainda não subiu** — é o vão do ledger. Ordem: `…140000` → `…220000` (Fatia 6) →
   `20270812100000` (Fatia 9) → **`20270812120000` (esta)**. A renumeração já a deixou por último, o que
   coincide com a dependência: ela só altera objeto que a `…140000` cria.

2. **Escrever o teste da Fatia 7** e registrá-lo no `run.sh` como **item 32** (número reservado com o Malho; 30 é dele, 31 provavelmente do Fole). **Nas DUAS listas.**
   Cobrir: `CHECK` do motivo obrigatório, normalização do CNPJ, autor vindo de `auth.uid()` e não de parâmetro, e os grants nome por nome — `DROP + CREATE` devolve EXECUTE a PUBLIC, e esta migration **faz** `DROP + CREATE`.

3. **A tela.** Linha de contagem + interruptor, formulário do pacote, dados fiscais, lista de links gerados com estado e revogação.

4. **Hook de cotação** com **debounce**, chamando a edge `billing-quote`.

5. **`useCouponValidation`:** use só para **validar e rotular** o cupom. O `discount_pct` que ele devolve **não** entra em conta na tela — passe o **código** para o motor. E `validate_coupon` é `STABLE` e **nunca incrementa `current_uses`**: o limite é checado e jamais consumido. Não construa em cima de "o cupom foi consumido ao validar".

---

## 6. ARMADILHAS MEDIDAS — cada uma me pegou pelo menos uma vez

1. **`npm run typecheck`, nunca `tsc -p tsconfig.json`.** A raiz é solution-style com `"files": []` → sai **limpo checando nada**. O comando certo mostra os **692 erros herdados**; o que importa é que nenhum seja seu.
2. **`npm ci` primeiro.** O worktree nasce sem `node_modules`, e sem ele o typecheck "passa" por não rodar.
3. **Saída vazia não é aprovação.** Aconteceu três vezes em um dia com roupas diferentes: grep numa lista curta demais, `gh run view --log` numa run em andamento, tsconfig sem arquivos. **Sempre confirme que o comando produziu saída.**
4. **CI vermelho no pgTAP é herdado.** São **18 arquivos**. Baixe o log com `gh api repos/.../actions/jobs/<id>/logs` (o `gh run view --log` recusa run em andamento) e compare o conjunto com o da `main` antes de concluir qualquer coisa.
5. **`git stash` é PROIBIDO** — o stash é do repositório inteiro e derruba o WIP dos colegas.
6. **O banco local é compartilhado.** Avise o Malho antes de `supabase db reset`.
7. **`maestri ask` passa por shell no terminal do destinatário.** Crase e `${...}` viram execução e quebram a mensagem — já aconteceu. Escreva identificador em prosa e **leia a saída** procurando `command not found`.
8. **Docker fora do PATH:** `export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"`.
9. **Guarda verde em branch atrasada não vale nada.** O guarda que roda é o **do checkout**: sem rebase você
   executa a versão antiga do script e ela aprova a colisão. E mesmo rebaseado, a metade (b) lê `git ls-tree HEAD`
   — renomeio **não commitado** é invisível para ela, e o FAIL continua citando o nome antigo. **Rebase → renomeia
   → commita → roda.** Medido nesta branch: guarda velho `exit 0`, guarda novo `exit 1` nomeando os dois arquivos.

---

## 7. Pendências que NÃO são desta fatia, mas encostam nela

- **PR #1533** (`fix/payment-link-metodo-do-port`): `boleto` não existe neste produto e o `CHECK` aceitava. **Mergeado; rebase feito.** O conflito veio exatamente onde ele previa: a asserção de contraste em `payment_links_test.sql` passava `'boleto'`, e o lado da `main` passa `'credit_card'`. Resolvido pela `main` — o `CHECK` agora só aceita `pix | credit_card`.
- **A migration de ciclo que está em produção NÃO está na cadeia do repo** — uma das **44 fantasmas** (issue #1521). O repo diverge de prod **agora**, nesse ponto.
- **Dois vocabulários de ciclo convivem por tabela:** `semiannual` no billing novo, `semester` no `payment_history` legado. Não é inconsistência de arquivo — são duas gerações de schema no mesmo banco.
- **Deploys manuais pendentes** (merge não faz): migrations `20270811120000`, `20270811140000`, `20270812120000` (esta fatia), `20270811170000`, e as edge functions `infra-watchdog` e `billing-quote`. **Ordem e vãos: issue #1548.**
- **Dois blocos `29`** no cabeçalho do `run.sh` da `main` (meu `payment_links_test` e o `rls_inv6_definer_sem_gate_test`). Comentário apenas; não renumerei bloco de outro dono.

---

## 8. Quem consultar

- **Prisma** (`/Users/gabrielaureliogipp/Dev/mst-ux`) — julgamento visual. Responde com protótipo em disco; **pergunte antes de escrever componente**, não depois.
- **Sentinela** (`/Users/gabrielaureliogipp/Dev/mst-review`) — revisão. Esta fatia toca **dinheiro e autoridade de master**, então o rubric de segurança é **obrigatório e bloqueante**. Chame direto, sem esperar despacho.
- **Malho** (`/Users/gabrielaureliogipp/Dev/mst-eng-c`) — Fatia 6 e o banco local compartilhado. Combine número de `run.sh` com ele **antes** de registrar.
