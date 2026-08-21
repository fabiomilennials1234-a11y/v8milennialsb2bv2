# O disparo pelo canal oficial tem motor próprio, e o destinatário é a unidade

**Status:** accepted (2026-08-21)

Revisa o enquadramento do ADR-0016 (ver Decisão 4). Estende ADR-0003 (orçamento diário e planos) e ADR-0002 (Disparo Rápido). Guardrails do mesmo canal: ADR-0029.

## Context

O Disparo em massa do Torque não é nosso: é da Uazapi. Os quatro criadores — `mass-send-create`, `quick-blast-create`, `blast-plan-create` e `blast-plan-release` — convergem num ponto único (`_shared/dispatch-router.ts:152`) que chama `provider.senderAdvanced`, e a partir dali quem ritma, retenta e conta é o endpoint `/sender/advanced` do fornecedor. Todo o estado do produto pendura em `uazapi_sender_jobs`: progresso, pause/resume/stop (via `/sender/edit`), reconciliação de falha e o painel do front.

O canal oficial (WhatsApp Business Platform via NotificaMe) não tem esse endpoint. O provider define `senderAdvanced` apenas para lançar `NotSupportedError` (`_shared/whatsapp-providers/notificame-provider.ts:1732`). Não é uma allowlist a alargar — é a ausência de um laço.

Levantamento na documentação do fornecedor (2026-08-21, host canônico `app.notificame.com.br`, 167 KB, 15 dias mais novo que o host que o Google indexa): **não existe equivalente ao `/sender/*`**. A Marketing Messages API exposta pelo hub é um trilho de entregabilidade, não de lote — uma requisição por destinatário. Há um `POST /v1/message-batches` no SDK oficial (`notificamehubsdk@0.0.27`) que não aparece em documentação nenhuma, em nenhum dos três hosts; contrato recuperado de binário, existência não confirmada.

O que a documentação da Meta acrescenta e muda o desenho:

- **A cobrança é por mensagem entregue**, não por envio, e o modelo por conversa está deprecado desde 01/07/2025.
- O **TTL** de um template de marketing vai a 30 dias, e mensagem não entregue dentro do TTL é **descartada em silêncio**.
- **Não há chave de idempotência** no NotificaMe (busca por `idempot`/`retry`/`duplicad` na doc: zero ocorrências). Reprocessar um lote parcialmente enviado duplica envio — e a duplicata é cobrada.

Medição em produção (2026-08-21): a história inteira do produto tem **3 disparos**, e os **3 falharam**. O mais recente é de hoje, 11h29, da Distetica: plano de 235 destinatários, lote de 10, `sent=1`, `failed=0`, job `failed`. O produto não sabe dizer quem recebeu — porque o estado mora num contador agregado, não na pessoa.

Do outro lado, metade do motor já existe e estava invisível: `blast_plan_recipients` guarda `pending | sent | skipped | failed` **por destinatário**; há jitter, fatiamento diário, orçamento por org e por número, e um molde de worker cron drenando fila (`process-outbound-dispatches`). E o problema mais caro da observabilidade — casar o callback de status com a linha certa — **já está resolvido**: `notificame-webhook/index.ts:1133-1208` casa pelo `provider_message_id`, o id estável, com fallback por `external_id`; o outro id muda a cada callback do mesmo envio.

## Decisões

1. **Existe um Disparo, e a Instance escolhida decide o regime.** Chip manda texto livre; Canal Oficial manda template aprovado, porque quem recebe um broadcast está por definição fora da janela de 24 horas. Público, Orçamento Diário, Plano de Disparo e os refinamentos de audiência são os mesmos nos dois regimes. Avaliada e descartada a criação de um segundo objeto ("Campanha Oficial"): duplicaria público, orçamento, plano e painel para modelar uma diferença de conteúdo, e obrigaria o operador a saber de antemão em qual porta entrar.

2. **O motor é uma fila por destinatário, reusando `blast_plan_recipients`.** Um worker próprio reivindica linhas pendentes e envia template 1:1 por `sendTemplateViaInstance` (`_shared/whatsapp-dispatch.ts:393`), que já traz governança, dedup de conteúdo, espelhamento de mídia de cabeçalho e classificação de falha. Pausar é o worker parar de reivindicar; retomar é seguir na próxima pendente. Descartada a fila exclusiva do canal oficial: duplicaria plano, lote, orçamento e painel, e deixaria a cegueira do chip como dívida em vez de consertá-la de passagem.

3. **Template para todos os destinatários, inclusive os que estão dentro da janela.** Medido em 2026-08-21: no disparo real de 235 pessoas da Distetica, **7 estariam dentro** da janela — cerca de 3%. O modo híbrido (texto livre grátis para quem está dentro, template pago para quem está fora) economizaria 3% ao custo de dois caminhos de envio, duas formas de erro e duas provas de conformidade.

4. **`sent` deixa de ser o fim da linha.** O ciclo por destinatário é `pending → sent → delivered | failed`, alimentado pelos callbacks de status. **O custo realizado do disparo é a soma das entregues**; o que está apenas enviado é custo previsto. Passado o TTL sem confirmação, a linha termina num estado explícito de *não confirmada* — nem entregue, nem falha.

   Isto revisa o enquadramento do ADR-0016, que registrou `sent` como "aceito pela fila" e declarou que nenhuma semântica de recibo seria implicada ou rastreada. Aquilo era correto para o chip, onde `sent` é o melhor fato disponível e ninguém cobra por entrega. No canal oficial a distinção é dinheiro: parar em `sent` faria o Teto de Gasto (ADR-0029) limitar uma estimativa enquanto a fatura da Meta mede outra coisa.

5. **A idempotência é nossa, por linha.** O fornecedor não oferece chave de idempotência, e a reentrega de um lote parcial é o caminho natural de qualquer retomada. A garantia de envio único vive na linha do destinatário — reivindicada antes do envio, nunca reprocessada por outro tique do worker.

6. **O Disparo Rápido também envia pelo canal oficial**, no mesmo motor. Hoje ele é o único lugar onde dá para tentar: o wizard filtra o provedor e esconde o número oficial (`disparo-wizard/instances-to-numbers.ts:31`), enquanto `QuickBlastDialog.tsx:91-95` filtra só por status — o número oficial aparece no seletor e a tentativa devolve ao vendedor a string crua `notificame does not support senderAdvanced`. Descartado remover o número oficial dali: uma Organization que só tem canal oficial — como as novas nascem — ficaria sem disparo rápido por omissão, e não por decisão.

## Consequências

- A tela de acompanhamento deixa de ser um contador e passa a ser uma lista de pessoas com estado. Um disparo continua "vivo" depois de terminar de enviar, enquanto entregas e falhas chegam.
- O caminho do chip herda o conserto: passa a existir quem recebeu, em vez de `sent=1` sem sujeito.
- O `POST /v1/message-batches` não documentado permanece uma pergunta aberta ao fornecedor. Mesmo que exista e seja estável, a fila por destinatário continua necessária para custo, supressão e reconciliação — não vira trabalho jogado fora.
