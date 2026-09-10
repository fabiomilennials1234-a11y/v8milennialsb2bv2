# SCRUM-693 — Inventário backend e identidade comercial

Data: 2026-09-10. Base: develop `215ff0bb9`, checkout isolado `torque-scrum-681-audit`. Auditoria estática; nenhum SQL executado nem ambiente alterado. Evidência de código não comprova aplicação em produção. Prefixos de migrations usam datas sintéticas; não representam datas de implantação. `archive/` é histórico, não cadeia ativa.

## Resultado

O sistema já separou identidade/dinheiro do negócio (`deals`) de posição (`pipeline_entries`), mas mantém `leads` como identidade operacional da pessoa. `contacts`/`companies` existem em paralelo; não basta renomear menu nem executar antiga RPC de backfill. Não foi encontrada relação N:N contato–empresa na cadeia inspecionada.

## Inventário de entidades

Referências `B` abaixo significam `supabase/migrations/20260101000000_baseline_prod_schema.sql`.

| Entidade | Contrato encontrado | Evidência |
|---|---|---|
| `leads` | Nome obrigatório, empresa textual opcional; telefone/email, qualificação, origem, responsáveis, estado IA e soft delete. `contact_id` e `company_entity_id` opcionais convivem com identidade antiga. | B:24853; B:34979 |
| `contacts` | Pessoa com `company_id` opcional, cargo na própria pessoa, `source_lead_id`, `is_primary`, telefone/email e soft delete. Não representa múltiplos vínculos com cargos distintos. | B:22668; B:34044 |
| `companies` | Org obrigatória, nome, domínio, segmento, endereço, parent_id e metadata; empresa pode existir sem contatos. | B:22527 |
| Identidade empresarial | Índice único `(organization_id, lower(trim(name)))`. Diferencia letras, mas colapsa caixa e espaços externos. | B:30536 |
| Identidade de contato | Telefone normalizado único por org entre contatos ativos, quando preenchido; source_lead_id indexado mas não único. | B:30588; B:30592 |
| `deals` | Empresa opcional; lead de origem opcional no schema inicial. Contratos de abertura exigem lead. Owner, título, valor, desfecho e procedência. | B:24045; `supabase/migrations/20271004000000_as_escritoras_saem_dos_espelhos.sql:13` |
| `deal_contacts` | N:N negócio–contato já existe, role livre e is_primary; UNIQUE(deal_id, contact_id). Sem organization_id próprio. | B:23989; B:28939; B:34533 |
| `pipeline_entries` | Identidade própria da posição, lead_id e deal_id. Posição saiu de deals. Views de compatibilidade preservam interfaces anteriores. | B:26064; `supabase/migrations/20270803000010_deals_drop_position_columns.sql:69`; `supabase/migrations/20270908001000_inversao_do_silo_custom.sql:594` |
| `activities` | Já admite filtros separados por contato/empresa/deal/lead na RPC get_activities. | B:5863 |
| Identidade social | `lead_social_identities` liga sujeito externo por canal ao lead; mensagem é cache derivado. WhatsApp também usa telefone e preferências independentes do lead. | `supabase/migrations/20270817090000_lead_social_identities.sql:184`; B:26049 |

Tipos gerados refletem entidades: `src/integrations/supabase/types.ts:3604` companies; `:4034` contacts; `:6849` deal_contacts; `:7014` deals; `:13666` pipeline_entries. Tipos não são prova do banco vivo e não devem ser editados manualmente.

## Cadeia posterior: correções necessárias às hipóteses antigas

1. `deals.pipeline_id/stage_id` foram removidos pela migration `20270803000010_deals_drop_position_columns.sql:69`. Comentários explicam remoção conjunta da antiga rota `/negocios` e `carteira/hooks/useDeals.ts`. Esse hook não existe neste checkout: referências anteriores da conversa estão desatualizadas.
2. Restrição de uma entrada por lead/funil foi removida em `20270730000050_deal_por_lead_destrava.sql:537`. Não propor sua remoção como trabalho novo.
3. Funis custom passaram a usar `pipeline_entries`; `custom_pipe_entries` virou view em `20270908001000_inversao_do_silo_custom.sql:594`. Sua escrita compatível ainda exige lead em `:640`.
4. Última definição inspecionada de `abrir_negocio` fica em `20271004000000_as_escritoras_saem_dos_espelhos.sql:13`: lê organização do lead, valida responsável, cria deals com source_lead_id e escreve posição via funções canônicas. Negócio apenas de empresa não passa por essa porta atual.
5. Procedência `source` tornou-se NOT NULL em `20270824000090_deals_procedencia_obrigatoria.sql:46`. Migração nova precisa respeitar procedência, não apenas IDs.
6. `garantir_negocio_da_entrada` materializa deal de entrada legada, com `source='entrada_materializada'`. Checagem `assert_org_access` já foi adicionada em `20270919000010_garantir_negocio_valida_a_org.sql:48`; não reportar brecha anterior como atual.
7. Relação ganho/perdido da pessoa já é derivada dos negócios/caderno: `20271018000000_lead_relacao_ganho_perdido.sql:33`. Não substituir por um booleano duplicado no contato sem avaliar semântica.
8. `deal_created` foi movido para nascimento da posição; casa organização e lead da entrada com source_lead_id em `20271007000000_deal_created_nasce_na_posicao.sql:144`. Reescrever contatos/negócios durante backfill pode acionar automações reais.

## RLS, integridade e segurança

**Escopo desta seção: fonte versionada.** Consulta complementar encontrou divergência nas policies aplicadas de companies/contacts/deal_contacts; ver [estado de produção](producao.md). Não usar as definições abaixo como prova do banco vivo.

- Companies e contacts: policies posteriores usam `get_my_organization_ids`, em `20270920000010_org_plural_nas_39_tabelas_restantes.sql:190` e `:275`. Baseline com `get_user_organization_id` não representa conclusão atual de multi-org.
- Deals: `20270730000010_deals_rls_org_scope.sql:195` e seguintes adicionam master/multi-org e soft delete. Não atribuir falha apenas à omissão de WITH CHECK: PostgreSQL reaproveita USING quando CHECK é omitido; migration documenta isso em `:41`.
- Deal_contacts: policy INSERT posterior verifica organização de deals (`20270920000010_org_plural_nas_39_tabelas_restantes.sql:392`). FKs no baseline validam IDs individualmente, sem chave composta por organização (B:34533). Não foi localizada guarda de igualdade org do contato nos arquivos que alteram essa relação. **Hipótese a validar no catálogo e testes negativos**, não vulnerabilidade reproduzida: usuário pode ter acesso ao negócio e referenciar contato de org incompatível. Mesmo padrão merece revisão em contacts.company_id, companies.parent_id e deals.company_id.
- Contatos/empresas usam acesso por organização nas policies examinadas, enquanto leads têm recortes por responsabilidade/permissão (ver `20270910000000_campos_personalizados_seguem_a_org_em_uso.sql:112`). Decisão de visibilidade precisa evitar que simples troca de identidade amplie acesso a históricos.
- `deal_contacts.is_primary` não tem unicidade parcial visível no baseline. Campo permite expressão do conceito, não comprova garantia de um único principal.
- FKs de lead se espalham por comunicação, consentimento, Copilot, campanhas, followups, métricas e carteira. Exclusão em cascata precisa entrar no plano de preservação, incluindo soft/hard delete e exportação LGPD.

## Migração existente não atende automaticamente ao acordo

`migrate_leads_to_contacts_companies` (B:15303) é SECURITY DEFINER, resolve uma org do usuário, percorre leads ativos sem contact_id, agrupa empresa por lower(trim(name)), insere contato e retorna vínculo ao lead. Não mantém sincronização contínua nem cria N:N. Não assume piloto de duas orgs explicitamente.

Consequências para planejamento:

- Regra humana de nomes diferentes exige especificar igualdade literal de caixa, espaços, acentos e Unicode antes de reaproveitar índice/backfill. Aproximação/fuzzy está descartada pela conversa; detalhes de normalização não foram decididos.
- Um contato novo por lead pode colidir no índice único de telefone de contatos já existentes. Medir duplicados e vínculo atual antes de escolher política.
- source_lead_id/contact_id não constituem sozinhos mapeamento único auditável ou garantia de idempotência concorrente.
- UPDATE em leads pode ativar histórico, webhooks e gatilhos. Necessário mecanismo de execução de migração que preserve contratos e evite efeitos indevidos, ainda a projetar.
- Não há evidência estática de quantos registros existem ou quantos foram migrados. Pai da auditoria verificará catálogo/dados agregados sem PII.

## Consumidores internos representativos e blast radius

| Fluxo | Dependência preservável/revisável | Evidência |
|---|---|---|
| Criação/deduplicação de pessoa | lead-service consulta leads por org/telefone e adota mensagens órfãs por lead_id. | `supabase/functions/_shared/lead-service.ts:152`, `:433` |
| Automação | Negócio explícito ou fallback negócio corrente do lead. Empresa-only não cabe nesse fallback. | `supabase/functions/_shared/negocio-subject.ts:43` |
| Histórico/comunicação | whatsapp_messages, channel_messages, conversations, summaries ligam lead_id. | B:33869; B:34124; B:36289 |
| Campanhas/followups | campanha_leads, scheduled_campaign_messages, follow_ups referenciam lead com CASCADE. | B:33774; B:34659; B:35699 |
| Carteira/produtos | Deal ganho popula lead_products usando source_lead_id, incluindo agregação de itens. | `supabase/migrations/20270901000011_produtos_do_negocio.sql:148` |
| Métricas/caderno | sale_events mantém lead_id; posição e deal compõem identidade comercial. | B:35664; `supabase/migrations/20270908005020_caderno_sabe_o_negocio.sql:1` |
| API pública | Rotas deals/deals-create/deals-move e RPCs ainda usam lead como vínculo. Contrato externo será inventariado em relatório próprio. | `supabase/functions/_shared/api/routes/deals-create.ts:1`; `supabase/migrations/20270909000000_api_aceita_qualquer_funil.sql:463` |
| Consentimento/exportação | consent_records/data_export_requests referenciam lead; renomear identidade afeta acesso, retenção e apagamento. | B:34034; B:34514 |
| Campos/tags/histórico | lead_custom_field_values/lead_tags/lead_history ainda usam lead. | B:34884; B:34959; B:34899 |

## Perguntas técnicas para grill-with-docs

1. Identidade canônica será tabela leads renomeada/evoluída ou contacts com migração de referências? Como preservar IDs externos e contratos legados?
2. Como representar N:N contato–empresa (cargo, início/fim, proveniência), preservando histórico quando vínculo mudar?
3. Como garantir negócio com empresa ou contato, sem lead obrigatório, na abertura, materialização de legado, API, automações e RLS?
4. Participante principal será obrigatório para mensagens? Qual regra impede envio ambíguo com vários contatos? Decisão de vínculo comercial não resolve roteamento de comunicação.
5. Como substituir carteiras/receita hoje ligadas a lead sem duplicar venda entre empresa e participantes?
6. Qual igualdade exata de nome empresarial cumpre acordo? Como tratar registros já unidos pela normalização anterior, se existirem?
7. Qual contrato de compatibilidade durante piloto Milennials/TorqueCRM: single-write, adaptadores, views ou outra abordagem? Evidência ainda insuficiente para escolher.
8. Quais guardas de tenant e responsabilidade valem para cada vínculo e para leitura agregada do histórico?
9. Como validar migração sem disparar workflows, mensagens, webhooks, comissões ou métricas adicionais? Que reconciliação e recuperação são necessárias?

## Validação e limites

Leitura de baseline + busca das redefinições posteriores em migrations ativas, código Deno e tipos; não houve build/teste de aplicação porque só documentação foi alterada. Não houve reprodução de exploração, EXPLAIN, replay da cadeia ou consulta a catálogo neste subtrabalho. Referências apontam para evidência de fonte; auditoria principal deve cruzar com estado implantado. Nenhuma decisão humana foi resolvida por esta auditoria.
