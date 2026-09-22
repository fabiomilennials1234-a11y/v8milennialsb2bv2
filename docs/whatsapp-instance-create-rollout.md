# Criação de instância: leitura após provisionamento

Sintoma: `Cannot coerce the result to a single JSON object` no cadastro. O proxy pode concluir a criação, mas a leitura seguinte pelo JWT do navegador retorna zero linhas porque a policy restritiva exige vínculo com a caixa, inclusive para membros com permissão de gerenciar instâncias.

Na Café Jurerê foram observadas criações bem-sucedidas seguidas de tentativas duplicadas; a conexão Tatiane-Televendas estava conectada na consulta. A conta usada na imagem não foi identificada, portanto a reprodução comprova o caminho de falha, sem atribuir todas as tentativas a esse usuário.

## Alterações

- A policy restritiva da tabela de instâncias reconhece a permissão existente de gerenciamento, mantendo a policy permissiva de organização.
- Leitura de conversas e resolução de caixas legíveis não mudam. Não há inclusão automática de membros na caixa.
- createInstance verifica autorização no client do usuário antes de qualquer efeito no banco/provedor; erro ao verificar falha fechado.
- A consulta do frontend filtra também a organização, trata ausência de linha sem erro técnico de JSON e atualiza as listas mesmo quando o carregamento após criação falha.

## Validação e implantação

`node scripts/test-whatsapp-instance-management.mjs` reproduz o bloqueio anterior e testa a migration real em PostgreSQL isolado, incluindo gestor, membro vinculado/não vinculado, admin/master, outra organização, ausência de acesso às mensagens e rollback. Fixtures simulam identidade/permissões, não substituem a validação integrada do ambiente Supabase.

Testes do handler real capturado de Deno.serve verificam que a API não provisiona sem autorização. Testes do hook verificam criação e falha posterior com atualização do cache.

Ordem: publicar o gate de autorização no whatsapp-api-proxy; aplicar exclusivamente a migration `20271021000023_allow_whatsapp_instance_management_read.sql`; publicar frontend. Conferir policy restritiva/roles e validar com usuário gestor e usuário sem vínculo. Não recriar conexões que já existem nem enviar mensagens para testar.

Rollback: restaurar policy com o arquivo homônimo em `supabase/migrations/rollback/`; reverter frontend via PR. O gate de autorização é independente e deve ser mantido. Não há alteração de dados nem concessão de novos grants. A migration foi gerada por CLI e renomeada para ordenar após a sequência sintética 2027 do repositório.
