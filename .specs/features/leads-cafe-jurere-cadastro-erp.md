# Abas de Leads — Café Jurerê

Decisão do CTO em 2026-09-10. Exceção exclusiva da organização
`4922638c-4909-494e-ba10-12282ec0b161`, na página `/leads`.

| Aba | Regra |
| --- | --- |
| Todos | Todos os leads visíveis ao usuário, respeitando os demais filtros. |
| Cliente | `erp_code` preenchido, sem depender da situação do ERP, representante ou compra. |
| Perdido | Sem código ERP, pelo menos um negócio perdido e nenhum ganho. Outro negócio aberto não impede esta aba. |
| Lead | Sem código ERP e fora de Perdido. Ganho sem cadastro ERP continua aqui. |

As abas são exclusivas: Cliente prevalece, depois Perdido, depois Lead.
Negócios excluídos não contam. Cards legados sem deal usam o desfecho da
etapa ativa no funil ativo, como na consulta de relação já existente.
Venda histórica isolada não substitui cadastro ERP nem um negócio ganho.

## Escopo e proteção

- Flag `organizations.feature_flags.leads_cafe_jurere_cadastro_erp`, estritamente
  booleana. O hook exige também o ID exato da Café Jurerê. Durante carregamento
  ou com flag ausente/desligada, permanece a regra anterior.
- O campo calculado `classificacao_cafe_jurere(leads)` retorna `NULL` para
  qualquer outra organização. É `SECURITY INVOKER`: preserva as permissões
  de leitura e filtra todas as fontes por `organization_id`.
- Lista, contagem, estatísticas e exportação usam o mesmo filtro no banco,
  antes de paginar. A coluna Relação da lista recebe a mesma classificação.
- A flag faz parte das chaves de cache. Visão salva em Indefinido vira Todos
  neste piloto. O menu de classificação manual fica oculto apenas no piloto,
  pois ele modifica a regra antiga e não determinaria as novas abas.
- Importação, `clientes_situacoes`, de-para de representantes, `classificacao`
  persistida, projeção `relacao_negocios` e outras páginas não são alterados.

## Disponibilização

1. Revisar e aplicar somente `20271019000004_leads_cafe_jurere_cadastro_erp.sql`.
   Não executar `db push` indiscriminado: o repositório tem migrations pendentes.
2. Disponibilizar o frontend do PR.
3. Com autorização explícita de produção, executar
   `scripts/sql/enable-cafe-jurere-leads-tabs.sql`. O script mescla a chave no
   JSON existente e restringe a escrita ao ID da Café Jurerê.
4. Conferir as quatro abas com admin e membro e verificar que outra org
   conserva suas abas. A consulta de flags tem cache de até 60 segundos.

Para desligar, definir somente essa chave como `false` na Café Jurerê.
Não é necessário reclassificar dados ou alterar a importação.

## Validação

Testes de flag (incluindo troca de organização), opções, visões antigas e
filtros em Vitest. Teste SQL com a migration real em PostgreSQL isolado
(PGlite), incluindo grants explícitos de default privileges, RLS com papel
authenticated, isolamento por tenant, ganho/perda/aberto, cadastro ERP,
código vazio, paginação e contagem. CI dedicado executa a prova SQL.
Isso não substitui a conferência autenticada no Supabase antes da ativação.

### Resultado local — 2026-09-10

- 58 testes focados passaram; os 10 testes novos foram repetidos e passaram.
- Migration real em PGlite: 9 verificações, com 14 cenários de lead, passaram.
- Build, lint ratchet, typecheck ratchet e dependency ratchet passaram.
- A suíte completa reportou 14 falhas fora do baseline. Em checkout limpo de
  `fc6f448d`, 12 reproduziram (10 dependem de Bash/WSL indisponível, além dos
  testes de deep link e espelhos). Os outros dois guards — roles e estados de
  destinatários — passaram isoladamente na branch. Nenhum baseline alterado.
- Simulação SQL somente leitura em produção, como visão administrativa:
  12.676 Clientes, 20 Leads, 1 Perdido. Nenhuma migration ou flag aplicada.
