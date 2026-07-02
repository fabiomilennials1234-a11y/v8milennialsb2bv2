# Motor 100 — definição de automação (disparo por dia)

Artefatos da automação **Motor 100** (cliente, reativação por disparo escalonado).
Relocados da raiz do repo em 2026-06-30 (eram `_motor100_*` scratch não-versionado).

| Arquivo | O que é |
|---|---|
| `wf-definition.json` | Definição declarativa do workflow de disparo (nodes/triggers). Fonte usada para criar os 5 clones de Reativação. |
| `fluxo.txt` | Notas do fluxo: colunas kanban `disparo_segunda..sexta`, waits = +3 dias úteis (pula FDS). |

Contexto: stages de disparo-por-dia criados via Data API (MCP não escreve stage).
Go-live gated em re-parear instância. Ver memória `project_motor100_dispatch_columns`.
