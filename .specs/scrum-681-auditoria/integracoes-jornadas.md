# SCRUM-695 — Jornadas, API e consumidores externos

Auditoria documental de 2026-09-10, fonte `develop` em `215ff0bb9b0d8ad3b5189d10dd551778026753bb`. Código de Edge Functions foi lido; versões implantadas e cenários externos não foram executados. Evidências do banco ficam em [estado aplicado](producao.md).

## Contrato público atual

`supabase/functions/api/routes.ts:27` registra recursos `/api/v1/leads`, busca, detalhe, timeline, tags, campos customizados, catálogos, `/deals`, criação, atualização e movimentação. Não registra recursos contacts/companies/participantes. Os escopos já distinguem `lead:*`, `deal:*`, `pipeline:*`, `metadata:*` e equipe; inventariar consumidores exige preservar escopos e permissões, não somente trocar nomes.

`supabase/functions/_shared/api/routes/deals-create.ts:112` exige `lead_id` existente e retorna 422 quando ausente. Envia esse ID à RPC `api_create_deal`, procedência fixa `api` e `Idempotency-Key`; replay devolve 200, criação 201. `leads-create.ts:61` também transmite idempotência e em `:75` devolve ID existente no conflito. Essas garantias precisam sobreviver ao novo contrato, inclusive durante piloto misto.

`public/api/openapi.json:6` documenta pessoa/empresa como Lead, negócio separado e criação em três chamadas. Já existe `/leads/{id}/stage` depreciada, mantida no roteador em `routes.ts:70` por compatibilidade. Não remover nem redirecionar semanticamente essa rota nesta auditoria.

**Documentação histórica divergente:** ADR-0008 descreve primeira onda sem negócios nem idempotência. Roteador, handlers e OpenAPI atuais já incluem ambos. Planejamento SCRUM-730 deve partir desses contratos executáveis; ADR anterior é histórico. Preservar significado de IDs, paginação, filtros, códigos de erro e payloads de eventos precisa de decisão explícita.

`supabase/functions/api/index.ts:30` usa cliente privilegiado; autenticação resolve organização pela API Key. O novo contrato precisa continuar validando tenant em cada handler/RPC: RLS sozinha não protege esse caminho. Esta leitura não certifica todos os handlers nem equivale a teste de penetração.

## Jornadas e fronteiras afetadas

| Jornada atual | Evidência de origem → processamento → consumo | Risco/decisão necessária |
|---|---|---|
| Entrada via formulário/webhook | `lead-webhook/index.ts:112` mapeia aliases empresariais para texto `company`; `:650` obtém lead, `:662` escreve empresa textual; `:507` prepara entrada no funil padrão | Distinguir pessoa, empresa e negócio sem transformar toda entrada em venda. Definir efeitos de repetir cadastro, campos mistos e compatibilidade de aliases. |
| Entrada de parceiro | `partner-webhook/index.ts:129` propaga company; `:216` devolve lead_id | Parceiro pode persistir ID antigo. Planejar ID estável/mapeamento, respostas e janela de compatibilidade. |
| API → negócio → funil | `api/routes.ts:59` cria negócio; `api/routes/deals-create.ts:119` chama RPC; `abrir_negocio` cria deals + pipeline_entries | Empresa sem pessoa exige revisão de toda cadeia. Preservar negócios simultâneos e idempotência já existentes. |
| Conversa → identidade → IA | `_shared/lead-service.ts:152` resolve pessoa; `_shared/outbound-sender.ts:93` propaga lead_id; `agent-message/index.ts:440` registra lead; frontend cobre listas de cada canal | Contato com várias empresas não determina contexto da conversa automaticamente. Preservar pausa humana, telefone, identidade social e histórico sem copiar contexto entre empresas. |
| Evento → workflow → ação | `_shared/workflow-trigger.ts:38` exige leadId; `:496` deduplica execuções considerando contexto; `_shared/negocio-subject.ts:43` resolve negócio declarado ou corrente da pessoa | Definir sujeito do evento, destinatário e negócio separadamente; preservar deduplicação e reexecução. Backfill não pode gerar disparos comerciais por acidente. |
| Campanha → envio | `_shared/action-handlers/send-campaign-message.ts:79` guarda lead_id; `_shared/outbound-sender.ts:31` recebe destinatário por lead | Selecionar empresa pode expandir vários destinatários. Precisam regra de consentimento, deduplicação e canal por contato; empresa não é automaticamente destinatário. |
| Agendamento → contato/funil | `webhook-calcom/index.ts:440` e `:528` vinculam lead existente/novo; frontend GoogleCalendar contém lead_id | Reagendamento/cancelamento devem atingir compromisso correto, mesmo com várias oportunidades por pessoa. |
| ERP → carteira → pedido | `erp-order-webhook/index.ts:112` resolve upsell_clients por CNPJ, depois nome normalizado, company e criação | Cliente ERP e empresa CRM ainda não têm identidade equivalente comprovada. Não usar esse matching como regra da migração; mistura pessoa/empresa e normalização diverge do requisito de nomes distintos. |
| Negócio ganho → produtos/receita | migration `20270901000011_produtos_do_negocio.sql:148` usa source_lead_id; caderno e vendas históricas permanecem vinculados à pessoa | Definir comprador versus participante. Não duplicar receita por participante nem perder histórico sem pipeline entry. |
| Consulta → métricas/histórico | Matriz [frontend](frontend.md), inventário [backend](backend.md) | Denominadores contato/empresa/negócio precisam de semântica explícita e reconciliação histórica. |

Caminhos abreviados da tabela são relativos a `supabase/functions/`, exceto migrations explicitadas. Cobertura representativa ponta a ponta, não call graph exaustivo de todo provedor.

## Make e demais integrações: lacuna delimitada

Busca de arquivos versionados por `make|integromat` não encontrou pacote identificável do conector Make neste checkout. Isso **não comprova ausência** do app publicado ou de cenários. Versão instalada, módulos, conexões, cenários e consumidores ativos não foram inspecionados. Nenhum cenário foi disparado.

SCRUM-730 deve obter artefato publicado/exportado do app e inventário dos consumidores autorizados, cobrindo: módulo, versão, rota/RPC, campos de entrada/saída, ID persistido, paginação, cursor, busca, webhook instantâneo/polling, deduplicação, idempotência, escopos e organização piloto. Incluir exemplos sanitizados e cenários de retentativa. SCRUM-731 implementará alterações após esse contrato. Não chamar troca de labels de atualização completa do Make.

Também permanecem a verificar contratos implantados de Meta, TinyERP, Google Calendar, Cal.com, parceiros e integrações HTTP personalizadas. Fonte dá pontos de entrada; uso real requer configuração/telemetria sanitizada por integração. Não inventariar credenciais nem payloads pessoais no repositório.

## Ordem de planejamento e critérios de saída

1. SCRUM-682: identidade canônica, vínculos e preservação de IDs. Produto já decidiu contatos e empresas opcionais; não reabrir isso.
2. SCRUM-683/684: receita/carteira, sujeito da automação, contexto de mensagem e autorização.
3. SCRUM-685: jornadas e contratos frontend, incluindo negócio apenas com empresa e seleção em massa por negócio.
4. SCRUM-730: API, eventos e Make com compatibilidade verificável; pode reunir inventário externo em paralelo às decisões de domínio.
5. SCRUM-686/687: migração, reconciliação, recuperação, supressão de efeitos colaterais e gate por IDs das duas orgs.

Implementação exige contratos resultantes dessas tarefas. Auditoria entrega evidências e lacunas; não escolhe rename físico, nova tabela, dual-write ou versão da API sem planejamento técnico.
