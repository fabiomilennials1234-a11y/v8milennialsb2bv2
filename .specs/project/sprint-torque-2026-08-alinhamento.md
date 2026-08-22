# Sprint Torque — alinhamento e próximos passos

Medido em **2026-08-12** contra o Jira (`SCRUM`, board 1) e o repositório.
Sprint ativa: **Sprint Torque**, 2026-08-10 → 2026-08-24, **sem meta definida**.

> Onde este documento e o Jira divergirem, vale este — os números abaixo foram
> puxados por API e as âncoras conferidas no repo. Onde eu não consegui medir,
> está escrito "não medido", e isso não é modéstia: é o que separa esta spec de
> um chute organizado.

---

## 1. O tamanho real do backlog

| | |
|---|---|
| Abertas | **185** |
| … das quais "A fazer / Subtarefa" | 80 |
| … "A fazer / Tarefa" | 43 |
| Empacadas em **"Testando"** | 16 |
| **Órfãs** (aberta, sem pai, não-Epic) | **26** |
| Épicos | 8 — 4 `Fazendo`, 4 `A fazer` |
| Fechadas nos últimos 14 dias | 179 |

179 fechadas em 14 dias contra 185 abertas: o time entrega rápido e **abre mais
rápido ainda**. O problema desta sprint não é velocidade, é que o board não conta
a verdade — e por isso não dá para decidir olhando para ele.

### 1.1 As 16 em "Testando" não são 16 assuntos, são 3

Ordenadas por dias sem toque:

| Bloco | Issues | Idade | O que é |
|---|---|---|---|
| **A virada de migrations** | SCRUM-179, 202, 245, 246, 247, 248, 249 (pai SCRUM-60) | 5d | Preparação do apply em prod: ledger, rollbacks, RLS de tabela de backup, n8n |
| **Leads & Negócios** | SCRUM-53, 56, 59, 97, 98, 102, 123, 124, 176 (pai SCRUM-43) | 2–7d | Fatia 2 + card do Lead + provas |
| **Billing** | SCRUM-277 (pai SCRUM-39) | 2d | Protótipo do checkout |

"Testando" virou **sala de espera**, não etapa. Sete itens do bloco da virada
estão parados no mesmo dia — ou seja, foram empurrados juntos e ninguém voltou.

### 1.2 As 26 órfãs são, em maioria, achado de auditoria sem dono

14 das 26 são `Bug` criado por varredura (SCRUM-326 a 335, 366 a 369). Nenhum
pendura em épico. É o padrão que produz ansiedade: toda auditoria despeja
achados soltos no topo do board, e eles competem visualmente com o trabalho da
sprint.

As outras 12 são guarda-chuvas antigos (`Refatoração de…`: SCRUM-11, 19, 38, 40)
e pedidos de cliente (SCRUM-228, 229, 266).

---

## 2. As quatro verdades que o board não mostra

### 2.1 🔴 Os 5 PRs da pilha SCRUM-311 nunca rodaram um único job de CI

`test.yml` dispara `pull_request` só com `branches: [main, develop]`. A base de
#1531/#1532/#1536/#1546/#1563 é branch de feature — logo `gh pr checks` devolve,
nos cinco, apenas `Supabase Preview skipping`.

**8 medidas e 9 migrations passaram por review sem um gate sequer.** É a mesma
classe de cegueira que o #1512 acabou de corrigir um andar acima, para `develop`.

### 2.2 🔴 A base da pilha (#1497) está vermelha e esconde os outros seis jobs

`Lint & Build fail` e os seis restantes `skipping`, porque todos declaram
`needs: [quality]`. O andar de baixo nunca provou nada, e os cinco de cima
herdam isso.

### 2.3 🔴 Squash-merge desmonta a pilha — e já desmontou esta mesma cadeia

O corpo do #1497 registra: *"Substitui o #1496, fechado por conflito: a branch
anterior divergiu de develop após o squash-merge do #1494"*. O histórico da
`develop` mistura squash (`24da9a20`) e merge commit (`947331b3`).

A ordem correta — **#1497 → #1531 → #1532 → #1536 → #1546 → #1563** — existe só
em prosa dentro dos corpos dos PRs. Não está em campo nenhum do Jira.

### 2.4 🔴 Quatro testes de integração apontam para PRODUÇÃO

Não é um arquivo, são quatro:

```
tests/integration/setup-prod.ts                      ← default = ref de prod, ensureTestOrg() CRIA org
tests/integration/lead-service-prod.test.ts
tests/integration/copilot-v2/border-regression.test.ts
tests/integration/human-pause.test.ts
```

`package.json:29` → `test:integration` = `vitest run tests/integration/` (glob
inteiro), e `test.yml:139` roda exatamente isso.

Hoje o estrago só não acontece porque `setup-prod.ts` estoura no import por falta
de `PROD_SUPABASE_SERVICE_ROLE_KEY`. **O perigo é alguém "consertar" o vermelho
fornecendo a chave** — e aí o CI passa a criar organização em produção.

Fora do glob, mas no repo: `tests/load/*` também mira o ref de prod.

---

## 3. Decisão do CTO — "todo teste deve apontar para branch efêmera"

Registrada nesta sessão. Ela tem **duas leituras com custos muito diferentes**, e
a escolha muda o plano:

### Leitura fraca — "nenhum teste aponta para produção"

O CI continua em Supabase local (`supabase start`, `localhost:54321`), que é o
que os jobs Integration, pgTAP e E2E já usam hoje (`test.yml:133,155,175`).

- **Custo**: 4 arquivos. Tirar `setup-prod`/`lead-service-prod` do glob, e checar
  os outros dois.
- **Prazo**: horas.
- **Ganho**: fecha o risco de escrita em prod, de forma permanente.

### Leitura forte — "todo teste roda contra branch efêmera, inclusive no CI"

- **Precisa existir**: token de acesso Supabase nos secrets do repo, script de
  criação/derrubada por rodada, garantia contra branch órfã.
- **Custo por rodada**: US$ 0,01344/hora de branch, mais **~4 min só de
  `db push`** (medido nesta sessão: 84 migrations).
- **Colisão**: o job Workflow (SCRUM-364) já está bloqueado por **falta de
  secret**. A leitura forte depende do mesmo destravamento.
- **Não medido**: quantas rodadas de CI o repo faz por dia. Sem isso não dá para
  estimar o custo mensal — é a primeira coisa a medir se você escolher esta.

> **Recomendo a fraca agora e a forte como ticket próprio.** A fraca elimina o
> risco real (escrita em prod) hoje; a forte é uma mudança de arquitetura de CI
> que não cabe nos 12 dias restantes da sprint e que depende de um secret que já
> trava outro job.

---

## 4. Alinhamento do Jira — change-list proposto

Nada abaixo foi executado. São mudanças reversíveis, e todas têm âncora.

### 4.1 Status que contradiz o repositório

| Issue | De | Para | Por quê |
|---|---|---|---|
| SCRUM-308, 310, 312, 313 | Fazendo | **Testando** | Código escrito e empacotado no #1497. Falta merge e prova, não teclado. |
| SCRUM-309 | Fazendo | **Testando** | idem |
| SCRUM-363 | A fazer | **Fazendo** | PR #1565 aberto contra `develop`, CI rodando |

### 4.2 Título que descreve o oposto do código

**SCRUM-309** — "Persistir o painel no servidor (dashboard_pages/dashboard_widgets)"
→ **"(metrics_studio_panels)"**.

A migration `20270811110000` tem um cabeçalho inteiro chamado *"POR QUE TABELA
NOVA E NÃO dashboard_pages/dashboard_widgets"*. O ticket prescreve a
implementação que foi deliberadamente rejeitada.

### 4.3 SCRUM-311 não mostra que 19 viraram 8 + 5 + 6

Hoje é uma `Tarefa` "Fazendo" com **uma** subtarefa. Proposta:

- **8 subtarefas "Testando"**, uma por fatia portada, cada uma citando seu PR
- **1 "Feito"** para as 3 absorvidas pelo recorte (G1+G2 do SPEC)
- **1 "Feito"** para as 2 que dependiam da migration não aplicada — resolvida na fatia 8
- **SCRUM-369** (motivos_perda) vira filha, em vez de Bug órfão
- SCRUM-365 já cobre as 5 decisões de produto

Sem isso, de fora não dá para ver que **o que resta do SCRUM-311 é decisão sua,
não fila de dev**.

### 4.4 Registrar a ordem de merge

Subtarefa nova sob SCRUM-311, ou na descrição:

```
#1497 → #1531 → #1532 → #1536 → #1546 → #1563
merge commit, NUNCA squash
pendente: rebase da pilha sobre fde96b37 (renumera metric_leads_sem_responsavel)
```

### 4.5 Issues que faltam

| Onde | O quê |
|---|---|
| Sob SCRUM-359 | **Teste de integração aponta para PRODUÇÃO** — os 4 arquivos da §2.4 |
| Sob SCRUM-359 | **PR empilhado não roda CI** — `test.yml` só dispara com base main/develop |
| Bug, sem épico | **Policy de leads dá a org inteira ao gestor de portfólio**, sem predicado de linha (`baseline:38240`) |
| Bug, sob SCRUM-43 | **`pipe_confirmacao_insert_fn` devolve id null** (`baseline:16088`) — atinge o app, não só o teste |
| Editar SCRUM-367 | Nomear os casos concretos: colisão `20270811150000`/`160000`; `personal_access_tokens` e `ensure_master_team_member` como duas das órfãs |

### 4.6 Acalmar o board

- **Pendurar as 14 órfãs de auditoria** (SCRUM-326–335, 366–369) num épico
  "Dívida técnica achada por auditoria", para pararem de competir com a sprint
- **Fechar ou adiar explicitamente** o bloco da virada (SCRUM-179, 202, 245–249):
  sete itens parados no mesmo dia é decisão pendente, não trabalho em curso
- **Meta da sprint** (não existe hoje). Proposta, cabendo nos 12 dias restantes:
  > *"O Estúdio de Métricas chega a produção com número real, e a `develop`
  > volta a ter CI que significa alguma coisa."*

---

## 5. Próximos passos, em ordem

### Bloco 1 — risco, antes de qualquer feature

1. **Tirar os 4 testes de prod do glob do CI** (§2.4). Leitura fraca da decisão
   da §3. Horas.
2. **Revogar o token do Jira** — `.jira.env` avisa, no próprio arquivo, que ele
   foi colado num chat em 2026-08-05 e devia ser revogado "assim que o import
   terminar". São 7 dias.

### Bloco 2 — destravar o que já está escrito

3. **Consertar o `Lint & Build` do #1497.** Enquanto ele estiver vermelho, os
   outros seis jobs nem rodam e a pilha inteira é invisível.
4. **Decidir merge commit × squash** e rebasear a pilha sobre `fde96b37`.
5. **Mergear a pilha na ordem** e então **aplicar em prod, arquivo a arquivo** —
   com atenção à colisão `20270811150000`/`160000`, que faz `db push` pular as
   fatias 4 e 5 **em silêncio**.
6. **Só depois do apply**: atualizar `metrics-studio-engine-map.ts`. Antes disso,
   medida ausente do catálogo de prod levanta `22023` e derruba a janela.

### Bloco 3 — caminho A (CI)

7. #1565 (E2E) — aguardando CI. **Não prometido**: destravar o login faz 114
   testes rodarem pela primeira vez em meses; o resultado deles é desconhecido.
8. Complemento pgTAP ao #1530 — 3 correções mecânicas. **#1530 sozinho não deixa
   o job verde**: medido, as suítes só trocam de erro.
9. Integration — 12 causas triadas, várias precisam de decisão.
10. Workflow (SCRUM-364) — secret. Só admin do repo.

---

## 6. O que trava, e é seu

1. **Merge commit ou squash** na pilha do SCRUM-311? Squash desmonta os cinco de
   cima — já aconteceu com o #1496.
2. **Consertar o #1497 primeiro** (a pilha espera) ou **desempilhar as 8 medidas
   direto contra `develop`** (perde a linhagem, ganha CI real em cada uma)?
3. **Decisão da §3**: leitura fraca ou forte de "todo teste aponta para branch
   efêmera"?
4. **As 5 medidas do SCRUM-365** — você decide agora, ou fecho o SCRUM-311 com
   as 8 portadas e o 365 migra para o SCRUM-314?

---

## 7. O que NÃO foi medido

Honestidade sobre os limites desta spec:

- **Rodadas de CI por dia** — necessário para custear a leitura forte da §3
- **Se os 179 fechados em 14 dias incluem retrabalho** — não abri um a um
- **A causa dominante do job Integration** (clientes Supabase dividindo a mesma
  chave de `localStorage` em jsdom) veio de diagnóstico, **não foi reproduzida
  por mim**
- **Projeção de comissão pela metade em prod** — dois levantamentos discordaram
  sobre a âncora no repo; fica como suspeita, não como fato
