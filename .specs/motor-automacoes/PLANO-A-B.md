# Motor de automações — Fatia A+B

Data: 2026-08-20 · Decisões: Gabriel (CTO), sessão `/grill-with-docs`
Base: `origin/main` (`5d93f98c`)

## Problema, medido em prod

Queixa: Goletric Perdizes e Pinheiros relatam automação que "não dispara".

| medida | valor | fonte |
|---|---|---|
| Lag p90, gatilho → 1º envio | **35–53 min** (pior 250 min) | 19/08, 11–21h UTC |
| Teto por org | **5 execuções/min** | `claim_workflow_executions(per_org_cap DEFAULT 5)`, caller não passa o param |
| Tempo médio por execução | **4,88s** (p99 85s, máx 139s) | 7 dias, bursts de `workflow_execution_steps` |
| Onde o tempo vai | `action` 3,38s · `delay` inline 2,27s · resto ~0,1s | idem |
| Vazão real de 1 invocação | **~12/min** (loop sequencial) | 1 ÷ 4,88s |
| Ocupação do motor | **27% dos minutos têm trabalho** | 14 dias |
| Orgs disputando o mesmo minuto | média **1,15**, máx **4** | 14 dias |
| Execuções vencendo no mesmo minuto | p99 **6**, máx **114** | 14 dias |

**Causa-raiz.** Carga I/O-bound (94% espera) rodando em loop **sequencial** (`index.ts:130`).
Vazão = concorrência ÷ latência = 1 ÷ 4,88s. `batch_size`/`per_org_cap` não entram na fórmula —
não compram vazão. Rajada de 114 contra cap de 5/min = 23 min de fila, que é o p90 observado.

**Defeito secundário.** A fila ordena por `started_at` (nascimento), não por `next_run_at`
(vencimento). Distância média entre os dois: **36,1h** (máx 720h). Execução que dormiu 7 dias
por desenho passa na frente de lead que espera de verdade há 3 min.

## Decisões (todas do CTO)

| # | Decisão | Escolha |
|---|---|---|
| 1 | Ordenação | Ordenar por **`next_run_at`** (Due), não `started_at`. Sem pistas reservadas por ora. Medir Lag e revisitar |
| 2 | Freio de ban no envio | **Nenhum freio novo.** Volume diário não muda (demanda é o limitante), só a rajada. Risco aceito explicitamente |
| 3 | Isolamento multi-tenant | **Fatia do pool por org** (concorrência), não contagem/min. `per_org_cap` da RPC vai a 1000 e deixa de ser freio |
| 4 | Onde o Lag mora | **Coluna `claimed_at`** em `workflow_executions`. Grava de carona no UPDATE do claim |
| 5 | Quem lê o Lag | **Aba nova em `/master/automation-health`** (tela já roteada e no sidebar). UI tem que **explicar cada número** |
| 6 | Claim | **Pedaços** (~2× o pool) em laço até o orçamento acabar. Nunca sobra linha reivindicada. Stale fica em 10 min |
| 7 | Mudança da RPC | **`CREATE OR REPLACE`** na mesma assinatura `(int,int)` — preserva grants. Sem v2, sem DROP |
| 8 | Validação | **Branch do Supabase** (nasce no projeto de prod, custa por hora — criar, usar, derrubar) |
| 9 | Kill-switch | **Parâmetros em `cron_config`**, lidos por invocação. Rollback sem deploy. Modo `pinned` **vence o controlador** |
| 10 | Rollout | **Entra direto em `pool = 4`.** Sem rampa manual |
| 11 | Escala | **Controlador automático**, faixa fechada `[4, 16]`. Sinal = **saturação**, não Lag. Regra opcional de recusar-subir por taxa de instância: **rejeitada pelo CTO** |

## Escopo

### 1. Migration (nova, timestamp **depois de `20270820160000`** — a mais alta do `origin/main` — convenção do repo é sequência, não data)

- `ALTER TABLE workflow_executions ADD COLUMN claimed_at timestamptz` (nullable, sem default).
- `CREATE OR REPLACE FUNCTION public.claim_workflow_executions(batch_size int DEFAULT 20, per_org_cap int DEFAULT 1000)`:
  - `ORDER BY next_run_at` (Due) nas duas ordenações — a do `ROW_NUMBER()` e a do `picked`.
    Usar `COALESCE(next_run_at, started_at)` porque `next_run_at` é nullable.
  - `SET claimed_at = NOW()` junto com `status='processing'`.
  - Preservar: os 3 ramos de elegibilidade, o `_wait_resolved` do `waiting_response`,
    `FOR UPDATE SKIP LOCKED`, a re-checagem no `WHERE` do UPDATE, e `SET search_path`.
- `INSERT` das chaves em `cron_config` (idempotente).

### 2. Worker — `supabase/functions/process-workflow-executions/index.ts`

- Ler parâmetros de `cron_config` uma vez por invocação, com fallback conservador se ausente.
- Trocar `for … await` por pool de concorrência com teto global e teto por org.
- Laço de claim em pedaços até `budget` acabar ou a fila secar.
- Passar `per_org_cap: 1000` explícito.
- Logar por batch: nº processado, Lag p50/p90/máx, degrau do pool em uso.
- **Não mexer** em `processExecution`, `workflow-executor.ts`, nem no `setTimeout` de delay curto.

### 3. Front — aba em `/master/automation-health`

Requisito do CTO: **o master entende sem perguntar.** A aba ensina enquanto mostra.
- Distinguir na tela **Wait** (espera autoral, saudável) de **Lag** (atraso real). Confundir os dois
  é o erro que originou a investigação.
- Tabela org × Lag p50/p90/máx (7 dias) + piores workflows.
- Cada métrica com explicação em linguagem simples, na própria tela.

### 4. Controlador de escala (dentro do worker)

**Sinal = saturação, não Lag.** Ao fim de cada invocação o worker sabe, sem ambiguidade, se estourou
o orçamento com fila ainda vencida. Lag é indicador **atrasado** — quando sobe, o cliente já esperou.
Lag continua sendo a métrica que humano lê na aba; não é o que fecha a malha.

| regra | gatilho | ação |
|---|---|---|
| **Subir** | 3 invocações **seguidas** com orçamento estourado e fila não vazia | `pool += 2`, teto `workflow_pool_max` |
| **Descer** | 20 invocações **seguidas** drenando a fila com **< 30%** do orçamento | `pool -= 1`, piso `workflow_pool_min` |
| **Carência** | 5 min sem alterar após qualquer mudança | — |
| **Fatia por org** | derivada: `floor(pool / 2)` | 2 … 8 |
| **Override** | `workflow_pool_mode = 'pinned'` | controlador **não toca em nada** |

Assimetria proposital: sobe de 2 em 2, desce de 1 em 1. Ficar pequeno machuca cliente; ficar grande
só desperdiça vaga ociosa.

**Verdade registrada:** descer **não** protege contra rajada — o controlador sobe de novo quando ela
chega, que é o trabalho dele. A única proteção real é o **teto de 16**.

**Guarda de concorrência:** invocações podem se sobrepor. A escrita do pool usa `UPDATE` condicional
com o timestamp da última mudança como guarda — a carência de 5 min torna a operação idempotente
entre invocações concorrentes.

### Parâmetros (`cron_config`)

| chave | valor inicial | quem escreve |
|---|---|---|
| `workflow_pool_mode` | `auto` | humano |
| `workflow_pool_size` | **4** | controlador (ou humano, se `pinned`) |
| `workflow_pool_min` | 4 | humano |
| `workflow_pool_max` | 16 | humano |
| `workflow_run_budget_ms` | 45000 | humano |
| `workflow_claim_chunk` | derivado: 2× pool | — |
| `workflow_pool_last_change` | timestamp | controlador |
| `workflow_pool_sat_streak` / `_idle_streak` | contador | controlador |

## Testes

- **Unit (`test:unit`, sem banco):** pool respeita teto global e por org; orçamento encerra o laço;
  claim em pedaços não deixa sobra; `pool=1` reproduz comportamento sequencial (controle positivo).
- **Branch do Supabase:** migration aplica limpa; a RPC devolve na ordem de Due (com caso onde
  Due e Started discordam — o caso que motivou a mudança); `claimed_at` grava; grants intactos
  após o `CREATE OR REPLACE` (`has_function_privilege`); worker de ponta a ponta com concorrência.
- Cada teste tem que **ficar vermelho se o fix for revertido**. Verde por ausência não conta.

## Rollout

1. Deploy com `workflow_pool_size = 4`, `mode = auto`. Já é ~5× o teto efetivo de hoje por org.
2. Controlador assume: sobe até 16 só quando **saturar de verdade**, desce sozinho na calmaria.
3. Acompanhar Lag na aba do master nas primeiras 48h.

**Baseline:** entrando direto em 4, não existe janela medindo o comportamento atual com `claimed_at`.
O "antes" é o p90 de 35–53 min reconstruído por arqueologia de `workflow_execution_steps`.
Menos limpo do que seria; aceito pelo CTO em troca de não atrasar a correção.

## Rollback

| o quê | como | tempo |
|---|---|---|
| Concorrência | `mode='pinned'` + `workflow_pool_size='4'` — **pinned vence o controlador** | segundos, sem deploy |
| Ordenação | outro `CREATE OR REPLACE` na RPC | segundos, sem deploy |
| Coluna `claimed_at` | fica (aditiva, inerte) | — |
| Emergência total | desagendar o cron job | segundos |

## Fora de escopo (registrado, não feito)

- Freio de ban / send-governor enforce (Fix 5) — decisão 2.
- Pistas com capacidade reservada — decisão 1, revisitar com Lag em mãos.
- `delay` curto inline virar `next_run_at`.
- pgmq + fan-out (degrau C) — vira ADR com gatilho de volume.
- Validação no editor que impede ativar workflow com nó de ação incompleto (causa-raiz das 810
  execuções mortas da Cadência).

## Achados colaterais (não desta fatia)

- **`system_alerts`: 79.071 alertas, todos `critical`, todos abertos, desde 28/04.** Categoria única
  (`cron_job_failure`), ~1,5/hora por job, 7+ jobs. Canal de alerta morto por saturação.
- Policy de UPDATE de `workflow_executions` usa `SELECT … FROM team_members` inline — padrão que o
  `CLAUDE.md` proíbe (recursão com Realtime). Pré-existente.
- `anon` tem grant de EXECUTE em `claim_workflow_executions`. RLS ligada + função INVOKER contêm.
  Higiene, não furo.

## Riscos aceitos

1. **Sem freio de ban** (decisão 2), e o controlador pode acelerar sozinho até 16 sem ninguém olhando.
   Mitigação: o teto de 16 é a única proteção — e é humano, configurável, e vence via `pinned`.
   Referência de mercado: Salesforce documenta ~16,7 execuções/min/org; nosso teto de 16 vagas dá
   ~98/min/org — ~6× o líder. Mas o controlador só chega lá **sob saturação real**, não por padrão.
2. Migration chega junto com a mudança de comportamento. Sem pool inerte (decisão 10 revisada),
   a mitigação é o `pinned` + o `CREATE OR REPLACE` de volta na RPC.
3. Até `workflow_claim_chunk` linhas podem ficar presas 10 min se a função for morta. Limite aceito
   em troca de não arriscar mensagem duplicada com janela de stale menor que os 139s medidos.
