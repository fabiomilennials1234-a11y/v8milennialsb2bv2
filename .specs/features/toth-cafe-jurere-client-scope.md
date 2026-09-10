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

Levantamento anterior em cache: 2.189 (1.703 ativos, 486 inconsistentes).
A leitura atual do ERP pode variar; registrar o resultado real da execução.

## Validação

121 testes focados passaram (recorte, representantes, mapeamento, empresa e
prévia), incluindo flags desligadas, outra organização, situações inválidas,
mapa vazio e membro de outra organização. `deno check` do handler passou.

Rollback: restaurar versão anterior da função e configuração anterior
(`clientes_situacoes=0,2`, `clientes_dias_compras=365`), desligando apenas esta
flag. A flag das abas é independente. Não excluir clientes ou histórico.
