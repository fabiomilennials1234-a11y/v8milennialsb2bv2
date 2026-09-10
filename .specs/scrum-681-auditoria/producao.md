# Estado aplicado — evidência somente de leitura

Consulta em 2026-09-10 via conector Supabase, projeto `jsjsmuncfkbsbzqzqhfq` (Torque CRM | PRODUÇÃO). [Evidência JSON](evidence/production-schema.json) preserva consultas e resultados de catálogo/contagens, sem registros individuais, tokens ou credenciais. Consultas ocorreram separadamente, não em snapshot transacional único; horário do JSON marca captura inicial do conjunto, complementado na mesma sessão com triggers e funções.

## Confirmado no ambiente

| Observação | Evidência | Consequência |
|---|---|---|
| companies, contacts e deal_contacts têm zero linhas na consulta | `results.counts` | Fundação existe, uso dessas tabelas não está materializado neste instante. Não significa recurso descartável; não houve remoção. |
| contacts contém company_id opcional; deals contém company_id/source_lead_id opcionais | `results.columns` | Campos isolados não entregam vínculo N:N nem jornada empresa-only. |
| Nome empresarial único por org com lower(trim(name)) | `results.indexes` | Não atende automaticamente igualdade literal; manter regra de não agrupar nomes diferentes e especificar caixa/espaços/Unicode no planejamento. |
| Contatos ativos têm telefone normalizado único por org | `results.indexes` | Migração precisa detectar colisões e telefones compartilhados, sem presumir uma pessoa por telefone. |
| pipeline_entries não possui UNIQUE(lead_id,pipeline_id); possui unicidade parcial de deal_id | `results.indexes`, `results.constraints` | Negócios simultâneos já suportados estruturalmente; não duplicar trabalho anterior. |
| abrir_negocio lê organização a partir do lead e falha quando não o encontra | `results.functions` | Bloqueio empresa-only confirmado na função aplicada, além do frontend e API de fonte. Função não foi executada. |
| migrate_leads_to_contacts_companies ainda existe, SECURITY DEFINER, agrupa lower(trim), cria um contato por lead | `results.functions` | Não usar essa função como migração do épico sem novo projeto técnico; não foi chamada. |

## Divergência entre fonte e produção

Migrations de `develop`, especialmente `20270920000010_org_plural_nas_39_tabelas_restantes.sql`, descrevem policies multi-org para companies, contacts e deal_contacts. Catálogo vivo ainda mostra `get_user_organization_id()` nessas relações e policies extras de leitura master. Deals/pipeline_entries já mostram `get_my_organization_ids()`.

Portanto, seção RLS do [inventário backend](backend.md) descreve **fonte**, não estado aplicado. Não inferir causa: consulta dos últimos 12 registros do ledger não prova que uma migration específica rodou ou foi revertida; versão presente tampouco prova definição atual. Comparar cadeia completa e estado desejado antes de planejar aplicação. Datas sintéticas de migrations não são datas reais de implantação.

## Integridade entre organizações: prioridade alta de validação

Catálogo de deal_contacts mostra FKs individuais para negócio/contato e policies que verificam organização pelo negócio. Não há trigger de usuário nessa tabela no catálogo consultado. Não aparece garantia de que contato e negócio pertencem à mesma org nessa combinação de constraints/policies/triggers.

Achado estrutural, **não exploração reproduzida**: não foram tentados inserts nem usados usuários de tenants distintos. Planejamento de autorização precisa prova negativa e positiva em ambiente isolado e exame de grants/caminhos de escrita. Estender análise aos vínculos contacts.company_id, deals.company_id e companies.parent_id. Não ampliar visibilidade de históricos ao trocar o modelo.

## Limites e próximos levantamentos

- Projeto dev informado nas instruções (`bcfadphgsibjzivtbjvc`) não apareceu em list_projects desta sessão. Não assumir disponível nem criar ambiente aqui. Estratégia de ensaio pertence ao planejamento da migração.
- IDs exatos de Milennials e TorqueCRM ainda precisam de verificação antes de qualquer gate ou backfill. Nomes da conversa não são autorização para adivinhar IDs.
- Não foram medidos duplicados, distribuição por org, colisões de nomes/telefone, volume de anexos, estimativas de duração ou plano de execução de backfill. Tarefa de migração deve medir agregados sanitizados antes de dimensionar lotes.
- Não houve comparação exaustiva de todos os RPCs, grants, triggers e funções implantadas, replay de migrations, EXPLAIN, teste RLS ou mutação em produção.
- Aplicação observada pode avançar depois da coleta. Revalidar catálogo antes da implementação; source commit fixa evidência do código.
