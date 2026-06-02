# Copilot v2 — Plano Definitivo de Implementação

**Criado:** 2026-06-02 · **Tipo:** Plano de execução merged · **Owner:** CTO (Gabriel) + arquiteto + engenheiro
**Funde:** [ADR-0002](../../../docs/adr/0002-copilot-v2-architecture.md) (decisões imutáveis) + [SPEC.md](./SPEC.md) (slices) + [PROGRESS.md](./PROGRESS.md) (estado vivo) + **Auditoria do Copilot 2026-06-02** (73 findings verificados adversarialmente)
**Objetivo:** Levar o copilot-v2 de *deployado-mas-inerte* a **motor único, totalmente funcional e em produção 100% do tráfego**, com a v1 decomissionada.

> Este doc é o **plano de execução autoritativo**. Decisões de arquitetura permanecem no ADR-0002 (imutável). O SPEC.md vira referência histórica de slices; este plano supersede o SPEC como fonte de ordem/escopo de execução, dobrando os gaps da auditoria e os 2 requisitos net-new do CTO.

---

## 0. Regras de implementação (inegociáveis)

- **Branch discipline:** todo trabalho em `feat/copilot-v2/slice-<N>-<nome>` saindo de **`develop`**, PR **para `develop`**. **Nunca direto na `main`.**
- **Deploy:** só no projeto **dev** (`bcfadphgsibjzivtbjvc`) durante o desenvolvimento. **Cutover em produção (Slice 12) exige autorização explícita do CTO na sessão.**
- **Pipeline de handoff:** `arquiteto` (sanity-check + arquitetura + cria branch) → `design` e/ou `engenheiro` → `arquiteto` (commit + push + abre PR pra develop) → CTO revisa.
- **TDD obrigatório:** cada incidente de produção vira invariante + teste de regressão no eval dataset (condição vinculante do ADR decisão #2). Sem regressão, o rewrite re-sangra bugs já pagos.
- **QA literal:** reportar counts numéricos do runner (vitest/lint/build), nunca "all green" parafraseado.
- **Migrations:** **NUNCA `supabase db push`** (prod tem drift — 8 migrations remote-only). Aplicar migration isolada via **MCP `apply_migration`**.
- **Multi-tenant:** `organization_id` SEMPRE do ctx/auth/instância, NUNCA do payload/LLM. RLS deny-all default. Seção de Segurança obrigatória nos slices marcados 🔒.
- **Fail-mode:** pausa/loop/dedup/rate-limit **fail-CLOSED**.

---

## 1. Decisão & escopo (recap — detalhe no ADR-0002)

Três gerações coexistem hoje: GEN-1 `agent-message` (viva, god-class 3000+ linhas), GEN-2 `_shared/copilot/*` (dead code), GEN-3 `_shared/copilot-v2/*` (limpa, deployada, **0% tráfego**). **Decisão: GEN-3 (v2) é o motor definitivo.** Clean-slate (não porta v1 — incidentes viram regressão). Três arquétipos fixos. v1 + dead code deletados ao final.

### Emenda ao ADR-0002 (2026-06-02) — Áudio outbound
ADR decisões #5/#12 fixam a send-media library em `image|video`. **Emenda:** estender para **`audio` (ptt)**. Justificativa: requisito do CTO de envios consistentes de "fotos, áudios e vídeos"; a v1 já envia áudio (pool de áudios do agente), então não suportar áudio no v2 seria regressão funcional. Escopo: tipo `audio` na biblioteca send-media (Slice 6) + handler no `send_media` (Slice 3). Mantém o princípio do envio estruturado+gate — áudio não é freeform.

---

## 2. Estado atual (baseline — PROGRESS 2026-05-31 + auditoria)

| Camada | Estado |
|---|---|
| Slices **0, 1, 2, 3 (parcial), 4, 10** | ✅ mergeados em develop. 133 testes TDD verdes, 17 módulos `_shared/copilot-v2/`. |
| Runtime | ✅ vivo em prod mas **inerte**: `agent-runtime-v2` (border) + `copilot-v2-worker` (cron 1/min). Agente Qualificador Milennials `is_active=FALSE`. Nenhuma instância Uazapi apontada. |
| Tools | **9/13 implementadas.** 🔴 4 `not_implemented` (gating honesto, sem NOOP): `send_media`, `search_knowledge`, `schedule_meeting`, `handoff_to_vendedor`. |
| Tabelas em prod | `copilot_v2_*` foundation + slices 4/6/7 tables (rubric, send_media, agent_media, knowledge, chunks pgvector 1536d). RLS deny-all. |
| Falta | Slices **5, 6, 7, 8, 9, 11, 12** + W1–W15 + **gaps da auditoria** (§3). |

Confirmação cruzada: o finding de auditoria #36/#47 ("v2 deployado, zero tráfego, cron drena fila vazia") = estado **intencional**, não bug. Concorda com PROGRESS.

---

## 3. Gaps da auditoria dobrados neste plano (rastreabilidade)

7 gaps net-new verificados adversarialmente contra o código + 2 requisitos do CTO. Cada um aterrissa num slice:

| # | Gap (finding) | Severidade | Aterrissa em |
|---|---|---|---|
| #3 | Loop-gate inerte: `sendReply` nunca registra `outbound` na fila → detectIdenticalBurst/pingpong nunca disparam | Alta | **Slice 1-H** |
| #19/#69 | `message-debounce` (coalesce de fragmentos) nunca plugado na border | Média/cost | **Slice 1-H** |
| #49 | Worker não re-checa human-pause/loop no envio (só na borda) → fila durável + retry permite bot responder conversa que humano já pegou | Média (segurança) | **Slice 1-H** |
| #22 | `claim` bumpa `attempts` no claim (não na falha) + sem reaper de rows travadas em `processing` → 3 blips dead-letteram msg válida | Média | **Slice 1-H** |
| #21 | dedup + enqueue não-atômicos → crash entre os dois perde a mensagem silenciosamente | Média | **Slice 1-H** |
| #50/#51 | `configByArchetype` joga 1 config nas 3 chaves; `_agentId` via cast untyped (foot-guns latentes) | Baixa | **Slice 1-H** |
| #52 | Capabilities hardcoded `true` (`capsFor`) → capability-gate não barra nada | Baixa (vira alta ao ativar) | **Slice 1-H** (gate lê config) + **Slice 8** (UI) |
| NET-NEW | **Áudio outbound** não modelado (`copilot_v2_send_media` é `image\|video`) | Requisito CTO | **Slice 3 + Slice 6** (+ emenda ADR §1) |
| NET-NEW | **Notificação ao responsável** (pessoa) via WhatsApp dele + roteamento por role | Requisito CTO | **Slice 5** |

Gaps da v1 que o v2 elimina por construção (não precisam de slice próprio — o rewrite limpo já resolve): double-send de outbound/followups (#7/#8/#9 → claim idempotente Slice 11), CRUD não-transacional (#35 → save transacional Slice 8), prompt-builder divergente (#30/#31 → 1 builder de slots), gate de ativação morto (#29 → validação real Slice 8), métricas fake (#66 → métricas reais), RPCs RAG sem org-scope (#40/#41 → Slice 7).

---

## 4. Modelo de arquétipos + migração v1→arquétipo

Três arquétipos fixos, Torque-owned, prompt imutável, roteamento determinístico por `get_contact_status(phone)` + stage:

| Arquétipo | Quem atende | Modelo | Roteia de |
|---|---|---|---|
| **Qualificador** | leads novos/frios (ads, formulário, 1º contato) | Gemini Flash-class | NOVO / LEAD_NO_PIPELINE |
| **Vendedor** | leads qualificados (proposta, negociação, fechamento) | Claude Sonnet-class | QUALIFIED |
| **Carteira** | clientes que já compram (recompra, upsell, resgate) | Gemini Flash-class | CLIENTE_CARTEIRA |

Handoff `qualificador → vendedor` via `handoff_to_vendedor`. Carteira trabalha por **segmento** (ouro/prata/novo/resgate/dormindo), nunca por qualification tier.

**Migração dos tipos v1 (no Slice 12):**

| Tipo v1 | Vira |
|---|---|
| qualificador, sdr, prospectador | **Qualificador** (arquétipo) |
| (vendas/fechamento) | **Vendedor** |
| pós-venda/upsell | **Carteira** |
| agendador | capability `schedule_meeting` (qualquer arquétipo) |
| followup | capability de cadência (Slice 11) |
| custom | mapeado caso-a-caso pelo CTO no re-preenchimento do wizard |

---

## 5. Plano de slices (definitivo)

Cada slice: branch `feat/copilot-v2/slice-N-<nome>` ← `develop`, PR → `develop`. 🔒 = seção de Segurança obrigatória.

### Fase A — Hardening da fundação (bloqueia qualquer ativação)

#### Slice 0-C — Limpeza de dead code + flag inerte 🔒(leve)
*Independente, baixo risco — pode rodar já, em paralelo.*
- **Escopo:** deletar dead code GEN-2 (#4 agent-router, #23 lead-profile-builder, #5/#68 knowledge-retriever, #38 prompt-builder/llm-client skeletons, #55 followup.ts, #54 followup-response-detector, #71 sanitizer facade). Remover flag inerte `organizations.copilot_engine_version` (#37) + o botão enganoso "Ativar v2" em `MasterAutomationHealth.tsx`.
- **Handoff:** design (remover UI enganosa) → engenheiro (deleção + ajustar testes que ancoram os mortos).
- **Exit:** grep confirma zero importadores dos deletados; build/lint/tsc verdes; testes ancorados removidos/retargetados. Counts literais.

#### Slice 1-H — Harness Hardening (auditoria 2026-06-02) 🔒
*Pré-requisito duro: nenhuma org ativa antes disto.*
- **Escopo:**
  - Loop-gate: `sendReply` registra `outbound` em `copilot_v2_message_queue` (#3) — sem isso o detector nunca dispara.
  - Plugar `message-debounce.coalesceFragments` antes do enqueue na border (#19/#69) — 1 turno LLM por burst.
  - Worker re-checa `human-pause` + loop no momento do envio, não só na borda (#49) — fail-closed real com fila durável.
  - Claim RPC: bumpar `attempts` só em falha real; **reaper/visibility-timeout** que devolve rows travadas em `processing` a `retry` (#22).
  - Colapsar dedup+enqueue num caminho atômico (ON CONFLICT do enqueue como primitivo único de dedup) (#21).
  - `resolveContext`: keyar `configByArchetype`/`capabilitiesByArchetype` só pelo arquétipo resolvido (#51); `_agentId` vira campo de 1ª classe em `ResolvedContext` (#50).
  - **Capability-gate lê config real por agente** de `copilot_v2_config` (mata `capsFor` hardcoded `true`, #52). UI de config é Slice 8; aqui o gate passa a respeitar o que existir (default = nada habilitado, fail-closed).
- **Touches:** `border.ts`, `copilot-v2-worker/index.ts`, `queue-processor.ts`, `capability-gate.ts`, `cognition-worker.ts` (ResolvedContext), migrations (claim RPC + reaper, dedup RPC).
- **Handoff:** engenheiro (DB + edge + tests + segurança).
- **Exit:** suíte de regressão verde — loop detectado em cenário prod-like; pausa criada mid-fila bloqueia o envio; crash de worker pós-claim não dead-lettera msg válida (reaper devolve); 2 workers concorrentes não duplicam; gate bloqueia write com capability off + loga. Counts literais.
- 🔒 multi-tenant, fail-closed, PII em pause state.

### Fase B — Capabilities core (caminho de 1 org a produção)

#### Slice 3 (completar) — Catálogo de tools: writes restantes + mídia 🔒
- **Escopo:** implementar os 4 handlers `not_implemented` + áudio:
  - `send_media`: resolve item de `copilot_v2_send_media` → delega ao adapter WhatsApp (`whatsapp-client`). Suporta `image|video|**audio(ptt)`** [emenda §1]. Gate antes do envio (já-enviou? momento certo?). **Fallback explícito sem silent-drop** quando o asset está indisponível/não-ready (lição do incidente VitrineVET, onde o v1 dropava a directive de mídia em silêncio).
  - **Detecção/normalização de media-type única** (helper MIME centralizado) — consistência cross-tipo (mata a heurística multi-camada do v1 send_document).
  - `handoff_to_vendedor`: reassign + dispara notificação (usa a infra do Slice 5).
  - `schedule_meeting` + `check_agenda_availability`: via Google Calendar adapter (`src/modules/integrations`), com write-after-introspect (`check_agenda_availability` antes do `schedule_meeting`) → grava `pipe_confirmacao`.
  - `search_knowledge`: handler que consulta `copilot_v2_knowledge_chunks` (depende Slice 7 popular os chunks).
- **Handoff:** design (UX do tool/gatilho estruturado no wizard) → engenheiro.
- **Exit:** cada arquétipo envia cada tipo (foto/áudio/vídeo/doc) de forma consistente no dev; write em stage/campo inexistente → bloqueado pelo introspect-guard; agendamento cria `pipe_confirmacao`.
- 🔒 multi-tenant (org do ctx), envio de mídia (storage signed URL), Calendar OAuth.

#### Slice 5 — Guardrails cumulativos + notificação de handoff (definitiva) 🔒
- **Escopo:**
  - 5 gates: capability-gate (formalizado), tool-call budget (5/turno), loop-detector (exposto como gate), **output LLM-as-judge** (modelo barato veta preço/promessa/credencial/tom antes do envio — possivelmente amostrado por custo), **input short-circuit** (spam/abuso/concorrente → resposta padrão sem gastar LLM).
  - HITL: toggle por org (default off) — aprovar/editar/rejeitar antes de ação crítica em lead alto valor.
  - **`transfer_to_human` → notificação confiável, estruturada e idempotente:**
    - **In-app:** insere em `notifications` → entrega **realtime** (canal + toast + sino `AlertsDropdown`), não polling. Destino: **responsável do lead** (role-aware: `responsible_id` → fallback `closer_id`/`sdr_id` → fallback time ativo da org).
    - **WhatsApp ao responsável (pessoa):** novo `team_members.phone` (opt-in) + roteamento por role; mantém `handoff_notify_phones` legado p/ grupos. **NET-NEW (requisito CTO).**
    - Conteúdo estruturado: lead / tier / motivo / resumo / deeplink.
    - Idempotência por chave estável (não time-bucket frágil do v1 #26); entrega por caminho confiável (claim idempotente, não o worker bugado v1 #7/#9).
- **Touches:** migration `team_members.phone` + `notifications`, RPC de fan-out org-scoped, canal realtime, `build-tools` (schema do `transfer_to_human`), `tool-executor` (`transfer_to_human`/`handoff_to_vendedor`).
- **Handoff:** design (UX: sino/toast + config phone/role/opt-in) → engenheiro (DB + RPC + realtime + segurança PII).
- **Exit:** lead movido pra humano → responsável recebe in-app realtime **e** WhatsApp no dev; judge bloqueia resposta com promessa proibida; short-circuit não chama LLM; HITL on pausa + pede aprovação; entrega idempotente (sem duplicar notificação).
- 🔒 PII (telefone do membro), multi-tenant (fan-out só dentro da org), estado de conversa.

#### Slice 6 — Acervos separados: send-media (incl. áudio) + knowledge base 🔒
- **Escopo (SPEC #6 + emenda áudio):**
  - **Send-media library:** `image|video|audio(ptt)` [emenda], org-level, `{arquivo, o que é, gatilho estruturado, nuance}`, seleção + gatilho por arquétipo. Enviado cru via `send_media` + gate. Rever o cap "≤5" pra acomodar áudio (ex.: ≤5 por tipo, ou ≤8 total — decisão de produto no design).
  - **Knowledge base:** separada, org-level, `image|video|doc|pdf` → ingerida (Slice 7), nunca enviada crua.
  - **Migração conceitual:** não reaproveitar a conflação `copilot_agent_documents` da v1.
- **Handoff:** design (biblioteca UI: upload, gatilho, preview) → engenheiro.
- **Exit:** mídia (incl. áudio) dispara só no gatilho certo; KB nunca enviada crua; trocar catálogo na org reflete nos 3 arquétipos.
- 🔒 storage org-scoped, validação MIME.

#### Slice 7 — Ingestão + RAG + auditoria de mídia inbound 🔒
- **Escopo (SPEC #7 + auditoria inbound):**
  - Ingestão media→texto: doc/pdf extrai+chunk; imagem OCR/caption; vídeo transcrição → embed pgvector → `search_knowledge`.
  - Hybrid search (semântico + keyword) + reranking + **threshold centralizado** (consolidar — a v1 tinha 3 divergentes: rag 0.6, search-knowledge 0.55, retriever 0.5).
  - RPCs `match_*` **org-scoped** (#40/#41 — adicionar predicate `organization_id`, não confiar só no agent_id).
  - **Inbound border media→texto auditado:** validar `OPENROUTER_API_KEY` no entry; retry + telemetria na transcrição (sem fallback silencioso que esconde credencial faltando); **fix doc travado em `processing`** (timeout guard + transição de status determinística).
  - Falha de embedding/RAG **não-silenciosa** (trace).
- **Handoff:** engenheiro.
- **Exit:** PDF de catálogo responde à spec; imagem de ficha técnica vira texto buscável; doc nunca trava em processing; falha de embedding aparece no trace; RPC cross-org bloqueada (teste RLS).
- 🔒 RPC org-scope, custo de ingestão.

#### Slice 8 — Contrato de config / wizard (+ capability config real) 🔒
- **Escopo (SPEC #8 + #52 + mata #29/#30/#31/#35 da v1):**
  - Wizard por arquétipo: 12 seções, **slots tipados** (dropdown/número/lista/texto-curto-guiado). **Sem edição do prompt.**
  - **Capability config real por agente** → alimenta o capability-gate da Slice 1-H (mata #52).
  - Escape-hatch único ≤500 char por arquétipo → **LLM-linter** rejeita conflito/PII/jailbreak antes de salvar.
  - **Save transacional** (RPC único, sem órfão de mídia/doc — mata #35 da v1).
  - **Validação de ativação real** (não o gate morto #29 da v1).
  - **Um** prompt-builder (slots → base imutável), sem a divergência de 2 builders #30/#31 da v1.
- **Handoff:** design (superfície de autoria — grande) → engenheiro.
- **Exit:** operador cria + ativa arquétipo com validação real; escape-hatch malicioso rejeitado; nenhum campo free-text além do escape-hatch; caps configuradas refletem no gate; save sem órfão (round-trip sem perda).
- 🔒 escape-hatch = superfície de injeção (linter + cap + sanitização).

#### Slice 9 — Simulador dry-run + eval-suite
- **Escopo (SPEC #9):** chat ao vivo no fim do wizard (operador digita como lead; agente usa base real + config; tools renderizadas como "IRIA executar", zero escrita; trace exibido). Botão "rodar eval-suite" do arquétipo → verde/vermelho.
- **Handoff:** design (UI simulador + trace) → engenheiro.
- **Exit:** dry-run não muta dados; eval-suite mostra pass/fail por caso; trace legível (tool, por quê, tier).

#### Slice 11 — Proatividade / scheduler 🔒
- **Escopo (SPEC #11 + mata #7/#8/#9 da v1):** first-touch (ad lead via lead-webhook → Qualificador manda 1ª msg), followup agendado (lead frio reengaja na cadência), resgate Carteira (cliente dormindo). Scheduler pg_cron → edge, respeitando horário + rate-limit. **Claim idempotente + UNIQUE constraints** (mata o double-send da v1 #7/#8/#9). Massa fria fica em `campaigns` (não duplicar).
- **Handoff:** engenheiro.
- **Exit:** ad lead recebe first-touch; followup dispara na janela sem duplicar; resgate só pra dormindo; sem colisão com campaigns.
- 🔒 rate-limit, idempotência, multi-tenant.

#### Slice 10 — Tracing + eval dataset (transversal, em andamento)
- **Escopo (SPEC #10):** `trace_id` borda→queue→cognição→tools→saída; sessões por conversa/lead; eval dataset (incidente→caso); runner roda suíte a cada mudança de base prompt. (CI gate = W13.)
- **Exit:** 1 turno = 1 trace correlacionável; mudar base prompt + rodar suíte detecta regressão introduzida de propósito.

---

### ⛳ PORTÃO DE PRODUÇÃO (Milennials 100% v2)

Antes de migrar a 1ª org real, **todos** verdes:
- [ ] Slices 0-C, 1-H, 3, 5, 6, 7, 8, 9, 11, 10 mergeados em develop, testes com counts literais.
- [ ] Guardrails W must-have: **W4** (realismo de entrega), **W10** (teto de custo + kill-switch), **W12** (red-team gate), **W13** (eval CI regression). Ver Fase C.
- [ ] Suíte de regressão dos 5 incidentes v1 verde (human-pause phone-keyed, Bertin loop, dedup race, increment_turn race, is_group).
- [ ] RLS cross-org testada por tabela (admin/membro/master).
- [ ] Dogfood Milennials: dry-run + 1ª conversa real validada por trace.

### Fase C — Rollout + decommission

#### Slice 12 — Rollout org-a-org + decommission v1 🔒 **(prod = CTO-gated)**
- **Escopo (SPEC #12 + cutover da auditoria):**
  - Routing flag por org no `whatsapp-webhook` (v1 legado | v2 definitivo) — rollback = flip de volta.
  - Milennials-first → org-a-org: CTO re-preenche wizard novo (pré-preencher do v1 onde mapeável, ver §4), testa dry-run, flipa `is_active`.
  - v1 coexiste até a última org migrar.
  - **Decommission final:** DELETAR GEN-1 (`agent-message` + `_shared/copilot/*`) + fila v1 (`copilot_message_queue`, `copilot-batch-processor`) + qualquer dead code/flag restante.
- **Handoff:** arquiteto (orquestra migração) → engenheiro (deleção + testes finais).
- **Exit:** Milennials 100% v2 com traces saudáveis antes da 2ª org; org-a-org; ao final GEN-1 deletada — **um motor**.
- 🔒 migração de dados, multi-tenant, rollback.

### Fase D — Hardening world-class (W1–W15)

Todos no ADR addendum. **Must-have pré-produção** (no portão): **W4, W10, W12, W13**. Restante = melhoria contínua pós-launch, priorizável.

| W | Tema | Pré-prod? | Dep |
|---|---|---|---|
| W4 | Realismo de entrega (split natural, typing, latência, guard de duplicado) | **SIM** | Slice 1-H |
| W10 | Governança de custo + kill-switch UX (teto/org/dia, degradação graciosa, auto-pausa) | **SIM** | Slice 1-H, 9 |
| W12 | Red-team release gate (injeção/exfil/jailbreak/over-promise) | **SIM** | W13 |
| W13 | Industrialização do eval (regressão em CI, judge→dataset) | **SIM** | Slice 10 |
| W2 | Gestão de contexto (compactação com piso de fatos + extração background) | recomendado | Slice 1-H, W1 |
| W8 | Defer-safety (confiança por turno + idioma/fora-de-escopo → handoff) | recomendado | Slice 8, 9 |
| W1 | Lead Fact Memory | pós | Slice 1-H |
| W3 | Sinais→ação (buying-intent + frustração + cadência adaptativa) | pós | Slice 4, 9 |
| W5 | Toolkit comercial (build_quote, pricing, payment_terms) | pós | Slice 3, 11 |
| W6 | Inteligência de Carteira (reorder forecast + gatilho proativo) | pós | Slice 10, W15 |
| W7 | Grounding (spec Q&A + gate de claims fundamentadas) | pós | Slice 5, 9 |
| W9 | Ledger de ações + undo 1-clique | pós | Slice 2 |
| W11 | Linter de brand-voice/política | pós | Slice 9 |
| W14 | Copilot como nó de workflow | pós | Slice 8, 11 |
| W15 | Legibilidade do agente (ActivityTimeline + funil por arquétipo) | pós | Slice 1, 2 |

(A/B variants por agente: **dropado** — ver ADR addendum.)

---

## 6. Ordem de dependência & paralelismo

```
0-C  ─┐ (independente, já)
1-H  ─┴─► [pré-req duro de tudo]
         ├─► 3 ──┐
         ├─► 5    │
         ├─► 6 ───┤
         ├─► 7 ───┤  (3,5,6,7 paralelos após 1-H)
         └─► 11   │
                  ▼
              8 (config/wizard — integra 1-H,3,5,6,7)
                  ▼
              9 (simulador — usa 8)
                  ▼
         [W4,W10,W12,W13]  ◄── must-have
                  ▼
            ⛳ PORTÃO PROD
                  ▼
              12 (rollout + decommission)  ◄── CTO-gated
```
Slice 10 (tracing) é transversal — continua durante tudo. Slice 4 (rubric) já feito.

---

## 7. Definition of Done (produção)

- [ ] 100% do tráfego inbound roteado pro v2; `agent-runtime-v2` recebe de instâncias Uazapi reais.
- [ ] 3 arquétipos funcionais (qualificador/vendedor/carteira) com handoff entre eles.
- [ ] Mídia consistente: foto/áudio/vídeo/doc enviáveis (send_media + gate) e recebíveis (inbound→texto auditado).
- [ ] Handoff humano notifica o responsável (in-app realtime + WhatsApp) de forma idempotente.
- [ ] Guardrails ativos (5 gates + W4/W10/W12/W13).
- [ ] Trace ponta-a-ponta + eval-suite em CI bloqueando regressão.
- [ ] GEN-1 + GEN-2 + flags mortas **deletadas**.
- [ ] Rollback documentado (flag por org).

---

## 8. Riscos & rollback

- **Cutover na flow mais frágil** → flag por org + paridade antes de deletar GEN-1; rollback = flip flag.
- **Rewrite re-sangra incidente** → suíte de regressão é dependência dura (ADR #2), não opcional.
- **v2 incompleto vira tráfego** → portão de produção é gate explícito; nenhuma org migra antes dele.
- **Custo/latência do LLM-judge por turno** → modelo barato + amostragem (W10).
- **Branch discipline** → tudo em develop; prod só Slice 12 com CTO.

---

## 9. Apêndice — Rastreabilidade auditoria → slice

| Slice | Findings de auditoria endereçados |
|---|---|
| 0-C | #4, #5, #23, #37, #38, #54, #55, #68, #69, #71 |
| 1-H | #3, #19/#69, #21, #22, #49, #50, #51, #52 |
| 3 | #6 (sanitizer v2 / fallback mídia), net-new áudio |
| 5 | #26 (idempotência), net-new notificação responsável; mata #7/#9 nesse caminho |
| 7 | #40, #41, inbound audit (doc travado em processing) |
| 8 | #29, #30, #31, #35, #52 (UI), #66 |
| 11 | #7, #8, #9 (double-send via claim idempotente) |
| 12 | #36/#47 (ativação), decommission GEN-1/GEN-2 |
