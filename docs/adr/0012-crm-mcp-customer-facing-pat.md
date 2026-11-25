# crm-mcp — MCP customer-facing (BYO-AI) com PAT per-user, RLS-puro

**Status:** accepted (2026-06-25)
**Relacionado:** `docs/adr/0011-torque-mcp-internal-ops-server.md` (cenário A; este é o cenário B que a 0011 adiou), `.specs/features/crm-mcp/DESIGN.md` (spec detalhada), `supabase/functions/_shared/mcp/` (espinha C1).

## Context

A 0011 entregou o `torque-mcp` (MCP interno de ops, ops-master cross-org) e **adiou o cenário B** (customer-facing) por amplificar a ferida multi-tenant aberta (vazamento anon ~60k registros; master-ghost recorrente em 5+ classes; RLS some em rebuild). A C1 extraiu a espinha auth-agnóstica para `_shared/mcp/`. O `crm-mcp` é o cenário B: cada cliente Torque pluga o próprio LLM nos próprios dados de CRM, sobre Streamable HTTP, autenticado por um Personal Access Token (PAT) emitido no CRM. O caller agora é um **tenant real** — um único bug de RLS aqui é vazamento cross-tenant de PII, não o sintoma benigno "master vê vazio".

## Decisões

1. **Função separada, RLS-pura per-user.** `supabase/functions/crm-mcp/` reusa a espinha (`dispatch`/`http`/`registry`/`crypto`/`redact`/`types`); troca **só** a auth. Um PAT resolve para `(user_id, organization_id)`; a fn minta um JWT de usuário e roda toda query como aquele usuário — **RLS ON, nunca master, nunca service_role, nunca BYPASSRLS**. `loadConfig` **falha o boot** se qualquer secret de ops (`SUPABASE_SERVICE_ROLE_KEY`/`MCP_MASTER_*`/`MCP_GATEWAY_SECRET`) estiver presente no env (assert-absent — vira invariante testada, não convenção).

2. **Mint de JWT self-signed com chave ES256 DEDICADA** (não o legacy/`service_role` secret do projeto). A fn carrega só a chave privada de assinatura, escopada a `aud:authenticated`; vazá-la forja qualquer *usuário*, **não** `service_role`. `role`/`aud` são literais não-parametrizáveis; **nenhuma claim `organization_id`** é mintada (a org viaja só no `ToolContext`). TTL **hard-cap 60s** (teto de propagação de revogação). Um mint malformado **falha fechado** antes de construir qualquer client (`assertWellFormedJwt`) — nunca cai pro role `anon`. **Rejeitado:** assinar com o legacy secret (= dar `service_role` a uma fn customer-facing); `generateLink`+`verifyOtp` (sessão GoTrue real, pesada — fica como fallback se a forja-de-usuário precisar ser estruturalmente eliminada, R1).

3. **PAT de usuário master é RECUSADO no resolve.** Como toda policy master-ghost é `is_master_user(auth.uid())`, mintar para um uid de master tornaria o endpoint de cliente um leitor cross-org. O resolve rejeita (403) qualquer uid em `master_users`, a cada request. Operações de master ficam no `torque-mcp`.

4. **Resolver hermético `crm_mcp_resolve_token`.** Roda **pré-auth** (não há JWT de usuário ainda) via o client anon-key da fn. É `SECURITY DEFINER`, devolve **só** identidade para um match exato de `token_hash` (nunca `SELECT *`), **vazio no miss** (não distingue not-found de revoked → sem oráculo), e dobra `is_master(user_id)` + `current_org_ids` ativos para a fn decidir elegibilidade em TS puro num único round-trip. A 0011/DESIGN previa "revoke from anon" — **resolvido aqui** a favor de "executável por anon + hermético": anon é o único role pré-sessão disponível, e o contrato hermético (mais 178 bits de entropia inquebráveis) é a parede; possuir o token é a única forma de resolvê-lo.

5. **Allowlist positiva de tools, fail-closed.** A espinha ganhou `ToolDef.customerExposed?` + `DispatchContext.toolFilter?` (não-breaking; torque-mcp inalterado). O crm-mcp passa `(t) => t.readonly && t.customerExposed` e **não importa** os tools de ops — dupla barreira (imports ausentes no bundle + filtro runtime). Tool readonly sem `customerExposed` é invisível por default.

6. **Defense-in-depth (camada 3, load-bearing).** Todo handler de cliente, **além** da RLS: ignora `org_id` de argumento (usa o do token; arg divergente → erro), e aplica `.eq("organization_id", token.org_id)` explícito. É a barreira que conteria uma regressão de RLS (a classe master-ghost/`is_team_member` é precedente **vivo**). Normalize de telefone é feito **em TS** (`lib/phone.ts`), nunca via `db.rpc` no user client — a lista de exceções definer no `ctx.db` é **vazia** (anti-bypass).

7. **Escopo C2 (esta entrega):** migration (`personal_access_tokens` + RLS + trigger de imutabilidade + RPC resolver), `lib/{config,pat,phone}.ts`, `crm-mcp/index.ts`, espinha estendida, tracer `lead.get` customer-scoped, e a suíte de unit + o anchor de integração do resolver/RLS. **Read-only duro** (sem tools mutating de cliente). UI de PAT (criar/listar/revogar), rate limit e lifecycle ficam para C3–C5.

## Consequências

- **Blast radius de um PAT vazado:** um tenant, ≤ a visão RLS do usuário que mintou (varia de uma fatia por responsabilidade a org-wide se o criador for admin) — **nunca** master, nunca a plataforma. Revoke do PAT mata no próximo resolve; um JWT em voo vive ≤60s (R2, aceito).
- **Residual R1:** quem tiver code-exec na fn ou a chave de assinatura forja qualquer *usuário* (não `service_role`). Inerente ao self-mint; ES256 dedicada reduz o acoplamento ao crown-jewel. Eliminação total = `generateLink`+`verifyOtp` (vetável).
- **Pré-requisito de deploy:** o projeto alvo precisa **confiar na chave pública ES256** do crm-mcp (JWT signing keys do Supabase) para a RLS honrar os JWTs mintados; secrets `CRM_MCP_JWT_SIGNING_KEY`/`CRM_MCP_JWT_KID` (+ `CRM_MCP_PAT_PEPPER` opcional) setados; canary round-trip valida no boot. Default **dev**; prod só com OK explícito.
- **`is_master_user` em `search_path`:** já pinado pela `20261227000000` (dinâmica, dev+prod, `unpinned=0`); C2 re-confirma em prod como guard antes do ship (não bloqueador).
- **Espinha agora serve dois callers** (ops-master e tenant) — o `toolFilter`/`customerExposed` mantêm o torque-mcp idêntico enquanto o crm-mcp estreita a superfície.

---

## Emenda 2026-11-23 — v1 (C2 fechada + C3 + C4 + C5), medida numa preview

A C2 de 2026-06-25 foi mesclada mas **nunca rodou em lugar nenhum**: a migration ficou arquivada sem aplicar, a UI (#890) ficou órfã numa branch empilhada, e o boot recusaria subir em qualquer projeto Supabase (item 1 abaixo). Esta emenda registra o que mudou ao levar o v1 até um ambiente real. Tudo foi medido na preview `qa-studio-pgtap-permanente`. O dev `bcfadphgsibjzivtbjvc` está aposentado e com o serviço restrito (`402 exceed_db_size_quota`).

1. **Decisão 1, assert-absent, e decisão 3, "namespace de secrets separado", corrigidas.** No Supabase, os secrets de edge são do **projeto inteiro**. Medido duas vezes:
   - a plataforma injeta `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_DB_URL` em toda função, e o runtime ignora `Deno.env.delete` (preview: boot 503 no estágio `scrub`);
   - em produção, os secrets do torque-mcp (`MCP_MASTER_*`, `MCP_GATEWAY_SECRET`) chegam ao crm-mcp. A trava da C2 recusou o boot no primeiro deploy (503, estágio `config`).
   Não existe namespace por função nessa plataforma. A garantia passou a ser de código: o boot tenta tirar esses valores do isolate e registra o que ficou; nenhum módulo do crm-mcp ou da create-pat os nomeia (teste de invariante de fonte em `lib/config.test.ts`, com controle negativo); nenhum client é construído com eles. Um namespace de verdade exigiria outro projeto Supabase.
2. **Decisão 2 e residual R1, raio de dano da chave corrigido.** Uma chave em que o projeto confia valida **qualquer** claim `role`, inclusive `service_role`. A frase "forja qualquer usuário, não service_role" estava errada: vazar `CRM_MCP_JWT_SIGNING_KEY` equivale a vazar a service_role.
   - O que a chave dedicada ainda compra é isolamento: ela vive só no env do crm-mcp e é revogável na hora (`PATCH .../signing-keys/{kid} {status: revoked}`) sem tocar na chave que assina as sessões dos usuários.
   - Alternativa estrutural continua descartada: `generateLink`+`verifyOtp` exigiria service_role dentro da função.
3. **Confiança da chave (pré-requisito de deploy), medido.**
   - Chave ES256 importada em `standby` **ou** `previously_used` é aceita pelo PostgREST. O controle sem importar dá 401 `PGRST301`.
   - Usamos `previously_used`: só verificação, e uma rotação feita no painel nunca a promove a chave de sessão.
   - Só existe **um** `standby` por projeto. Criar um segundo dá 422 sem rebaixar o existente.
   - Em prod o `standby` é o HS256 legado, que antes precisa ir para `previously_used`. Ele continua verificando: a chave anon legada funciona com o HS256 em `previously_used` na preview. Sequência no runbook `docs/runbooks/crm-mcp-prod.md`.
   - O JWK que a API exige (`key_ops: ["sign","verify"]`) é recusado pelo WebCrypto ao importar a chave privada. A função reduz o JWK aos parâmetros da curva (`toSigningJwk`).
4. **Decisão 4 substituída: o resolver não é mais chamável por anon.** O único caminho token → identidade é `crm_mcp_authenticate`, executável só pelo papel `crm_mcp_resolver`.
   - O papel é NOLOGIN, sem BYPASSRLS, e não lê tabela nenhuma.
   - Só é alcançável por um JWT de 30 s assinado pelo próprio crm-mcp.
   - Navegador não chega nele: anon e authenticated não têm EXECUTE, e o INV-6 (folga zero) não muda.
   - Medido: troca de papel 200, o papel lendo `leads` dá 403, usuário logado chamando o resolver dá erro.
5. **Limite de uso, `last_used_at` e registro de recusas ficam dentro do resolver.** Um round-trip, e só quem tem o token consome o balde dele. Uma RPC separada chamável por authenticated deixaria um usuário esgotar o balde de outro.
   - Limites: 120 por minuto por token, 600 por minuto por org, 20 000 por dia por org. Ao estourar: 429 com `Retry-After`.
   - Token estourado não consome o balde da org.
   - Token revogado que continua chegando fica registrado em `crm_mcp_auth_denials`, que é sinal de vazamento.
6. **Emissão.** Só o dono insere. Admin e master leem e revogam, mas não emitem: inserir com `user_id` alheio seria virar aquele usuário.
   - Gestor de portfólio não emite (é principal cross-org).
   - O banco impõe por conta própria: escopo só `read`; validade de até 366 dias; revogação de mão única com carimbo e motivo do servidor; teto de 10 ativos; hash ilegível pelo navegador (grant por coluna).
   - Pepper não é usado: um token de ~178 bits não tem pré-imagem a proteger, e o pepper só acoplaria um segredo a duas funções. O suporte opcional fica.
7. **Ciclo de vida (C5).**
   - Desligar ou apagar o membro revoga os tokens dele na org (`offboarding`).
   - 90 dias sem uso revoga (`auto_unused`).
   - Faxina diária via pg_cron às 06:17 UTC.
   - Desligar a flag `crm_mcp` corta todos os tokens da org na próxima chamada.
8. **Read pack (C3).** `lead.get`, `lead.list` (busca, funil/etapa, datas, cursor), `pipeline.list`, `stage.list`, `conversation.get` e `whatsapp.instance_status`.
   - Toda tabela tocada usa o `get_my_organization_ids()` plural, então token da segunda org de um usuário multi-org funciona.
   - Toda query leva `.eq(organization_id)` do token.
   - Nenhuma `.rpc` no client do usuário (teste de fonte e de execução).
   - Todas as tools anunciam `readOnlyHint`.
   - O status de WhatsApp nunca seleciona `provider_config`, `qr_code` nem `metadata`.
9. **Fora do v1 (C6):** OAuth 2.1 (conectores do claude.ai web e do ChatGPT), token de serviço por org e escopo de escrita.

**Evidência:**
- pgTAP `supabase/tests/crm_mcp_tokens_test.sql`: 59/59. O controle negativo (policy de INSERT sem checagem e master liberado) reprova 9.
- Canary HTTP na preview: 31/31. Cobre emissão, protocolo, mesmo telefone em duas orgs, MCP igual ao app para membro e admin, flag, revogação, hash e resolver.
- Invariantes de RLS: zero violações dos objetos novos em INV-1/2/3/4/6.
- Deno: crm-mcp, create-pat, espinha e torque-mcp verdes.

---

## Emenda 2026-11-23 (2) — fatia 1 do v2: métricas e a allowlist de RPC

**Regra nova (substitui a decisão 6, "zero `.rpc` no client do usuário").** A tela de Métricas do app usa um motor SECURITY DEFINER (`fn_metric_measure`). Proibir toda RPC deixaria o MCP de fora dele, ou empurraria para uma cópia do cálculo, que diverge. A regra passa a ser uma **allowlist** em `crm-mcp/tools/rpc.ts`. Entra uma função só se as três condições valerem:
- o app já a chama com a mesma sessão do usuário;
- sendo DEFINER, ela autoriza o chamador antes de qualquer outra coisa (`assert_org_access`, `auth.uid()`);
- o MCP passa sempre a org do token.

A lista fica fixada em teste (`tools.test.ts`). Cada portão é provado no banco real (`supabase/tests/crm_mcp_rpc_allowlist_test.sql`): org alheia recusada, segunda org de um multi-org aceita, permissão respondida pela org pedida. Hoje a lista tem `fn_metric_catalog` (INVOKER), `fn_metric_measure` (DEFINER com `assert_org_access`) e `has_feature_permission(text, uuid)`, sempre na forma de dois argumentos. A de um argumento resolve a "primeira org" e erra para quem é multi-org.

**Ferramentas.**
- `metrics.catalog`: o catálogo do Estúdio de Métricas mais o CAC derivado.
- `metrics.query`: até 8 métricas; períodos `today`, `week`, `month`, `quarter`, `year` e `range` no fuso da org; comparação com o período anterior; recortes do catálogo; filtros da allowlist do motor.

**Permissão.** O app checa `metrics.view` só no navegador. Aqui ela é checada no servidor, por org.

**CAC.** O motor não tem CAC. O MCP calcula: investimento cadastrado em Métricas › Marketing (`mkt_origin_config`, por origem e mês, rateado pelos dias do período) ÷ `num_vendas` do motor. O gasto do Meta Ads não fica guardado no Torque e não entra. Sem investimento, ou sem venda, o valor é `null` com `empty_reason`, nunca zero.

**Evidência (preview):** pgTAP da allowlist 12/12; canary 12/12, com `leads_criados` e `receita` iguais aos do motor chamado com a sessão do usuário, CAC indisponível com motivo e membro sem `metrics.view` barrado; Deno 55/55 no crm-mcp.

---

## Emenda 2026-11-23 (3) — fatia 2 do v2: a IA organiza o funil (primeira escrita)

Esta emenda revoga a D11 ("v1 só leitura") para escopos explícitos. A escrita chega com uma fundação comum (`20280124013300_crm_mcp_escrita.sql`), que as fatias 3 e 4 reusam.

1. **Escopos no token:** `read`, que é sempre incluído, mais `crm:write`, `messages:send` e `automations:write`. Só entra escopo que a pessoa já pode exercer no app:
   - `crm:write` exige a permissão `pipeline.move_cards`;
   - `automations:write` exige `workflows.create`;
   - `messages:send` é só para admin da org (Disparos não tem chave própria);
   - todos exigem a flag `crm_mcp_write` na org, além de `crm_mcp`.
   A regra é aplicada na emissão (policy) e de novo a cada plano e a cada confirmação. O resolver de permissão (`_crm_mcp_member_feature`) segue a mesma ordem de `has_feature_permission`: override do membro, padrão da org, padrão da chave.
2. **Plano de uso único:** toda escrita é `plan` → `confirm`. O plano fica em `crm_mcp_actions`, gravado por funções que só o papel `crm_mcp_resolver` executa e amarrado ao hash do token. A confirmação só manda o id; aplica o que o servidor validou, uma vez, em até 5 minutos, para o mesmo token e com o escopo ainda válido.
3. **Auditoria:** a mesma tabela é a trilha. Quem agiu, o admin da org e o master leem. O navegador não escreve nela.
4. **Ferramentas:**
   - `funnel.review`: lote com etapas e regras, cards, dias na etapa e o fim da conversa.
   - `deal.move.plan`: valida as regras de etapa (ganho pode exigir valor, perda exige motivo), lista as automações e o WhatsApp automático que disparam, e guarda o plano.
   - `deal.move.confirm`: aplica por `mover_negocio`, a mesma escrita do app, da API e dos gatilhos, rodando como o usuário; pula card que mudou desde o plano; grava `lead_history` com `source='agent'` e o motivo.
   - `deal.move.undo`: em 24 h, devolve o que ainda está onde a IA pôs. Automação e mensagem já disparadas não voltam, e a ferramenta diz isso.
5. **Allowlist de RPC:** ganha `mover_negocio`, que é INVOKER.
6. **Annotations:** `plan` é não-destrutivo; `confirm` e `undo` são `destructiveHint`, então o cliente pede OK ao humano.

**Evidência (preview, `mover_negocio` real):**
- pgTAP da fundação 26/26: escopo na emissão, uso único, outro token não confirma, plano vencido, permissão retirada depois do plano, flag desligada, trilha não forjável.
- Allowlist 13/13.
- Canary do funil 15/15. Regressão: v1 31/31 e métricas 12/12.

---

## Emenda 2026-11-23 (4) — fatia 3 do v2: disparo pela IA

**Decisão:** o MCP não reimplementa disparo. Ele entrega o plano ao **motor de Disparos do app** (`blast-plan-create`), chamando a função **como o usuário**, com o JWT de 60 s da requisição. Medido: o GoTrue aceita esse JWT (`/auth/v1/user` → 200). Assim valem os mesmos limites diários (org e número), o espaçamento anti-ban e a janela da tela de Disparos. Status e cancelamento passam por `blast_plans` (RLS) e `blast-plan-control`. O teste para o próprio celular usa `whatsapp-api-proxy` (`sendText`, com a org explícita).

**Ferramentas:**
- `audience.preview` (leitura): cards abertos do funil, por etapa, parados há pelo menos N dias. A régua é a do quadro: `COALESCE(stage_changed_at, entered_at, created_at)`.
- `broadcast.plan` (`messages:send`): guarda o plano com lista de leads, mensagem e números; mostra 3 exemplos renderizados pelo `resolveBlastMessage` do motor.
- `broadcast.test`: envia para o celular de quem pede.
- `broadcast.confirm`.
- `broadcast.status` (leitura).
- `broadcast.cancel`.

**Guardas que o motor não tem, aplicadas aqui:**
- **Número de setor** (`reserved_for`, ex.: cobrança) nunca entra. O motor criaria o plano e falharia depois.
- **Janela de envio:** a confirmação só roda de segunda a sábado, das 8h às 20h, no horário da org. O motor manda o 1º lote no ato, a qualquer hora. A checagem acontece antes de consumir o plano.
- **Multi-org:** recusado com explicação. O motor resolve a org pelo primeiro vínculo e não aceita org explícita; isso é uma limitação do app, a corrigir lá.
- **Plano órfão:** o motor grava o plano antes de enviar o 1º lote. Se o envio falha, ele devolve erro sem o id. O MCP procura o plano pela marca `source.action_id` e relata "criado, 1º lote não saiu", com o id. A ação fica `partial`.
- Só números Uazapi conectados. O Canal Oficial exige template e fica para depois.

**Fora desta fatia:** opt-out. A lista de supressão da ADR-0029 §4 ainda não existe no app.

**Evidência (preview, com `blast-plan-create`, `blast-plan-control` e `whatsapp-api-proxy` deployadas):**
- Canary 11/11.
- Na preview não há provedor de WhatsApp. O motor cria o plano como o usuário e falha o 1º lote por `UAZAPI_BASE_URL not set`, exatamente o caminho do plano órfão, que o MCP relatou com o id.
- Deno 243/243, incluindo o type-check dos arquivos de teste.

---

## Emenda 2026-11-23 (5) — fatia 4 do v2: automação recorrente pela IA

**Decisão: nenhum gatilho novo no motor.** A automação "card parado N dias na etapa S → WhatsApp" é montada com peças que o executor e o editor visual já rodam e editam:
1. gatilho `stage_changed` (`pipeline_id` + `to_stage` = id exato da etapa);
2. espera de N dias;
3. condição "ainda em S" (`stage_id equals`);
4. condição "parado N+ dias" (`days_in_stage ≥ N`, que lê `stage_changed_at`; sair e voltar reinicia a contagem);
5. `send_whatsapp`.

O spec passa pelo mesmo `safeParseSpec → compileWorkflow → validateWorkflow` que a tool de workflow do time usa (ADR-0013). Um gatilho de varredura `stage_idle` atingiria também os cards **já** parados, mas seria código novo no executor, um caminho de envio em massa sem as travas do motor de Disparos. Para esses cards, a resposta é o disparo avulso da fatia 3.

**Tools:**
- `automation.list` (leitura).
- `automation.draft` (`automations:write`): grava **desligada**, aparece em Automações para revisão e edição.
- `automation.activate`: em dois passos, `workflow_id` → plano, depois `confirm_token` → liga.
- `automation.deactivate`.

**Permissão:** a RLS de `workflows` deixa qualquer membro inserir e alterar; `workflows.create` e `workflows.edit` só eram checadas no navegador. O crm-mcp as checa no servidor (`has_feature_permission`) antes de cada escrita. A emissão do escopo já exige `workflows.create` (`crm_mcp_scope_check`).

**Armadilha evitada:** `loop_limit` é o teto de **passos** por execução (`workflow-executor.ts`, `maxSteps`), não de repetições. Com 1, a automação pararia no primeiro nó. Usamos 100, o padrão do app.

**Evidência (preview):**
- Canary 12/12.
- U8: com a automação ligada, um card entrando na etapa cria execução no **motor real**, então o gatilho gerado é aceito. U4: desligada, não cria.
- Regressão: v1 31/31, métricas 12/12, funil 15/15, disparo 11/11.
- Deno 84/84 no crm-mcp (282 no conjunto MCP + workflow-schema).

---

## Emenda 2026-11-24 (6) — fatia 5 do v2: mensagem de automação para quem já está na etapa

**Origem:** um usuário de cliente pediu à IA para "mandar a mensagem da automação X para os clientes da etapa Y do funil Z". A IA respondeu que não conseguia. Três motivos:
1. o token tinha só `read`, e uma tool de escrita sem escopo nem aparece em `tools/list`, então a IA não tinha como explicar o que faltava;
2. `automation.list` não expõe o texto das mensagens;
3. o motor de Disparos resolve só `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}` e `{{segmento}}`, e **apaga em silêncio** qualquer outra variável. As automações desse cliente usam também `{{saudacao}}`, `{{dia_reuniao}}`, `{{hora_reuniao}}`, `{{telefone}}` e `{{faturamento}}`, que chegariam em branco ao lead.

**Decisão: o servidor copia a mensagem; a IA não a redigita.** `broadcast.plan` e `broadcast.test` aceitam `from_automation {workflow_id, node_id}`. O texto e a mídia saem do nó lido **pelos mesmos campos que o executor lê** (`automation-steps.ts`, espelho de `workflow-action-handler.ts` e `action-handlers/send-whatsapp*.ts`). Um ponto não óbvio: o nó de imagem envia `imageCaption`, não `messageTemplate`. `message`, quando vem junto, substitui só o texto, que vira a legenda da mídia. O plano guarda o vínculo, que segue para `blast_plans.source`.

**Ferramentas:**
- `automation.get` (leitura) devolve:
  - o gatilho com nomes de funil e etapa;
  - o fluxo em ordem (BFS a partir do gatilho);
  - cada envio com `node_id`, tipo, texto, mídia, variáveis e se o disparo consegue enviá-lo (e por que não);
  - a audiência pronta para quem **já** está na etapa.
- Sem `messages:send`, a resposta diz exatamente como liberar.

**Trava de variáveis (vale também para texto livre):** `broadcast.plan` e `broadcast.test` recusam qualquer variável que o motor não preenche, nomeando cada uma. Antes, o texto saía com o buraco.

**Mídia:** só imagem e documento, que é o que o motor de Disparos envia (`blast-media.ts`), e só do bucket público `media` do projeto. Áudio, vídeo, figurinha, menu, Pix, template da Meta, texto gerado por IA e envios para a equipe aparecem em `automation.get` com o motivo de não serem disparáveis. Imagem sem legenda pede `message`, porque o motor exige texto. O `broadcast.test` manda a mídia de verdade (`sendMedia`).

**O que o token pode:** o `initialize` passa a enviar `instructions` (campo do protocolo MCP). Elas dizem o que o token pode fazer e, para cada escopo ausente, quem pode liberar e onde (token novo em IA conectada; um token não pode ser ampliado). A IA deixa de responder só "não consigo".

**Proveniência:** `broadcast.confirm` passa `source.pipelineId` (o funil da audiência), que o motor já usava para registrar a origem do disparo e que o MCP não mandava.

**Fora desta fatia:** rodar a **sequência inteira** da automação (esperas, condições, várias mensagens) para os cards que já estão na etapa. Isso não existe nem no app. Criar execuções em massa contornaria o limite diário e o anti-ban do motor de Disparos. A fatia 6 candidata é um catálogo único de variáveis, para o Disparo preencher as mesmas da automação.

**Evidência:**
- Deno 163/163 no crm-mcp + `_shared/mcp`, com type-check dos testes; suíte edge do CI 1219/1219.
- vitest do resolver 31/31; travas de tsc, lint e dep-cruise sem nada novo.
- O canary da preview **não** rodou nesta fatia: a preview efêmera e o script não existem mais.
