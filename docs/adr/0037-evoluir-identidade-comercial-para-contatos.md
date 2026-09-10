---
status: accepted
---

# Evoluir identidade comercial existente para Contatos

No épico SCRUM-680, o CTO decidiu evoluir o cadastro hoje centrado em leads para Contatos, preservando IDs e referências, em vez de transferir indiscriminadamente pessoas para a estrutura contacts existente. A auditoria SCRUM-681 demonstrou dependências operacionais em comunicação, automações, negócios e API; preservar continuidade evita trocar a identidade de uma pessoa apenas por mudança do modelo comercial. Decisão D1 e síntese D1–D27 aprovadas na SCRUM-682; este ADR aceita a direção, não atesta implementação.

## Alternativa considerada

Migrar registros para contacts mantendo os mesmos UUIDs também é possível, mas exige migrar referências, permissões e caminhos de escrita de forma coordenada. Essa não foi a direção escolhida. A existência de uma tabela contacts vazia não é razão suficiente para torná-la fonte canônica nem autorização para removê-la.

## Mapeamento conceitual

| Origem | Modelo alvo | Continuidade exigida |
|---|---|---|
| Lead que representa pessoa | Contato | Mesmo identificador e preservação das referências/histórico; empresa deixa de ser identidade textual da pessoa |
| Empresa textual associada a pessoa | Empresa e vínculo profissional | Identidade empresarial própria, nomes distintos não agrupados por aproximação; preservação do valor de origem para migração auditável |
| Lead confirmado como somente empresarial | Empresa | Preservar história e rastreabilidade do identificador legado; não inventar contato. Mapeamento físico e contrato externo precisam de especificação própria |
| Cadastro de natureza ambígua | Registro para revisão de migração | Não classificar só pelo nome, descartar ou converter automaticamente em pessoa |
| Deals e pipeline_entries | Negócio e posição no funil | Preservar identidade comercial existente; adaptar referência à pessoa/empresa e participantes conforme invariantes do novo modelo |
| Contacts/deal_contacts já presentes no schema | Estruturas a conciliar com a identidade canônica | Não criar segunda fonte de pessoa nem presumir remoção. Inventariar dependências e definir transição nas tasks de migração/API |

## Consequências e limites

Nome físico leads pode permanecer temporariamente. Produto alvo não possui entidade Lead separada. Não basta renomear menu: autoria de campos, vínculos N:N, participantes e permissões exigem novos contratos.

D18 qualifica continuidade: registros legados exclusivamente empresariais não são pessoas. Não foi decidido reciclar UUID, criar alias específico, usar views ou dual-write; SCRUM-686/730 devem especificar preservação e resolução de IDs em cada contrato antes de migrar.

Campos e índice de telefone existentes não podem impor identidade de pessoa por número: D19 permite telefone compartilhado. Compatibilidade deve preservar idempotência de requisições sem confundi-la com deduplicação de pessoas.

Histórico das decisões de funis/API permanece válido para o modelo implantado, mas referências a Lead devem ser revistas no novo domínio. Este ADR não reescreve automaticamente ADRs anteriores nem autoriza aplicação de migrations, deploy ou quebra de consumidores.

Ver [síntese do domínio](../../.specs/scrum-682-dominio/README.md) e [registro de decisões](../../.specs/scrum-682-dominio/decisoes.md). Base auditada: develop 215ff0bb9; produção e código não devem ser presumidos idênticos.
