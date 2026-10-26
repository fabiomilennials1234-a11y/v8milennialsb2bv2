# Tarefas internas do master

Rota `/master/tarefas`, em **Operação → Tarefas**, ao lado de Chamados. Usa o mesmo `MasterKanban` das centrais, com **A fazer**, **Fazendo** e **Feito**.

- Cada entrada na página começa no ID do master conectado. A escolha de outro quadro não é persistida em URL ou armazenamento local; trocar de conta também reinicia a seleção.
- O seletor mostra Gabriel, Marcelo e Lucas, nomes confirmados pelo solicitante. Os nomes vêm de `master_list_staff`, cruzados com as contas ativas de `master_users` com `permissions.all = true`. O primeiro nome identifica as três opções; tarefas e consultas são vinculadas ao UUID real de `master_users`, nunca ao texto do nome. Se o primeiro nome de uma conta mudar, atualizar a seleção em `lib/master-tasks.ts`.
- Todos os masters plenos podem visualizar e gerenciar as tarefas dos três responsáveis. Outbounders, suporte restrito e usuários comuns não acessam a tabela nem a rota funcional.
- A nova tarefa assume o responsável do quadro selecionado. O formulário permite trocar responsável, título, contexto, descrição e status. **Pegar para mim** salva a tarefa no quadro do master conectado. Para **Encaminhar tarefa**, escolha outro responsável e salve. Essas ações preservam o andamento e o prompt; a auditoria registra o responsável anterior, o novo e quem mudou. Arrastar muda apenas o status. Excluir exige confirmação.
- Contadores refletem o quadro selecionado; a busca filtra título e descrição. A lista pagina para não perder tarefas no limite da API. Revalida a cada 30 segundos enquanto a página está ativa.
- Mudanças usam `updated_at` como versão para evitar sobrescrever ou excluir uma tarefa alterada por outro master. Em falha, o formulário permanece aberto.

## Descrição como prompt de execução

O campo **Contexto para o prompt** preserva o texto original do solicitante. A **Descrição** contém o objetivo, passos, pontos a confirmar e critérios de conclusão, para copiar no **Codex** ou **Claude Code**. A geração não executa a tarefa nem altera seu status.

Ao criar uma tarefa sem descrição preenchida, a interface solicita a geração antes de inserir a tarefa. Também é possível gerar uma prévia ou escrever manualmente. Em falha, os dados permanecem no formulário: o usuário pode tentar novamente ou escolher **Criar sem descrição**. Uma falha ao salvar não repete a geração já concluída. Trocar de conta ou sair da tela durante a geração descarta seu resultado e não salva na nova sessão.

Nas tarefas existentes, gerar novamente exige confirmar a substituição; o resultado só é persistido ao salvar. O texto continua editável. O agente classifica a complexidade, ajustável pelo usuário, e a aplicação calcula as duas recomendações:

| Complexidade | Codex | Claude Code |
| --- | --- | --- |
| Baixa | GPT-6.1 Sol · low | Sonnet · medium |
| Média | GPT-6.1 Sol · medium | Opus · medium |
| Alta | GPT-6 Astra · high | Opus · high |

Esta é a política inicial do Torque, não um benchmark entre fornecedores. Escolhe modelos e esforços suportados segundo as documentações de [modelos do Codex](https://learn.chatgpt.com/docs/models), [seleção de modelos OpenAI](https://developers.openai.com/api/docs/guides/model-selection) e [configuração do Claude Code](https://code.claude.com/docs/en/model-config), conferidas em 26/10/2026. Os aliases `sonnet` e `opus` acompanham a versão disponível no provedor/conta. Disponibilidade e limites dependem da conta de execução. A matriz fica centralizada em `lib/master-task-prompts.ts` para revisão futura.

O botão de copiar inclui título, contexto, plano e recomendação do destino escolhido. No Codex, o operador seleciona modelo/esforço no aplicativo. No Claude Code, os comandos `/model` e `/effort` têm botões separados, pois colá-los juntos como um comando causa erro. Copiar o prompt não configura automaticamente nenhuma das ferramentas.

O agente gerador é a Edge Function `master-task-description`. Usa JWT validado por `requireAuth`, confere conta ativa com `permissions.all = true` pelo cliente RLS e só então chama o provedor. Envia apenas título e contexto; não consulta dados de organizações nem usa ferramentas do modelo. Saída estruturada validada, limites de entrada/saída, timeout de 25 segundos, sem repetição automática nem registro do conteúdo nos logs. O modelo gerador (padrão `openai/gpt-4.1-mini` no OpenRouter) é independente dos modelos recomendados para executar a tarefa.

## Banco e publicação

Migration: `supabase/migrations/20261026161627_master_tasks_by_owner.sql`.

Cria `master_tasks`, com RLS para masters plenos, responsável obrigatório, campos de autoria e relógio protegidos por privilégios de coluna, validação de responsável ativo e auditoria em `master_audit_logs`. Os gatilhos são `SECURITY INVOKER`; nenhum bypass novo de RLS é necessário.

Aplicar a migration e publicar `master-task-description` antes de publicar o frontend. A função usa o secret `OPENROUTER_API_KEY` já utilizado pelas outras funções de IA; `MASTER_TASK_DESCRIPTION_MODEL` é um override opcional. Nenhuma credencial vai ao frontend. A migration depende apenas das tabelas e políticas do baseline; a lista de nomes usa a RPC `master_list_staff` já existente nas centrais. Nenhuma tarefa de exemplo é inserida no banco real.

## Verificação

- `node --test tests/integration/master-tasks.test.mjs`: PostgreSQL local via PGlite, políticas reais do baseline, três identidades, acesso negado, validações, auditoria, relógio, transferência e concorrência.
- `node --test tests/integration/master-task-description.test.mjs`: autenticação/autorização, validação, falhas do provedor e formato do prompt, usando respostas simuladas sem consumo da API. Ambos os testes SQL/geração rodam no CI.
- `deno check --node-modules-dir=none --no-lock supabase/functions/master-task-description/index.ts`: verificação de tipos da função e suas dependências, também no CI.
- `node node_modules/vitest/vitest.mjs run src/modules/identity/master/pages/MasterTasks.test.tsx src/modules/identity/master/hooks/useMasterTasks.test.tsx tests/unit/master-centrais-nav.test.ts tests/unit/master-page-header.test.tsx --no-file-parallelism`: entrada pessoal, troca de conta/quadro, criação, edição, erros, paginação e navegação.
- Com `scripts/ui-preview/mock-supabase.mjs --master` e `scripts/ui-preview/start-vite.mjs` ativos, `node scripts/ui-preview/check-master-tasks.mjs` exercita a interface real usando dados fictícios locais: geração, cópia nos dois destinos, pegar, encaminhar, arrastar, editar, excluir e mobile. Capturas ficam em `.ui-shots/master-tasks/`.
- Validação remota pendente: a sessão de desenvolvimento não tem acesso autenticado ao Supabase. A geração real com o secret do ambiente deverá ser conferida no ambiente de publicação; os testes locais usam o provedor simulado.
