# Spec: Second Brain — Obsidian Context Mapper v2

**Data**: 2026-04-12
**Status**: Aprovado
**Autor**: Gabriel (CTO) + Claude Code

---

## Objetivo

Evoluir o segundo cerebro no Obsidian para ser a fonte de verdade do projeto Torque CRM com:

1. **Documentacao profunda** de todas as features (produto + tecnico)
2. **Tracking automatico** de toda mudanca via hook pos-commit
3. **Backlog vivo** com status de pedidos, specs, fixes
4. **Leitura automatica** pelo agente antes de qualquer acao (via CLAUDE.md)
5. **Comando manual** `/second-brain` como complemento

---

## Vault: Estrutura Final

```
Claude Code — Torque CRM/
├── 00 — INDEX.md
├── 01 — Identidade/
│   ├── Permissoes.md
│   └── Comportamentos.md
├── 02 — Arquitetura/
│   ├── Visao Geral.md
│   ├── Modulos.md
│   └── Integracoes.md
├── 03 — Operacional/
│   ├── Scripts e Comandos.md
│   ├── Fluxos de Trabalho.md
│   └── Limitacoes.md
├── 04 — Decisões/
│   └── ADR-YYYY-MM-DD-<tema>.md
├── 05 — Log de Contexto/
│   └── YYYY-MM-DD—<sessao>.md
├── 06 — Features/                         ← NOVO
│   ├── Comunicacao/
│   │   ├── Chat WhatsApp.md
│   │   ├── Mensagens Agendadas.md
│   │   └── Templates de Mensagem.md
│   ├── Vendas/
│   │   ├── Pipe WhatsApp.md
│   │   ├── Pipe Confirmacao.md
│   │   ├── Pipe Propostas.md
│   │   ├── Pipelines Customizados.md
│   │   ├── Funis Hub.md
│   │   ├── Follow-ups.md
│   │   ├── Produtos.md
│   │   └── Upsell.md
│   ├── Automacao/
│   │   ├── Workflow Builder.md
│   │   ├── Campanhas.md
│   │   └── Regras de Pipe.md
│   ├── IA/
│   │   ├── Copilot.md
│   │   ├── Oraculo Comercial.md
│   │   └── Lead Score.md
│   ├── Analytics/
│   │   ├── Dashboard.md
│   │   ├── Dashboard Outbound.md
│   │   ├── Analytics Comercial.md
│   │   ├── Analytics UTMs.md
│   │   ├── Performance.md
│   │   ├── Ranking.md
│   │   └── TV Dashboard.md
│   ├── Equipe/
│   │   ├── Gestao de Time.md
│   │   ├── Comissoes.md
│   │   ├── Metas.md
│   │   └── Premiacoes.md
│   ├── Integracoes/
│   │   ├── WhatsApp Evolution.md
│   │   ├── Meta Facebook.md
│   │   ├── Google Calendar.md
│   │   ├── TinyERP.md
│   │   ├── Asaas Pagamentos.md
│   │   ├── SZ Chat.md
│   │   └── n8n Orquestracao.md
│   └── Admin/
│       ├── Onboarding.md
│       ├── Configuracoes.md
│       ├── Permissoes Sistema.md
│       ├── Checkout e Planos.md
│       ├── API Docs.md
│       ├── Webhooks.md
│       └── Master Admin.md
├── 07 — Changelog/                        ← NOVO
│   ├── YYYY-MM-DD.md                     (daily note)
│   └── individuais/
│       └── YYYY-MM-DD—<tipo>-<descricao>.md
└── 08 — Backlog/                          ← NOVO
    ├── backlog/
    ├── em-progresso/
    └── concluido/
```

---

## Templates

### Feature (`06 — Features/`)

```markdown
---
tags:
  - claude-code
  - feature
  - torque-crm
  - <dominio>
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: active
---

# <Nome da Feature>

## O que faz
[Descricao de produto — o que o usuario ve e faz.
Linguagem simples, como se explicasse pro cliente.]

## Regras de negocio
[Regras, condicoes, limites.]

## Como o usuario usa
[Passo a passo do fluxo principal na UI]

## Edge cases
[Situacoes especiais, comportamentos nao obvios]

---

## Como funciona (tecnico)

### Componentes
[Arquivos React principais — path + responsabilidade]

### Hooks
[Hooks React Query usados — queryKey, tabela, o que retorna]

### Edge Functions
[Functions do backend envolvidas]

### Tabelas
[Tabelas do banco, campos chave, relacoes]

### Fluxo de dados
[Entrada → processamento → saida]

---

## Historico de mudancas
- [[YYYY-MM-DD—tipo-descricao]] — descricao curta

## Links relacionados
- [[Feature relacionada]]
```

### Daily Changelog (`07 — Changelog/YYYY-MM-DD.md`)

```markdown
---
tags:
  - claude-code
  - changelog
  - daily
created: YYYY-MM-DD
---

# Changelog — YYYY-MM-DD

## Resumo do dia
[2-3 frases do que aconteceu — gerado por /second-brain]

## Commits

### HH:MM — <mensagem do commit>
- **Arquivos**: lista dos arquivos alterados
- **Features afetadas**: [[Feature 1]], [[Feature 2]]
- **Nota**: [[YYYY-MM-DD—tipo-descricao]] ou —
```

### Nota Individual (`07 — Changelog/individuais/`)

```markdown
---
tags:
  - claude-code
  - changelog
  - <tipo>
created: YYYY-MM-DD
status: concluido
tipo: feat | fix | refactor | spec
features:
  - Feature Afetada
---

# <tipo>: <descricao>

## O que mudou
[Descricao clara do que foi feito e por que]

## Arquivos alterados
- `path/to/file.ts` — o que mudou nele

## Contexto
[Por que essa mudanca foi necessaria]

## Impacto
[O que melhora, o que pode quebrar, o que testar]

## Features afetadas
- [[Feature 1]]
- [[Feature 2]]
```

### Backlog Item (`08 — Backlog/`)

```markdown
---
tags:
  - claude-code
  - backlog
  - <tipo>
  - torque-crm
created: YYYY-MM-DD
last_updated: YYYY-MM-DD
status: backlog | em-progresso | concluido
tipo: feature | fix | spec | melhoria | pedido
prioridade: alta | media | baixa
features:
  - Feature Afetada
---

# <Titulo do item>

## Descricao
[O que precisa ser feito e por que]

## Criterios de conclusao
- [ ] Criterio 1
- [ ] Criterio 2

## Notas
[Contexto adicional, decisoes, links]

## Historico
- YYYY-MM-DD — Criado (backlog)
- YYYY-MM-DD — Movido pra em-progresso
- YYYY-MM-DD — Concluido via [[nota-changelog]]
```

---

## Automacao

### Hook pos-commit (settings.json)

Configurado em `.claude/settings.json` como hook de evento `PostCommit`.

**Etapa 1 — Sempre (shell script sync, sem IA):**
- Le dados do commit via `git log -1`
- Cria/appenda no daily note `07 — Changelog/YYYY-MM-DD.md`
- Formato: timestamp, mensagem, arquivos alterados

**Etapa 2 — Se significativo (Claude Code background):**
- Prefixos significativos: `feat`, `fix`, `refactor`, `spec`
- Prefixos ignorados: `chore`, `style`, `docs`, `ci`, `test`
- Se significativo:
  1. Cria nota individual em `07 — Changelog/individuais/`
  2. Identifica features afetadas via mapa de paths
  3. Atualiza nota da feature (historico + "Como funciona" se aplicavel)
  4. Checa/atualiza backlog se item relacionado existe

### Mapa de paths → features

Arquivo de configuracao que mapeia paths do codebase para features do vault:

```json
{
  "src/components/chat/": "Chat WhatsApp",
  "src/hooks/useChannelChat": "Chat WhatsApp",
  "supabase/functions/evolution": "WhatsApp Evolution",
  "src/components/copilot/": "Copilot",
  "src/hooks/useCopilot": "Copilot",
  "supabase/functions/agent-message/": "Copilot",
  "src/components/automacoes/": "Workflow Builder",
  "src/hooks/useWorkflow": "Workflow Builder",
  "supabase/functions/process-workflow": "Workflow Builder",
  "src/components/kanban/": ["Pipe WhatsApp", "Pipe Confirmacao", "Pipe Propostas"],
  "src/pages/PipeWhatsapp": "Pipe WhatsApp",
  "src/pages/PipeConfirmacao": "Pipe Confirmacao",
  "src/pages/PipePropostas": "Pipe Propostas",
  "src/pages/Dashboard": "Dashboard",
  "src/components/dashboard/": "Dashboard",
  "src/hooks/useDashboard": "Dashboard",
  "src/components/campanhas/": "Campanhas",
  "src/hooks/useCampanha": "Campanhas",
  "supabase/functions/campaign": "Campanhas",
  "src/components/leads/": "Pipe WhatsApp",
  "src/hooks/useLeads": "Pipe WhatsApp",
  "supabase/functions/lead-webhook/": "Webhooks",
  "src/components/team/": "Gestao de Time",
  "src/hooks/useTeamMembers": "Gestao de Time",
  "src/components/comissoes/": "Comissoes",
  "src/hooks/useCommissions": "Comissoes",
  "src/components/performance/": "Performance",
  "src/components/ranking/": "Ranking",
  "src/pages/Upsell": "Upsell",
  "src/components/upsell/": "Upsell",
  "src/components/products/": "Produtos",
  "src/hooks/useProducts": "Produtos",
  "supabase/functions/tinyerp": "TinyERP",
  "supabase/functions/meta": "Meta Facebook",
  "supabase/functions/google-calendar": "Google Calendar",
  "supabase/functions/sz-chat": "SZ Chat",
  "supabase/functions/asaas": "Asaas Pagamentos",
  "src/components/followups/": "Follow-ups",
  "src/hooks/useFollowUps": "Follow-ups",
  "src/components/checkout/": "Checkout e Planos",
  "src/hooks/useCheckout": "Checkout e Planos",
  "src/components/onboarding/": "Onboarding",
  "src/components/settings/": "Configuracoes",
  "src/lib/permissions": "Permissoes Sistema",
  "supabase/functions/_shared/permission": "Permissoes Sistema",
  "src/components/api-docs/": "API Docs",
  "src/components/master/": "Master Admin",
  "src/hooks/useMaster": "Master Admin",
  "src/hooks/useScheduledMessages": "Mensagens Agendadas",
  "supabase/functions/process-scheduled": "Mensagens Agendadas",
  "src/components/confirmacao/": "Pipe Confirmacao",
  "src/components/proposals/": "Pipe Propostas",
  "src/hooks/useGoals": "Metas",
  "src/components/gamification/": "Premiacoes",
  "src/hooks/useAwards": "Premiacoes",
  "src/components/tv/": "TV Dashboard",
  "src/hooks/useAnalytics": "Analytics Comercial",
  "src/components/analytics/": "Analytics Comercial",
  "supabase/functions/oraculo": "Oraculo Comercial",
  "supabase/functions/calculate-lead-score/": "Lead Score",
  "src/components/custom-pipelines/": "Pipelines Customizados",
  "src/hooks/useCustomPipeline": "Pipelines Customizados",
  "src/components/funis/": "Funis Hub",
  "supabase/functions/pipe-rule": "Regras de Pipe",
  "src/pages/DashboardOutbound": "Dashboard Outbound",
  "src/components/dashboard-outbound/": "Dashboard Outbound"
}
```

### Comando /second-brain

Skill custom invocavel manualmente. Faz tudo que o hook faz, mais:

- Escaneia todos os commits desde a ultima execucao
- Permite documentar itens sem commit (decisoes verbais, pedidos)
- Forca re-leitura de features e atualiza se o codigo mudou
- Gera "Resumo do dia" na daily note
- Recebe parametros opcionais:
  - `/second-brain` — scan completo desde ultimo run
  - `/second-brain resumo` — gera resumo do dia
  - `/second-brain feature <nome>` — atualiza feature especifica
  - `/second-brain backlog <titulo>` — cria item no backlog

---

## CLAUDE.md — Secao Segundo Cerebro

Adicionar ao `CLAUDE.md` do projeto:

```markdown
## Segundo Cerebro (Obsidian)

O vault Obsidian em `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/`
e a fonte de contexto do projeto. Consulte ANTES de agir.

### Regras

1. **Inicio de sessao**: Leia `00 — INDEX.md` para visao geral e o daily
   note mais recente em `07 — Changelog/` para contexto do que mudou.
2. **Antes de mexer em qualquer feature**: Leia a nota da feature em
   `06 — Features/<dominio>/` para entender regras de negocio,
   como funciona, edge cases, e historico de mudancas.
3. **Antes de implementar**: Cheque `08 — Backlog/em-progresso/` para
   ver se ja existe item relacionado ao que foi pedido.
4. **Pedido novo**: Verifique se existe nota no vault antes de
   explorar o codebase do zero.
5. **Pos-commit**: O hook automatico atualiza o vault. Se o hook
   nao rodar, use `/second-brain` manualmente.

### Paths

| O que | Onde |
|-------|------|
| Indice geral | `Obsidian/Segundo Cerebro/Claude Code — Torque CRM/00 — INDEX.md` |
| Features | `06 — Features/<dominio>/<feature>.md` |
| Changelog diario | `07 — Changelog/YYYY-MM-DD.md` |
| Changelog detalhado | `07 — Changelog/individuais/` |
| Backlog | `08 — Backlog/<status>/` |
| Decisoes | `04 — Decisões/` |
```

---

## Escopo de implementacao

### Fase 1 — Estrutura e features (~35 notas)
Criar todas as pastas e notas de features com documentacao profunda (produto + tecnico). Atualizar `00 — INDEX.md`.

### Fase 2 — Automacao (hook + skill)
Implementar hook pos-commit no `settings.json`, criar mapa de paths, criar skill `/second-brain`.

### Fase 3 — CLAUDE.md
Adicionar secao do segundo cerebro ao CLAUDE.md do projeto.

### Fase 4 — Backlog inicial
Popular `08 — Backlog/` com items conhecidos (features em progresso, bugs, pedidos pendentes).
