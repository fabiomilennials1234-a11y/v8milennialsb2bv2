# STATE — contratos cross-componente vivos

> Estado técnico dos boundaries que mais de um componente depende. Atualizar ao mudar contrato.

## Métricas Montáveis — Camada 2 (#1194 / ADR-0023) — fundação DB

Status: **construído, atrás de flag, pgTAP pendente de run local** (2026-07-23). v1 liga só a TV.

### Flag de rollout
- `organizations.composable_metrics_enabled boolean NOT NULL DEFAULT false`.
- Helper `fn_composable_metrics_enabled(org uuid) → boolean`.
- Gate: escrita de composição (trigger + publish) e leitura de snapshot. Motor `fn_metric_measure` NÃO é gated (é leitor puro; a exposição é gated pelo snapshot/UI).

### Catálogo fechado (read-only, deny-all write)
- Tabelas: `metric_catalog_measures`, `_recortes`, `_formats`, `_measure_recortes`, `_measure_formats`, `_ratios`.
- 7 medidas: `receita, num_vendas, leads_criados, reunioes_marcadas, reunioes_realizadas, leads_na_etapa, tempo_medio_etapa`.
- 10 recortes: `total, closer, sdr, origem, tag, produto, stream, pipeline, etapa, tempo`.
- Compatibilidade medida×recorte declarada em `_measure_recortes` — par ausente = sem query = rejeitado na escrita.
- 3 presets de razão: `conversao (num_vendas/leads_criados)`, `comparecimento (reunioes_realizadas/reunioes_marcadas)`, `ticket_medio (receita/num_vendas)`.
- Servido por `fn_metric_catalog() → jsonb` (global, sem org).

### Motor
- `fn_metric_measure(p_org_id uuid, p_measure_ref jsonb, p_recorte text, p_period text DEFAULT 'month', p_ref date, p_start date, p_end date, p_filters jsonb DEFAULT '{}') → jsonb`.
- `p_measure_ref`: `{"kind":"leaf","id":"receita"}` | `{"kind":"ratio","num":"num_vendas","den":"leads_criados"}`.
- `p_period`: `day|week|month|range` (vocabulário de `metric_period_bounds`).
- `p_filters` allowlist: `pipeline_id, member_id, origin, tag_id, product_id, stream`. NUNCA `organization_id`.
- Retorno leaf: `{measure_id, unit, currency, anchor, recorte, value, series, empty_reason, kind, provenance}`.
- Retorno ratio: `{kind:'ratio', unit, currency, anchor, value, series:null, num:{...}, den:{...}, empty_reason, provenance}`. `den 0|null → value null`.
- Unit da razão: `count/count→percent`, `currency/count→currency`, senão `ratio`.
- INVARIANTE: ZERO EXECUTE no motor (grep CI + gate revisor). Filtros LIGADOS.
- `assert_org_access(p_org_id)` é a 1ª instrução (bloqueia cross-org).

### Composição (config validada na escrita)
- `dashboard_pages(id, organization_id, surface tv|command, title, position, rotation_seconds, draft jsonb, ...)` — RLS org-scoped, escrita admin-only.
- `dashboard_widgets(... measure_kind leaf|ratio, measure_id|num_measure_id|den_measure_id → catálogo FK, recorte_id, format_id, filters, weight hero|primary|secondary, eyebrow_override ≤28, ...)`.
- Validação na escrita: FK (catálogo) + CHECK (enums, eyebrow, coerência leaf/ratio) + trigger `validate_widget_against_catalog` (recorte/format compatíveis, filters só allowlist e sem org_id, máx 1 hero/página, teto 12/página, gate de flag).
- `draft jsonb` = staging do Composer (Vitral); não passa por FK enquanto rascunho.

### Leitura em lote (TV)
- `fn_dashboard_snapshot(p_org_id, p_page_id, p_period, p_ref, p_start, p_end) → jsonb` = `{disabled, page_id, widgets[]}`. 1 fetch/página, teto 12, erro isolado por widget (`{widget_id, error:'unavailable'}`), gate de flag (`disabled:true` se OFF).

### Publish atômico
- `fn_publish_dashboard_page(p_org_id, p_page_id) → jsonb` = `{published, page_id}`. Lê `dashboard_pages.draft.widgets[]`, valida cada um (trigger), swap `DELETE`+`INSERT` numa transação → atômico (inválido reverte, parede anterior sobrevive). Gate: admin/master + flag.

### Hooks (frontend)
- `useMetricCatalog()`, `useMetricMeasure({measureRef, recorte, period, filters, ...})`, `useDashboardSnapshot({pageId, period, pollMs=30_000})` em `@/modules/analytics`. v1 liga só a TV via snapshot.

### Aterramento (colunas reais)
- receita/num_vendas → `sale_events` (event_type='sale', líquido de estorno, `sold_at <@ bounds`). closer=`sale_responsible_id`, sdr=`pre_sale_responsible_id`, stream=`revenue_stream`.
- leads_criados → `leads` `COALESCE(metrics_period_at, created_at)`, `deleted_at IS NULL`.
- reunioes → `meeting_events` (`meeting_booked` por occurred_at; `meeting_held` por COALESCE(meeting_date, occurred_at)).
- leads_na_etapa → `pipeline_entries` abertas (snapshot).
- tempo_medio_etapa → `pipeline_stage_events` dwell desde a última transição (snapshot).

### Comissão/carteira
- Motor só lê. `receita` recortável por `stream` → comissão nunca inclui carteira em silêncio. Projeção segue OFF p/ producer=carteira (ADR).

---

## Casca da TV montável (#1207) — grid, WidgetFrame, painel semeado

Status: **construído, atrás de flag, pgTAP 19/19 + unit 21/21 verdes** (2026-07-24). Worktree `feat/tv-shell-1207`.

### Célula legada reservada
- `metric_catalog_renderers(id, label, description, is_legacy, sort)` — read-only, RLS, deny-all de escrita. Semeada com `legacy:closer-performance` e `legacy:thermometer`.
- `dashboard_widgets.renderer_id text` → **FK** para o catálogo de renderers (fronteira declarativa, mesmo mecanismo do #1194 — não allowlist em trigger).
- `measure_kind` agora `leaf|ratio|legacy`. `recorte_id`/`format_id` viraram NULLABLE; `kind_coherence` é o único guardião e declara os 3 ramos explicitamente + `ELSE false`.
- `renderer_id` é NULL em leaf/ratio (simetria: sem isso o snapshot ficaria ambíguo).
- `fn_dashboard_snapshot` emite a célula legada com `measure: null` — **não chama `fn_metric_measure`**. Payload ganhou `measure_kind`, `renderer_id`, `recorte_id`, `filters`.
- `fn_metric_catalog()` passou a servir `renderers` (o Composer filtra por `is_legacy` para não oferecer célula reservada como composível).

### Semeadura
- `fn_seed_default_dashboard(p_org_id) → jsonb` — `SECURITY DEFINER`, `assert_org_access` 1ª instrução, gate de flag, **idempotente** (org com painel de TV não é tocada).
- Gatilhos: trigger no **flip da flag** (`organizations.composable_metrics_enabled` false→true) + backfill por migration. **Nunca lazy-on-read.**
- Semeia 2 páginas (§8.4.6): "Fechamento" (8 widgets) e "Time e topo de funil" (9 widgets). Os 2 pinned legados entram em CADA página — 20 de 72 células, 28% permanente.
- ⚠ **A derivação por quiz não roda**: `org_onboarding` não existe em prod, então `generateTVConfig` sempre devolve `DEFAULT_CONFIG`. O seed reproduz a composição padrão. `tv-config-from-quiz.ts` está `@deprecated`.

### Frontend
- `WidgetFrame` (eyebrow · valor de cabeça · corpo · faixa de proveniência) — o MESMO componente servirá TV e Comando.
- `ProvenanceLine` — faixa obrigatória em 100% dos widgets; degradação **medida em tempo de render** (ResizeObserver), ordem 4→3→abrevia 2→colapsa 1; a âncora nunca some.
- `TVGrid`/`TVGridCell` — 12×6, gap 20px, padding 24px, **sem rolagem**; fonte única de layout, inclusive `pinned`.
- `TVComposableWall` — consome `fn_dashboard_snapshot` (UMA chamada por atualização), aplica teto de densidade, isola erro por widget.
- `TVComposableShell` — `data-surface="tv"` + indicador de frescor (§5.4).
- Gate: `TVDashboardRouter` em `TVDashboard.tsx`. Flag OFF nem monta o caminho novo.
- Libs puras testadas: `tv-metric-format` (ausência = `—`, nunca 0), `tv-provenance`, `tv-density` (teto de 8 dispara por **tipografia**, não por célula).


## Documentos nos comentários do negócio — 2026-09-10

`DealCardComments.onComentar(texto, files?)` → `DealCardPanel` →
`useCreateLeadComment`. Até 5 × 20 MB; `pipelineEntryId` obrigatório para anexos.
`CommentAttachment` em `leads/lib/comment-attachments/files.ts` descreve
`path/name/size/type`. `lead_comments.attachments` é JSONB imutável após criação.
Download por callback mantém preview sem banco. Migration deve preceder frontend.

## UAZAPI — 2026-09-11, branch em homologação

`codex/uazapi-rebuild`: fronteira do provider normaliza mídia/menu/quotas e usa rotas documentadas. `getMessageLimits` admite current/limit null e sinal can_send_new_messages. Circuito por servidor/credencial/grupo. Estado e bloqueios em `.specs/uazapi-rebuild/STATE.md`. Sem rollout em produção.
## Navegação de funis — 2026-09-11

`pipelines.config.navigation.is_visible` guarda visibilidade explícita; ausente
significa visível. `pipelines.display_order` é fonte única de ordem.
`is_active` segue operacional. Importação histórica limitada ao pré-#2092;
leitura permanente agnóstica a tipo/slug. Detalhes e limitações de validação:
[correção de navegação](features/funis-unificacao/correcao-navegacao-2026-09-11.md).

## Clientes 360 dentro de Leads — 2026-09-16

`ClientPortfolio` apresenta o mockup aprovado; `ClientPortfolioSection` coordena
paginação, seleção e filtros. `client_portfolio_page` calcula o recorte inteiro
no banco sob RLS, antes da paginação: receita mensal do ledger, faixa e recompra.
Histórico usa `useClientPortfolioPurchases`; ações usam `LeadCardNewDeal` e
`useDealSheet` existentes. Migration `20271021000014` deve preceder frontend.
Contrato, rollout, testes e limitações de ambiente: `.specs/clientes-360.md`.


Homologação remota concluída em 16/09: carteira/360, RLS, paginação, criação de negócio e rollback aprovados em branch Supabase descartável, já excluída. Corrigidas colisão de canais Realtime e data prevista na lista. Evidências e limites: `.specs/clientes-360-homologacao.md`. Produção não alterada.


## WhatsApp ingress — preparação de ativação, 2026-09-24

Serviço continua desligado; produção mantém ingresso Edge. O ACK do serviço
passa a HTTP200 somente após commit da inbox. `INGRESS_ACCEPTING=false` com
`INGRESS_ENABLED=true` permite drenar trabalho já aceito sem novas admissões.
Replay estrito rejeita IDs/operações inválidos antes de escrever. Preflight puro
verifica todas as rotas locais/globais, sem alterar o fornecedor.

Estado histórico desta preparação: migration29 ainda não aplicada.
Atualização de implantação e testes abaixo. Economia adicional de tráfego
ainda não ativada.
Ver `services/whatsapp-ingress/README.md` e
`docs/operations/supabase-capacity-ingress-readiness-2026-09-24.md`.


### Proteção dos writers — 2026-09-24

Guarda por `UAZAPI_INGRESS_PROTECTED_INSTANCE_IDS`, vazia por padrão, impede
criação/reconfiguração de instância protegida antes de reserva ou escrita remota.
Proxy retorna conflito409; rebind registra skip sem afirmar verificação.
Env inválido falha fechado503. Não toca envio, leitura ou conexão.
Integração protege os pontos de escrita; lista não ativada nesta entrega.
Serviço ingress permanece desativado. SQL29 foi aplicada na etapa abaixo.


### Inbox em produção e recuperação — 2026-09-24

SQL29 aplicada em produção no ledger `20260924124643_whatsapp_ingress_durable_inbox`.
Inbox e contador vazios; RLS e RPCs restritas a service_role conferidos. Nenhuma
rota ou allowlist ativada. Não reaplicar pelo timestamp futuro do arquivo.

Imagem `torque-whatsapp-ingress:1498af879` construída no VPS; container temporário
desativado respondeu health200/ready503, encerrou com código0 e foi removido.
Ensaio com worker real, PGlite em disco e SIGKILL passou: recuperação após lease
real120s, FIFO e rejeição de token antigo. Handler de negócio é fixture; não
prova todos os efeitos do webhook nem retries/capacidade do fornecedor.

Acesso administrativo para configurar credenciais continua pendente. Piloto
TorqueSDR ainda sem tráfego. Evidências e próximos gates em
`docs/operations/supabase-capacity-ingress-pilot-2026-09-24.md`.

### Ingress: runtime real e queries — 2026-09-24

Credenciais conferidas; runtime em loopback validado com banco real e receipts
já lidos. Perfil do piloto com margem:50/50 concluídos na primeira tentativa,
p95 fila0,881s. Estresse concentrado:até11,725s; não extrapolar para todas as
instâncias. Reuso da leitura durável reduz uma consulta por receipt duplicado;
UPDATE atômico e conclusão comercial preservados. Testes canônicos PGlite novos.
Global desativado com URL vazia aceito estritamente pelo preflight.

Produção webhook114 recebeu patch mínimo já presente na main: reação de grupo
explicitamente não capturado deixa de falhar por alvo ausente.55 arquivos
verificados,54 dependências intactas. Ingress ainda não recebeu tráfego regular.
Teste temporário não recebeu eventos: reentrega segue inconclusiva. Rota,
container, proxy e credenciais remotas temporárias removidos; proteção temporária
dos writers retirada, rota original conferida. Evidências: `docs/operations/supabase-capacity-ingress-runtime-2026-09-24.md`.

Conferência final13:44UTC: inbox e contador zerados. Entre13:35–13:42UTC houve
falha transversal REST/Auth e timeout de funções; banco registra restart13:41:45,
não iniciado por este trabalho. SQL/REST recuperados, causa não determinada.


## Ponte Edge → inbox WhatsApp — 2026-09-24

Implementada, desligada por padrão; não implantada/ativada nesta fatia.
`WHATSAPP_EDGE_INBOX_ENABLED` e `WHATSAPP_EDGE_INBOX_INSTANCE_IDS` controlam
somente a composição Edge. `messages_update` de instância resolvida e autorizada
retorna ACK após admissão durável (ou exclusão explícita de grupo); erro nunca
retorna ao handler inline. Demais eventos/instâncias preservam caminho atual.
Worker usa factory sem ponte. Helper compartilhado reside dentro do pacote
Supabase; reexport do serviço preservado. Nenhuma migration nova.

Gate de ativação pendente: transição com único dono de efeitos, tratamento de
trabalho em voo/isolates antigos e recuperação antes do commit. Ponte não reduz
invocações Edge; não incluída como economia na meta 1,4M.


## Pausa de claims e bloqueio FIFO — 2026-09-24

SQL32 adiciona controle privado por instância, revisão CAS, snapshot sem payload
ou segredo e RPCs exclusivas de service_role. Pausa impede novos claims; enqueue
e conclusão continuam funcionando. Retomada recusa processing inclusive expirado.
Head dead_letter bloqueia eventos seguintes da mesma instância. Não há reset,
descarte ou replay automático. `scripts/whatsapp-ingress-handoff.mjs` faz ações
explícitas com credencial em arquivo privado e leitura posterior; não retenta
mutação incerta. Nenhum polling/cron novo. `/ready` não prova drenagem ou dono único.

Contrato operacional e limites: `docs/operations/whatsapp-ingress-worker-handoff.md`.
Troca com Edge antiga e recuperação pré-commit continuam gates separados; não
contar esta proteção como economia de invocações.


SQL32 aplicada em produção no ledger `20260924143904` (fonte
`20271021000032_whatsapp_ingress_worker_pause.sql`). Smoke transacional com
service_role desfeito integralmente: fila/controles/orçamento zerados. ACL e RLS
conferidos no alvo. Sem ativação de Edge, worker ou rota de fornecedor.
