# Relatório World-Class — Torque CRM

**Data:** 2026-07-07 · **Método:** 6 auditorias paralelas (frontend/UX, métricas, automações, configuração/onboarding, gap de features vs mercado, saúde de engenharia) + análise de 844 commits desde maio/2026.

---

## TL;DR — o diagnóstico em um parágrafo

O Torque não tem um problema de invenção — tem um problema de **conexão e governança**. Em todas as 6 auditorias, o mesmo padrão apareceu: **o mecanismo correto já existe no codebase, mas está desconectado, ilhado ou ignorado.** O event-sourcing correto existe (`meeting_events`) mas as vendas e o funil continuam em estado mutável. O dedup atômico de workflows existe no schema mas nunca é gravado. Os templates de agente/pipeline existem mas nada força o uso. O design system existe (118 variáveis CSS) mas há 549 cores hardcoded por cima. O checkout self-service existe mas não está versionado no repo. O wrapper de modal compartilhado existe e tem **1 uso** contra 103 modais artesanais. As sensações do time ("front sujo", "métricas quebram", "automações quebram", "difícil configurar") são todas sintomas dessa mesma causa-raiz. A velocidade dos últimos 2 meses (844 commits, ~14/dia) foi quase toda em features novas — Meta Ads, API pública, Disparos, Carteira ERP, mobile — com quase zero consolidação, e código novo já nasce reintroduzindo os problemas que a auditoria de métricas de 02/07 diagnosticou.

**Scorecard geral de engenharia: ~6.75/10.** Fortes: testes (478 arquivos, CI de 7 jobs bloqueantes, pgTAP de RLS), observabilidade (Sentry em 110/111 edge functions), diferencial de produto (IA conversacional + automação DAG + carteira/ERP que nenhum concorrente tem junto). Fracos: migrations/deploy drift (4/10), consistência de frontend, robustez de automações, autonomia de configuração.

---

## 1. Mudanças recentes (maio → julho 2026)

844 commits em ~2 meses. O que foi entregue:

| Frente | Entregas |
|---|---|
| **Meta Ads** | Leadgen polling, asset bindings, conversion signals de funil completo (CAPI), master binding tab |
| **API pública** | REST /api/v1 com keyset cursor, scopes, writes P2, OpenAPI + Postman docs |
| **Disparos/Mass send** | Wizard de audiência, Blast Plans (lotes multi-dia), Daily Blast Budget, cap por número (ADR-0015) |
| **Funil Oportunidades** | Merge Agendamentos+Orçamentos atrás de flag, meeting-confirmation, bridges automáticos |
| **Métricas** | ADR-0007 meeting_events (event-sourced), auditoria completa (24 findings), SP-0 quick wins |
| **Mobile web** | Bottom-sheets, kanban→lista, nav unificada (3 fatias) |
| **Workflows** | Node unificado Enviar Mensagem (8 tipos), auto-upgrade lazy, checklist nodes, copy/paste |
| **Carteira ERP** | Sync bidirecional TinyERP (push order/NFe + pull pedidos), health score, recompute de métricas |
| **Copilot** | PDF send trigger, fix áudio/mídia, entrega durável, quoted messages |
| **Modularização** | 14 BCs concluídos, ESLint boundaries em error, arch deepening 9.x |

Leitura: throughput excepcional pra um time de 1 CTO + 1 júnior + subagentes. Mas o ratio feature:consolidação está ~95:5, e é isso que gera a sensação de sistema frágil.

---

## 2. Frontend — por que parece "sujo e confuso" (com números)

819 arquivos .tsx. O design system existe e é bom; é sistematicamente contornado.

**Confuso (arquitetura de informação):**
- ~50 rotas de topo; menu com ~20 itens em `TopNavigation.tsx` (994 linhas)
- **Jargão racing opaco**: Combustível=Leads, Pilotos=Equipe, Pitstop=Config, Revisão=Follow-ups, Comando=Dashboard. Usuário novo não mapeia item→função
- Duas listas de navegação duplicadas (admin/não-admin) mantidas em dobro, ícone `Zap` usado em 2 itens diferentes
- Config geral: 1 página com ~15 abas de topo (28 TabsTrigger contando aninhadas)

**Sujo (inconsistência):**
- **549 cores hex hardcoded** + 101 classes Tailwind arbitrárias + 479 styles inline — apesar de 118 variáveis CSS existentes
- **103 arquivos** importam `Dialog` cru e montam modal próprio; o wrapper compartilhado `CreateNewModal` tem **1 uso**
- Detalhe de lead implementado de **8+ formas** (LeadDetailDialog + V1 + V2 vivas simultaneamente, Sheet, Focus, Modal 891 linhas, +variantes por módulo)
- 5 cards de lead independentes, 21 arquivos de KPI card sem base comum, 8 tabelas custom
- **28 arquivos >800 linhas** (ActionPanel 2.102, DisparoWizard 1.864, PipePropostas 1.672)
- Lixo commitado: 7 arquivos `" 2.tsx"` duplicados (um com 940 linhas), 3 diretórios `legacy/` vivos, 122 console.log, módulos `billing`/`integrations` vazios
- ErrorBoundary em apenas 12 arquivos → risco real de tela branca em páginas de 1.000+ linhas

---

## 3. Métricas — por que "quebram com facilidade"

A auditoria de 02/07 continua válida: **24 inconsistências, 6 causas-raiz, e só a Fase 0 (SP-0, 6 quick wins) foi executada.** As fundações (pipeline_stage_events, sale_events, etapas governadas, camada semântica, invariantes no CI) não existem.

**Pior: código pós-auditoria já reintroduziu as causas-raiz.**
- RPC `get_productivity_activity_by_seller` (03/07) usa `type='system'` (R3), COALESCE de chaves de atribuição (R5) e `sold_at` por fallback (R4) — cita `sale_events` em comentário, mas a tabela nunca foi criada
- Carteira ERP criou uma **segunda superfície de receita** com âncora própria (`sold_at`), soma `sale_value` sem conversão de moeda e nunca reconcilia com `pipe_propostas`

Estado atual das divergências centrais:
- "Reuniões realizadas": **2 fontes vivas na mesma tela de TV** (bloco usa `pipe_confirmacao.status`, KPI usa meeting_events via performance hooks)
- "Vendas/receita": **5+ âncoras temporais** diferentes (metrics_period_at/closed_at/created_at/sold_at/updated_at) conforme a tela
- Atribuição: comissão lê `sale_responsible_id` puro; pódio usa COALESCE de 3 chaves → venda aparece no pódio sem gerar comissão
- Timezone: dashboard calcula mês em UTC, filtros de analytics em horário local — venda na virada de mês cai em meses diferentes conforme a tela

`get_dashboard_metrics` já foi corrigida ~18×, `get_ranking_data` ~6× — cada fix reabre outra divergência porque não há lugar único de definição. **Caçar mais bugs não resolve; a spec de refundação (SP-1→SP-4) já existe e está parada.**

---

## 4. Automações — por que "quebram com facilidade"

Inventário: 16+ workers cron/pg_net, 11 webhooks de entrada, executor DAG de 1.103 linhas. O achado central espelha as métricas: **a infra de robustez existe mas está desconectada.**

Top fragilidades (com evidência):
1. **Dedup atômico MORTO**: migration criou `trigger_dedup_key` + índice único; `computeTriggerDedupKey` existe em `_shared/workflow-trigger-dedup.ts` — e **zero callers em produção**. Os inserts reais não preenchem a chave. A proteção contra o incidente que a motivou (workflow rodou 142× pra 78 leads) não está ativa
2. **Dedup real é TOCTOU**: read-then-insert em `workflow-trigger.ts:75-119`; cron 1min + pg_net concorrentes duplicam execuções
3. **Fan-out sem filtro**: trigger PG de field_changed dispara pra 8 campos em qualquer UPDATE de lead; validação só no worker → execuções-lixo marcadas "completed" com erro dentro
4. **Sem outbox**: pg_net engole falha com RAISE WARNING; se secret drifta ou edge dá timeout, automações param em silêncio
5. **Circuit breaker Uazapi é in-memory** (Map a nível de módulo) → morre a cada cold start de isolate; não protege nada cross-invocation
6. **Embeddings Gemini sem retry/backoff**: um 429 quebra RAG na hora
7. **Dois motores de copilot vivos** (legado pending_ai_actions + v2 queue) com políticas de retry divergentes — maior fonte estrutural de "quebra fácil"
8. **webhook_call falha e o fluxo continua** como se nada; periodic triggers com `limit(200)` (lead 201+ nunca dispara) e skip silencioso se RPC falta
9. **Retry manual não idempotente**: insere execução nova sem travar a original → mensagens dobradas
10. **3 políticas de retry diferentes** (executor 30s·3ⁿ, job-tracker [1,5,15]min, copilot-v2 exponencial 30-600s)

**O modelo a replicar já existe dentro de casa**: `copilot/queue-policy.ts` (backoff exponencial, MAX_ATTEMPTS, lease/reclaim) é o subsistema mais robusto do repo.

Observabilidade: boa pro master (Operations Center, dead letter, alerts), fraca pro usuário — não existe visão "o que falhou hoje e por quê" pra org, e falhas engolidas não geram rastro visível.

---

## 5. Configuração — por que "tudo é difícil de configurar"

1. **Copilot ativável quebrado**: criação sem validação nenhuma; ativação é flip de boolean puro. Agente vazio conversa com lead real respondendo genérico. Os 5 presets completos (`template-presets.ts`) existem e nada força usá-los. Não há gate de completude
2. **3 sistemas de onboarding**: um ativo bloqueante (OnboardingGate), um MORTO (~1.500 linhas de wizard sem rota), um checklist pós-onboarding — 3 fontes de verdade de "org configurada" que divergem. O gate bloqueante não tem "pular" e trava o admin no passo WhatsApp (o integrador mais instável do sistema), com polling que engole erro e spinner infinito sem timeout
3. **Provisionar cliente = ~7 passos manuais, 3 fora do produto** (org, plano, sync quotas esquecível, usuário, vínculo master-only, user_creation_key no banco, workflow n8n). E `checkout-provision-org`/`asaas-webhook` estão **declaradas no config.toml sem código no repo** — o coração da aquisição não é auditável
4. **Feature flags Master-only**: rollout flag = `UPDATE organizations SET feature_flags` na mão; gestor não liga nada sozinho; todo upgrade passa por 1 pessoa
5. **n8n 1-workflow-por-cliente**: 20+ workflows externos artesanais com regex de Trello. Regex quebra = leads perdidos em silêncio. A 100 clientes, 100 workflows. O `lead-webhook` genérico já suporta tudo — o conector por cliente é acidental, não essencial
6. **3 UIs de conectar WhatsApp** (onboarding ativo, wizard morto, settings) com comportamentos potencialmente diferentes

---

## 6. Gap de features vs mercado (Pipedrive, HubSpot, RD, Kommo)

**Onde o Torque já ganha** (nenhum concorrente tem o conjunto): agentes IA conversacionais + RAG, automação DAG visual com A/B split, SLA com escalation + round-robin, pós-venda/carteira com health score e ERP sync, gamificação/comissões, lead scoring automático.

**O buraco é o miolo transacional B2B** — o funil é forte até "agendado" e forte depois de "vendido"; entre proposta e assinatura, não há produto:

| # | Gap | Tipo |
|---|---|---|
| 1 | **Proposta como documento** (template → PDF/link rastreável com produtos/preços/condições) | Table stakes |
| 2 | **Empresa ↔ múltiplos contatos** (lead = pessoa/empresa fundidos; venda B2B tem comprador+gerente+dono) | Table stakes, **o mais caro de adiar** — mexe na tabela central e cada mês adiciona dados no modelo errado |
| 3 | **Mobile app / PWA** (nem manifest existe; vendedor externo vive no celular) | Table stakes |
| 4 | **Telefonia/click-to-call** (só call log manual) | Table stakes |
| 5 | **Assinatura eletrônica BR** (Autentique/ZapSign) — fecha o loop proposta→vendido→ERP | Diferencial |
| 6 | **E-mail real** (UI shell existe; sem backend de envio, tracking, sequências) | Table stakes |
| 7 | **Inbox omnichannel unificada** (WhatsApp + Meta em UIs separadas, sem fila/atribuição) | Diferencial |
| 8 | **Report builder ad-hoc** (33 charts fixos não respondem "vendas por região por produto") | Table stakes |
| 9 | **Forecast formal** (commit/best-case por vendedor vs quota; base já existe) | Diferencial |
| 10 | **API docs públicas + integrações self-service** (api_keys e webhooks existem sem portal) | Diferencial |

**Maior alavancagem**: #1 + #5 são uma feature só — "Proposta 2.0": catálogo → documento → link no WhatsApp → tracking de visualização → assinatura → pedido no TinyERP. Reusa ~70% do que já existe (products, variants, carteira, tinyerp-proxy) e ataca exatamente o ICP.

---

## 7. Saúde de engenharia — scorecard

| Dimensão | Nota | Evidência |
|---|---|---|
| Testes | 8.0 | 478 arquivos, coverage com gate real + ratchet, pgTAP RLS, e2e. Buraco: billing/checkout (código nem está no repo) |
| Error handling | 8.5 | Sentry front + 110/111 edge; ~0 catch vazio; falta ErrorBoundary por rota |
| CI | 8.0 | 7 jobs bloqueantes; só npm audit é best-effort |
| Tipos | 6.0 | strict total, mas 895 `any` no src + 486 no edge + baseline de erros congelados (`.tsc-baseline.json` 134KB) |
| Segurança | 6.0 | Sem secrets hardcoded, CORS allowlist, engine fail-closed; mas 86 funções `verify_jwt=false` e twin de permissão do front ainda permissivo (back é fail-closed, front não) |
| **Migrations/Deploy** | **4.0** | **598 migrations, 16 prefixos duplicados, 5 untracked no working tree, 3 contagens diferentes de edge functions (config.toml 84 × disco 111 × docs 96), billing deployado direto em prod sem código no repo, prod à frente do repo (migrations jan/2027 ausentes)** |

**O repo não é fonte-de-verdade confiável do estado de prod.** É o risco estrutural nº 1 — invalida qualquer garantia que testes e CI dão, porque o que roda não é o que está testado.

---

## 8. Roadmap para world-class

### Fase 0 — Estancar (dias, alto retorno imediato)

1. **Reconciliar repo↔prod** (pré-requisito de tudo): puxar migrations 2027 do prod, versionar checkout-provision-org/checkout-create-payment/asaas-webhook, commitar as 5 migrations untracked, proibir escrita direta em prod fora do fluxo git
2. **Ligar o dedup atômico de workflows** (código e schema já pagos — preencher `trigger_dedup_key` + ON CONFLICT DO NOTHING). Mata duplicação de execução na raiz
3. **Higiene de front em 1 dia**: deletar 7 arquivos `" 2"`, diretórios `legacy/`, LeadDetailDialogV1/V2 mortos, 122 console.log, módulos vazios; ErrorBoundary por rota; regra ESLint proibindo hex hardcoded e `bg-[#...]`
4. **Gate de ativação do Copilot**: validador de completude (business_context + prompt + instância vinculada) antes do `is_active=true`; criação força partir de um dos 5 presets
5. **Escape no onboarding**: "pular por agora" no passo WhatsApp + timeout/erro explícito no polling do QR
6. **Lint de métricas**: bloquear em review qualquer RPC nova com `type='system'`, COALESCE de atribuição ou âncora nova — pra parar de reintroduzir R3/R4/R5 antes das fundações

### Fase 1 — Fundações (semanas, mata as 3 dores estruturais)

7. **Retomar a refundação de métricas (SP-1→SP-4, spec pronta)**: `pipeline_stage_events` + `sale_events` espelhando meeting_events; flags governadas em `pipeline_stages` (is_won/is_lost/...); RPCs canônicas únicas; TV e comissão param de recalcular client-side; suite de invariantes de reconciliação no CI (`SUM(membro)==total`, Dashboard==Financeiro==Ranking)
8. **Robustez de automações**: outbox transacional (event-dispatcher já existe pra domain_events — generalizar); política de retry única (adotar queue-policy.ts como padrão); circuit breaker durável em tabela (rate_limits já existe) + retry/backoff em embeddings; webhook_call com aresta de erro explícita; deprecar copilot legado (1 motor só)
9. **Design system enforcement + kit compartilhado**: `<DataTable>`, `<DetailDrawer>`, `<KpiCard>`, `<EntityCard>` em shared/ e migração módulo a módulo; consolidar detalhe de lead em 1 componente; quebrar os 4 piores god components (ActionPanel, DisparoWizard, PipePropostas, CopilotPlayground)
10. **Navegação nova**: nomes literais (ou glossário racing opcional por org), 1 array declarativo único, reagrupamento por job-to-be-done. Ataca "confuso" na raiz por custo baixo
11. **Provisionamento 1-botão**: RPC `provision-org-complete` transacional (checkout-provision-org já é 80% disso) exposta no Master; onboarding unificado (matar wizard morto, 1 fonte de verdade)
12. **Zerar dívida de tipos progressivamente**: ratchet do baseline até baseline vazio; alinhar twin de permissão do front ao fail-closed do back

### Fase 2 — Produto (trimestre, fecha os gaps de mercado)

13. **Proposta 2.0** (gap #1+#5): catálogo → documento/PDF → link rastreável no WhatsApp → assinatura eletrônica → pedido TinyERP. Maior ROI de produto disponível
14. **Contas ↔ contatos** (gap #2): começar já pelo modelo de dados — cada mês de atraso encarece a migração
15. **PWA** (manifest + install prompt + push que já existe) antes de app nativo
16. **Ingestão nativa configurável**: conector Trello/Meta com mapa de campos na UI substitui os 20+ workflows n8n artesanais → onboarding self-service de verdade
17. **Inbox omnichannel + report builder + forecast formal** conforme tração

### Critério de sucesso

World-class não é "mais features" — é: **(a)** repo = fonte de verdade absoluta de prod; **(b)** cada métrica com exatamente 1 definição, verificada por invariante no CI; **(c)** cada automação idempotente, com retry uniforme e falha visível na UI; **(d)** cada tela usando os mesmos 5 componentes base e os tokens do design system; **(e)** cliente novo do checkout ao primeiro lead sem nenhum toque do time. Os cinco são mensuráveis; sugiro tratá-los como as 5 métricas do programa.

---

*Fontes: 6 auditorias multi-agente (2026-07-07), RELATORIO-AUDITORIA-METRICAS-2026-07-02.md, docs/superpowers/specs/2026-07-02-metrics-foundation-design.md, memórias de sessão (drift repo↔prod).*
