# Ticket 17 — decisão de domínio para “Último contato”

**Status:** decisão necessária do CTO antes de expor o campo.

O modelo atual não oferece uma fonte canônica segura:

- `deals.last_activity_at` muda em edições e movimentos de etapa. Não representa contato.
- `activities` não tem cobertura operacional confiável para provar ausência ou recência.
- `follow_ups.created_at` representa criação de tarefa. Não representa contato com o lead.

O catálogo guiado mantém “Último contato” ausente até o CTO fechar:

1. Eventos elegíveis por canal: mensagem recebida, saída enviada/entregue/lida, ligação conectada, reunião concluída e e-mail.
2. Estados que contam e que não contam: falha, pendência, cancelamento, reação, recibo e evento de sistema.
3. Instante canônico por fonte e regra para sincronização tardia.
4. Efeito de exclusão, correção e reprocessamento de eventos.
5. Escopo da relação: lead inteiro ou negócio exato do gatilho.
6. Tratamento de ações automáticas e contatos internos.

Após decisão, implementação precisa de fonte coberta, contrato de ausência, permissão atual, publicação, avaliação pessoal/automática e migração com rollback. Nenhum timestamp genérico pode substituir essa definição.
