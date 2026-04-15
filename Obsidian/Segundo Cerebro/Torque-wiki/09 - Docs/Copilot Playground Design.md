---
tags:
  - torque-crm
  - docs
  - reference
created: 2026-04-14
last_updated: 2026-04-14
status: active
source: docs/copilot-playground-design.md
---

# Copilot Playground - Design Document

## Visao Geral

Substituir o wizard multi-step atual (31 componentes, 9-14 etapas por template) por uma tela unica estilo "Playground de LLM" com editor de prompt + live preview.

## Layout

```
+----------------------------------------------------------------------+
| Header: [Template selector v]  [Nome do Agente]          [Salvar]    |
+----------------------------------+-----------------------------------+
|                                  |                                   |
|  PROMPT EDITOR (~60%)            |  LIVE PREVIEW / CHAT (~40%)       |
|                                  |                                   |
|  Textarea rico com @mentions     |  Chat de teste                    |
|  - @tool -> lista de tools       |  - Input do usuario               |
|  - @doc -> lista de docs/links   |  - Respostas do agente            |
|                                  |  - Botao "Simular conversa"       |
|  [Botao expandir/fullscreen]     |  - Botao "Reiniciar"              |
|                                  |  - Reseta auto ao mudar config    |
|                                  |                                   |
+----------------------------------+                                   |
|                                  |                                   |
|  PAINEIS COLAPSAVEIS             |                                   |
|                                  |                                   |
|  > Settings                      |                                   |
|  > Tools                         |                                   |
|  > Base de Conhecimento          |                                   |
|                                  |                                   |
+----------------------------------+-----------------------------------+
```

## Decisoes

| # | Decisao | Motivo |
|---|---------|--------|
| 1 | Layout "Playground de LLM" | Direto, familiar, foco no prompt |
| 2 | Templates como ponto de partida | Facilita onboarding sem limitar liberdade |
| 3 | Prompt livre + settings essenciais colapsaveis | Equilibrio entre liberdade e configs estruturadas |
| 4 | Tools com painel + config visual + @autocomplete | Combina organizacao visual com fluidez de escrita |
| 5 | Triggers como toggle no painel de settings | Agente proativo eh config, nao tool |
| 6 | Base de conhecimento com painel + @referencia | Gerencia no painel, referencia no prompt |
| 7 | FAQs viram documento ou texto no prompt | Simplifica, elimina step dedicado |
| 8 | Kanban rules como instrucao no prompt | Maxima flexibilidade, menos UI |
| 9 | Chat reseta ao mudar config + simulacao automatica | Teste fiel ao estado atual + teste rapido |
| 10 | 2 colunas fixas com accordions | Ver multiplos paineis + prompt simultaneamente |
| 11 | Prompt editor com fullscreen | Espaco quando o usuario precisa focar no texto |

## Painel: Settings

- Horario de Funcionamento: toggle "sempre ativo" ou horario definido (dias, inicio, fim, timezone)
- Comportamento de Resposta: delay slider 0-45s, temperature LLM (Criativo/Balanceado/Preciso)
- Agente Proativo (toggle):
  - Gatilhos: lead adicionado, mudanca de etapa, tempo sem resposta, tag especifica, origem especifica
  - Config: delay primeiro envio, max tentativas, intervalo entre tentativas, mensagem inicial com variaveis
  - Audios: sub-toggle, ordem (texto/audio primeiro), upload/gravar (max 5)

## Painel: Tools

Cada tool = card com toggle + mini-form de config ao expandir. Tools disponiveis:

| Tool | Parametros |
|------|-----------|
| QUALIFICAR_LEAD | Campos obrigatorios, campos opcionais |
| AGENDAR_REUNIAO | Link de agendamento, instrucoes |
| MOVER_CARD | Pipe (dropdown), etapas (multi-select) |
| ENVIAR_FOLLOWUP | Intervalo minimo entre followups |
| TRANSFERIR_HUMANO | Mensagem de transferencia, para quem |
| CRIAR_LEAD | Campos obrigatorios para criacao |
| ATUALIZAR_CRM | Campos editaveis do lead |
| RESPONDER_FAQ | Sem config extra (usa base de conhecimento) |

Tools ativadas aparecem no @autocomplete do prompt. Badge "X tools ativas" no accordion fechado.

## Painel: Base de Conhecimento

- Documentos: drag & drop + botao upload (PDF, DOC, TXT, imagens). Processados via RAG. Aparecem no @autocomplete.
- Links: input URL + apelido. Aparecem no @autocomplete. Agente pode enviar URL ao lead.
- Badge "X documentos, Y links" no accordion fechado.

## Chat de Teste

- Header: "Live Preview" + botao "Simular" + botao "Reiniciar"
- Baloes estilo WhatsApp (lead esquerda, agente direita)
- Tool calls mostram chip inline (ex: "MOVER_CARD executada -> etapa Negociacao")
- Docs/links mostram preview visual
- Indicador "digitando..."
- Input: campo texto + botao enviar, placeholder "Fale como se fosse um lead..."
- Reset automatico ao mudar prompt/tools/settings (debounce 2s)
- Simulacao: 4-6 turnos automaticos, lead virtual com contexto do prompt, pode continuar manualmente apos

## Fluxo de Criacao

1. Usuario clica "Novo Copilot"
2. Tela Playground abre com selector de template em destaque
3. Template pre-preenche prompt, tools, settings / "Em branco" comeca vazio
4. Edita, testa, ajusta
5. "Salvar" -> valida (nome obrigatorio, prompt minimo, se proativo = 1 gatilho), gera system prompt, salva

## Fluxo de Edicao

1. Clica no agente na listagem
2. Abre Playground preenchido com dados salvos
3. Template selector informativo (nao reseta)
4. Edita, testa, salva

## Geracao do System Prompt

- Prompt do usuario EH o system prompt principal
- @mentions resolvidas no salvar/enviar ao LLM:
  - @TOOL -> tool incluida na lista de tools do LLM com parametros
  - @doc -> contexto RAG injetado no runtime
  - @link -> URL disponibilizada como referencia
- Texto salvo no banco mantem @mentions como estao (formato de edicao)

## Validacao ao Salvar

- Nome obrigatorio
- Pelo menos 1 linha de prompt
- Se "Agente Proativo" ativo -> pelo menos 1 gatilho configurado


## Links relacionados

- [[Onboarding]]

- [[WhatsApp Evolution]]

- [[Copilot]]

- [[00 - INDEX]]
