# Handoff — Métricas v2, para fechar a implementação em 13/08

> # 🔴 SUPERADO EM 2026-08-20 — NÃO USE A SEÇÃO DE ESTADO
>
> **O plano deste documento foi executado. As afirmações de estado estão falsas.**
>
> Medido em 2026-08-20 contra `origin/develop`:
>
> - **Os 9 PRs listados como pendentes foram TODOS mergeados em 13/08** — #1497,
>   #1531, #1532, #1536, #1546, #1563 (a pilha), mais #1565, #1576 e #1530.
>   Somou-se o #1597, que trouxe `Lead ≠ Negócio no motor, e a métrica
>   personalizada da Emenda 1`. A seção "1. Onde a implementação está" e o
>   "68% construído · 11% em produção" **não valem mais**.
> - **Passos 1, 2, 3 e 4 da "ordem do dia": feitos.** As migrations
>   `20270813100000_metric_negocio_semantica` e `20270813110000_metric_custom_definitions`
>   estão em `develop`, com pgTAP (`supabase/tests/metric_custom_tree_test.sql`,
>   47 asserções, registrado no `run.sh`).
> - **Passo 5 (E2E): a pré-condição caiu** — o #1565 entrou, e
>   `tests/e2e/16-metrics-studio.spec.ts` existe com o seed do lead de dois negócios.
>
> **O que continua verdadeiro e vale ler:** a seção 0 (as três regras do CTO —
> R1 "não toca produção" segue valendo), a seção 3 (o loop de validação e os 10
> tropeços), a colisão de migrations, o "nunca aplicar `20260727140000`", e a
> seção 4 (gates).
>
> **O que resta na frente de métricas** está no Jira, reconciliado no mesmo dia:
> `SCRUM-311` (17 de 29 medidas fora do motor), `SCRUM-313` (falta só o range
> personalizado), `SCRUM-316` (razão entre etapas), `SCRUM-320` (crivo de
> segurança — **nunca rodou, e é bloqueante**), `SCRUM-365` (5 decisões de
> produto) e o épico `SCRUM-321` (UI/UX).
>
> Estado corrente do módulo: `src/modules/analytics/CLAUDE.md`, seção
> "Estúdio de Métricas".

Sessão de 2026-08-12. Repo `v8milennialsb2bv2`.
Objetivo do CTO para amanhã: **fechar a implementação e começar os testes E2E de
leads, negócios e métricas.**

---

## 0. As três regras que o CTO fechou hoje. Leia antes de qualquer coisa.

### 🔴 R1 — Esta feature NÃO toca produção. De forma alguma.

O Torque roda para ~30 empresas. Métricas v2 mexe em catálogo, motor de leitura e
semântica de funil — mudança aqui não quebra tela, muda o **número que o cliente
usa para decidir**.

- Validação só em **branch efêmera de prod**, criada e encerrada no mesmo ciclo.
- `db push`, `apply_migration` e `gen types` contra prod: **proibidos** sem pedido
  explícito na sessão.
- Leitura de prod (SELECT, MCP read-only) é permitida — é assim que se mede.
- **PR aberto e parado é estado aceitável.** "Pronto" ≠ "em produção".

### 🔴 R2 — As métricas nascem sabendo que Lead ≠ Negócio.

Não é fase posterior. Vai na mesma feature. Se o sistema migrar para Negócio e as
métricas continuarem contando lead, dá conflito no dia da virada.

**E já não bate hoje** — medido em prod, 12/08:

```
41.025  entradas de funil abertas   ← o que a medida devolve
36.073  leads distintos nelas       ← o que o nome promete
 4.952  de diferença                ← ninguém vê
```

A medida `leads_na_etapa` conta **entradas**; o nome diz "Leads na etapa"; a UI a
rotula "Negócios na etapa". Três nomes, uma conta, nenhuma correta.

Estado da infra do Negócio **em produção**:

| peça | estado |
|---|---|
| tabela `deals` | existe, **0 linhas** |
| `pipeline_entries.deal_id` | **existe** |
| `abrir_negocio` / `mover_negocio` | **não existem** — só na branch `wip/wf-114aa5e4-88c-9-resgate` |
| `sale_events` | aponta para `lead_id`, **não** para negócio |

### 🔴 R3 — Métrica personalizada pelo usuário entra nesta feature.

Combinar medidas existentes com operadores. Exemplo do CTO: receita ÷ leads, para
saber quanto cada lead gasta em média.

🟢 **Já está arquitetado — não redecidir.** A **Emenda 1** do
`docs/adr/0023-composable-metrics-closed-catalog.md` (aceita 11/08) abre:

- profundidade **≤ 3** (hoje o motor faz exatamente 1)
- operadores **`+ − × ÷`**, conjunto enumerado no código
- folhas: id do catálogo + filtro da allowlist + **número literal**
- representação: **árvore tipada em `jsonb`**, nunca texto para parsear

Obrigações que a emenda cria: validar **na escrita E em runtime**; **falhar alto**
(árvore inválida levanta erro, nunca devolve `null` passando por número); pgTAP
por operador e para o teto — **incluindo recusar profundidade 4**.

O exemplo do CTO é `currency ÷ count`, que o motor **já** deriva como moeda. O que
falta é a UI de composição e a persistência da árvore — não o cálculo.

---

## 1. Onde a implementação está

**68% construído · 11% em produção.** A distância entre os dois é fila de merge e
apply, não teclado. Documento visual:
`<scratchpad>/metricas-progresso.html` (publicado como artifact).

### A pilha, e por que a ordem importa

Cada PR reescreve `_metric_leaf` acrescentando o próprio ramo. Fora de ordem, um
apaga o ramo de quem veio depois.

```
develop
 └── #1497  fix/metrics-studio-integration   ← BASE. Estúdio inteiro.
      └── #1531  família de qualidade
           └── #1532  negócios perdidos
                └── #1536  tempo de resposta
                     └── #1546  taxa de qualidade (1ª razão)
                          └── #1563  reuniões sem comparecimento + alvo
```

**Merge commit, nunca squash** — decisão do CTO. Squash do #1494 já desmontou
esta cadeia uma vez (foi o que matou o #1496).

⚠️ **A pilha está 1 commit atrás da base.** `fde96b37` renumera
`metric_leads_sem_responsavel` para `20270812010000`. Rebasear antes de mergear.

### Fora da pilha, contra `develop`

| PR | o quê | estado |
|---|---|---|
| #1565 | E2E: a CSP barrava o Supabase local — 114 testes nunca rodavam | UNSTABLE |
| #1576 | nenhum teste aponta para produção (4 arquivos) | UNSTABLE |
| #1530 | pgTAP: `'membro'` no enum + grant de `metric_period_bounds` | UNSTABLE, alheio |

---

## 2. O que fazer amanhã, na ordem

### Passo 1 — Destravar o #1497 (bloqueia os outros cinco)

Duas causas foram corrigidas hoje:

1. **Ciclo de módulos** (`3ebd92bd`) — `useMetricsStudio` ↔ `useMetricsStudioPanel`.
   O import de volta era só de TIPO, mas o `dependency-cruiser` lê o grafo de
   módulos. Tipo saiu para `lib/metrics-studio-window.ts`.
2. **Tipo infinito** (`dd195feb`) — `metrics_studio_panels` não está em `types.ts`
   (a migration não está em prod, e `gen types` lê prod). Sem assinatura, o TS
   percorre o PostgrestBuilder sem fim.

**A última rodada falhou com `socket hang up`** — falha de rede do runner, não do
código. Já re-disparei (`gh run rerun 31631434433 --failed`). **Confira o
resultado antes de concluir qualquer coisa.**

⚠️ Correção que custou tempo: o job `Lint & Build` **roda um TSC ratchet**. Eu
afirmei o contrário durante a sessão, lendo o trecho errado do `test.yml`.

### Passo 2 — Mergear a pilha, de baixo para cima

Depois do rebase sobre `fde96b37`. Merge commit.

### Passo 3 — Semântica de Negócio nas métricas (R2)

**Este é o coração do dia.** Regras que as medidas passam a seguir:

- **"Negócios na etapa"** conta NEGÓCIO aberto — não entrada, não lead
- **"Leads que entraram"** conta a PESSOA uma vez, mesmo com 3 negócios
- **Conversão** = negócio ganho ÷ negócio aberto (não venda ÷ lead — senão um
  lead com 3 negócios infla o denominador)
- **Receita** precisa apontar para o negócio, não só para o lead
- **Renomear antes de mudar a conta.** A medida atual passa a se chamar o que ela
  mede — *entradas* — para o histórico continuar legível depois da virada

Ordem sugerida: renomear primeiro (barato, reversível), depois trocar a fonte.

### Passo 4 — Métrica personalizada (R3)

Seguir a Emenda 1 ao pé da letra. O que falta:

- tabela para guardar a árvore (`jsonb` tipado, org-scoped, RLS)
- validador na escrita + validação em runtime no motor
- extensão do ramo `kind='ratio'` de `fn_metric_measure` para árvore ≤ 3
- UI de composição no Estúdio
- pgTAP: um por operador, o teto de profundidade, e **profundidade 4 recusada**

⚠️ **Armadilha de unidade, medida:** o motor deriva `count/count → percent` e
**multiplica por 100**. Uma razão "negócios por lead" sairia 135% em vez de 1,35.
O front formata pelo `format_id` do mapa e só **sufixa** `%` sem multiplicar — ou
seja, par incoerente imprime erro de **100×** e nada detecta. A guarda de
coerência entrou na migration `20270812100000` e no pgTAP `metric_taxa_qualidade_test`.

### Passo 5 — E2E de leads, negócios e métricas

**Pré-condição:** o #1565 precisa entrar, senão o login do Playwright não passa e
nada roda. Hoje 114 testes aparecem como "did not run".

Cenários mínimos:

- Organização sem a chave de liberação não vê rota, menu nem busca
- Painel com 4 janelas: cada número bate com o banco *(feito à mão hoje: R$ 41,9 mil,
  6, 2 e 70,0% bateram com o seed)*
- Trocar período muda o número; trocar corte muda a série e o rótulo
- Razão devolve escalar, sem corte nem gráfico de série
- Período sem dado mostra travessão, **nunca zero**
- Painel salvo reaparece após recarregar e trocar de máquina
- **Um lead com dois negócios: "Leads que entraram" = 1, "Negócios na etapa" = 2**
  ← o teste que prova o passo 3
- Métrica personalizada: montar receita ÷ leads e conferir contra o banco;
  profundidade 4 é recusada com erro visível

---

## 3. O loop de validação, e onde ele morde

Runbook: `.specs/project/runbook-validacao-local.md`. Estes tropeços **não** estão lá:

1. **`psql` não existe nesta máquina.** Use
   `node <scratchpad>/run-pgtap.mjs --db-url "$URL" --file <suite>`.
2. **`pg` pode sumir do `node_modules`** quando outra sessão troca de branch e roda
   install. `npm install pg@8.13.1 --no-save` resolve sem sujar o lockfile.
3. **Período válido é `day|week|month|range`.** Não existe `custom`.
4. **Toda suíte que chama `fn_metric_measure` precisa de contexto de auth** —
   `SET LOCAL role authenticated` + `set_config('request.jwt.claims', …)` + um
   `team_members` ATIVO de verdade.
5. **`role` de `team_members` é `'member'`, não `'membro'`.** O `CLAUDE.md` do repo
   está errado (SCRUM-366).
6. **`sale_events`** exige `revenue_stream` e, com `producer='funnel'`,
   `pipeline_id` + `stage_key`.
7. **Função `STABLE` é somente-leitura** — `CREATE TEMP TABLE` levanta `25006`. Use CTE.
8. **`goals` tem `name` NOT NULL** — omitir derruba a suíte na primeira inserção.
9. **Git Bash mangleia `git show origin/develop:caminho`** — prefixe `MSYS_NO_PATHCONV=1`.
10. **plpgsql:** `IF x <> CASE … THEN … END THEN` **não compila** — o parser fecha a
    condição do `IF` no primeiro `THEN`, o do `CASE`. Extraia para variável.

### Migrations: a colisão que apaga trabalho em silêncio

`20270811150000` e `20270811160000` **já estão no ledger de prod** com migrations de
**billing**. `db push` **pula** arquivo cuja versão consta no ledger — sem erro.
As fatias 4 e 5 não chegariam em prod e nada avisaria.

Antes de numerar migration nova: varrer `git log --all --diff-filter=A --name-only`
**e** o ledger de prod. `scripts/check-migration-versions.sh` **não pega** — compara
o repo consigo mesmo.

### 🔴 Nunca aplicar `20260727140000` como está

Ela reescreve `_metric_leaf` com o CASE de **8** medidas; o corpo vigente tem 14.
Aplicada depois das 2027, apaga o roteamento e o bloco de `target`. A fatia 8
(`20270812120000`) já absorveu as duas metades no despachante atual. **A migration
velha continua no repo como armadilha.**

---

## 4. Gates

`lint:ratchet` · `typecheck:ratchet` · `test:ratchet` · `lint:deps:check` ·
`check-migration-versions.sh` · `check-metric-antipatterns.sh` — **nunca** `npm run
lint` nem `npm run test:unit` crus.

⚠️ Baseline local pode divergir do CI quando a branch bifurcou antes da última
regeneração. Se o ratchet local acusar arquivo que você não tocou, confira o log do
CI antes de "consertar".

---

## 5. Pendências que não são de código

- **Token do Jira** (`.jira.env`) — o próprio arquivo pede revogação desde 05/08.
- **`SUPABASE_SERVICE_ROLE_KEY`** ausente nos secrets → job Workflow vermelho (SCRUM-364).
- **`tests/load/`** ainda mira prod; decisão do CTO: sai de `tests/` para `scripts/`,
  com trava que recusa org com automação ativa.
- **Sprint intocada** — decisão do CTO: não mover nada que não seja do Marcelo.

---

## 6. Prompt de arranque

```
Continuo Métricas v2 no Torque CRM. Objetivo de hoje: fechar a implementação e
começar os E2E de leads, negócios e métricas.

TRÊS REGRAS, e a primeira é dura:

1. Esta feature NÃO toca produção. O app roda para ~30 empresas. Validação só em
   branch efêmera, criada e ENCERRADA no mesmo ciclo. db push / apply_migration /
   gen types contra prod: proibidos sem eu pedir na sessão. Leitura é liberada.
2. As métricas nascem sabendo que Lead ≠ Negócio — mesma feature, não fase
   depois. Já não bate hoje: 41.025 entradas de funil para 36.073 leads.
3. Métrica personalizada pelo usuário entra nesta feature. NÃO redecida a
   arquitetura: a Emenda 1 do ADR-0023 já fechou (profundidade ≤ 3, + − × ÷,
   folha = id do catálogo ou número literal, árvore jsonb, validar nas duas
   pontas, falhar alto).

NÃO confie no que este prompt afirma sobre estado. Meça primeiro:

  gh pr checks 1497
  gh pr list --state open --limit 12
  gh run list --workflow=test.yml --branch develop --limit 3

Leia, nesta ordem:
1. .specs/project/handoff-metricas-2026-08-13.md   (este handoff, completo)
2. docs/adr/0023-composable-metrics-closed-catalog.md — a Emenda 1
3. src/modules/analytics/CLAUDE.md — seção "Estúdio de Métricas"
4. .specs/project/runbook-validacao-local.md

ORDEM DO DIA
  1. Destravar o #1497 (bloqueia 5 PRs). Falhou por `socket hang up` — rede, não
     código; re-disparei. Confira o resultado antes de mexer.
  2. Rebasear a pilha sobre fde96b37 e mergear de baixo para cima, MERGE COMMIT.
  3. Semântica de Negócio nas métricas — renomear antes de trocar a fonte.
  4. Métrica personalizada, seguindo a Emenda 1.
  5. E2E. Pré-condição: #1565 entrar, senão o login do Playwright não passa.

ARMADILHAS QUE JÁ CUSTARAM TEMPO
  - 20270811150000 e 160000 colidem com o ledger de prod: db push PULA em
    silêncio. Varra git log --all E o ledger antes de numerar.
  - NUNCA aplicar 20260727140000 como está: reescreve _metric_leaf com 8 medidas
    e apaga o roteamento das 14.
  - count/count vira percent e MULTIPLICA por 100 no motor; o front só sufixa %.
    Par incoerente = erro de 100x que nada detecta.
  - role é 'member', não 'membro'. psql não existe aqui — use run-pgtap.mjs.
  - Git Bash: MSYS_NO_PATHCONV=1 antes de `git show ref:caminho`.

Nada foi aplicado em produção. Zero branches efêmeras vivas.
```
