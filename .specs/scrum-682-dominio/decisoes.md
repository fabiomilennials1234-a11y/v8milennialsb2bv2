# SCRUM-682 — Registro do planejamento de identidade

Status: decisões D1–D27 e síntese validadas com CTO; detalhamento técnico permanece aberto conforme README. Apenas decisões explicitamente aprovadas são vinculantes; este documento não autoriza implementação. Base inicial: develop `215ff0bb9`. Evidência: auditoria SCRUM-681, PR #2077.

## D1 — Evoluir cadastro existente e preservar identidade

Aprovada pelo CTO em 2026-09-10: “Pode seguir então com essa recomendação”.

Evoluir o cadastro hoje armazenado em leads para representar Contatos, preservando IDs e vínculos existentes. Exemplo: pessoa com ID 123 continua com ID 123 e mantém referências de conversas, atividades e negócios. Empresas entram como cadastros próprios e relações separadas. Não haverá entidade Lead separada no modelo alvo do produto.

O nome físico leads pode permanecer temporariamente durante transição. Isso não fixa para sempre o nome da tabela, nem reduz o trabalho a trocar labels: campos, contratos, permissões e consumidores precisam acompanhar o novo domínio.

Alternativa considerada: transferir registros para a tabela contacts preservando os mesmos IDs e migrando referências/permissões. Não escolhida como direção, pois exige coordenar mais alterações estruturais na transição sem evidência atual de benefício que compense esse custo. Preservar IDs também seria possível nessa alternativa; a diferença é estratégia de evolução das referências, não capacidade de manter UUIDs.

Ainda pendentes: destino da estrutura contacts hoje vazia e de suas referências; tratamento de cadastros legados que representam empresas; ordem de mudanças de schema/contratos; janela de compatibilidade API/Make; vínculos profissionais, responsáveis, integridade e arquivamento. Nenhum merge automático, deduplicação ou conversão de empresa legada em pessoa foi aprovado.

## D2 — Cargo opcional por vínculo profissional

Aprovada pelo CTO em 2026-09-10: “sim”. Cargo pertence ao vínculo contato–empresa, permitindo cargos diferentes por empresa. Exemplo: Ana é diretora na Empresa A e consultora na Empresa B; mantém um único cadastro de pessoa. Cargo pode ficar vazio. Editar cargo em um vínculo não altera os demais. Não confundir cargo com papel de participação em um negócio.

## D3 — Papel opcional por participação no negócio

Aprovada pelo CTO em 2026-09-10: “sim”. Papel comercial opcional na participação contato–negócio, independente do cargo profissional. Exemplos: decisor, influenciador ou contato financeiro. A mesma pessoa pode ter papéis distintos em negócios diferentes. Multiplicidade definida em D21; catálogo e destinatário de comunicação não são determinados pelo papel.

## D4 — Responsáveis pelo contato e pelo negócio independentes

Aprovada pelo CTO em 2026-09-10: “sim”. Responsável pelo relacionamento com o contato independente do responsável por cada negócio. Transferir um negócio não transfere automaticamente o contato ou outros negócios. Exemplo: Maria acompanha o contato Ana; Pedro conduz uma negociação específica. Obrigatoriedade desses responsáveis e efeitos sobre permissões ainda não decididos. Responsável pela empresa definido em D5.

## D5 — Responsável próprio e opcional pela empresa

Aprovada pelo CTO em 2026-09-10: “Sim”. Empresa pode ter responsável próprio e opcional pelo relacionamento com a conta, independente dos responsáveis pelos contatos e negócios. Alterar responsável pela empresa não redistribui automaticamente contatos ou negócios associados. Essa atribuição não define, por si só, permissões de acesso.

## D6 — Encerramento do vínculo profissional com preservação histórica

Aprovada pelo CTO em 2026-09-10: “Sim”. Saída de uma pessoa da empresa encerra seu vínculo profissional, preservando o registro da relação e o histórico dos negócios. Não exclui o contato nem transfere negócios para outra empresa. Exemplo: Ana deixa Empresa A e passa a trabalhar na Empresa B; encerra-se o vínculo com A e cria-se vínculo com B, mantendo o mesmo contato e os negócios anteriores na empresa original. Regras de destinatários e tratamento de negócios abertos precisam de decisão própria; preservar histórico não autoriza continuar enviando mensagens em nome da antiga relação.

## D7 — Revisão da participação em negócios abertos após saída da empresa

Aprovada pelo CTO em 2026-09-10: “sim”. Sinalizar participação para revisão pelo responsável do negócio, sem remover ou substituir automaticamente o participante. Encerramento do vínculo profissional não determina sozinho encerramento da participação comercial: a pessoa pode continuar como consultora externa. Responsável decide se mantém participação ou indica outra pessoa. Destinatários e automações continuam pendentes de decisão específica.

**Refinamento aprovado em D22/D23:** exemplo de consultora externa sem vínculo deixou de ser permitido. Preservação do registro e revisão continuam, mas manutenção da participação ativa exige vínculo ativo com a empresa. D7 não autoriza exceção a essa regra.

## D8 — Pausa contextual explícita enquanto participação aguarda revisão

**Refinada pela orientação D9 abaixo:** pausa não deve ser a única opção da automação. A exigência de sinalização permanece quando houver pausa; critérios de continuidade ainda estão em discussão.

Aprovada pelo CTO com condição: “Sim, mas tem que ter algo explicito que foi pausado, talvez uma notificação para a revisão ou algo do tipo”. Suspender mensagens automáticas destinadas à pessoa no contexto dos negócios afetados até revisão da participação. Não representa bloqueio global do contato nem pausa integral do negócio.

A pausa precisa ser visível e permitir encontrar a revisão pendente; não pode ser silenciosa. Encaminhamento de UX recomendado: aviso persistente no negócio indicando pessoa, motivo, alcance da pausa e ação Revisar participação, acompanhado de notificação ao responsável. Ler ou dispensar a notificação não equivale a resolver a revisão nem a retomar os envios. Desenho final deve ser validado no protótipo SCRUM-685; comportamento de automações e notificações em SCRUM-684.

Pendências técnicas: mensagens já enfileiradas, destinatário substituto, ausência de responsável, deduplicação de notificações, rastreabilidade e semântica de retomada. Recomendação ainda não aprovada sobre retomada: mensagens vencidas não devem ser disparadas em lote automaticamente ao concluir revisão.

## D9 — Alternativa de continuidade configurável na automação

Orientação do CTO: “teria que ter algo na automação, para enviar para o proximo contato da empresa, caso a pessoa não queira pausar”. Automação deve oferecer alternativa de encaminhar para outro contato da empresa em vez de necessariamente pausar. Não confundir troca do destinatário da execução com remoção automática da participação histórica (D7).

Conjunto de candidatos refinado em D10 e prioridade em D11. Ainda não definido: ausência de substituto, ponto de retomada e tratamento de mensagens personalizadas/enfileiradas. A proposta anterior sobre mensagens acumuladas não recebeu aprovação.

A recomendação de restringir candidatos aos participantes do negócio não foi adotada pelo CTO; ver D10. Pausa e notificação quando não houver candidato elegível aprovadas em D12. Semântica final será consolidada em SCRUM-684 e UX em SCRUM-685.

## D10 — Substituto pode ser contato da empresa fora do negócio

Escolha do CTO: “Acho que pode ser vinculado a empresa”. Candidatos à substituição podem vir dos contatos vinculados à empresa, sem exigir participação prévia no negócio. Essa escolha não autoriza seleção entre empresas diferentes de um mesmo contato nem define inclusão automática do substituto como participante do negócio.

Ordem de prioridade aprovada em D11. Elegibilidade por vínculo ativo, canal disponível e regras de comunicação deverá ser detalhada em SCRUM-684. Local da configuração e apresentação pertencem ao planejamento frontend.

## D11 — Prioridade configurável para substituição

Aprovada pelo CTO: “sim”. Permitir organizar ordem de prioridade entre contatos da empresa para escolha do substituto. Exemplo: Ana → Bruno → Carla; após saída de Ana, automação procura próximo contato elegível nessa ordem. Não selecionar arbitrariamente pela data de cadastro. Essa ordem não estabelece empresa principal do contato nem exige participação prévia no negócio.

Ausência de substituto definida em D12. Ainda pendentes: escopo da configuração por empresa/automação, elegibilidade e concorrência na seleção.

## D12 — Pausa explícita quando não há substituto elegível

Aprovada pelo CTO: “sim”. Quando a automação percorrer a lista e não encontrar substituto elegível, pausar o envio afetado e notificar o responsável com motivo e ação de revisão. Exemplo: “Envio pausado: nenhum contato disponível para substituição. Revisar contatos.” Não pausar globalmente o contato, a empresa ou todo o negócio. Tratamento de ausência de responsável e semântica de retomada continuam pendentes em SCRUM-684.

## D13 — Abordagem específica para o substituto

Aprovada pelo CTO: “sim”. Automação possui caminho específico de substituição com mensagem de apresentação e contexto para o novo contato, em vez de entregar diretamente follow-up escrito para a pessoa anterior. Não reiniciar automaticamente o workflow inteiro, pois pode repetir ações comerciais. Configuração do caminho, mensagens enfileiradas e eventual continuidade após apresentação precisam de definição em SCRUM-684. Aprovação não define texto da mensagem nem autoriza envios nesta sessão.

## D14 — Arquivamento reversível da empresa

Aprovada pelo CTO: “Sim”. Arquivar empresa preserva cadastro, vínculos e histórico, removendo-a das seleções para novos negócios até reativação. Não arquiva automaticamente contatos associados. Tratamento dos negócios abertos e automações existentes precisa de decisão específica; não presumir encerramento ou pausa em cascata. Arquivamento também não altera automaticamente receita, carteira ou classificação comercial: essas semânticas pertencem à SCRUM-683.

## D15 — Bloqueio de arquivamento da empresa com negócios abertos

Aprovada pelo CTO: “sim”. Impedir arquivamento enquanto houver negócios abertos vinculados à empresa, exibindo quais precisam de resolução. Não marcar oportunidades como perdidas nem transferi-las automaticamente. Usuário resolve cada negociação conforme seu estado real antes de arquivar. Efeitos sobre automações sem negócio aberto permanecem pendentes em SCRUM-684.

## D16 — Arquivamento reversível do contato

Aprovada pelo CTO: “SIM”. Arquivamento reversível do contato preserva identidade, vínculos e histórico, mas o retira das seleções para novos negócios e da elegibilidade para novos envios automáticos. Não arquiva empresas relacionadas. Escopo da desativação é o CRM da organização, não somente um vínculo profissional. Negócios abertos, mensagens em fila e reativação de automações precisam de regras próprias; não inferir efeitos em cascata.

## D17 — Resolver participações ativas antes de arquivar contato

Aprovada pelo CTO com requisito de UX: “sim, só pense nessas alternativas de modo facil para o usuario, simples na interface e intuitivo”. Bloquear arquivamento enquanto contato tiver participação ativa em negócio aberto, exibindo pendências para substituir participante, encerrar participação ou resolver negócio conforme o caso. Preservar histórico da participação e exigir que negócio mantenha empresa ou contato válido. Não encerrar negócio automaticamente nem exigir arquivar empresa. Participações somente históricas não devem bloquear.

### Direção de interface para protótipo SCRUM-685

Direção confirmada pelo CTO com “SIM” após exemplo textual do modal: pendências resolvidas no mesmo contexto, ações aplicáveis e progresso visível. Aprovação do fluxo conceitual; protótipo visual e detalhes operacionais ainda precisam de validação.

Fluxo guiado no contexto de Arquivar contato. Explicar em linguagem de usuário: “Ana participa de 2 negócios abertos. Resolva as participações para arquivar.” Listar negócios com ações diretas por linha, sem exigir navegação por várias telas:

- Trocar contato: selecionar substituto no próprio fluxo.
- Retirar deste negócio: oferecer quando outro contato válido ou empresa sustenta o negócio; preservar histórico.
- Revisar negócio: abrir contexto quando negociação precisa ser concluída, sem marcar perda como atalho para arquivamento.

Mostrar apenas ações permitidas e aplicáveis. Se retirada deixaria negócio sem empresa nem contato válido, explicar junto à ação que é necessário indicar substituto. Permissões de edição de negócio precisam ser respeitadas; ausência de permissão deve orientar revisão pelo responsável sem revelar dados inacessíveis.

Exibir progresso das pendências resolvidas e habilitar Arquivar contato quando nenhuma restar. Permitir cancelar; não arquivar silenciosamente ao resolver última pendência. Persistência das alterações anteriores e tratamento de falhas parciais precisam ser explícitos no protótipo e contrato técnico. Interface deve manter estado do usuário em caso de erro ou conflito.

Essa é direção de design para validação no protótipo, não tela implementada. Mesma exigência de clareza vale para arquivamento de empresa, pausa e revisão de participação. Evitar mensagens técnicas de constraint, exclusões em cascata ocultas e confirmações repetitivas sem mudança de consequência.

## D18 — Cadastros legados empresariais sem contato fictício

Aprovada pelo CTO: “sim”. Cadastro legado confirmado como somente empresarial, sem pessoa identificada, será tratado como Empresa, preservando histórico, rastreabilidade e relações. Não criar contato fictício com nome da empresa. Registros ambíguos ficam para revisão; não classificar automaticamente só pelo nome.

D18 qualifica D1: continuidade da identidade não significa converter todos os registros legados indiscriminadamente em pessoas. Estratégia concreta de IDs e referências dos registros empresariais, histórico de conversas, mapeamento e compatibilidade permanece planejamento SCRUM-686 e SCRUM-730. Nenhuma regra de detecção automática, descarte, união de registros ou troca de IDs foi aprovada.

## D19 — Telefone compartilhado por pessoas diferentes

Aprovada pelo CTO: “sim”. Permitir contatos distintos com mesmo telefone, como pessoas que usam uma central empresarial; telefone isoladamente não prova identidade da pessoa nem autoriza união automática. Detecção de duplicatas, resolução do destinatário/conversa e compatibilidade com criação via API precisam ser definidos a partir dessa regra. Auditoria registrou unicidade por telefone em contacts e contratos de deduplicação em leads; mudança exige planejamento, não simples retirada de índice. Não implica duplicar envios ao mesmo número ou atribuir uma mensagem a todas as pessoas que o compartilham.

## D20 — Identificação pendente em conversa ambígua

Aprovada pelo CTO: “Sim”. Quando contexto disponível não identifica com segurança a pessoa entre contatos do mesmo número, manter conversa recebida e sinalizar identificação pendente, oferecendo seleção contextual do contato e opção de identificar depois. Não escolher arbitrariamente primeiro cadastro nem copiar mensagem para todos os históricos pessoais. Exemplo de interface: “Quem está falando? Ana / Bruno / Identificar depois”. IA, automações, associação temporal e permissões requerem detalhamento em SCRUM-684; UX em SCRUM-685. Não foi definido que uma seleção atribui retroativamente todas as mensagens do número à pessoa.

## D21 — Vários papéis na mesma participação

Aprovada pelo CTO: “sim”. Um contato pode ter vários papéis no mesmo negócio, como decisor e contato financeiro, sem duplicar a participação. Papéis permanecem opcionais conforme D3. Direção de interface: seleção de etiquetas na participação, sem cadastrar novamente a pessoa. Catálogo e desenho final continuam sujeitos ao planejamento específico.

## D22 — Não admitir participante sem vínculo com empresa compradora

CTO rejeitou proposta de permitir participantes externos com “não”. Negócio com empresa compradora exige vínculo do participante com essa empresa; não admitir pessoa sem esse vínculo nem criar vínculo automaticamente para contornar regra. Isso não torna empresa obrigatória em negócios pessoais, já permitidos. Organização tenant permanece conceito distinto da empresa compradora.

Conciliação com D7 aprovada em D23: exemplo de consultora externa não constitui exceção à exigência de vínculo. Efeito temporal e aplicação a negócios fechados precisam de especificação sem reescrever histórico.

## D23 — Participação ativa exige vínculo profissional ativo

Aprovada pelo CTO: “Sim”. Em negócio com empresa compradora, participante ativo precisa de vínculo ativo com essa empresa. Ao encerrar vínculo, preservar participação anterior no histórico e revisão pendente, mas não manter pessoa como participante ativa sem vínculo. Responsável não pode simplesmente confirmar manutenção ativa se vínculo continuar encerrado. Isso não exclui histórico nem impõe empresa em negócio pessoal.

Regras de pausa/substituição seguem D8–D13; substituição de destinatário não equivale a apagamento da participação anterior. Definição operacional dos estados e concorrência fica na implementação planejada; nenhuma mudança executada.

## D24 — Revisar participantes ao adicionar ou trocar empresa compradora

Aprovada pelo CTO: “Sim”. Ao adicionar ou trocar empresa no negócio, mostrar participantes ativos sem vínculo ativo com empresa escolhida e exigir resolução antes de salvar. Não criar vínculos profissionais nem retirar participantes silenciosamente. Resolver no mesmo fluxo, preservando histórico da mudança e permissões. Aplicação a negócios fechados permanece pendente.

## D25 — Correção explícita de empresa em negócios fechados

Aprovada pelo CTO: “SIM”. Mudança de empresa compradora em negócio fechado deve ocorrer por ação explícita Corrigir empresa, com justificativa e histórico da alteração, sem reabrir negociação automaticamente. Permitir correção de cadastro errado sem tratá-la como edição rotineira. Política de permissão, registro de antes/depois, validação de participantes históricos, impacto em receita/carteira/relatórios e efeitos em integrações precisam de planejamento SCRUM-683/684/730. Aprovação não autoriza recalcular ou reenviar eventos de venda automaticamente.

## D26 — Contatos e negócios podem existir sem responsável

Aprovada pelo CTO: “SIM”. Permitir cadastro de contato ou negócio sem responsável, com estado explícito Sem responsável, preservando entradas por importação e integração antes da distribuição ao time. Complementa D4: responsabilidades são independentes e opcionais. Empresa já tem responsável opcional conforme D5. Não atribuir automaticamente ao criador nem ampliar permissões por ausência de responsável.

## D27 — Revisões sem responsável vão aos administradores da organização

Aprovada pelo CTO: “sim”. Quando negócio não tiver responsável, encaminhar notificação de revisão aos administradores da própria organização, mantendo pendência visível. Não atribuir propriedade do negócio automaticamente nem notificar outras organizações. Regras de acesso, deduplicação, destinatários inativos e assunção da revisão ficam no planejamento SCRUM-684.

## Consolidação

Decisões acima são registro sequencial da discussão. Quando uma pendência antiga é resolvida por decisão posterior, prevalece o refinamento explícito: D26 resolve obrigatoriedade dos responsáveis; D27 resolve destinatário da revisão sem responsável; D12 resolve ausência de substituto; D25 define correção de empresa em negócio fechado, mantendo detalhes técnicos pendentes. Ver [síntese vigente e encaminhamentos](README.md).
