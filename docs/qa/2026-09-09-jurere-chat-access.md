# Isolamento dos chats por instância — 2026-09-09

## Diagnóstico em produção (somente leitura)

Organização Café Jurerê: 6 instâncias conectadas, todas com lista de membros configurada. Quatro membros ativos têm acesso a uma instância cada; quatro contas estão cadastradas como admin (Micheli, Jorge, Fernanda e Carolini). Não houve mudança de perfis, vínculos ou configurações da organização.

Consulta como membro, com SET LOCAL ROLE authenticated e request.jwt.claims dentro de BEGIN/ROLLBACK:
- whatsapp_readable_instance_ids retornou somente a instância vinculada.
- get_whatsapp_conversation_list_multi para outra instância retornou 0 conversas.
- get_whatsapp_conversation_list para a mesma instância proibida retornou 5 conversas (limite do teste).
- SELECT direto em whatsapp_messages retornou 2.661 mensagens dessa outra instância.

Causa: a lista de uma caixa validava a organização, mas não a lista de membros da instância; a RLS das mensagens validava a organização e o responsável do lead, não a instância. O frontend também descartava erros ao carregar a lista de permissões, interpretando falha como ausência de restrição.

## Correção

A resolução de histórico verifica o acesso à instância viva antes de expandir os IDs antigos. A lista oficial faz a mesma checagem. Políticas SELECT restritivas fecham as consultas diretas em mensagens, resumos e conversas sem substituir as permissões existentes. O frontend propaga falhas nas duas consultas de permissão e separa o cache do seletor por perfil.

Admins da organização e masters mantêm acesso completo, incluindo histórico órfão. Membros mantêm o histórico das instâncias permitidas. A semântica existente de instâncias sem lista de membros permanece; na Café Jurerê todas as seis instâncias têm lista.

## Validação

- 30 testes Vitest passaram; os dois novos testes de falha de permissão falharam antes da correção.
- 66 asserções SQL passaram em PGlite 0.5.8 (Postgres real em WASM), incluindo reprodução vermelha com as definições consultadas em produção, membros, admins, master, inativo, administrador de outra org, histórico e service_role.
- ESLint dos arquivos TypeScript alterados passou.
- Verificação completa de versões passou, sem duplicações ou colisões com origin/main. Typecheck geral interrompido após mais de três minutos sem resultado; não considerado aprovado.
- Sem QA de navegador ou aplicação em produção. O projeto antigo de desenvolvimento está em modo somente leitura; nenhum recurso remoto foi criado. O ensaio usa schema isolado e dados fictícios.
- Advisor de produção consultado como baseline; avisos existentes sobre funções SECURITY DEFINER e search_path não são validação pós-deploy. Referência: [Supabase Database Linter](https://supabase.com/docs/guides/database/database-linter).

Para repetir o ensaio SQL, instale @electric-sql/pglite@0.5.8 em um diretório temporário e execute:

```
node scripts/test-chat-instance-access.mjs <diretorio-temporario>/node_modules/@electric-sql/pglite/dist/index.js
npx vitest run tests/unit/whatsapp-instance-read-access.test.tsx tests/unit/use-whatsapp-chat.test.ts
```

## Aplicação em produção

Migration: 20271019000003_enforce_whatsapp_instance_read_access.sql. Criada com a CLI e renumerada após a última migration do repositório para respeitar as dependências existentes (o repositório usa versões futuras). A versão 20271019000002 foi ocupada pelo merge concorrente do PR #2056.

Aplicada em produção em 2026-09-09 às 17:15 UTC, após autorização do usuário. O MCP registrou automaticamente a versão **20260909171503**, nome **enforce_whatsapp_instance_read_access**. Existe drift de versão entre esse ledger e o arquivo do repositório: não reaplicar o arquivo sem reconciliar o ledger. O conteúdo SQL aplicado é o mesmo; somente o arquivo foi renumerado para resolver a colisão.

Verificação autenticada em produção: os quatro membros da Café Jurerê mantiveram uma instância visível e não puderam ler mensagens das outras instâncias. O admin consultado manteve as seis instâncias e suas mensagens. Na Alamaster, um membro continuou lendo 7.252 mensagens históricas de uma instância recriada. O advisor de segurança não apresentou novas categorias ou contagens de avisos em relação ao baseline.

O CI passou build, TSC ratchet, lint, RLS pgTAP, CodeQL e testes Deno. A suíte de integração apresentou 34 falhas já presentes na main e três novas causadas pela fixture de Org B sem instance_id. A fixture foi corrigida com uma instância própria e vínculo explícito, preservando as mesmas asserções de isolamento por responsável.

Aplicar somente esta migration, após autorização explícita do CTO, e publicar o frontend via PR/review. Não executar um db push indiscriminado sobre migrations pendentes. Repetir o teste autenticado de produção: instância proibida deve retornar zero mensagens e zero conversas; validar também uma instância permitida e uma conta admin. Atualizar a página para descartar dados já carregados.

A aplicação altera o controle de leitura em todas as organizações que usam listas de membros por instância. Revisar também uma organização com histórico de instância recriada antes de encerrar o rollout.
