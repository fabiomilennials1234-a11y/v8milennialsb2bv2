# Nova Conversa no chat

O botão Nova Conversa fica entre Não lidas e + Filtro no desktop e na barra de ações do inbox mobile.

- Solicita somente o número de WhatsApp com DDD, usando a validação brasileira já adotada pelo envio (incluindo telefones fixos comerciais).
- Abre o compositor normal na caixa de WhatsApp selecionada e mostra o nome dessa caixa no formulário. Com várias caixas e nenhuma conversa selecionada, pede escolher uma caixa pelo seletor existente. Não escolhe remetente arbitrariamente.
- Abrir ou cancelar não grava contato, lead ou mensagem. O primeiro envio utiliza o fluxo existente, com suas permissões, recuperação de falhas e persistência.
- Se a conversa já está na lista dessa caixa, abre a existente. Nunca reaproveita uma conversa de outra caixa.
- As ações de criar/ver lead e o painel de contexto aparecem após uma mensagem de saída confirmada como enviada, entregue ou lida. Falha e tentativa pendente não liberam essas ações.
- Não altera o canal oficial/Instagram, que usam outro fluxo de envio. Não requer migration, Edge Function ou branch Supabase.

Validação: testes do formulário, posicionamento do botão, roteamento por caixa, telefone inválido/fixo, envio sem lead, status de envio e cabeçalho; regressão dos hooks de envio e recuperação. Nenhuma mensagem real enviada a clientes durante os testes.
