# Security — Threat Model e Postura de Seguranca

**Analyzed:** 2026-04-15
**Owner:** agent-security
**Last review:** 2026-04-15

---

## Perfil do produto

Torque CRM — SaaS B2B multi-tenant. ~30 organizacoes ativas. Dominio: `torquecrm.com.br`. Dados sensiveis tratados: leads (PII — nome, telefone, email), conversas de WhatsApp, dados de pagamento (via Asaas — PIX/cartao), tokens OAuth (Google Calendar), credenciais de integracao (Evolution, TinyERP, Meta).

**Regimes aplicaveis:** LGPD (obrigatorio), SOC 2 (alvo enterprise futuro).

## Threat model (STRIDE)

### Spoofing
- **Cross-tenant `organization_id` spoofing** — body/header do cliente contendo org_id alheia
- **Webhook spoofing** — payload falso no `lead-webhook`, `asaas-webhook`, Meta, Cal.com
- **Account enumeration** — signup sem email confirmation (`enable_confirmations = false`)

### Tampering
- **RLS bypass via service_role** em edge functions sem filtro manual de org
- **Migration iterativa** — policies reescritas (20+ refixes) abrem janelas
- **Realtime subscription sem filtro de org** no channel

### Repudiation
- Sem audit log centralizado de acoes admin/master
- `master_users` table sem trilha de criacao/uso
- `lead_history` cobre lead, nao cobre acoes cross-cutting

### Information disclosure
- **BOLA** — endpoints que aceitam `lead_id`/`conversation_id` sem validar ownership
- **service_role key** com `VITE_` prefix historicamente (CONCERN-S1)
- **Secrets em `.env` plaintext** (CONCERN-S2)
- **Copilot prompt leakage** — agente IA vazando contexto entre orgs

### Denial of service
- **Rate limit em memoria** (`new Map()`) em `auth.ts` — reseta em cold start
- **`checkRateLimitPersistent` fail-open** — `allowed: true` em erro DB
- Sem throttling em `import-leads`, webhooks publicos

### Elevation of privilege
- **Permission engine fallback `allowed: true`** quando feature nao mapeada
- **Master admin** sem whitelist auditada
- **3-tier cascata** (master → admin → feature_permissions → member_permissions) com gaps

---

## Inventario de superficie critica

### Edge functions publicas (`verify_jwt = false`)
49 funcoes total. Classificar em 3 grupos:
- **Legitimas sem JWT**: webhooks externos (Meta, Asaas, Cal.com, TinyERP), cron triggers, OAuth callbacks
- **User-facing, JWT validado internamente**: precisam auditoria caso-a-caso + teste
- **User-facing sem validacao**: precisam `verify_jwt = true` ou `validateAuth()` obrigatorio

**Status:** auditoria pendente. Tracking em issue dedicada.

### Integracoes externas
| Integracao | Secret | Rotacao | Risco |
|------------|--------|---------|-------|
| Asaas | `ASAAS_API_KEY` | Nunca | Financeiro — PCI |
| Evolution API | `EVOLUTION_WEBHOOK_SECRET` | Nunca | WhatsApp — dados pessoais |
| Gemini | `GEMINI_API_KEY` | Nunca | IA — custo se vazar |
| Google Calendar | OAuth per-org | Token refresh | Calendar acesso |
| TinyERP | Per-org | Nunca | ERP — comercial |
| Meta | `META_APP_SECRET` | Nunca | Ads e Messenger |
| SZ.Chat | Per-org | Nunca | Chat multi-canal |
| ElevenLabs | `ELEVENLABS_API_KEY` | Nunca | TTS — custo |

**Status:** nenhuma rotacao programada. Roadmap: rotacao 90d.

### PII mapeada
- `leads` — nome, telefone, email, empresa (operacional)
- `conversation_messages` — conteudo de WhatsApp (operacional)
- `team_members` + `profiles` — dados do time
- `organizations` — CNPJ (implicit em onboarding)
- `subscription_plans` / Asaas — dados financeiros

**Retencao:** indefinida. Direito ao esquecimento nao implementado.

---

## Controles em vigor

- RLS em todas as tabelas org-scoped
- `withSentry()` wrapper em edge functions — observabilidade de erros
- `withSecurityHeaders()` e `getCorsHeaders()` compartilhados
- CORS com allowlist (`torquecrm.com.br`)
- Migrations versionadas
- Zero commits com secret rastreavel (`.env*` em gitignore)

## Controles faltando / parciais

| Controle | Status | Prioridade |
|----------|--------|-----------|
| SAST no CI | Ausente | Alta |
| SCA (Dependabot/Snyk) | Parcial | Alta |
| Secrets scan pre-commit | Ausente | Critica |
| pgTAP tests RLS | Parcial — test existe, skipado em CI | Critica |
| HMAC signature validation em webhooks | Parcial | Alta |
| Rate limiting persistente | Parcial — fail-open | Alta |
| Audit log de master/admin | Ausente | Alta |
| Secret rotation schedule | Ausente | Media |
| LGPD — direito ao esquecimento | Ausente | Alta |
| CSP headers | Parcial | Media |
| SBOM | Ausente | Baixa |
| Threat model por feature | Apenas este doc | Media |

---

## Matriz de risco (resumo)

| Risco | Probabilidade | Impacto | Severity |
|-------|---------------|---------|----------|
| Cross-tenant data leak via edge function sem JWT | Alta | Critico | **Critica** |
| RLS bypass via service_role sem filtro | Media | Critico | **Critica** |
| Secret vazando em build (VITE_ prefix) | Media | Critico | **Critica** |
| Webhook spoofing (Asaas/Meta sem HMAC) | Media | Alto | **Alta** |
| Account enumeration via signup aberto | Alta | Medio | **Alta** |
| Privilege escalation via permission fallback | Baixa | Alto | **Alta** |
| Prompt injection Copilot cross-org | Media | Alto | **Alta** |
| Supply chain (dep comprometida) | Baixa | Alto | **Media** |

---

## Orquestracao

O `agent-security` e invocado pelo Conductor nos triggers definidos em [.claude/skills/agent-security/SKILL.md](../../.claude/skills/agent-security/SKILL.md). Tem poder de veto.

Em features sensiveis, a ordem obrigatoria e:
```
Architect → Security (threat model) → DBA → Backend →
Security (RLS + auth review) → Frontend → QA →
Security (final gate) → Infra
```

## Referencias

- `.specs/codebase/CONCERNS.md` — findings operacionais
- `.specs/codebase/INTEGRATIONS.md` — detalhes de integracao
- OWASP Top 10 2025 / API Top 10 / LLM Top 10
- OWASP ASVS 5.0
- NIST SSDF (SP 800-218)
- LGPD
