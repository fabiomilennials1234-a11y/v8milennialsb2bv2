---
tags:
  - claude-code
  - backlog
  - em-progresso
  - qa
  - coverage
created: 2026-04-13
status: em-progresso
priority: alta
---

# Coverage 70%

> [!info] Status
> **20.48%** (977 testes) → Meta: **70%+**
> Gap: 5,613 linhas

## Como continuar

Cole isto no início de qualquer sessão:

```
Continuar o projeto de coverage 70%. 
Leia .specs/features/coverage-70/tasks.md pra ver onde parou.
Rode npm run test:coverage pra ver o estado atual.
Siga os templates em .specs/features/coverage-70/spec.md.
```

## Comandos úteis

```bash
# Ver estado atual
npm run test:coverage

# Ver próximas tasks
grep -n "^\- \[ \]" .specs/features/coverage-70/tasks.md | head -5

# Ver gap exato
node -e "const d=JSON.parse(require('fs').readFileSync('coverage/coverage-summary.json','utf8'));console.log('Lines:',d.total.lines.pct+'%','Gap:',Math.ceil(d.total.lines.total*0.7)-d.total.lines.covered)"

# Rodar teste específico
npx vitest run tests/unit/nome-do-teste.test.ts

# Ver coverage HTML detalhado
open coverage/index.html
```

## Spec e Tasks

- **Spec:** `.specs/features/coverage-70/spec.md` — padrões, helpers, templates de teste
- **Tasks:** `.specs/features/coverage-70/tasks.md` — sprint por sprint, o que falta

## Progresso

| Sessão | Testes | Coverage | Delta |
|--------|--------|----------|-------|
| 2026-04-13 | 273 → 977 | 6.61% → 20.48% | +13.87% |

## O que falta (resumo)

1. **Hooks** (12.7% → 65%): Testes com `renderHook` + `waitFor` pra os 20 maiores hooks
2. **_shared** (26.2% → 55%): Mock mais profundo nos gigantes (ai-action-executor, workflow-action-handler, meta-api)
3. **Contexts** (38.8% → 80%): OrgFeaturesContext e ThemeTransitionContext
4. **Lib** (67.4% → 80%): evolutionApi, audioToMp3, workflowTrigger

## Links

- [[Protocolo]] — protocolo de agentes
- [[00 — INDEX]] — índice do vault
