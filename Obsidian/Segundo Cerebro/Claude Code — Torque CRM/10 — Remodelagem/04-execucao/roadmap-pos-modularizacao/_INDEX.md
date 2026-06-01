# Roadmap pós-modularização — fases 1-6

**Criado:** 2026-05-28
**Base:** [`analise-pos-modularizacao.md`](../analise-pos-modularizacao.md) (PR #517 merged)
**Objetivo:** Levar a modularização do estado **estruturalmente completo** para o estado **enforcement real + deployado em prod sem bugs**.

## Estado atual (2026-05-28)

- 14 módulos em `src/modules/` populados, sub-CLAUDE.md em todos, index.ts em todos, ADR de conclusão criado, smoke checklist pronto.
- **CI nunca executou lint/build/tests** porque `npm audit` falha primeiro (8 vulns deps pré-existentes).
- **ESLint boundaries** está em "error mode" mas a regra atual permite qualquer `module → module` (sem barrel-only).
- **dep-cruiser** continua warn-only (não flipado na slice 17).
- **973 deep-imports cross-module** vivos, não enforçados.
- **Event-bus piloto** com infra pronta (table + dispatcher + handler) mas migration **não aplicada em nenhum ambiente** e cron **não ativado**.
- `triggerStageChangedWorkflows` (em `src/lib/workflowTrigger.ts`) é **dead code** pós-slice 19.

## Dependência entre fases

```
  Fase 1 (CI) ──► Fase 2 (Enforcement) ──┐
                                          ├──► Fase 4 (Limpeza)
  Fase 3 (Event-bus dev) ─────────────────┤
                                          ├──► Fase 5 (Deploy prod) ──► Fase 6 (Finalizar)
```

- **Fase 1 → Fase 2**: sem CI rodando, enforcement não é verificável.
- **Fase 2 e Fase 3 independentes**: podem rodar em paralelo (terminais separados).
- **Fase 4 depende de Fase 2 + Fase 3** (limpeza só faz sentido com baseline verde).
- **Fase 5 depende de tudo anterior** (deploy prod = decisão CTO + janela noturna).
- **Fase 6 é o fechamento** após validação prod.

## Constraints invariantes (todas as fases)

1. Zero push em `main` durante fases 1-4. **Fase 5** é a única que toca prod, e **só com autorização explícita do CTO na sessão** + janela combinada.
2. Zero mutação em prod DB (`jsjsmuncfkbsbzqzqhfq`) fora da Fase 5.
3. Fase 3 aplica em **dev** project ref `bcfadphgsibjzivtbjvc` — também apenas com autorização explícita.
4. Push sempre em branch nova. PR target `develop` exceto Fase 6.
5. Sem `--no-verify`, sem skip de hooks.
6. Antes de cada sessão: `git checkout develop && git pull --ff-only origin develop`.

## Fases

| # | Fase | Esforço sessão | Esforço CTO | Janela | Prompt vault |
|---|------|----------------|-------------|--------|--------------|
| 1 | CI unblock | 1h | 0 | qualquer | [`fase-1-ci-unblock.md`](./fase-1-ci-unblock.md) |
| 2 | Enforcement real | 6-8h | 0 | qualquer | [`fase-2-enforcement-real.md`](./fase-2-enforcement-real.md) |
| 3 | Event-bus end-to-end dev | 2h | autorização | qualquer | [`fase-3-event-bus-dev.md`](./fase-3-event-bus-dev.md) |
| 4 | Limpeza pós-validação | 1h | 0 | qualquer | [`fase-4-limpeza.md`](./fase-4-limpeza.md) |
| 5 | Deploy prod | 2-3h | toda fase | noturna | [`fase-5-deploy-prod.md`](./fase-5-deploy-prod.md) |
| 6 | Finalizar (develop → main) | 1h | merge approval | qualquer | [`fase-6-finalizar.md`](./fase-6-finalizar.md) |
| | **Total** | **~13-16h** | | | |

## Como usar

Cada arquivo `fase-N-*.md` é um **prompt definitivo, self-contained**, projetado para ser executado por agente sem contexto prévio. Para abrir terminal e atacar uma fase:

```
Leia o arquivo Obsidian/Segundo Cerebro/Claude Code — Torque CRM/10 — Remodelagem/04-execucao/roadmap-pos-modularizacao/fase-<N>-<nome>.md no vault deste projeto e execute integralmente as instruções dele. Auto mode. Constraints invariantes (zero prod, zero push em main, zero mutação em prod DB fora da Fase 5, sem skip de hooks) são absolutas — se qualquer instrução violar, pare e pergunte. Antes de cortar branch confirme que está em develop sincronizada com origin/develop.
```

Substituir `<N>-<nome>` por: `1-ci-unblock`, `2-enforcement-real`, `3-event-bus-dev`, `4-limpeza`, `5-deploy-prod`, `6-finalizar`.

## Risk gates

Antes de cada fase, validar:

- **Fase 2**: Fase 1 mergeada + CI verde em pelo menos 1 PR de teste.
- **Fase 3**: autorização CTO explícita na sessão para aplicar migration em dev + deploy edge em dev + ativar cron em dev.
- **Fase 4**: Fase 2 + Fase 3 mergeadas + 24h de event-bus rodando em dev sem `domain_events.status='failed'`.
- **Fase 5**: TODAS as fases 1-4 mergeadas em develop + smoke pre-prod verde + janela noturna combinada + CTO presente. **Esta é a única fase que toca prod.**
- **Fase 6**: Fase 5 verde + 48h de monitoria prod sem incidente.
