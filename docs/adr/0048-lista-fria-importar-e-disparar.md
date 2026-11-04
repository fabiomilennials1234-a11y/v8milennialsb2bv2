# 48. Lista Fria: "Importar e Disparar" (negócio no funil e mensagem cadenciada)

Date: 2026-11-03

## Status

Proposed. Revisa uma decisão do ADR-0042 ("a lista só exporta e importa; sem disparo", CTO, 27/10/2026). Migration `20271224000000_lista_fria_importar_e_disparar.sql`. Não há deploy em produção até o CTO pedir.

## Context

Hoje a Lista fria termina em "Importar para Lista fria": o contato vira lead numa aba própria, sem funil, sem card e sem mensagem. Para prospectar, o usuário ainda precisa abrir cada lead, criar o negócio e mandar o disparo por outra tela.

O CTO pediu (03/11/2026) um segundo botão, "Importar e Disparar": importar, abrir um negócio de cada contato num funil e etapa que o usuário escolhe e mandar uma mensagem escrita antes, de forma cadenciada.

O que já existe e foi reaproveitado, sem reimplementar:

- `lista_fria_importar` (importação em lote, `FOR UPDATE SKIP LOCKED`, marca o lead, suprime `lead_created` e webhook).
- `abrir_negocio` (adota o card órfão do mesmo lead no mesmo funil; não duplica).
- `blast-plan-create` (plano de disparo: teto diário da org e do número, intervalo entre mensagens, lotes dos dias seguintes, falha, pausa, rastreio de entrega).

## Decision

1. **Quem orquestra é uma edge function** (`lista-fria-importar-e-disparar`), não o navegador: fechar a aba no meio não interrompe, e o resultado fica registrado.
2. **Ordem:** valida e checa a janela de horário → `lista_fria_disparo_preparar` (RPC, com o JWT do usuário) abre o pedido → importa → abre o negócio de cada lead importado → cria o plano de disparo **só com os leads que ganharam negócio**.
3. **Os negócios são abertos todos antes e a mensagem sai em gotejamento depois**, em vez de negócio e mensagem intercalados por contato. O resultado é o mesmo e o negócio já existe quando o lead responde.
4. **Tudo que toca dado do cliente roda com o JWT do usuário** (RPCs e `blast-plan-create`): RLS e permissão valem como na tela. A função exige a flag `lista_fria` e a permissão `lista_fria.edit`. O `service_role` só lê os resultados da busca e atualiza o registro do pedido.
5. **Registro do pedido** em `lista_fria_disparos`: fase, contagens, `plan_id`, erro. Um pedido ativo por busca (índice único parcial); pedido parado há mais de 15 minutos é dado como abandonado e libera um novo.
6. **Teto de 500 contatos por pedido**, fixo na RPC (subir exige migration). Disparo frio em escala é o que queima número.
7. **Só número WhatsApp comum** (Uazapi/Evolution) e **nunca o reservado a um setor** (`reserved_for`, ex.: cobrança). Canal Oficial exige template e fica fora desta versão.
8. **Só dentro da janela seg a sáb, 08h às 20h (Brasília).** O motor de disparo só aplica a janela aos lotes seguintes; o primeiro sai na hora da criação. A função recusa fora da janela, antes de importar qualquer coisa.
9. **A mensagem só aceita `{{nome}}`, `{{primeiro_nome}}`, `{{empresa}}`, `{{segmento}}`** (e spintax `{a|b}`). Qualquer outra variável sairia vazia para o lead, então é recusada na tela e no servidor. `{{responsavel}}` não existe no disparo em plano.
10. **A etapa do negócio não pode ser de ganho, de perda nem desligada.**
11. **Os leads continuam com `excluded_from_metrics = true`.** Prospecção fria não conta como lead de entrada nas métricas de venda, mesmo depois de virar negócio.

## Consequences

- **Falha no meio não desfaz:** o que foi importado fica na Lista fria e o que ganhou negócio fica no funil. O pedido guarda a fase e o erro.
- **Reenviar retoma, não recomeça (corrigido em 04/11).** A primeira versão dizia que reenviar não duplicava nada. Era falso quando a falha vinha no último passo: a busca ficava sem nada a importar, o botão devolvia `nada_para_importar` e os leads ficavam no funil sem mensagem (caso real: 81 contatos). Agora o pedido soma ao que falta importar os contatos que um pedido anterior importou e deixou sem plano (`lista_fria_disparo_pendentes`), e a tela mostra "N já importados aguardam o disparo". Esses contatos **não ganham outro negócio**: `abrir_negocio` só adota card *sem* negócio; num lead que já tem negócio ele cria outro card ("recompra", ADR-0023). Quem já é destinatário de um plano desta busca não entra de novo.
- **O plano de envio é criado como chamada de serviço.** `blast-plan-create` resolvia a org por `team_members` com `maybeSingle`, o que falha para conta master (sem linha) e para usuário em mais de uma org: "No organization". A função agora o chama com a service role e passa a org **da busca** (já validada pela RPC com o JWT do usuário) e o autor; o caminho de usuário do `blast-plan-create` não mudou e continua ignorando org no corpo.
- **Automação de etapa pode duplicar mensagem.** Abrir o card dispara `trg_pipeline_entries_dispatch` (campanhas por etapa) e os workflows de `deal_created`. A tela avisa quando o funil tem "disparo por etapa" ligado, mas **não** detecta workflows. Quem escolhe a etapa precisa saber o que dispara nela.
- **O envio em plano pode não aparecer no histórico do chat de imediato:** `blast-plan-create` não grava `channel_messages`; a mensagem entra pelo webhook de mensagem enviada. Não foi medido em produção.
- **LGPD e termos do Google/Meta** continuam sem revisão jurídica (pendência herdada do ADR-0042). A flag `lista_fria` segue restrita; ligar para um cliente continua sendo decisão do CTO.
- **O teste de banco (pgTAP) não foi rodado** (ver a pendência herdada de rodar pgTAP real).
