# Tarefas internas do master

Rota `/master/tarefas`, em **Operação → Tarefas**, ao lado de Chamados. Usa o mesmo `MasterKanban` das centrais, com **A fazer**, **Fazendo** e **Feito**.

- Cada entrada começa no ID do master conectado. Trocar de conta também reinicia a seleção; a escolha de outro quadro não é persistida.
- O seletor mostra Gabriel, Marcelo e Lucas, nomes confirmados pelo solicitante. Os nomes de `master_list_staff` são cruzados com contas ativas de `master_users` com `permissions.all = true`. O primeiro nome identifica as opções; tarefas e consultas usam o UUID real de `master_users`. Se o primeiro nome de uma conta mudar, atualizar `lib/master-tasks.ts`.
- Todos os masters plenos podem visualizar e gerenciar as tarefas dos três responsáveis. Outbounders, suporte restrito e usuários comuns não acessam a tabela nem a rota funcional.
- A nova tarefa assume o responsável do quadro selecionado. O formulário permite editar título, descrição manual, data limite, tempo estimado, responsável e status.
- **Pegar para mim** salva no quadro do master conectado. Para **Encaminhar tarefa**, escolha outro responsável e salve. Ambas preservam descrição, prazo, estimativa e andamento; a auditoria registra o responsável anterior, o novo e quem mudou. Arrastar muda apenas o status. Excluir exige confirmação.
- Contadores refletem o quadro selecionado; a busca filtra título e descrição. A lista pagina para não perder tarefas no limite da API. Revalida a cada 30 segundos enquanto a página está ativa.
- Mudanças usam `updated_at` como versão para evitar sobrescrever ou excluir tarefas alteradas por outro master. Em falha, o formulário permanece aberto com os valores preenchidos.

## Prazo e estimativa

**Data limite** e **Tempo estimado** são obrigatórios. A data é armazenada como `date`, sem conversão de fuso. O prazo vale até o fim do dia em Brasília: tarefas ainda não concluídas ficam **Atrasadas** a partir do dia seguinte. Os cartões exibem a data e a estimativa; tarefas concluídas não recebem o aviso de atraso.

A estimativa é informada em **horas e minutos inteiros**, com mínimo de um minuto. Pode ser preenchida só em horas ou só em minutos; minutos vão de 0 a 59. O banco armazena o total em `estimated_minutes`, um inteiro positivo. Estimativa é o tempo de trabalho previsto, independente da data limite; não inicia cronômetro nem altera o status automaticamente.

## Banco e publicação

Migration: `supabase/migrations/20261026161627_master_tasks_by_owner.sql`.

Cria `master_tasks`, com RLS para masters plenos, responsável e planejamento obrigatórios, autoria e relógio protegidos por privilégios de coluna, validação de responsável ativo e auditoria em `master_audit_logs`. Os gatilhos são `SECURITY INVOKER`.

Aplicar a migration antes de publicar o frontend. A lista de nomes usa a RPC `master_list_staff` já existente. Não há função de IA, dependência de provedor ou secret novo para tarefas. Nenhuma tarefa fictícia é inserida no banco real.

## Verificação

- `node --test tests/integration/master-tasks.test.mjs`: PostgreSQL local via PGlite, políticas reais do baseline, três identidades, acesso negado, prazo/estimativa obrigatórios, auditoria, transferência e concorrência. Roda no CI.
- `node node_modules/vitest/vitest.mjs run src/modules/identity/master/pages/MasterTasks.test.tsx src/modules/identity/master/hooks/useMasterTasks.test.tsx src/modules/identity/master/lib/master-tasks.test.ts tests/unit/master-centrais-nav.test.ts tests/unit/master-page-header.test.tsx --no-file-parallelism`: entrada pessoal, troca de conta/quadro, criação, edição, erros, paginação, prazo por dia de Brasília, estimativa e navegação.
- Com `scripts/ui-preview/mock-supabase.mjs --master` e `scripts/ui-preview/start-vite.mjs` ativos, `node scripts/ui-preview/check-master-tasks.mjs` exercita a interface real com dados fictícios locais: validação de campos obrigatórios, criação, arraste, edição, persistência, pegar, encaminhar, excluir e mobile. Capturas em `.ui-shots/master-tasks/`.
- Validação remota pendente: a sessão de desenvolvimento não tem acesso autenticado ao Supabase; a migration ainda precisa ser validada e aplicada no ambiente de publicação.
