# Spec da virada — Leads ↔ Negócios em produção

**Medido em 2026-08-06** contra prod `jsjsmuncfkbsbzqzqhfq` e `origin/develop` (`8f2bbde0`). Substitui, onde divergir, `.specs/project/receita-deploy-migrations.md` — que está stale em três pontos comprovados (§9).

> **O que esta spec é.** A sequência única, numerada, com dono e gate por passo, para pôr em produção a feature que está 100% em `develop` e 0% em prod. Ela reconcilia seis medições independentes que, lidas isoladamente, se contradizem em ordem — e a contradição é do tipo que trava cliente.

---

## 1. Estado, com número e data

| O quê | Medido hoje | O que o doc dizia |
|---|---|---|
| Commits `main..develop` | **100** (243 arquivos, +34.915/−3.244) | — |
| Migrations pendentes | **41** (20 novas + 21 re-carimbos) | 22 |
| Ledger de prod | **60 versões** | 57 |
| Migrations órfãs (prod sem arquivo) | **31** | 31 ✔ |
| Edge functions desatualizadas em prod | **30 de 30** (100%) | — |
| Cards para o backfill M4 | **39.499 em 67 orgs** | 38.898 |
| Leads com responsável cross-org | **1.594**, em 2 orgs pagantes | 1.594 ✔ |
| `pipeline_entries` cross-org | **1.091** | 1.091 ✔ |
| Pedidos de ERP para a Carteira | **363 em 7 orgs** | 344 em 13 |
| Orgs com `deal_manual_only` ligada | **0 de 98** | 0 ✔ |
| Nós n8n que criam card | **6 ativos + 2 armados + 3 escritas diretas** | 4 + 1 sweep |

Duas leituras que mudam decisão:

- **a Carteira é alvo móvel.** 25 pedidos novos desde 04/08, o último hoje às 14:18 UTC — o ERP sincroniza ao vivo. Contar de novo no dia;
- **a sujeira cross-org está congelada.** Maria Bonita ← Mapila (1.091, todas de 2026-05-06) e Zaplub ← The Good Balloon (503, todas de 2026-03-26). Nada novo desde então: não é vazamento ativo, é dívida parada.

---

## 2. A sequência

Cada passo tem **dono**, **gate** (como saber que deu certo) e **reversão**. Passo sem gate é passo que ninguém confere.

### 0 · Congelar e desarmar
**Dono:** agente · **Reversão:** n/a

```bash
supabase unlink                      # o checkout ESTÁ linkado a prod agora
bash scripts/check-migration-versions.sh   # tem que sair "0 (baseline 0)"
git rev-parse origin/develop         # anote o SHA; a virada inteira é sobre ele
```

**Gate:** `supabase/.temp/linked-project.json` não existe mais. Sem isso, um `db push` bare escreve em produção — é o modo de falha que a guarda mecânica do `CLAUDE.md` existe para impedir.

### 1 · Decidir a service_role key exposta
**Dono:** CTO · **Bloqueia:** nada, mas é o único item que fica pior esperando

O n8n `bUHokUwk8Brv4xNo` está **ativo** e carrega a chave em texto plano em 4 campos de header. `service_role` tem `rolbypassrls=true` medido hoje: a chave lê e escreve as 98 orgs com RLS desligada. Ver §5.

### 2 · Deployar as 30 edge functions
**Dono:** agente · **Reversão:** redeploy da versão anterior por função

**Esta ordem não é preferência.** Nenhuma função depende de schema novo (zero chamadas a `abrir_negocio`/`mover_negocio`), mas duas migrations quebram o código velho:

- `20270730000050` derruba os dois unique → o `.maybeSingle()` da versão velha do adapter vira **duplicador de card**;
- `20270803000040` esvazia `pipe_whatsapp` no MOVE → a condição `stage` do workflow velho passa a ler vazio.

Deployar depois do push é entregar uma janela em que automação de cliente escreve errado, em silêncio.

**Gate:** as 30 em `ACTIVE` com versão bumpada. `--project-ref` explícito em toda chamada; **nunca** omitir o slug (deploy sem nome sobe as 143) e **nunca** `--prune`.

### 3 · Patchar o n8n
**Dono:** agente (patch) + CTO (as 3 decisões) · **Reversão:** restaurar o workflow pela versão anterior

São **8 nós** com `place_in_pipe` — 6 ativos e 2 armados (inativos). Os 2 inativos são os templates de onde os novos nascem: patchar só os ativos deixa a arma carregada. Dois workflows com `place_in_pipe` nasceram **depois** da última auditoria, o último ontem.

Três escritas diretas por PostgREST ficam **fora do alcance da flag** — inclusive `Insert Opor-V3`, que faz POST em `custom_pipe_entries` com service_role. O plano dizia que nenhum nó escrevia nessa tabela; escreve.

### 4 · Reparar as 21 re-carimbos
**Dono:** agente · **Reversão:** `--status reverted`

21 das 41 pendentes são **o mesmo SQL já aplicado em prod** sob versão 2026 diferente (provado: o ledger de `20260804124709` começa com `-- 20270805000000_voip_incoming_creates_call.sql`). Replicá-las rodaria `DROP POLICY`/`DROP TRIGGER`/`CREATE` em tabelas vivas — 20 delas fazem DDL destrutivo-e-recriativo.

```bash
supabase migration repair --status applied <as 21> --db-url "$URL_PROD"
```

**Gate:** ledger passa de 60 para 81 versões, e o `--dry-run` do passo 5 passa a listar 20, não 41.

### 5 · Push das 18 migrations — sem a M6 e sem a da Carteira
**Dono:** CTO (é escrita em prod) · **Reversão:** ver §4

```bash
supabase db push --include-all --dry-run --db-url "$URL_PROD"   # tem que listar 18
```

⚠️ **`--include-all` é obrigatório.** Há 4 órfãs com versão maior que tudo no repo (`20270807000000-003`), e o CLI ignora o que está abaixo do máximo remoto: sem a flag, o push **não aplica nada** e imprime algo que o operador lê como "já está tudo em prod".

`20270731000010` (M6) e `20270805000010` (carteira) ficam **fora** deste lote — os passos 7 e 9.

### 6 · Limpeza cross-org
**Dono:** CTO · **Reversão:** `backup_cross_org_responsaveis` (14.347 linhas)

`scripts/m6-limpeza-cross-org.sql`. É **DML**, não migration — não entra no `db push` (guarda F4).

**Tem que rodar aqui**, entre o schema e a trava: com o M6 no ar, todo `UPDATE` nas linhas sujas é recusado, inclusive o desta limpeza. O bloco 0 do script recusa rodar na ordem errada — provado em branch efêmera hoje.

⚠️ **Antes do INSERT do bloco 1**, acrescentar `ALTER TABLE public.backup_cross_org_responsaveis ENABLE ROW LEVEL SECURITY`. Hoje a tabela nasce legível por qualquer `authenticated` — a limpeza que existe para fechar vazamento cross-org criaria um.

**Gate:** `LIMPEZA OK — 0 valores cross-org nos dois caminhos de varredura`.

### 7 · Acender o M6
**Dono:** CTO · **Reversão:** dropar os 3 gatilhos

`supabase db push --include-all` com `20270731000010`. Depende de `leads.claimed_by` existir (veio no passo 5).

**Gate:** `VALIDATION PASSED: fn_assert_member_same_org cobre as 8 colunas`.

### 8 · Backfill M4, org a org
**Dono:** CTO · **Reversão:** ver §6

39.499 cards, 67 orgs, ~16s no total medido em ensaio. Pega **ACCESS EXCLUSIVE** em `pipeline_entries` uma vez por org — a tabela do kanban, num banco com 30 orgs dentro. Janela de baixo tráfego, da menor org para a maior.

Basic4u fica **bloqueada** pelo card `dd91cd35` (§6).

### 9 · Carteira
**Dono:** CTO

Push de `20270805000010` (aposenta os funis) + backfill dos **363** pedidos. Recontar no dia: o número se move.

### 10 · Tipos, pontes e flag
**Dono:** agente

```bash
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq > src/integrations/supabase/types.ts
npm run typecheck:ratchet    # rodar ANTES e DEPOIS de tirar as pontes
```

Gerar **de produção**, nunca de branch. Sai junto: as 3 pontes `as never` de `abrir_negocio`/`mover_negocio` e a flag `STALLED_FILTER_ENABLED_FOR_SYSTEM_PIPES`.

⚠️ O regen arrasta ~204 linhas de drift alheio (as 31 órfãs). Rodar o ratchet duas vezes separa o que é seu do que veio junto.

### 11 · Merge `develop` → `main`
**Dono:** CTO · **Reversão:** revert do merge + esperar ~80s

**Isto é um ato de produção, não de versionamento.** Medido hoje: PR #1428 mergeado às 17:31:03Z, `index.html` de torquecrm.com.br com `Last-Modified` às **17:32:22Z** — 79 segundos — enquanto o job "Build Image" do mesmo SHA ainda estava `queued`. Quem constrói é o EasyPanel, direto do repo.

**Gate mecânico antes do merge:** um `SELECT` em `pg_proc` confirmando `abrir_negocio` e `mover_negocio` em prod. Sem elas, "abrir negócio" e "avançar etapa" quebram para 98 orgs 80 segundos depois do clique.

`git merge-tree` sai limpo hoje, mas `main` recebeu 2 commits nas últimas horas — **refazer o teste na hora**.

### 12 · Acender a piloto
**Dono:** CTO

Flag `deal_manual_only` na Milennials + aviso operacional, **no mesmo dia** do patch do n8n. Fora de ordem, vira chamado de "sumiu lead".

---

## 3. O que aborta a virada

Pare e reverta se:

- o `--dry-run` do passo 5 listar número diferente de 18;
- o gate do passo 7 não imprimir `VALIDATION PASSED`;
- a verificação pós-apply achar **trava ≠ 0** — a fatia 2 não valeu e o backfill **não pode** rodar;
- alguma das 30 edge functions ficar fora de `ACTIVE`;
- `has_function_privilege('anon', 'public.abrir_negocio(...)', 'EXECUTE')` voltar `true`.

---

## 4. Rollback — o buraco conhecido

**12 das 13 migrations da virada não têm arquivo de rollback.** Uma delas (`20270803000010`, o `DROP COLUMN`) é irreversível sem restore.

O único rollback que existe foi exercitado hoje pela primeira vez — e **falhava**: `fn_assert_member_same_org` referencia `claimed_by`, e o `DROP COLUMN` batia em dependência de catálogo. Corrigido na PR #1430; agora derruba as três travas antes, e diz em letra grande que a trava fica desligada ao fim.

**Antes do passo 5**, escrever os rollbacks dos 5 de efeito destrutivo. Rollback que ninguém rodou é rollback que não existe.

---

## 5. Segurança — os dois que não esperam a virada

| Item | Medição de hoje |
|---|---|
| `SCRUM-199` service_role no n8n | workflow **ativo**, chave em 4 campos de header, `rolbypassrls=true` — lê e escreve as 98 orgs |
| `SCRUM-200` `x-webhook-key` | chave **global única**, compartilhada com outras 4 edge functions; `organization_id` vem do **corpo** da requisição; 9.041 leads de 39 orgs em 30 dias |

Nenhum depende do deploy. Rotacionar a chave, porém, derruba integrações que ninguém inventariou — **varrer a frota n8n antes** (`n8n_list_workflows` + `get_workflow`, filtrando o host de prod).

---

## 6. Decisões que são suas

1. **Basic4u, card `dd91cd35`** — fonte diz `novo`, espelho diz `vendido`. É o **único card divergente da base inteira**, e destrava 4.226 cards do M4 e 68% da Carteira. Não tem resposta no dado.
2. **Como os backfills rodam em prod** — os dois runners recusam o ref de produção **por desenho, sem escape**. A mensagem manda usar "outro caminho", que não existe no repo. Acrescentar um escape auditável (`--eu-sei-que-e-prod <ref>`), ou `psql` direto abrindo mão das guardas?
3. **Zerar ou reatribuir** os 1.594 responsáveis cross-org. Zerar é o que o script faz e tem backup; reatribuir é trabalho novo, sem backup e sem prova.
4. **`Insert Opor-V3`** — cria card por escrita direta, fora do alcance da flag. Desliga no dia D, ou Oportunidades-V3 é exceção deliberada?
5. **Os 2 nós que só movem card** (`Sweep Reunião → Agendado`, 480×/dia) — ficam de pé (ajudam com os 2.384 cards legados) ou desligam junto?
6. **`place_in_pipe` no `lead-webhook`** — a higiene manual do n8n já falhou duas vezes em 16 dias. Fazer a edge function **ignorar** `place_in_pipe` quando a org tem a flag ligada resolve na raiz.
7. **Rotação da chave: antes ou depois?** Antes fecha o furo e mexe em credencial na véspera de um apply grande.
8. **As 7 órfãs sem dono** — `20270807000000-003` (billing) e as 3 de carteira de hoje não existem em branch nenhuma. Sem elas no repo, o próximo `db diff` propõe desfazer o rename de `feature_catalog`.

---

## 7. O que já está provado, e o que não está

**Provado** (branch efêmera, hoje): RLS de `deals` com admin multi-org, membro e master; a porta `abrir_negocio` recusando lead de outra org; a flag `deal_manual_only` decidindo **por organização**; a limpeza cross-org com backup e guarda de ordem; o rollback do claim.

**Não provado**: a interface logada nos três papéis. A branch replica só o Postgres — sem as 78+ edge functions o app não passa do boot.

---

## 8. Ordem, em uma linha

```
unlink → [decidir chave] → 30 EF → n8n → repair 21 → push 18 → limpeza DML →
M6 → backfill M4 → carteira → types+pontes → merge main → flag piloto
```

O que essa ordem protege: **a limpeza cabe entre o schema e a trava** (senão 1.091 cards ficam imóveis), e **as functions chegam antes das migrations que quebram o código velho** (senão automação de cliente escreve errado, calada).

---

## 9. Onde esta spec contradiz o doc anterior

`receita-deploy-migrations.md`, medido hoje:

| O doc diz | Medido |
|---|---|
| 22 migrations pendentes | **41** |
| ledger com 57 versões | **60** |
| reparar `20270203000000` por 42P07 | **desnecessário** — `dc0c1b44` tornou o arquivo idempotente em 05/08 |
| "uma única falha, e ela é previsível" | verdade, mas é **outra**: `20270728000000_meta_conversations.sql:24` |
| `supabase db push` puro | **não aplica nada** sem `--include-all` |

O doc não estava errado quando foi escrito — estava certo em 04/08. O merge `main→develop` trouxe 22 arquivos depois, e o fix do omie entrou 2h depois de ele ser salvo. **É por isso que esta spec traz data em cada número.**
