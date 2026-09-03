# ADR-0024 — TorqueCalls: chamada de voz WhatsApp em serviço separado

- **Status**: Aceito
- **Data**: 2026-07-29
- **Referencia**: ADR-0017 (observabilidade in-house), ADR-0021 (gestor de portfólio — `get_my_organization_ids`)
- **Fatia que este ADR acompanha**: S8/S9 — `20270730000000_torquecalls_voip_foundation.sql`

## Contexto

O Torque conversa com o lead por mensagem (Uazapi) e não consegue **ligar** para ele. Ligar pelo mesmo número que já conversa é a diferença entre um follow-up que o vendedor faz e um que ele adia.

Duas coisas foram medidas antes de decidir:

1. **Trocar o gateway inteiro não paga.** AstraCalls/WaCalls cobrem ~7% da superfície Uazapi que consumimos (25 endpoints). `send/menu` e `send/pix-button` são **impossíveis** em qualquer stack não-oficial — os botões foram depreciados pelo WhatsApp e só existem via Business Platform. Substituir custaria 6–10 semanas (WAHA Plus) ou 3–6 pessoa-mês (próprio), para perder capacidade que já está em produção.
2. **O bloqueador real não era técnico, era de coexistência.** A pergunta que travava tudo: parear um segundo aparelho derruba a sessão Uazapi? Foi testada com número real, instância de teste, e a resposta é **não** — Uazapi pareado às 20:33, TorqueCalls pareado às 21:05, mensagem de entrada gravada em `whatsapp_messages` às 21:08 (`direction=incoming`, `received_via=webhook`). Depois disso: chamada tocando no aparelho de destino (21:18), áudio bidirecional confirmado (21:22, 26 s), e duas chamadas concorrentes de um aparelho vinculado (`<preaccept>` de ambos os destinos).

O WhatsApp permite 1 celular principal + 4 aparelhos vinculados. Uazapi ocupa um slot, TorqueCalls ocupa outro.

## Decisão

### 1. Serviço separado, em paralelo ao Uazapi — não substituição

TorqueCalls roda como processo próprio (Go + whatsmeow + pion), com Postgres local na VPS para a sessão, e fala com o CRM **só por HTTP**. Nunca toca o Supabase direto.

### 2. Base MIT, com a restrição de licença registrada no `NOTICE`

`go.mau.fi/libsignal` é **GPL-3.0** e entra no binário por ligação estática via whatsmeow — nas duas bases candidatas. Consequência que vale para sempre e que alguém vai querer violar em 2027:

> **Captura de áudio, transcrição e lógica de valor competitivo vivem FORA deste processo.** In-process fica apenas um tap de PCM para socket.

A base AGPL (AstraCalls) ficou como espelho de referência; nenhuma linha dela foi incorporada.

### 3. A VPS nunca cunha autoridade — só verifica

Credenciais são JWS Ed25519 assinados **no Supabase**; a VPS guarda apenas a chave pública. VPS comprometida não consegue emitir autoridade para org nenhuma. `aud` é o host exato, `kid` por ambiente (token de dev não disca em prod), `jti` de uso único.

Espelho disso no lado do dado: **a organização nunca vem do corpo da requisição.** O CRM deriva a org de `voip_sessions.tc_session_id` — exatamente o que `whatsapp-webhook/index.ts` já faz com `whatsapp_instance_secrets`. Sem isso, o Ed25519 protegeria a cunhagem e deixaria a escrita cross-org aberta pelo HMAC simétrico, que mora na própria VPS.

### 4. Governor fundido ao emissor da credencial — desenho (C)

O ponto que ninguém contorna é **quem assina**, não o endpoint. A VPS recusa requisição sem token de escopo `call`; a única função capaz de assinar esse escopo é `authorizeCallAndMint`, que roda o governor. Passar pelo governor e obter autoridade são a mesma operação.

Lição do Send Governor: proteção nas closures dos helpers não é proteção no choke — o `copilot-v2-worker` atravessou porque ninguém enumerou os callers diretos.

O **desenho (C)**, travado pelo CTO, define onde mora o freio:

- contador próprio (`voip_call_usage`);
- **as chaves de desligar ficam em `whatsapp_instances`** (`voice_calls_enabled`, `daily_call_cap`), ao lado de `daily_blast_cap` — onde um humano procura durante o incidente;
- **NÃO** existe `voip_call_policies`. Duas tabelas para desligar coisa é uma tabela esquecida no incidente seguinte;
- **NÃO** ancorar em `whatsapp_instance_reputation`: inerte, 0 linhas para 137 instâncias, nenhum leitor;
- **NÃO** acoplar ao Send Governor de mensagem: frente separada, em produção.

Os demais tetos (concorrência por org, taxa por minuto, teto por destino, backoff) são constantes documentadas dentro de `fn_voip_call_reserve`. Virar knob exige decisão do CTO — é ausência deliberada, não esquecimento.

### 5. Consentimento de chamada é separado do de mensagem, e não é auto-serviço

A política do WhatsApp exige opt-in próprio para ligar. Na via não-oficial ninguém enforça, então vira requisito nosso.

O gate nasce real: `voice_call_whatsapp` fica **fora do alcance de `authenticated`** nas policies de `consent_records`, entra só por RPC de `service_role` que carimba origem/IP/user-agent, e o choke exige `source IN ('form','api','webhook')`. Consentimento de chamada afirmado pelo próprio vendedor no CRM não é consentimento.

### 6. Ordem de exposição vale mais que ordem de código

**Expor porta pública é o último passo.** Todo o spike rodou por túnel SSH — `http://localhost` é contexto seguro, então `getUserMedia` funciona sem TLS. Zero porta pública durante as fases 1, 2 e 2b.

Sequência: S8/S9 (DB + permissões) → S10 (choke) → S5 (middleware, mata o `clientID` auto-declarado) → S11 (webhook com confiança invertida) → S12/S13 (plano de controle + fila durável) → S14 (cliente) → **só então** porta pública.

## Consequências

**Ganhamos** chamada de voz pelo número que o cliente já usa, sem tocar o transporte de mensagem, e com o governor nascendo junto com a feature em vez de ser acrescentado depois de um incidente.

**Aceitamos**:

- Risco de ban só é medível em dias/semanas. O spike roda na org Milennials — o risco é do CTO, não de cliente.
- Cliente com 4 aparelhos já vinculados falha no pareamento. Vira passo de onboarding.
- Custo de CPU por chamada simultânea **não foi medido**. `WACALLS_MAX_CALLS` foi baixado de 8 para 2 e o teto de concorrência por org nasce em 2, até haver número.
- A VPS tem 8,8% de steal time. Não é gargalo de rede (relés brasileiros a 3–16 ms), mas é jitter que pode confundir medição.
- Sob qualquer licença, gravação e transcrição exigem processo separado. Isso é custo de arquitetura, não só de licença — e também é a versão boa (falha isolada, deploy e escala distintos).

**Rejeitamos explicitamente**:

- A Calling API oficial do WhatsApp (decisão do CTO — caminho não-oficial).
- A moldura "AGPL expõe o moat": errada. Com libsignal GPL-3.0 no binário, **MIT também não produz binário proprietário**. A diferença real é estreita — §13 da AGPL dispara em interação remota por rede, GPLv3 dispara em distribuição de cópia.
- Portar o multi-chamada da AstraCalls (AGPL contaminaria a base MIT). Descoberta posterior tornou o ponto irrelevante: o upstream já cria um `CallManager` **por chamada**, com `callRegistry` e guard `ownerActiveCall`. O refactor de 1–2 dias orçado não existia.

## Emenda 1 — vê o lead → pode ligar (2026-09-02)

- **Contexto**: pedido do CTO — "alguns casos não conseguimos ou não aparece o botão para ligar, mesmo com o TorqueCalls ativo e conectado (Milennials)". Medido em produção em 2026-09-02: os 3 contatos dos prints tinham dono (Marcos ×2, Nicolodi) e quem estava no chat era a Gabrielly (`member`), dona de nenhum. O botão sumia por um **gate de dono do lead** em duas camadas — `useCanCallLead` no front e `not_lead_owner` em `_shared/voip/call-plane.ts`.
- **A justificativa do gate estava errada**: o comentário dizia ser "a mesma fronteira que a RLS de `voip_calls` aplica na leitura". Não era — `voip_calls_select_org` → `voip_can_see_call` → `can_see_lead_by_permissions`, que inclui `leads.view_all` (default `true`). A leitura já era por **visibilidade**; a escrita ficou mais estreita. E o gate lia as colunas **legadas** de responsável (`sdr_id`/`closer_id`/`responsible_id`, espelho por trigger, drop no #755), não as canônicas `pre_sale_responsible_id`/`sale_responsible_id` — 26 leads em produção com dono canônico barrado.
- **Decisão (CTO, não renegociável)**: a condição "dono do lead" **sai** do front e do servidor. Fica: número ao alcance (ADR-0025), `voip.call.start`, mesma org, telefone, consentimento, tetos. O servidor pergunta ao banco **com o JWT do chamador** (`Caller.asUser`) se o lead é visível — a mesma policy `leads_select_by_responsibility_and_permissions` que decide a tela. Recusa: `lead_not_visible` (403). Não há mais "admin bypassa dono" porque não há dono a bypassar.
- **Leitura acompanha**: `voip_can_see_call` passa a olhar o dono canônico (`20270915000000_voip_can_see_call_por_dono_canonico.sql`), via `OR REPLACE` para preservar grants.
- **Superfícies**: o botão (`VoiceCallButton`, variante `icon`) passa a existir também no Card do Lead (substitui um `AcaoRapida` "Ligar" sem `onClick`), no cabeçalho do Card do Negócio e no cabeçalho do chat no celular. Os cards recebem por slot (`acaoLigar`): são alcançáveis a partir de `src/preview/main.tsx`, que não pode importar o provider de voz.
- **Ordem de deploy**: migration em prod → `torquecalls-signal` → merge (o front deploya sozinho no merge; front novo + servidor velho mostraria o botão e devolveria 403 "Este lead não é seu.").

