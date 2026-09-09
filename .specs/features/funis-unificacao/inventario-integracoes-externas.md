# Inventário de integrações externas — formato de funil (SCRUM-638)

Medição: 2026-09-02, prod. Fontes: `runtime_logs.payload_snapshot` do
`lead-webhook` (formato novo grava a intenção `place_in_pipe` desde o
deploy da janela 7, 2026-09-02 07:52 UTC) + Make MCP (read-only).
n8n MCP indisponível — inventário n8n derivado 100% do banco.

## Quem manda o quê (pós-deploy, 37 ingests com intenção)

| Org | Funil pedido | Formato | Desfecho | Precisa migrar? |
|---|---|---|---|---|
| Bolivar | `whatsapp` | slug legado | 100% virou card | Não (alias segura) |
| Central do MDF | `whatsapp` | slug legado | 100% | Não |
| DADUPACK | `whatsapp` | slug legado | 100% | Não |
| Grafica Cauta | `whatsapp` | slug legado | 100% | Não |
| Improving | `whatsapp` | slug legado | 100% | Não |
| Labarr Chocolate | `whatsapp` | slug legado | 100% | Não |
| Liris | `whatsapp` | slug legado | 100% | Não |
| Milennials | `whatsapp`, `confirmacao` | slug legado | 100% | Não |
| Ventimais | `whatsapp` | slug legado | 100% | Não |

- **0 integrações mandam UUID** hoje; 100% usam slug legado.
- **0 pedidos recusados** (404/409) e **0 fallbacks** para o funil padrão
  desde o deploy.
- Migração para `id` é **opcional e gradual** — aliases são contrato
  permanente do adapter (padrão da 626). Nenhuma ação externa obrigatória.

## Make (via MCP, leitura)

- 101 cenários usam o app `torquecrm` (SDK API), **80 ativos** — todos
  falam com a API/webhook pelo app, que aceita os dois formatos. Nada a
  editar. (Lista do MCP capada em 500 cenários de um total maior; os que
  usam o app Torque aparecem completos dentro do recorte lido.)

## n8n

- MCP não conectado nesta sessão. Pelo banco: os senders ativos são as
  orgs da tabela acima (fluxo Trello→n8n→lead-webhook, ~20+ workflows,
  1/cliente). Todos em slug legado, todos funcionando. Migração: opcional.

## API (chaves)

- 49 orgs com chave emitida; **22 ativas em 30d**; 9 orgs de cliente
  usaram a API só em 2026-09-02. Audiência do aviso
  (`aviso-api-funis.md`).
