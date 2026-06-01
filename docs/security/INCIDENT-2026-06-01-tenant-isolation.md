# Incidente de Segurança — Quebra de Isolamento Multi-Tenant

**Data:** 2026-06-01
**Ambiente:** Produção (`jsjsmuncfkbsbzqzqhfq`)
**Severidade:** Crítica
**Status:** Vetores pré-auth fechados e verificados; follow-ups autenticados/sistêmicos em andamento.

> Todas as afirmações abaixo foram **verificadas empiricamente contra produção** (anon key pública via PostgREST/RPC + `pg_policies`/`pg_proc` via CLI `--linked`). Achados de auditoria que não reproduziram em prod estão marcados como FALSO-POSITIVO.

## 1. Resumo

Com **apenas a anon/publishable key** (pública, embarcada no bundle do frontend, trivial de extrair), um atacante **sem login** conseguia ler dados cross-org de produção. Qualquer usuário autenticado de uma org conseguia ler dados de outras orgs por múltiplos caminhos.

**Pergunta "sem login dá pra roubar?": SIM (confirmado).**
**Pergunta "admin org A rouba org B?": SIM (confirmado).**

## 2. Vazamentos confirmados em prod

| Alvo | Vetor | Evidência (medida em prod) |
|---|---|---|
| `conversation_messages` | pré-auth + cross-org | anon leu **1.736** linhas, incluindo `content` (corpo das mensagens) |
| `conversations` | pré-auth + cross-org | anon leu **925** linhas de **14 orgs** |
| `conversation_context_summary` | pré-auth + cross-org | anon leu resumos IA de leads |
| `get_dashboard_metrics` (RPC) | pré-auth + cross-org | anon leu **MRR R$203.349**, vendas/receita por dia da org-alvo |
| `suggest-retention-action` (edge fn) | pré-auth + cross-org | `verify_jwt=false` + service_role, sem auth → carteira/LTV/churn por `client_id` |
| `system_alerts`, tabela órfã `pipeline_entries_revert_20260514` | pré-auth | anon leu (org_id, message / lead+pipe) |
| **Grant em massa**: anon tinha **SELECT+INSERT+UPDATE+DELETE em 213/223 tabelas**; **256** funções `SECURITY DEFINER` executáveis por anon | sistêmico | RLS/guards eram a única trava — qualquer omissão = leak |

## 3. Causa-raiz

1. **Policies RLS roleless**: policies criadas como "service role" sem a cláusula `TO service_role` → Postgres aplica a **todos os roles** (anon + authenticated); com `USING(true)` viram leitura/escrita pública total, anulando o isolamento por org (policies permissivas são combinadas com OR).
2. **RPCs `SECURITY DEFINER` sem guard de membership** + `PUBLIC EXECUTE` → param `org_id` controlado pelo atacante, RLS bypassada por DEFINER.
3. **Edge functions** com `verify_jwt=false` usando service_role e confiando em id do body sem validar o caller.
4. **Grant em massa pra anon** (`GRANT ALL ... TO anon`) deixando a RLS como única defesa.
5. **Drift de migration**: prefixo de versão `20261012000000` **colidido** entre dois arquivos → `schema_migrations` grava a versão uma vez → `db push` pulou um arquivo → fixes de hardening nunca aplicados em prod.

## 4. Ações executadas (todas verificadas em prod)

- **RLS**: dropadas policies `{public} USING(true)` em `conversations`, `conversation_messages`, `conversation_context_summary` (mantidas org-scoped + service_role). `user_roles` reescopada (self + admin/master). → anon `200`→`401`; dados intactos (925/1736/921).
- **Grants tabela**: `REVOKE` de anon em 10 tabelas sensíveis; `REVOKE` de **todos os writes de anon** nas 223 tabelas + `ALTER DEFAULT PRIVILEGES` (anon writable: 213→0).
- **RPCs**: `REVOKE PUBLIC/anon EXECUTE` em todas as DEFINER com param de org (org-param anon-executáveis: 67→0); guard `assert_org_access` adicionado às 8 DEFINER que não tinham (19/19 cross-org readers agora protegidas). Verificado: anon → `access_denied` mesmo com grant.
- **Edge function**: `suggest-retention-action` agora exige `requireAuth(org do client)` + redeployada.
- **Durabilidade**: migrations `20260601130000` + `20260601140000` capturam tudo (idempotentes; **aplicar em dev**).

## 5. Falso-positivos da auditoria (corrigidos contra prod)

- **`conversation_summaries` permissiva (RLS-004)**: drift **só de dev**; prod limpo.
- **View RLS-bypass (`security_invoker` off)**: prod tem as 7 views com `security_invoker=on`, **0 inseguras**. Um agente de auditoria gerou migration + relatório alegando números de prod (7.587 linhas/36 orgs) e "já aplicado em prod" — **falso**, descartado.

## 6. LGPD / exposição de dados

**Exfiltração histórica não pôde ser confirmada nem descartada.** Razões:
- `SELECT` não é auditado no Postgres — não há log nativo de quem leu o quê.
- Logs de gateway de API (PostgREST/edge) têm retenção curta; ataques anteriores ao incidente provavelmente fora da janela.
- O token do CLI (keychain) é rejeitado pelo endpoint de analytics da Management API.

**Postura recomendada (dado que a capacidade era trivial e pública):**
1. **Assumir potencial exposição** de: corpos de mensagens WhatsApp/IA (PII de leads — nome, telefone, conteúdo), métricas financeiras por org (MRR/receita), e roster de carteira (clientes, LTV, churn).
2. **Dados pessoais envolvidos** (LGPD Art. 5º): nomes, telefones, conteúdo de conversa de leads de até 14–41 orgs.
3. **Avaliar dever de comunicação** (LGPD Art. 48): comunicar ANPD + titulares se houver risco/dano relevante. Decisão jurídica — recomenda-se consultar DPO/jurídico com este relatório.
4. **Preservar evidências**: snapshot deste relatório + estado de `pg_policies`/`pg_proc` pré/pós-fix (no histórico da sessão).
5. **Rotacionar** chaves de webhook (`WEBHOOK_API_KEY`, `ERP_ORDER_WEBHOOK_SECRET`) — pendente, requer coordenação n8n.

## 7. Follow-ups abertos

- **Edge functions** (precisam coordenação n8n / rotação de chave): `webhook-new-lead` (grace bypass até 2026-07-09), `webhook-orchestrator`, `lead-webhook`, `erp-order-webhook` (fail-open se secret vazio), `semi-automatic-dispatch` (zero auth), `meta-oauth-callback`/`google-calendar-callback` (`state` sem HMAC).
- **Drift de migration**: renomear o arquivo colidido `20261012000000_*` para versão única + `supabase migration repair` (delicado — fazer em janela controlada).
- **Long tail**: 191 DEFINER ainda anon-executáveis sem param de org — revisar por outros params (lead_id/phone/client_id). `whatsapp_rate_tracking` (RLS off). Catálogos `feature_flags`/`feature_permissions` legíveis por anon (baixo).
- **Guarda CI**: teste pgTAP que falha se qualquer policy em tabela com `organization_id` for `roles={public}` + `qual=true`, ou se DEFINER com param de org for anon-executável.
