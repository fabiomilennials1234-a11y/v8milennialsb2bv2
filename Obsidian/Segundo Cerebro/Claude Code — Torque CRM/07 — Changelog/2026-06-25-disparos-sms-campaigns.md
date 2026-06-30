---
type: changelog
title: 2026-06-25 — Disparos: wizard linear, fonte planilha (ADR-0014), anti-ban per-número (ADR-0015), painel Acompanhar
status: shipped
created: 2026-06-25
updated: 2026-06-25
tags: [disparos, blast, whatsapp, campaigns, anti-ban]
related: ["[[2026-06-05-blast-plans]]", "[[2026-06-05-daily-blast-budget]]"]
owner: gabriel
---

# 2026-06-25 — Disparos: wizard linear, fonte planilha (ADR-0014), anti-ban per-número (ADR-0015), painel Acompanhar

Dia inteiro dedicado a transformar **Disparo** (blast WhatsApp em massa) numa feature de primeira classe com porta canônica própria, fluxo guiado de ponta a ponta e o backend multi-número/anti-ban fechado. Direção visual vencedora do protótipo (#900). Todos os commits abaixo estão em `origin/develop` via os PRs citados; **migration prod + deploy de edge functions ficam gated** (ver Follow-ups).

## Mudanças

- **Porta canônica + wizard shell** (#904, `02e5e3e0`): Disparos promovido a item **primário do topbar** (Comissões desce pro menu "Mais"); rota `/disparos` aberta a **qualquer membro** (removido o gate `campaigns.view`). `DisparosPanel` vira porta canônica — empty-state com receita de 3 passos na 1ª vez, depois histórico + botão "Novo disparo". `/disparos/novo` abre o **Wizard Linear** navegável: **Pra quem → Mensagem → Velocidade → Revisão → Acompanhar**. A página `MassSend.tsx` órfã foi aposentada. Módulos puros de planejamento (`planBlast`, `validateBlastMedia`, `nextValidSendTime`) ligados via **twin frontend** (`blast-planning.ts`) parity-pinned ao core Deno (cross-runtime).

- **Fonte planilha — upload + upsert E.164 + cria leads** (ADR-0014, #906, `71b961b8` + `61b9f660`): novo modo de audiência por planilha. Núcleo puro `partitionSpreadsheet` (`spreadsheet-upsert.ts`) particiona a lista mapeada contra os Leads existentes pelo **normalizador canônico de telefone** (reusado, sem cópia local): match → dispara como está; não-match → cria lead; sem telefone/inválido → reportado; duplicado no arquivo → colapsado para um envio. Edge `disparo-planilha-create` carrega leads por telefone, cria os novos (origem `disparo_planilha`, semeia funil/etapa, aplica tags) **sem sobrescrever** matched (só preenche vazio). Org vem server-side do JWT, writes via `service_role`, **sem role gate** (ADR-0014). Preview via `dry_run`. Frontend: `StepAudience` vira container (etapa | planilha) + `AudienceBySpreadsheet` (upload CSV via papaparse, auto-detecção de coluna confirmável, funil/etapa destino, tags, preview criados/no-CRM/inválidos/duplicados); parser puro `spreadsheet-parse.ts`.

- **Composer de mensagem — anti-ban** (#907, `6e526a03`): passo Mensagem ganha composer completo — picker de variáveis (`{{primeiro_nome}}`/`{{nome}}`/`{{empresa}}`/`{{segmento}}`), preview em **bolha WhatsApp** renderizada com lead amostra real ("outro cliente" troca a amostra), **toggle anti-bloqueio (on por padrão)** e aviso de risco em anexo de vídeo. Resolver puro `message-preview.ts` (`resolvePreview`): token conhecido → valor; `{{primeiro_nome}}` → primeira palavra; desconhecido → vazio.

- **Teto per-número + multi-número round-robin** (ADR-0015):
  - **UI** (#908, `5f427dd1`): passo Velocidade ganha slider único de **teto por número/dia** (20–200, default 80) com zona verde (≤80 seguro) e vermelha (>80, "você assume o risco"). Número marcado "novo" auto-clampa abaixo do slider via `effectiveCap`. Seleção multi-número recalcula capacidade+dias ao vivo via `planBlast`. Helper puro `speed-safety.ts` (`effectiveCap`/`capRisk`/`clampCap`).
  - **Backend** (#901, `2d2662ec`): migration **aditiva** (coexiste com o `blast_daily_usage` org-wide do ADR-0003) — tabela `blast_instance_daily_usage` + RPC `increment_instance_daily_usage` (SECURITY DEFINER, service_role-only, `search_path=''`), coluna `whatsapp_instances.daily_blast_cap` (default 80), `blast_plan_recipients.instance_id` (stamp do número), `blast_plans.window_*` (janela). `blast-plan-create` aceita `instance_ids[]` e distribui via `planBlast` (round-robin por número, cap por instância); `blast-plan-release` respeita janela (`nextValidSendTime`) + ledger per-número. Caminho single-number legado preservado (colunas nullable, fallback).

- **Liga wizard ao backend real** (#902/#908/#910/#911, `a51cf3b7`): audiência real via RPCs `get_stage_lead_ids`/`get_filtered_lead_ids` com contador ao vivo (`audience-resolve.ts` + `useAudienceResolve`); números reais a partir das `whatsapp_instances` conectadas (`instances-to-numbers.ts`, `isNew` por `created_at` < 14d); dispatch real via `useCreateBlastPlan` + `StepMonitor` com `useBlastPlanProgress`/`useBlastPlanControl` + Realtime em `blast_plans`/`blast_plan_recipients`; edição via edge `blast-plan-edit` (service_role, só `active`/`paused`, edita message/release_time — **audiência imutável**, ADR-0003).

- **Painel Acompanhar** (#910/#911, `99e2baed` + `a51cf3b7`): passo final vira painel real — card em andamento (lote X/N, barra, enviados/fila, próximo lote), **Pausar/Retomar + Cancelar** (com confirmação; já-enviados permanecem), relatório transparente (enviados / sem-WhatsApp / ignorados-recência / duplicados / leads criados) e nota do sino do CRM. Snapshot puro `monitor-progress.ts` (`monitorSnapshot`): deriva lote em voo, fila e % do plano, fail-closed sem `NaN`.

- **Nomes dos funis system** (`aa778812`): labels do seletor de funil alinhados ao glossário canônico — `pipe_whatsapp` = **Oportunidades**, `pipe_confirmacao` = **Agendamentos**, `pipe_propostas` = **Orçamentos** (era "Funil WhatsApp/Confirmação/Propostas"). Funis custom já vêm via `useCustomPipelines` no mesmo dropdown.

## Arquivos tocados

Frontend (módulo `campaigns`):
- `src/modules/campaigns/components/disparo-wizard/DisparoWizard.tsx` — **novo**, orquestrador do wizard linear.
- `.../disparo-wizard/{StepAudience,StepMessage,StepSpeed,StepMonitor,StepReview,StepHeader,WizardProgress}.tsx` — **novos**, passos + chrome.
- `.../disparo-wizard/wizard-machine.ts` — **novo**, máquina de estados do fluxo.
- `.../disparo-wizard/{AudienceBySpreadsheet,AudienceByStage}.tsx` — **novos**, fontes de audiência (planilha | etapa).
- `.../disparo-wizard/spreadsheet-parse.ts` — **novo**, parser CSV puro.
- `.../disparo-wizard/{message-preview,speed-safety,monitor-progress,audience-resolve,instances-to-numbers}.ts` — **novos**, helpers puros (preview, anti-ban, snapshot, audiência, números).
- `src/modules/campaigns/lib/blast-planning.ts` — **novo**, twin frontend parity-pinned ao core Deno.
- `src/modules/campaigns/pages/{DisparosPanel,NovoDisparo}.tsx` — porta canônica + entrada do wizard; `MassSend.tsx` **removido**.
- `src/modules/campaigns/components/BlastPlanCard.tsx` — controles + dialog de edição.
- `src/modules/campaigns/hooks/{useDisparoPlanilhaCreate,useAudienceResolve,useBlastPlans}.ts` — hooks de criação/resolução/controle.
- `src/modules/platform/components/layout/TopNavigation.tsx` + `src/App.tsx` — promoção do item topbar + rotas `/disparos`, `/disparos/novo`.

Backend (edge + shared):
- `supabase/functions/disparo-planilha-create/index.ts` — **novo**, ingest da planilha (upsert + cria leads).
- `supabase/functions/blast-plan-edit/index.ts` — **novo**, edição de plano ativo/pausado.
- `supabase/functions/{blast-plan-create,blast-plan-release,quick-blast-create}/index.ts` — multi-número + janela + cap per-número.
- `supabase/functions/_shared/quick-blast/spreadsheet-upsert.ts` — **novo**, `partitionSpreadsheet`.
- `supabase/functions/_shared/quick-blast/{blast-plan-distribution,instance-budget}.ts` — **novos**, distribuição round-robin + orçamento por instância; `blast-plan.ts` estendido.
- `supabase/config.toml` — registro de `disparo-planilha-create` e `blast-plan-edit`.

Migrations (gated p/ prod):
- `supabase/migrations/20270102000000_add_disparo_planilha_origin.sql` — adiciona `disparo_planilha` ao enum `lead_origin`.
- `supabase/migrations/20270103000000_blast_instance_daily_usage.sql` — tabela `blast_instance_daily_usage` + RPC `increment_instance_daily_usage` + `whatsapp_instances.daily_blast_cap` + `blast_plan_recipients.instance_id` + `blast_plans.window_*`.

Testes: `blast-planning-twin`, `disparo-wizard`, `disparo-csv-parse`, `spreadsheet-upsert`, `message-preview`, `speed-safety`, `monitor-progress`, `disparo-audience-resolve`, `disparo-instances-to-numbers`, `blast-plan-distribution`, `blast-plan-multinumber` (todas verdes; build Rollup verde nos commits).

## Decisões

- **ADR-0014 — fonte planilha sem role gate** (referenciado nos commits `71b961b8`/`61b9f660`; ADR ainda não versionado em `docs/adr/`): upload de planilha cria leads (`origem disparo_planilha`) e **nunca sobrescreve** dados de lead matched (só preenche campo vazio); org server-side, writes `service_role`, sem `campaigns.view`.
- **ADR-0015 — teto anti-ban per-número + multi-número** (referenciado em `2d2662ec`/`5f427dd1`; ADR ainda não versionado): ledger **por instância** (`blast_instance_daily_usage`) coexiste com o ledger org-wide do [[2026-06-05-blast-plans|ADR-0003]]; cap default 80/número/dia, zona segura ≤80, número novo auto-clampado; migration **aditiva** (colunas nullable, fallback single-number).
- **Audiência imutável após criação** (ADR-0003, `a51cf3b7`): `blast-plan-edit` só toca message/release_time — a membership do plano permanece congelada.
- **Disparos é item primário e aberto a todo membro** (#904): removido o gate `campaigns.view` na rota; a porta única substitui a antiga `MassSend`.
- **Twin frontend parity-pinned** (#904): os módulos de planejamento são portados para TS de frontend mas mantidos em paridade testada com o core Deno, em vez de reimplementados.

## Follow-ups

- **GATED p/ prod**: aplicar as migrations `20270102000000` (enum `lead_origin`) e `20270103000000` (`blast_instance_daily_usage`/RPC/colunas) + deploy das edge functions (`disparo-planilha-create`, `blast-plan-edit`, `blast-plan-create`, `blast-plan-release`, `quick-blast-create`) — só com aval explícito (DDL prod). Frontend chega em prod pelo caminho main→ghcr `:latest`→EasyPanel após `develop` → `main`.
- Composer ainda usa lead amostra mock onde o público real não está resolvido (samples reais vêm de #902 já parcialmente ligado).
- `StepMonitor`: `sentTotal`/relatório derivam do plano (mock parcial) até o feed de dispatch ao vivo amadurecer — TODO #910.
- Formalizar **ADR-0014** e **ADR-0015** como notas em `04 — Decisões` / `docs/adr/` (hoje só citados nos commits).
