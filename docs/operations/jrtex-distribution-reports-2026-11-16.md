# Jrtex: distribuição regional e relatórios da Karine

Primeira etapa do documento Call 10-11, autorizada pelo usuário na sessão.
Ativada em produção em 2026-11-16 às 10:40:06, America/Sao_Paulo.

## Regras implementadas

- Novos contatos dos funis comerciais Jrtex precisam de cidade, UF explícita e
  CNPJ com formato e dígitos verificadores válidos antes de ir ao representante.
  A validação suporta CNPJ numérico e alfanumérico; não consulta situação cadastral.
- O fluxo comercial cumprimenta o contato mesmo quando já há representante.
  Solicita os dados ausentes; mensagens separadas de cidade, UF e CNPJ são aceitas.
  DDD não determina UF. Município e UF são conferidos contra 5.571 registros do IBGE.
- Rodízio sequencial por estado, com lock transacional. Pools e cidades de
  atendimento remoto foram extraídos da versão publicada anterior, preservando
  sua ordem. Referências a representantes removidos foram excluídas.
- SC: 3 representantes; SP: 1; GO: 6; DF: 2; TO: 2; CE: 1; RJ: 2.
  MG não tem representante ativo no cadastro anterior. MG, estados sem pool e
  falta de outro elegível na redistribuição vão para Karine, na fábrica.
- Qualificação incompleta fica atribuída à Karine. Pendência de 24 horas gera
  uma tarefa de recuperação; município não reconhecido ou falta de cobertura
  gera tarefa imediata. Uma tarefa aberta por lead, sem duplicação a cada cron.
- Redistribuição após **180 minutos de expediente com o cliente esperando uma
  resposta humana**. Segunda a sexta, 08–12h e 13–18h, America/Sao_Paulo.
  Não há calendário de feriados configurado. Verificação a cada cinco minutos.
- Nova mensagem do cliente não reinicia o prazo. Automação, IA, falha de envio e
  histórico antigo não contam como resposta. Mensagem humana enviada pelo
  aparelho conta mesmo quando não há identificação de autor no provedor.
- O novo representante recebe um prazo novo; a espera anterior na triagem não
  o penaliza. Pedidos não estornados, negociação/proposta ativa ou `keep_owner`
  preservam o responsável e geram tarefa. Leads em funis de outros grupos exigem
  revisão, sem redistribuição automática. Não houve migração em massa da carteira.
- A troca atualiza os responsáveis do lead, atribuições/metadados dos cards e
  negócios abertos e remove co-donos anteriores na mesma transação. Isso elimina
  os caminhos alternativos de propriedade usados pela RLS.

## Relatórios e isolamento

Karine permanece `member`. A autorização privada permite apenas seu usuário
ativo consultar agregados dos quatro funis comerciais Jrtex. O servidor cruza
essa configuração com o escopo Jrtex da conta e rejeita um filtro Profit explícito.

O painel **Relatórios Jrtex**, em `/metricas`, usa o Metrics Studio e seu exportador
XLSX existentes: receita, quantidade de vendas, receita/vendas por representante,
leads/receita por origem, vendas por data e perdas por representante. Períodos
continuam disponíveis pelo seletor padrão. Estornos são excluídos dos totais.
Os dados atuais incluem vendas sem valor preenchido; o relatório não inventa receita.

Representantes não têm acesso ao painel de gestão nem à RPC correspondente.
As políticas de leads, mensagens e resumos não foram relaxadas. Karine também não
recebeu permissão geral para ler chats de todos: relatórios são agregados; os chats
de triagem ficam disponíveis por atribuição real.

## Componentes e implantação

- `20280112001000_regional_sales_reports.sql`: configuração privada, escopo de
  painel e agregador; substitui somente o bloqueio Jrtex no `fn_metric_measure`.
- `20280112002000_regional_sales_distribution.sql`: qualificação, atribuição,
  proteção de carteira, prazo útil, tarefas, auditoria e triggers.
- `20280112003000_regional_contact_capture_safety.sql`: dados em mensagens separadas.
- `20280112004000_regional_capture_pipeline_scope.sql`: captura limitada aos funis comerciais.
- `scripts/sql/configure-jrtex-regional-sales.sql`: resolve referências existentes
  por organização/nome, configura expediente e cria o painel.
- `scripts/prepare-jrtex-rollout.mjs`: gera SQL revisável a partir dos snapshots
  e municípios IBGE. Não aplica SQL nem envia mensagens.
- Workflow `b88c2b1a-9c6a-4ada-840f-588da4437944`: versão 3, revisão 10, 14 nodes.
  Gatilho `lead_created` filtrado pelo Funil de Vendas - JRtex. Publicação
  operacional com ator nulo, sem impersonar administrador; versão 2 preservada.
- Cron `regional-sales-distribution`: `*/5 * * * *`, função privada
  `process_regional_sales`. A configuração `routing_enabled=false` o torna inerte.

Snapshots anteriores e SQL de ativação/pausa estão no diretório local
`output/jrtex-implementation-20261116` do workspace pai, fora do repositório.
Não há credenciais nesses scripts. O rollout verifica versão/revisão, workflow
previamente ativo, ausência de execuções em curso e seed completo antes de mudar.

O MCP gerou as versões 20261116132009, 20261116133813, 20261116134321 e
20261116134532. Somente esses quatro registros do ledger foram reconciliados
para os nomes ordenados do repositório acima, evitando reaplicação futura.
O primeiro ciclo agendado terminou com sucesso às 10:45 de Brasília.

## Verificação

- 20 testes de integração no PostgreSQL embarcado PGlite: regressão do erro de
  relatório, escopos positivos/negativos, CNPJ, rodízio, relógio útil, carteiras,
  troca de todos os vínculos, membros inativos, qualificação enfileirada, captura
  de mensagens, histórico, outros funis e desativação do worker.
- 26 testes Vitest: contrato de publicação do workflow, perguntas/saídas e
  exportação dos relatórios existentes. ESLint dos arquivos JS/TS sem erros.
- Em produção: todos os oito indicadores responderam para Karine; `metrics.view`
  e `performance.view` autorizados. RPC negada ao Ivan e filtro Profit negado à Karine.
- RLS com Ivan e Alesson: lead/mensagem próprios visíveis; os do outro invisíveis;
  painel de gestão invisível. Teste transacional de troca: vendedor anterior perde
  lead e mensagem, novo vendedor ganha ambos. ROLLBACK preservou dados reais.
- Advisor: tabelas privadas com RLS e sem políticas são intencionais (negação
  por padrão para clientes); somente funções internas e service_role as acessam.
  Não foram criados endpoints públicos de atribuição.
- Não foi feito login como Karine nem envio de mensagem de teste a cliente real.

Para executar localmente, `npm ci`, `node --test tests/integration/regional-sales.test.mjs`
e `npx vitest run tests/unit/jrtex-regional-workflow.test.ts src/modules/analytics/lib/metrics-studio-report.test.ts`.
`REGIONAL_PGLITE` permite apontar para outra instalação do mesmo pacote.

## Pausa e próximos itens do documento

Para pausar, colocar `routing_enabled=false` na configuração Jrtex e desativar o
workflow regional. O SQL gerado `pause.sql` também remove o cron. Manter relatórios,
RLS e log de atribuições. Não desfazer automaticamente responsáveis já trocados.

Esta etapa não habilitou criação automática para telefones desconhecidos: a flag
existente é global na organização e afetaria também o WhatsApp Profit. A captura
implementada atua em conversas vinculadas a leads nos funis comerciais; criação
por primeiro inbound precisa de escopo por conexão antes de habilitação.

Instagram não tem canal conectado na organização. Continuam para a próxima
etapa: integração desse canal, identificação separada de campanha/canal de entrada,
relatórios de visitas e motivos de perda (o painel atual mostra quantidade de
perdas), e consulta externa da situação cadastral do CNPJ, se desejada.

Fonte dos municípios: https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome
Algoritmo CNPJ: https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf
