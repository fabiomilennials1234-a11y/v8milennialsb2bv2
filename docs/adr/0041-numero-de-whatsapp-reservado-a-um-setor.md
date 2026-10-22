# 41. Número de WhatsApp reservado a um setor

Date: 2026-10-22

## Status

Accepted (CTO, 2026-10-22: respostas da cobrança no "chat do Torque, isolado"). Migration `20271213000000_cobranca_regua.sql`. Complementa o ADR-0040 (cobrança é um contexto próprio).

## Context

A régua da cobrança (entrega 2) envia de um número exclusivo, conectado como qualquer outro (`whatsapp_instances`, Uazapi). Sem nada a mais, esse número se comportaria como número comercial, nos dois sentidos:

- **Entrada.** `trg_resolve_message_lead_id` liga a mensagem ao lead que tiver o mesmo telefone — e devedores costumam ser clientes que já foram lead (a TorqueCRM tinha 1.049 leads). O webhook aciona o copilot da org para toda mensagem recebida, e o `agent-message` cria lead para contato desconhecido. O devedor viraria lead e receberia IA de venda.
- **Saída.** Os fallbacks "primeiro número da org" (`resolveInstance`, `selectSendableInstance`, `listRoutable`, seletores locais em follow-up, campanha, pipe, agendadas) escolheriam o número da cobrança para automação comercial. Vários desses caminhos chamam o fornecedor direto, sem passar por um choke comum.

## Decision

**1. A reserva é uma propriedade da instância:** `whatsapp_instances.reserved_for` (`NULL` = número comum; `'collections'` = cobrança; um por org). É a fonte única: quem envia ou recebe já tem a linha da instância em mãos e decide sem consulta extra. A tela da cobrança só escreve nela (`cobranca_regua_definir_numero`, admin da org).

**2. Entrada isolada no banco e na edge.**
- `trg_resolve_message_lead_id_zz_cobranca` (BEFORE, depois do resolve por ordem alfabética) desfaz o vínculo com lead — no INSERT e em qualquer UPDATE de `lead_id`.
- `resolve_uazapi_instance` devolve `reserved_for`; o `triggerReactions` do webhook não aciona copilot nem resolve espera de workflow para o número reservado (custo zero por evento). O `agent-message` recusa por `instance_id` (segunda porta).
- `trg_cobranca_registrar_mensagem` (AFTER) transforma resposta do devedor e mensagem humana do chat em evento do caso; "SAIR"/"PARAR" marca não contatar.

**3. Saída isolada na origem e no choke.**
- Todo seletor org-wide filtra `reserved_for IS NULL`.
- `recusaDoNumeroReservado` no topo de cada remetente de `_shared/whatsapp-dispatch.ts`: número reservado só envia com `trackSource = 'cobranca'` ou categoria manual (mão humana no chat). Disparo em massa (`runUazapiSenderJob`) recusa.
- O número reservado **não pode ter dono comercial nem copilot** (`trg_cobranca_proteger_numero`, nos dois sentidos). Isso fecha os caminhos que escolhem o número pelo dono do lead (`get_lead_write_instance`) ou pelo agente e chamam o fornecedor direto — sem redefinir funções que, em prod, leem o schema `private`.

**4. No chat o número é sinalizado, não escondido.** A conversa aparece com o selo "Cobrança", sem "Sem lead" e sem "Criar lead". Quem a vê é quem tem acesso ao número (`whatsapp_instance_allowed_members`), como qualquer caixa.

## Consequences

- Um setor novo com número próprio (pós-venda, suporte) é um valor novo no CHECK de `reserved_for` e um ramo em `recusaDoNumeroReservado` — não uma tabela nova.
- Ordem de deploy: **migration antes da edge e do front**. O front lê a coluna numa consulta própria e tolerante (`useNumerosDaCobranca`), nunca no select quente do chat; as edges degradam para "número comum" se a coluna faltar.
- O canal oficial (NotificaMe) fica fora desta entrega: mensagem iniciada pela empresa exige template aprovado, e a régua da entrega 2 manda texto livre. `cobranca_regua_definir_numero` recusa provider que não seja chip.
- Copilot v2 (`agent-runtime-v2`) não tem a porta por `instance_id`; em 22/10 tinha 0 agentes e fila vazia em prod. Entra quando o v2 ganhar uso.
