# Café Jurerê — planejamento de escrita no ERP Toth

Data: 2026-09-17.
Estado: decisões de produto consolidadas em 30 respostas do CTO. Etapa 0 autorizada na sessão em 2026-09-17; levantamento local registrado em [cafe-jurere-etapa-0/README.md](cafe-jurere-etapa-0/README.md). Posteriormente, o CTO autorizou construir o lado do CRM. A fundação de rascunhos está em implementação conforme [escopo técnico](../../.specs/features/toth-order-drafts.md). Contrato técnico e homologação do ERP ainda não confirmados; envio real e publicação em produção continuam pendentes.

## Objetivo e limites

Criar pedidos a partir de negócios do Torque, preservando cadastros e pedidos existentes. Evoluir em três entregas: criação, alteração e cancelamento. Toda liberação de escrita depende das proteções comprovadas no Toth e de autorização explícita de produção.

Documentos de contexto: `.specs/project/integracao-erp-cafe-jurere-pedido-formal.md`, `.specs/project/toth-plano-sync-cafe-jurere.md` e `.specs/project/toth-o-que-falta.md`. São registros históricos, não comprovação do estado atual do fornecedor ou da implantação.

## Decisões confirmadas

| # | Decisão |
|---|---|
| 1 | Começar por pedidos para clientes já cadastrados no ERP. |
| 2 | Envio manual após revisão por usuário autorizado. |
| 3 | Criar pedido definitivo, sujeito à confirmação dos efeitos operacionais no Toth. |
| 4 | Somente administradores da organização enviam pedidos ao ERP. |
| 5 | Preços, descontos e condições seguem o ERP, sem edição livre no CRM. |
| 6 | Catálogo sincronizado do ERP; revalidar antes do envio e exigir nova revisão se houver mudanças. |
| 7 | Pedido nasce de um negócio, com rascunho salvo no CRM; salvar não escreve no ERP. |
| 8 | Escopo completo inclui criação, alteração e cancelamento pelo CRM. |
| 9 | Alteração e cancelamento limitados aos pedidos criados pela nova integração; históricos e pedidos criados diretamente no ERP são somente consulta. |
| 10 | Alterar e cancelar somente antes do processamento operacional; situação desconhecida bloqueia a operação. Mapear estados e vínculos impeditivos com o fornecedor. |
| 11 | Mudança direta no ERP bloqueia a operação até atualização dos dados e nova revisão; nenhuma sobrescrita automática. |
| 12 | Resposta incerta gera “Aguardando confirmação”; consultar o ERP antes de liberar nova tentativa. Sem resultado conclusivo, manter bloqueado para conferência. |
| 13 | Um único pedido por negócio. Após cancelamento, um substituto exige outro negócio. |
| 14 | Criação confirmada no Toth marca o negócio como ganho. Resposta incerta não muda o desfecho. |
| 15 | Cancelamento confirmado reabre o negócio e reverte seus efeitos nos indicadores, preservando histórico. Não libera outro pedido no mesmo negócio. |
| 16 | Alteração confirmada do total ajusta valor do negócio e indicadores pela diferença, sem contar outra venda. |
| 17 | Alterações e cancelamentos diretos no Toth refletem os mesmos efeitos no CRM após confirmação pela sincronização, apenas para pedidos da nova integração, sem repetição de efeitos. |
| 18 | Empresa/filial e representante derivam de vínculos válidos no ERP; ausência ou ambiguidade bloqueia envio. Quem envia não é presumido como representante. |
| 19 | Alterações abrangem itens, quantidades e condições comerciais válidas. Cliente, empresa/filial e representante ficam fixos após criação. |
| 20 | Endereço de entrega e frete seguem opções e regras do ERP; sem preenchimento livre. Ausência de dados obrigatórios bloqueia envio. |
| 21 | Respeitar bloqueios de crédito, inadimplência e estoque do ERP, sem exceção local. |
| 22 | Contrato da API de escrita ainda não validado; começar pela confirmação com o fornecedor. |
| 23 | Liberar em etapas: criação → alteração → cancelamento, cada uma com homologação e critérios próprios. |
| 24 | Existência de ambiente de homologação do Toth ainda desconhecida. |
| 25 | Piloto com um administrador designado, poucos pedidos e conferência individual no ERP. |
| 26 | Motivo obrigatório em alterações e cancelamentos; registrar autoria, mudanças e resultado. |
| 27 | Se o ERP confirmar e o CRM falhar, registrar “Sincronização pendente” e recuperar apenas efeitos locais; não reenviar ao ERP. Avisar administrador se persistir. |
| 28 | Usuários com acesso ao negócio e permissão específica preparam rascunhos; envio continua exclusivo de administradores. |
| 29 | Mudança no rascunho invalida a revisão; enviar exatamente a versão conferida. |
| 30 | Capacidade de segurança ausente bloqueia a operação afetada até solução validada com o fornecedor; interface e simulação podem avançar quando o desenvolvimento for autorizado. |

## Roadmap de implementação proposto

### Etapa 0 — contrato, ambiente e levantamento do estado existente

- Inventariar código, sincronizações e regras atuais do CRM em leitura; identificar como negócios ganhos, ajustes de valor e reversões afetam os indicadores. Reaproveitar as regras existentes sem criar uma segunda fonte de venda.
- Obter contrato de criação, alteração, cancelamento e consulta, incluindo códigos estáveis, erros e exemplos sem credenciais ou dados pessoais desnecessários.
- Confirmar homologação isolada do ERP, credenciais próprias e dados de teste. Um ambiente isolado do CRM não isola o Toth.
- Confirmar produtos, preços, descontos, condições, endereço, frete, empresa, representante e validações comerciais.
- Mapear efeitos da inclusão definitiva, estados impeditivos e operações que afetam estoque, cobrança, faturamento e expedição.
- Validar identificação única de operações, consulta de resultados após timeout e proteção contra mudanças simultâneas. Ler antes de gravar, sozinho, não elimina a corrida entre leitura e gravação.
- Reavaliar transporte e credenciais para escrita: os documentos históricos registram HTTP aceito para leitura. Isso não confirma a configuração atual nem estende automaticamente aquela decisão ao novo poder de escrita. Definir canal protegido e permissões mínimas para o novo escopo.
- Confirmar como detectar mudanças diretas no ERP e escolher frequência de reconciliação conforme limites e necessidade operacional.

Saída: matriz de capacidades com evidências, campos e regras definidos, ambiente confirmado e dependências atribuídas. Operação sem garantia essencial permanece bloqueada. Não estimar prazo firme antes dessa saída.

### Etapa 1 — fundação de segurança e rascunhos

- Modelar rascunho versionado, vínculo exclusivo negócio/pedido, origem verificável e registro persistente das operações.
- Aplicar escopo da organização e permissões no servidor; preparar não equivale a enviar. Definir a matriz das ações de alteração e cancelamento antes de implementá-las, mantendo as escritas restritas a administradores como proposta a confirmar.
- Sincronizar catálogo e vínculos, preparar revisão de totais e validar versão no envio.
- Separar situação do pedido, situação da operação e situação da sincronização local.
- Definir auditoria, processamento sem duplicidades, recuperação de falhas e interrupção de novos envios.
- Simular localmente sem chamar endpoints de escrita do ERP.

Saída: rascunhos e proteções validados, sem escrita real. Testes positivos e negativos de autorização e isolamento entre organizações.

### Etapa 2 — criação e primeiro piloto

- Implementar criação manual do pedido definitivo com valores e referências válidos no ERP.
- Persistir identificação da operação antes de enviar; vincular o pedido confirmado sem permitir um segundo pedido para o negócio.
- Marcar o negócio como ganho uma única vez e recuperar falhas locais sem reenviar ao Toth.
- Tratar resposta perdida, clique duplo, concorrência e indisponibilidade com confirmação e reconciliação.
- Implementar já nesta etapa a leitura de alterações/cancelamentos feitos diretamente no Toth para esses pedidos, pois a equipe poderá corrigi-los no ERP durante o piloto.
- Homologar e, após autorização explícita, iniciar piloto com um administrador e conferência individual.

Saída: pedido e negócio conciliados, valores e indicadores corretos, nenhuma modificação em cadastros ou pedidos preexistentes. Criação não depende da liberação das interfaces de alteração e cancelamento, mas depende de acompanhar seus efeitos quando realizados diretamente no ERP.

### Etapa 3 — alteração

- Permitir somente o escopo confirmado: itens, quantidades e condições válidas.
- Exigir motivo, origem comprovada, estado elegível e proteção de concorrência no momento da gravação.
- Revalidar regras comerciais; conflito exige atualização e nova revisão.
- Ajustar valor e indicadores apenas após confirmação, uma única vez por mudança.

Saída: alteração homologada, inclusive disputa com edição direta no ERP, sem sobrescrita e sem duplicação de venda.

### Etapa 4 — cancelamento

- Exigir motivo, origem comprovada, estado elegível e confirmação explícita da ação na interface.
- Aguardar confirmação do Toth antes de reabrir negócio e reverter indicadores.
- Preservar pedido, histórico e vínculo; impedir reutilização do negócio para outro pedido.

Saída: cancelamento e efeitos locais homologados; repetição e resposta perdida não geram reversões duplicadas.

### Etapa 5 — ampliação e operação assistida

- Expandir uso após aceite do piloto e evidências de conciliação.
- Disponibilizar pendências de confirmação, conflitos e sincronização para administradores.
- Documentar resposta a incidentes e conferência manual, responsáveis e critérios de interrupção.
- Interromper novas escritas não deve desligar leitura e reconciliação de operações já enviadas.
- Não tratar desligamento como reversão: pedidos confirmados exigem os procedimentos válidos do ERP.

## Testes de aceite obrigatórios

- Pedidos históricos, cadastros e pedidos de outra origem recusam alteração e cancelamento mesmo por chamada direta ao servidor.
- Membro sem autorização, usuário sem acesso ao negócio e usuário de outra organização não conseguem executar ações indevidas.
- Clique duplo, envio concorrente, repetição de eventos e reinício do processo não criam pedidos ou efeitos comerciais duplicados.
- ERP grava e perde resposta: confirmar o resultado antes de qualquer nova tentativa.
- ERP confirma e CRM falha: recuperar apenas a atualização local.
- Mudança direta no ERP ou no rascunho invalida revisão antiga; proteger também a janela entre validar e gravar.
- Estado impeditivo, vínculo ambíguo, produto inválido, regra comercial recusada e ERP indisponível impedem envio.
- Mudanças de total e cancelamentos afetam indicadores uma única vez, inclusive quando originados diretamente no Toth.
- Negócio já ganho antes do envio não pode contabilizar uma segunda venda; mapear esse cenário no levantamento das regras atuais.
- Eventos atrasados ou fora de ordem não podem restaurar uma versão antiga nem desfazer um cancelamento confirmado.

## Pendências para fechar o desenho técnico

Do fornecedor: contrato, homologação, garantias de concorrência e duplicidade, consultas de resultado, regras e efeitos operacionais, transporte e permissões.

Da Café Jurerê/CTO: nome do administrador do piloto, amostra e duração, critérios quantitativos de aceite, responsáveis por conferência/incidentes e autorização de produção. Confirmar explicitamente a aplicação da restrição a administradores também às ações de alteração e cancelamento, cuja pergunta original tratou do envio de pedidos.

Da engenharia após autorização: levantamento do código atual, desenho técnico, estados e transições detalhados, estratégia de reconciliação, frequência/alertas e estimativas por etapa. Nenhuma lacuna acima autoriza presumir capacidade da API.
