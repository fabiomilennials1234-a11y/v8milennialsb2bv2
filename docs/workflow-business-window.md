# Janela Comercial

O nó controla quando o fluxo pode continuar. Ele não envia mensagens por conta própria.

| Situação | Comportamento |
| --- | --- |
| Dentro de uma janela de saída padrão | Continua apenas pelas conexões da saída padrão. |
| Dentro de uma janela com saída própria | Continua apenas pelas conexões dessa janela. |
| Dentro de horários sobrepostos | A primeira janela da lista prevalece. As setas do editor alteram essa ordem. |
| Fora de todos os horários | Aguarda a próxima janela da saída padrão, mesmo que uma saída nomeada abra antes. |
| Somente saídas nomeadas cadastradas | Aguarda a próxima janela nomeada disponível. |
| Horário atravessa meia-noite | O período continua no dia seguinte ao dia selecionado. |
| Início e fim iguais | Período de 24 horas. O minuto final é inclusivo. |
| Retomada agendada | Distribuição determinística de até 30 minutos, limitada à metade da duração da janela; depende também do processamento da fila. |
| Retomada atrasada mais de 24 horas | Execução cancelada, sem seguir para os próximos nós. |

Use um único nó com duas janelas para escolher entre manhã e tarde. Duas janelas ligadas à mesma saída não representam ramos independentes: o executor mantém apenas um ponto de retomada. O editor bloqueia a ativação desse desenho direto. Isso não implementa execução paralela para outros desenhos com esperas.

Coloque a janela depois de um atraso e imediatamente antes do envio quando o horário da mensagem precisar ser controlado. Um atraso posterior pode levar o envio para fora da janela.

Na ativação, o editor valida dias, horários, fuso, limite de seis janelas, conexões de saídas nomeadas e conexões antigas sem janela correspondente. Rascunhos podem ser salvos para corrigir esses problemas depois. Essa validação é do editor, não uma restrição de banco para outros clientes da API.

Configurações antigas continuam sendo interpretadas pelo executor. `hold_until:` sem alvo libera pela saída padrão; com alvo representa bloqueio e aguarda conforme a prioridade acima (o nome do alvo não seleciona a próxima janela). A condição de horário de um nó Condicional é outro recurso e não foi alterada aqui.

Validação: testes do executor com relógio controlado e ações simuladas, testes do editor com interação real nos componentes e testes do contrato de ativação. Não disparam mensagens reais.
