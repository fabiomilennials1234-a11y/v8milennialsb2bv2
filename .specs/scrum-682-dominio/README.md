# SCRUM-682 — Síntese do modelo acordado

Status: síntese D1–D27 validada pelo CTO com “sim”. Não é implementação nem especificação técnica completa. [Registro D1–D27](decisoes.md), [ADR da direção canônica](../../docs/adr/0037-evoluir-identidade-comercial-para-contatos.md) e [invariantes para implementação](invariantes.md). Fonte de evidências: auditoria SCRUM-681, PR #2077. Branch de planejamento baseada em develop `215ff0bb9`.

## Identidade e relações

- Contatos substituem Leads no produto, evoluindo cadastro existente e preservando IDs/referências. Tratamento físico final, compatibilidade e migração não se resumem a renomear tabela.
- Empresa é opcional para contato; contato pode ter várias empresas. Cargo opcional pertence a cada vínculo profissional.
- Negócio tem até uma empresa compradora e vários contatos, exigindo empresa ou contato. Negócio pessoal não exige empresa.
- Participante ativo de negócio empresarial exige vínculo ativo com empresa compradora. Trocar/adicionar empresa exige resolver participantes incompatíveis antes de salvar; sem vinculação ou retirada silenciosa.
- Contato pode exercer vários papéis opcionais na mesma participação, sem duplicá-la.
- Contato, empresa e negócio têm responsáveis independentes e opcionais. Sem responsável, revisões notificam administradores da própria organização; isso não atribui propriedade automaticamente.

## Histórico, comunicação e automação

- Saída da empresa encerra vínculo e preserva histórico. Participação anterior permanece, com revisão pendente, mas não pode continuar ativa sem vínculo ativo.
- Automação pode pausar ou substituir destinatário conforme configuração. Substituto pode vir dos contatos da empresa mesmo sem participação prévia no negócio, seguindo prioridade configurável.
- Sem substituto elegível, envio afetado pausa e responsável é notificado. Pausa é explícita, com ação para revisão; não equivale a bloquear todo contato, empresa ou negócio.
- Substituto recebe abordagem própria; não reiniciar automação inteira nem entregar simplesmente follow-up escrito para pessoa anterior.
- Contatos distintos podem compartilhar telefone. Mensagem ambígua fica recebida com identificação pendente; não escolher primeiro cadastro nem copiar histórico para todos.

## Arquivamento e correção

- Empresa e contato podem ser arquivados reversivelmente, preservando histórico e vínculos. Arquivar um não arquiva os demais.
- Empresa com negócios abertos não pode ser arquivada; contato com participações ativas em negócios abertos exige resolução antes de arquivar.
- Contato arquivado fica fora de novos negócios e novos envios automáticos; empresa arquivada fica fora de novos negócios até reativação.
- Interface resolve pendências no contexto da ação, mostra progresso e apenas alternativas válidas. Não marcar negócios perdidos nem remover participantes silenciosamente para liberar arquivamento.
- Negócio fechado admite ação Corrigir empresa, com justificativa e histórico, sem reabrir automaticamente.

## Migração e rollout já acordados

- Cadastros confirmados como somente empresariais serão Empresas, sem pessoa fictícia. Casos ambíguos vão para revisão. Estratégia de preservação/mapeamento dos IDs desses casos precisa ser especificada.
- Nomes empresariais diferentes permanecem distintos; sem agrupamento aproximado. Igualdade técnica de caixa/espaços/Unicode ainda requer especificação compatível com essa decisão.
- Piloto Milennials e TorqueCRM; disponibilidade final para todas as organizações. IDs das orgs devem ser verificados antes de configurar execução.
- PRs direcionados a develop. Este planejamento não autoriza deploy nem alteração em produção.

## Ainda exige planejamento técnico / grill-with-docs

| Task | O que falta definir antes da implementação |
|---|---|
| SCRUM-682 / SCRUM-696 | Direção canônica e mapa conceitual registrados no ADR-0037; detalhamento físico do destino de contacts e compatibilidade segue SCRUM-686/730 |
| SCRUM-697 | Contato principal por negócio, sua relação com destinatário e autoria/proveniência dos vínculos; não inferir principal a partir de papel ou prioridade de substituição |
| SCRUM-698 | Exclusão definitiva versus arquivamento, efeitos temporais e regras concorrentes; invariantes aprovados estão documentados, mecanismo de garantia ainda não implementado |
| SCRUM-683 | Receita/carteira/denominadores históricos; efeitos de correção de empresa em vendas fechadas |
| SCRUM-684 | Permissões; estados de revisão; destinatários; filas e mensagens vencidas; continuidade após substituição; contexto IA e telefone compartilhado; concorrência; notificações |
| SCRUM-685 | Protótipo, telas e fluxos; seleção de papéis/prioridade; arquivamento e correção; falhas parciais, cancelamento, acessibilidade e estados vazios |
| SCRUM-686 | Classificação do legado, igualdade de nomes, colisões, mapeamento de IDs, ordem de migração, ensaio, reconciliação, recuperação e controle de efeitos colaterais |
| SCRUM-687 | IDs e gates do piloto, observabilidade, critérios de expansão |
| SCRUM-730 | API/Make, ID externo, deduplicação versus idempotência, versionamento, eventos e consumidores efetivamente publicados |

Implementação fica nas tasks SCRUM-688/689/690/691/692/731, após contratos correspondentes. Esta síntese não encerra automaticamente tasks de planejamento nem converte perguntas técnicas pendentes em decisões aprovadas.
