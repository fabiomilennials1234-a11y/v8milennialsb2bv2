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


## Tickets de execução Edge — 2026-09-24

SQL33 prepara gate privado inline/queued com revisão CAS e tickets de execução
sem expiração. Admissão inline registra ticket antes dos efeitos; queued grava
na inbox antes do ACK. Worker só avança com gate queued e nenhum ticket. Mudar
para inline exige tickets e trabalho não concluído zerados. Pausa/FIFO continuam.
Até64 tickets por instância; erro ou resultado incerto exige reconciliação.

`WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS` vazio por padrão. Somente messages_update
autenticados da instância resolvida entram. Conclusão acompanha a promise real,
inclusive após timeout HTTP12s. Modo instrumentado exige validação estrita;
falha não libera ticket nem cai silenciosamente no processamento antigo.

Sem ativação nesta entrega. Gate não cobre isolates antigos não instrumentados.
A documentação Uazapi não estabelece recuperação completa pré-commit: buffer
de erros em memória e histórico de mensagens não são diário durável de eventos.
Ponte Edge ainda consome invocações; nenhuma economia nova contabilizada.
Contrato: `docs/operations/whatsapp-ingress-worker-handoff.md`.


SQL33 aplicada em produção no ledger real `20260924151218`; arquivo-fonte
`20271021000033_whatsapp_edge_execution_gate.sql`. Smoke com service_role validou
admissão, revisão, tenant, ticket bloqueando claim, quitação e reabertura; ROLLBACK
removeu todos os dados de teste. Gates/tickets/fila/controles zerados, grants e
RLS conferidos. Edge instrumentada não implantada; nenhuma instância habilitada.
Validação:140 unit direcionados,3 SQL; build/Deno/ratchet TS passaram.151 falhas
unit herdadas permanecem; regressão strictfalse corrigida e rerodada. Lint mantém
cinco avisos anteriores de quotes. Revisão independente GPT-6 Sol concluída.


## Webhook live atualizado — 2026-09-24

Versão119 implantada com patch mínimo sobre118.53 arquivos anteriores intactos;
index delega updates ao módulo canônico novo, quotes recebe propagação estrita
de falhas; V2 preserva campos extras.56 arquivos publicados conferidos byte a byte.
Status não regride com receipt atrasado; reação repetida não incrementa contagem;
falhas de persistência não viram sucesso. Alvos ausentes continuam permissivos
no caminho live. Nenhuma rota/flag/worker ativado; economia Edge adicional zero.

Validação:89 testes direcionados+16 do bundle real, build/TS e Deno do módulo
passaram.151 falhas unit e5 avisos lint anteriores permanecem. Gate operacional
refinado: retry Uazapi não bloqueia absolutamente piloto na MESMA URL Edge;
continua risco preexistente, com novas rejeições da fila a controlar. Próximo
bloqueio concreto: TorqueSDR teve7 logs de receipts sem alvo em24h; worker estrito
pode travar FIFO nesses casos. Definir desfecho auditado antes de ativar.
Evidências e sequência: `docs/operations/whatsapp-live-update-parity-2026-09-24.md`.


## Desfecho de receipts e estado do piloto — 2026-09-24

SQL34 (`20271021000034_whatsapp_ingress_completion_outcome.sql`) consta no ledger
de produção `20260924155231`. A migration prepara desfecho auditável para
receipts sem alvo e lane de adiamento: recibo ainda dentro de cinco minutos
pode aguardar sem segurar o fluxo regular da instância; após esse prazo, o
resultado sem alvo fica registrado. Claims preservam pausa, ticket e bloqueio
por dead letter regular. Esta aplicação de schema não ativa processamento.

No estado validado nesta atualização, worker permanece pausado, rota do
fornecedor inalterada e piloto Edge → inbox ainda não ativo. Não atribuir
economia Edge à migration nem inferir merge/deploy final do código do piloto.

### Atualização operacional — piloto ligado em24/09/2026 às16:04 UTC

TorqueSDR `messages_update` agora passa pela Edge v121 para inbox e worker único
na VPS. Gate queued/revision2; worker retomado/revision2; provider/URL inalterados.
Recibo controlado de mensagem já lida:200, processed em1,84s, uma tentativa,
sem erro; nenhuma mensagem enviada. SQL34 ledger20260924155231;58 arquivos live
conferidos.149 testes direcionados e quatro integrações SQL aprovados; suíte
completa13.780 aprovados e151 falhas idênticas às anteriores.

**Rota direta VPS ainda desligada; economia Edge desta ponte=zero.** Documentação
Uazapi declara que messages_update não repete entrega HTTP malsucedida. Falta
recuperação/reconciliação testada antes da migração direta. Estado anterior de
piloto desligado registra preparação; esta entrada supersede esse estado.
Procedimento/readbacks: `docs/operations/whatsapp-edge-to-inbox-pilot.md`.


## Recuperação parcial de recibos — 2026-09-24

SQL35 aplicado em produção (ledger `20260924163948`). Estado/cursor e lacunas
privados, lease de dois minutos, página de 50 mensagens outgoing conhecidas na
janela fixa de sete dias. RPC admite somente avanço confirmado entregue/lida;
worker usa origem confiável da fila para impedir efeitos comerciais e limitar
alvo a ID exato/chat/org/instância. Payload externo não concede esse privilégio.

Recuperação não recompõe eventos de edição/exclusão/reação/pin, nem eventos
perdidos antes da persistência. Rota direta permanece bloqueada; ponte Edge
atual não economiza invocações. Flags e evidência operacional atualizada:
`docs/operations/whatsapp-receipt-recovery-2026-09-24.md`.

Ativação: imagem `recovery-20260924-v3`, worker único, pausa retomada/revision4.
Recuperação ligada só TorqueSDR; primeira página finalizada às16:45:09UTC:50
verificadas,0 correções confirmadas,9 inconclusivas persistidas,0 erros. Cursor
avançou/lease liberada; demais páginas pendentes.194 testes direcionados e
integração SQL aprovados. Provider e Edge v121 inalterados; rota direta OFF.

Ciclo automático confirmado às16:49:34UTC: mais50 mensagens,11 estados de leitura
recuperados,8 inconclusivas,0 erros.11 eventos completed/processed,1 tentativa;
11 alvos exatos conferidos. Total parcial:100 verificadas,11 reparadas,17 lacunas.
PR2178 merge `d28871396`;198 testes direcionados +3 integrações SQL aprovados.
GitHub Actions não iniciou por cobrança/limite da conta. Rota direta permanece
OFF; economia de invocações desta recuperação=zero.


## FileDownloaded FIFO barrier repaired — 2026-09-24

TorqueSDR's FileDownloaded head failed strict validation eight times, blocking
61 pending updates while the process remained alive. SQL36 (production ledger
20260924185213) and worker notification-20260924-v2 add a strict observed-shape
provider_notification outcome and one-shot audited replay, preserving payload
and order. Claims paused at revision 5 and resumed at revision 6.
The dead letter completed as a notification; pending and new natural traffic
drained. Readback: 109 normal processed, 23 recovery processed, one notification,
zero noncompleted events. New /worker-health and Docker probe detect blocked or
aged queues independently of direct admission. Healthy with zero restarts;
179 focused unit tests and three SQL integrations passed. Provider and Edge v121
remain unchanged; direct routing remains off. Remaining activation gates:
`docs/operations/whatsapp-direct-route-next-gates-2026-09-24.md`.
