# Importação de clientes Café Jurerê

Autorização em 10/09/2026: ativar flag, merge na main e sincronizar apenas
Ativo (0) ou Inconsistente (3), com representante cadastrado no Torque.

O piloto exige simultaneamente o ID da Café Jurerê e a flag
`toth_clientes_ativos_inconsistentes_com_representante`. As demais organizações
mantêm o fluxo existente. O mapa deve apontar para um `team_members.id` da
mesma organização. Mapa vazio, representante nulo ou membro de outra org
não autorizam a entrada. Não há correspondência por nome.

Empresa CAFE JURERE obrigatória no piloto, sem aceitar registros sem empresa.
Filtro aplicado após mapeamento e antes de prévia, enriquecimento ou criação.
Contagem `recorte` disponível nas respostas e logs, sem dados pessoais.
A propagação de responsáveis fica limitada aos IDs elegíveis lidos na execução;
a classificação legada não roda no piloto, cujas abas usam cadastro no ERP.

## Publicação

- Publicar `toth-sync-clientes` e dependência `cafe-jurere-client-scope.ts`.
- Executar `scripts/sql/enable-cafe-jurere-client-scope.sql` somente no alvo
  autorizado; situações 0,3 e sem janela de compra, pois cadastro é o critério.
- Rodar `dry_run`, conferir elegíveis, criações e adoção de conversas.
- Sincronizar e verificar erros, limite de execução e contagens.
- Nenhuma exclusão de registros históricos faz parte desta operação.

## Visibilidade da lista (autorizada em 10/09/2026)

Com a flag das abas da Café Jurerê ligada, lista, contagens e exportação
aplicam `visivel_lista_cafe_jurere(leads)` antes da paginação. Leads sem
cadastro ERP continuam visíveis. Cadastros ERP precisam de cliente Toth
vinculado, empresa CAFE JURERE, situação 0/3 e representante mapeado para
membro da mesma organização. A avaliação usa os dados conhecidos no CRM.
Não altera registros, histórico, negócios, WhatsApp ou acesso à ficha.
Desligar a flag das abas restaura a lista anterior. Outras organizações
mantêm o comportamento anterior, inclusive se consultarem o campo calculado.

Validação: 15 verificações PostgreSQL isoladas, incluindo RLS, anon sem
EXECUTE, membro de outro tenant, status 0/3, sem mapa e preservação dos dados.

### Correção do timeout de listagem

O campo calculado original consultava três tabelas sob RLS por linha.
O teste administrativo (0,37 s) não representava o usuário: a contagem
autenticada ultrapassou 8 s e a tela permaneceu tentando carregar.
`20271019000006` passa a derivar `leads.cafe_jurere_erp_elegivel` na escrita.
Triggers internos mantêm a projeção quando cliente, mapa ou organização do
membro muda; tentativas de escrever diretamente o booleano são recalculadas.
Nenhuma policy de acesso foi ampliada. Leitura usa apenas a linha de lead e
o planejador expande a expressão, sem consultas correlacionadas por cadastro.

Backfill separado do schema, somente para a Café Jurerê. Validado em produção
com JWT de usuário e role authenticated: 2.284 visíveis em 42,6 ms; primeira
página com 50 leads e classificação carregou dentro do limite de 5 s.
Grants internos revogados de anon/authenticated e conferidos no alvo.
Regressão inclui plano sem chamada por linha e manutenção automática da
projeção após mudanças de mapa e situação.

Levantamento anterior em cache: 2.189 (1.703 ativos, 486 inconsistentes).
A leitura atual do ERP pode variar; registrar o resultado real da execução.

Prévia em produção: 12.746 recebidos, 2.232 elegíveis (1.697 ativos e 535
inconsistentes); 2.189 existentes e 43 novos. Sem erros de mapeamento.
O Toth limitou a consulta com marcas mesmo sem janela; `diasCompras=0` e
`marcas=` retornaram a base completa. O piloto fixa esses parâmetros.

## Validação

121 testes focados passaram (recorte, representantes, mapeamento, empresa e
prévia), incluindo flags desligadas, outra organização, situações inválidas,
mapa vazio e membro de outra organização. `deno check` do handler passou.

Rollback: restaurar versão anterior da função e configuração anterior
(`clientes_situacoes=0,2`, `clientes_dias_compras=365`), desligando apenas esta
flag. A flag das abas é independente. Não excluir clientes ou histórico.
