# Node único "Enviar Mensagem" — unifica os 4 nodes de envio WhatsApp via seletor de tipo

**Status:** accepted (2026-06-24)

## Context

O editor de Automações (workflows DAG, `src/modules/workflows/`) expõe hoje **quatro nodes de ação separados** para mandar WhatsApp, cada um um `WorkflowActionType` próprio (`src/types/workflow.ts`):

- `send_whatsapp` — texto (3 modos: livre / template campanha / template Meta)
- `send_whatsapp_audio` — áudio (gravar / template)
- `send_whatsapp_image` — imagem + legenda
- `generate_ai_message` — **não envia**; roda prompt → salva em `{{ai_message}}` → outro node envia depois

Além desses, `send_whatsapp_sticker`, `send_whatsapp_menu` (Uazapi), `send_whatsapp_pix_button` (Uazapi). Na categoria "Comunicação" do picker são **9 entradas** distintas. Quem monta automação tem que saber de antemão o tipo, escolher o node certo, e — pra IA — encadear dois nodes (gerar + enviar).

Cada tipo entra como `case` no `switch(actionType)` do `supabase/functions/_shared/workflow-action-handler.ts`, delegando a um handler dedicado em `_shared/action-handlers/`. Existem **workflows em produção** com esses nodes já salvos no JSON do DAG.

Pedido do CTO: colapsar os tipos de envio WhatsApp num **node único** "Enviar Mensagem" onde se escolhe o tipo num seletor — referência mental Kommo. A IA deve seguir funcionando como hoje (prompt gera a mensagem, variável é inserida no envio), mas **dentro do mesmo node**.

Durante o grill, descartada a leitura "composer" (um node empilha texto+imagem+áudio numa sequência multi-parte): o desejo é **picker** — um node que *sabe* enviar qualquer tipo, mas envia **uma** mensagem por execução.

## Decisões

1. **Novo `WorkflowActionType` `send_whatsapp_message`** — node único "Enviar Mensagem (WhatsApp)". Carrega um discriminador `messageType` (`texto` | `imagem` | `audio` | `sticker` | `menu` | `pix`) + a config daquele tipo. Envia **exatamente uma** mensagem por execução (não é sequência/composer).

2. **Três eixos mantidos separados** — não colapsar o que é genuinamente diferente:
   - **Conteúdo** (o quê) → o `messageType` deste node.
   - **Canal** (onde) → WhatsApp aqui. **Meta message** (`send_meta_message`) e **Template Meta/HSM** (`send_whatsapp_template`) **ficam nodes próprios** — API, identidade e capacidades distintas; Meta não envia menu/pix/sticker Uazapi.
   - **Entrega** (como) → **toggle `semi_automatic`** no node, aplica à mensagem inteira (roteia pra aprovação do SDR antes de enviar) em vez de auto-enviar.

3. **IA = sub-modo do tipo Texto.** Texto tem 3 modos de autoria: `Escrever` (livre) / `Template` (campanha) / `Gerar com IA`. No modo IA, um prompt gera o texto numa variável (default `{{ai_message}}`) e o **mesmo node** envia — preserva o mental de hoje (gerar → variável → enviar), sem segundo node.

4. **`generate_ai_message` NÃO é absorvido — segue node legado vivo.** Ele *não envia*; serve pra gerar texto e usar em **condição** downstream sem disparar nada. Some do picker novo (deprecated), continua executando pros DAGs que o usam.

5. **Tipos no seletor desde já: os 6** (`Texto/Imagem/Áudio/Sticker/Menu/Botão PIX`), **reusando os configs e handlers existentes** (`MenuNodeConfig`, `PixButtonNodeConfig`, `send-whatsapp-media.ts`, `send-whatsapp-rich.ts`). Sem fase 2 pendurada.

6. **Backend aditivo, sem rewrite.** Novo `case "send_whatsapp_message"` despacha por `messageType` para os **handlers já existentes** (`sharedSendWhatsApp`, `sharedSendWhatsAppAudio`, `sharedSendWhatsAppImage`, `sharedSendWhatsAppSticker`, `sharedSendWhatsAppMenu`, `sharedSendWhatsAppPixButton`). Os 4 `actionType` antigos permanecem no `switch` (legado-mas-vivo) — DAGs salvos seguem rodando.

7. **Migração lazy, não destrutiva.** Nada reescreve JSON de workflow em massa em prod. Ao **abrir/salvar** um workflow no editor, nodes antigos (`send_whatsapp`→`texto`, `_audio`→`audio`, `_image`→`imagem`, e sticker/menu/pix→tipo equivalente) são auto-convertidos pro node novo e gravados no próximo save. `generate_ai_message` **não** é convertido (semântica diferente — não envia).

8. **Front/UI sem redesign.** A superfície de edição continua a **sidebar (`ActionPanel`)** de hoje; o `ActionPanel` passa a renderizar o seletor de tipo + o config do tipo selecionado. Avaliado um redesign (node expandindo inline / modal com preview) e **descartado nesta entrega** — escopo cirúrgico, sem mexer no visual.

9. **Rollout gateado por org (feature flag `unified_message_node`).** O node unificado só aparece no picker, e o auto-upgrade lazy só roda, para orgs com a flag `unified_message_node = true` em `organizations.feature_flags` (lido via `useFeatureFlag`, **fail-closed**). Orgs sem a flag veem **exatamente o picker legado** (os 6 envios separados) e seus nós **não são convertidos** — continuam como antes. O **backend não é gateado**: o `case send_whatsapp_message` funciona para qualquer org (seguro — um nó unificado criado no piloto roda mesmo se a flag for desligada depois). Piloto inicial: org **Improving** (`5595bbe2-6bd0-4647-9c22-dc86346aab36`). Toggle por SQL: `UPDATE organizations SET feature_flags = feature_flags || '{"unified_message_node": true}'::jsonb WHERE id = '<org>'`.

## Consequências

- **Picker, não composer.** Mandar texto + imagem continua sendo 2 nodes. Aceito — é o modelo pedido.
- **Categoria "Comunicação" encolhe** de 9 entradas pra ~4 (Enviar Mensagem unificado + Template Meta + Meta message + Semi-automático legado, conforme limpeza). Menos carga cognitiva.
- **Sem big-bang, sem downtime, reversível.** Handlers antigos vivos + auto-upgrade lazy. Pior caso (bug no node novo) não afeta DAGs antigos.
- **Dívida registrada:** os `actionType` legados (`send_whatsapp`/`_audio`/`_image`) ficam mortos no picker mas vivos no executor até todo DAG em prod ter passado pelo auto-upgrade. Limpeza futura só depois de telemetria confirmar zero uso.
- **`generate_ai_message` permanece** como exceção consciente — gerar-sem-enviar é caso real (alimenta condição).
- **CONTEXT.md atualizado:** novos termos **WhatsApp Message Node (Enviar Mensagem)** e **Message Type**.

## Refs

- Types: `src/types/workflow.ts` (`WorkflowActionType`, `ACTION_LABELS`, `ACTION_CATEGORIES`)
- UI: `src/modules/workflows/components/sidebar-panels/ActionPanel.tsx`, `components/nodes/ActionNode.tsx`, `components/action-configs/`
- Backend dispatch: `supabase/functions/_shared/workflow-action-handler.ts`
- Handlers: `supabase/functions/_shared/action-handlers/send-whatsapp*.ts`
- Glossário: `CONTEXT.md` — WhatsApp Message Node, Message Type, Template Variable, Message Gateway, Action Handler
