# Handoff — Fatia 7 do billing (SCRUM-288): montagem do pacote e geração do link no Master

**Escrito em 2026-08-12 por quem construiu, para quem retomar — provavelmente eu mesmo depois de um `/clear`, sem lembrar de nada.**
Leia inteiro antes de escrever a primeira linha. Metade do valor daqui é o que **não** fazer.

- **Branch:** `feat/scrum-288-master-montagem-link`
- **Worktree:** `/Users/gabrielaureliogipp/Dev/mst-eng-a`
- **Commits meus:** `9ddbc309` (a fatia) e `b94b7854` (correção de teste da Fatia 5, que veio junto por empilhamento)
- **Ticket:** https://milennialstech-1785256858036.atlassian.net/browse/SCRUM-288
- **Nada foi aplicado em produção.** O apply é botão do CTO.

---

## 1. Onde isto se encaixa

A **Fatia 5** (SCRUM-286, PR #1520, **já mergeada**) criou o link de pagamento no banco: tabela `payment_links`, tabela `payment_link_charges` e quatro funções (`billing_create_payment_link`, `billing_revoke_payment_link`, `billing_resolve_payment_link`, `billing_attach_link_charge`).

A **Fatia 7** é a **tela do Master** que chama essas funções. O CTO foi explícito ao me dar: *"se o contrato que você desenhou não servir à tela, é agora que aparece"*.

**Apareceu.** Ver seção 3.

---

## 2. O que JÁ ESTÁ FEITO (nos dois commits)

### 2.1 `supabase/migrations/20270811160000_payment_links_package.sql` — **NÃO TESTADA**

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

1. **APLICAR E TESTAR A `20270811160000`.** Ela nunca rodou.
   ```bash
   export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
   supabase db reset      # avise o Malho antes: o banco local é compartilhado
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
     --no-psqlrc --quiet -t -A --variable ON_ERROR_STOP=1 \
     --file supabase/tests/payment_links_test.sql
   ```
   Espere quebrar: a assinatura de `billing_create_payment_link` mudou e o teste da Fatia 5 chama a antiga. **Isso é RED legítimo** — o teste precisa passar os parâmetros novos.

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

---

## 7. Pendências que NÃO são desta fatia, mas encostam nela

- **PR #1533** (`fix/payment-link-metodo-do-port`): `boleto` não existe neste produto e o `CHECK` aceitava. **Pronto, 40/40 no CI.** Quando mergear, **rebase esta branch em `main`** — o `payment_links_test.sql` daqui é a versão anterior ao fix.
- **A migration de ciclo que está em produção NÃO está na cadeia do repo** — uma das **44 fantasmas** (issue #1521). O repo diverge de prod **agora**, nesse ponto.
- **Dois vocabulários de ciclo convivem por tabela:** `semiannual` no billing novo, `semester` no `payment_history` legado. Não é inconsistência de arquivo — são duas gerações de schema no mesmo banco.
- **Deploys manuais pendentes** (merge não faz): migrations `20270811120000`, `20270811140000`, `20270811160000`, `20270811170000`, e as edge functions `infra-watchdog` e `billing-quote`.
- **Dois blocos `29`** no cabeçalho do `run.sh` da `main` (meu `payment_links_test` e o `rls_inv6_definer_sem_gate_test`). Comentário apenas; não renumerei bloco de outro dono.

---

## 8. Quem consultar

- **Prisma** (`/Users/gabrielaureliogipp/Dev/mst-ux`) — julgamento visual. Responde com protótipo em disco; **pergunte antes de escrever componente**, não depois.
- **Sentinela** (`/Users/gabrielaureliogipp/Dev/mst-review`) — revisão. Esta fatia toca **dinheiro e autoridade de master**, então o rubric de segurança é **obrigatório e bloqueante**. Chame direto, sem esperar despacho.
- **Malho** (`/Users/gabrielaureliogipp/Dev/mst-eng-c`) — Fatia 6 e o banco local compartilhado. Combine número de `run.sh` com ele **antes** de registrar.
