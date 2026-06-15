# Meta integration via agency System-User token (polling + Conversions API)

**Status:** accepted (2026-06-15)

## Context

A integração Meta hoje é **OAuth por-org**: cada org loga via Facebook, gera tokens user-scoped (`meta_connections`/`meta_pages`) que expiram ~60 dias e exigem refresh (`refresh-meta-tokens`). O leadgen nativo já cai na org via webhook push (`meta-webhook` → `processLeadgen`), mas na prática as orgs nunca configuraram — o atalho foi rotear o form do Meta por Make, mantendo um hop externo desnecessário.

O CTO quer: (1) conectar Meta sem OAuth, via uma conta-agência onde a Torque ganha partner access aos assets do cliente; (2) puxar leadgen nativo direto pra org (matar Make); (3) mandar sinal de conversão de volta pro Meta quando o lead avança, otimizando a campanha sem expor receita. Validação contra token real (2026-06-15): o token puxa 25 contas de anúncio + leadgen real da Milennials (493 leads, campos certos, TOS aceito).

## Decisões

1. **OAuth morto. Um Torque Meta System User token único.** Clientes dão partner access aos seus assets (Páginas + Contas de anúncio) ao Business Manager da Torque; um System User token (longo, não-expira) lê/age sobre todos com uma credencial. Armazenado como **secret service-role-only**, nunca per-org, nunca no frontend. Rejeitado: manter OAuth (expira, fricção de setup por org, não escala pra modelo agência). Rejeitado: token user-scoped (expira ~60d — o token de validação era user token, é descartável; o durável é System User).

2. **Vínculo asset→org é master-only e manual** (Meta Asset Binding). Aba no `MasterRoute` (Gabriel) enumera Páginas + Contas de anúncio do token e mapeia, por org, quais pertencem a ela. Página→org é a **fonte de verdade** do roteamento de leadgen (supera `meta_pages.organization_id`). Uma Página mapeia pra exatamente uma org. Rejeitado: self-serve por admin da org (outro projeto; ~30 orgs cabem no manual).

3. **Leadgen via polling, não webhook.** Cron pg_cron (~5 min) lê `GET /{form}/leads` das páginas bindadas com o System User token, cursor por form, dedup por `leadgen_id`. **Zero config manual no painel do Meta** (sem callback URL, sem verify token, sem inscrição por página, sem verificação de assinatura). Reusa o mapeamento/insert que já existe (`applyFieldMappings`, `meta_leadgen_configs`). Custo: ~5 min de latência — irrelevante pro follow-up B2B. Rejeitado: webhook push (instantâneo, mas exige config 1x no app + assinatura HMAC + inscrição por página — fricção que o modelo polling elimina). Webhook pode ser ligado por cima depois se exigir <5s pós-clique.

4. **Otimização via Lead Conversion Signal (Conversions API).** Quando o lead avança, manda evento de volta keyed por `leadgen_id` (`action_source: system_generated`), pra Meta otimizar campanhas "Conversion Leads". **Escalonado, 3 eventos** (`qualified` quando vira Tier prata+, `meeting` no `compareceu`, `sold` no `vendido`), **sem valor monetário** — receita nunca vai pro Meta, por política. **Idempotente** (cada `event_name` 1x/lead, via `meta_signals_sent`). Só dispara pra lead com `leadgen_id` (chave de join); lead de click-to-WhatsApp sem form fica de fora. Pré-requisito Meta-side: campanha do cliente configurada como "Conversion Leads" + dataset id por conta — senão o evento entra mas não otimiza. Promove `metadata.leadgen_id` pra coluna indexada `meta_lead_id`.

5. **Inbox omnichannel é épico separado, não escopo aqui.** Colapsar o chat Meta (`AtendimentoMeta`) no chat WhatsApp com `ChannelBadge` é desejado, mas ortogonal a leadgen/otimização. A fundação de dados já existe abandonada (`channel_messages`, `channel_type` enum, RPC `get_unified_conversations`, migration `20260951100000`) — sem uso no frontend. Fica pra depois pra não inflar o blast radius. Nó duro a resolver lá: Instagram não tem telefone (contato = PSID), e o modelo de lead/card é telefone-cêntrico.

## Consequências

- **Blast radius do token único:** um token acessa os assets de todos os clientes. Comprometê-lo expõe tudo. Mitigação: secret service-role-only, rotação manual, gerar como System User (não user token).
- **Leadgen de cliente exige partner access da Página, não só da conta de anúncio.** Validação mostrou 25 contas de anúncio acessíveis mas só 1 página (Milennials). Otimização (#3) funciona já pros 25; leadgen pull (#2) só funciona pra quem compartilhar a Página. Onboarding de cliente passa a pedir os dois.
- **Chat Meta congela** ao matar OAuth (depende dos tokens de página OAuth). Volta no épico omnichannel via System User token (page tokens derivados não expiram — melhora a dor de refresh do chat).
- **Migração Milennials:** já está em OAuth + webhook. Precisa re-bind no master + partner access da página ao BM novo, desligando o caminho velho sem derrubar o leadgen ativo.
- `refresh-meta-tokens` e o `meta-webhook` (path leadgen) viram legado/dormentes pós-corte.
