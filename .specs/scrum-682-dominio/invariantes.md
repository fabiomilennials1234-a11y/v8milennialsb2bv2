# Invariantes e cenários para implementação

Contrato derivado das decisões aprovadas; **não são testes executados**. Destinado a orientar testes de domínio, integração/RLS e jornadas frontend. Isolamento de tenant é requisito existente do projeto, não nova decisão de produto. Implementação só deve começar após fechar contratos da respectiva task.

| Regra | Cenário positivo | Cenário negativo / resultado proibido |
|---|---|---|
| Identidade contínua (D1) | Pessoa migra conceitualmente a contato mantendo ID e histórico | Criar segunda pessoa e abandonar referências antigas só para mudar nomenclatura |
| Contato independente | Criar pessoa sem empresa nem negócio | Exigir empresa fictícia para cadastro pessoal |
| N:N profissional e cargo (D2) | Ana tem cargos diferentes em A e B | Editar cargo de A sobrescrever cargo de B |
| Negócio com empresa ou contato | Criar negócio pessoal; criar negócio só de empresa | Salvar negócio sem empresa e sem contato válido |
| Uma empresa compradora | Negócio aponta para empresa A | Atribuir duas empresas compradoras simultaneamente |
| Tenant consistente | Contato, empresa e negócio da mesma organização | Vincular registros de organizações diferentes por API, RPC ou escrita direta; privilégios não justificam relação comercial cruzada |
| Papéis por participação (D3/D21) | Ana decisora e financeira na mesma participação | Duplicar participação para segundo papel |
| Responsabilidades independentes (D4/D5/D26) | Transferir dono de negócio; contato e empresa mantêm responsáveis | Propagar transferência silenciosamente ou impedir cadastro sem responsável |
| Histórico de vínculo (D6/D7/D23) | Encerrar vínculo preserva participação histórica e revisão | Manter participação ativa sem vínculo ativo ou apagar histórico da saída |
| Revisão de troca de empresa (D24) | Resolver incompatibilidades no fluxo antes de salvar | Salvar empresa nova com participante ativo incompatível ou criar vínculo silencioso |
| Substituição configurada (D9–D13) | Selecionar próximo elegível pela prioridade e executar abordagem específica | Enviar para número anterior, repetir workflow inteiro ou escolher por ordem arbitrária |
| Sem substituto (D12/D27) | Pausa explícita; aviso ao responsável ou administradores da org | Falha silenciosa, atribuição automática de proprietário ou notificação a outro tenant |
| Arquivar empresa (D14/D15) | Sem negócios abertos, arquivar e posteriormente reativar | Arquivar com negócio aberto, arquivar contatos em cascata ou marcar venda perdida automaticamente |
| Arquivar contato (D16/D17) | Resolver participações, arquivar preservando histórico | Arquivar com participação ativa aberta, incluir arquivado em novos negócios/envios ou deixar negócio sem vínculo mínimo |
| Corrigir empresa de negócio fechado (D25) | Ação explícita, justificativa e histórico | Reabrir negócio automaticamente ou tratar troca como edição sem registro |
| Empresa legada (D18) | Classificação confirmada gera representação empresarial | Criar pessoa fictícia ou decidir natureza pelo nome sem revisão |
| Telefone compartilhado (D19/D20) | Duas pessoas usam número; conversa ambígua aguarda identificação | Mesclar pessoas, copiar mensagens a todos ou escolher primeiro cadastro |

## Concorrência e limites a projetar

Implementação deve validar regras no momento da escrita, não confiar em lista ou permissão carregada anteriormente pela UI. Testes precisam simular: encerramento de vínculo concorrente à inclusão do participante; abertura de negócio concorrente ao arquivamento da empresa; nova participação concorrente ao arquivamento do contato; dupla execução de substituição; resolução de revisão após troca de responsável.

Resultado exigido: estado persistido respeita invariantes e UI informa conflito com ação recuperável. Ordem de serialização, transações, locks, idempotência e política de retentativa são escolhas técnicas ainda a especificar. Não foi decidido que operações em massa serão inteiramente atômicas ou parcialmente confirmadas; essa semântica precisa aparecer no contrato e no protótipo.

## Pendências que impedem certificação completa

Contato principal, autoria/proveniência, exclusão definitiva, regras temporais para participantes de vendas encerradas, histórico financeiro, fila de mensagens, consentimento/destinatários, prioridade por empresa versus automação, implementação de isolamento e permissões continuam detalhamento das tasks indicadas no README. Não confundir os cenários acima com cobertura total ou teste de produção.
