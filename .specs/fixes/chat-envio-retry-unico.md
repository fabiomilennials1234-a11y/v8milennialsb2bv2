# Envio com uma bolha e recuperação limitada

## Regra

Envio manual no chat WhatsApp, texto e mídia: uma identidade por mensagem.
A primeira falha inicia o contador “Erro no envio, tentando novamente 1/10”.
A recuperação termina no máximo em 10/10, sem décimo primeiro envio, deixando
“Falha no envio” e a bolha vermelha. O botão de retry não reinicia um envio
que já esgotou o limite. Erros de validação anteriores ao envio mantêm a mensagem
acionável existente; não disparam tentativas de transporte.

## Causa verificada

A conversa da imagem tinha só uma cópia da mensagem no banco, entregue. A UI
acumulava falhas locais; o rollback restaurava snapshots inteiros (podendo
ressuscitar bolhas pendentes) e o renderer fabricava IDs com Date.now para falhas.
O cache de falhas não tinha observador. O casamento da otimista text com o eco
conversation também não funcionava.

## Implementação

- Um controlador de recuperação por mutation; retry externo do TanStack desativado.
- Contador atualiza a bolha existente. Refetch preserva pendentes e reconcilia ecos.
- Falha remove somente sua otimista, preservando mensagens concorrentes/realtime.
- Falha mantém ID estável; useFailedMessages observa o cache para atualizar a UI.
- Cor vermelha e rótulo final; esgotamento não permite reiniciar o ciclo pelo retry.
- ACK tardio consultado por organização, instância, telefone, conteúdo/mídia e janela
  temporal. Confirmação não regrava a mensagem entregue como sent.
- Nenhuma gravação sintética local_* no banco quando a resposta não traz ID real.

## Limites importantes

Timeout, erro de rede e HTTP 5xx podem ocorrer após o WhatsApp aceitar a mensagem.
Nesses casos, as tentativas são de confirmação do mesmo envio, sem POST cego.
Somente rejeição HTTP 429 anterior à entrega permite repetir o POST, dentro do
mesmo orçamento total de dez. Isso preserva a proteção existente do Uazapi contra
reenvio de chamadas cuja entrega é incerta. O encerramento cancela novas tentativas
do CRM; não consegue desfazer um envio que o provedor já aceitou.

O estado de falha mantém o armazenamento local no cache do chat existente; não
introduz fila durável, mudança de schema ou retry global de workflows/Copilot.
O escopo corresponde ao envio manual identificado na conversa da captura.

## Validação

Testes simulam dez recusas, sucesso tardio, webhook confirmando entrega, erro
ambíguo sem repost, preservação de realtime ao falhar e transição visual 1/10 →
10/10 → falha com uma única bolha. Nenhuma mensagem real enviada a clientes no QA.
