# Tarefas no Comando e gestão por organização

## Comportamento entregue

A execução permanece no card **Tarefas do dia** do Comando. A lista reúne as
ações pessoais existentes de `acoes_do_dia` e as atividades atribuídas pelo
admin. Os dois títulos são **Criadas por você** e **Criadas pelo admin**.
O recorte é sempre do próprio usuário, inclusive na Central da equipe do admin.
Criar, concluir, reabrir e remover tarefas pessoais continua usando os registros
originais; não há cópia nem descarte dessas ações.

A porta **Gestão de tarefas**, acima da Agenda, só aparece para admins. Membros
que tentarem acessar `/tarefas` são redirecionados ao Comando e não carregam
configuração ou filas de equipe. A paleta de comandos e os recentes aplicam a
mesma restrição.

Na gestão, o admin atribui uma atividade à equipe inteira ou seleciona um ou
mais membros ativos da organização. Informa prazo, orientação e prioridade
**baixa**, **média** ou **alta**. Cada destinatário recebe uma ocorrência própria;
concluir uma não conclui a dos colegas. A fila prioriza a tarefa em andamento e,
entre as outras atividades atribuídas, a prioridade e o prazo.

O admin também configura playbooks por etapa e rotinas. Playbooks podem ter
destinatários fixos ou acompanhar o responsável pelo negócio. Somente estes
últimos acompanham uma troca de responsável. Cada combinação negócio/atividade
é gerada uma vez: retornar à etapa não duplica a distribuição, mesmo se o modelo
tiver sido editado. Edições não reescrevem as instruções das tarefas já geradas.

Atividades obrigatórias exigem um motivo para avançar ou encerrar o negócio sem
executá-las. O avanço continua permitido; o motivo fica no histórico e a tarefa
permanece pendente. A autorização tem prazo e é consumida uma única vez.

Rotinas respeitam os dias e o fuso da organização. Uma ocorrência não executada
encerra como **Não feita** após a virada do dia. O próximo dia gera outra
ocorrência, sem acumular a anterior na fila. Há sincronização ao abrir/refrescar
a fila e um job quatro vezes por hora quando `pg_cron` está instalado, nos
minutos 10, 20, 40 e 50. Os intervalos alternam entre 10 e 20 minutos para não
coincidir com purgas pesadas nem exceder o teto de conexões simultâneas.

## Preservação e autorização

Os modelos de checklist vinculados a etapas são convertidos uma única vez em
atividades do playbook. Itens já aplicados aos negócios ficam como histórico,
com seus estados originais, sem virarem um backlog novo. O motor de checklist
legado continua para organizações Classic.

As tabelas novas têm RLS e o cliente autenticado não recebe permissão de escrita
direta. Os RPCs verificam acesso à organização; configuração e distribuição
exigem admin. Destinatários vazios, repetidos, inativos ou de outra organização
são recusados. A fila pessoal não aceita alargar o recorte pelo parâmetro de
responsável; consultar a equipe exige uma opção explícita e autorização admin.
Executar uma tarefa exige ser seu destinatário. Ações pessoais novas também
validam organização, autor e vínculo do lead no servidor.

O master conserva sua função administrativa, mesmo sem assento na organização,
mas os destinatários e as consultas permanecem limitados à organização alvo.
Falhas numa das fontes do card não escondem a outra: o card mantém os dados
disponíveis e informa qual consulta precisa ser refeita. Os indicadores não
apresentam uma contagem parcial como se fosse completa.

## Validação local

```sh
npm run test:tasks
npm run typecheck:ratchet
npm run build
```

`test:tasks` executa os testes de interface e a migration real em PGlite, usando
o gate de tenancy e o gatilho legado extraídos das migrations do repositório.
Cobre conversão sem backlog, histórico, atribuição múltipla, prioridade,
isolamento por organização, execução independente, virada de dia, avanço com
motivo, pausa/reativação, master e manutenção das tarefas pessoais existentes.
Isso não substitui um ensaio contra o schema completo e o ledger do ambiente
que receberá a publicação.

Neste checkout, a prévia visual usa o `MainLayout`, o `Dashboard` e os componentes
reais com dados demonstrativos em `.ui-shots/tasks-preview/`. Esses fixtures são
ignorados pelo Git e não entram no build do produto. Para abrir:

```sh
node node_modules/vite/bin/vite.js --config .ui-shots/tasks-preview/vite.config.ts
```

Endereço: `http://127.0.0.1:4177/dashboard`. O seletor **Testar como** alterna
admin/membro exclusivamente nessa prévia. Ela não valida login nem conecta ao
banco de produção. Alterações nos dados demonstrativos duram até recarregar.

## Publicação

Produção exige autorização explícita, conforme `CONTRIBUTING.md`. O Supabase dev
antigo está aposentado; não usar a URL antiga do MCP como ambiente de teste.
O procedimento do repositório para um ensaio conectado está em
`.specs/project/runbook-validacao-local.md`, incluindo custos e descarte da branch.

1. Confirmar o projeto alvo e comparar seu ledger com as migrations do checkout.
   Não executar `db push` indiscriminadamente: a numeração do repo é histórica e
   pode divergir do ledger do ambiente.
2. Revisar a migration `20271216000000_tarefas_playbook_opcao_b.sql`, principalmente
   RLS, grants, RPCs e os gatilhos dos negócios e das ações pessoais. Confirmar
   dependências e fazer o ensaio conectado antes de liberar a mudança.
3. Aplicar a migration autorizada antes de publicar o frontend que usa os RPCs.
   Ela cria a estrutura; não converte em lote as organizações existentes.
4. Publicar o frontend. A primeira sincronização converte os modelos daquela
   organização. Para ativação antecipada/controlada de uma organização, executar
   `SELECT public.task_activate('<organization UUID>');` com a identidade de admin
   ou serviço apropriada. `scripts/migrate-checklists-to-playbooks.sql` é a opção
   explícita em lote para todas as organizações V5; não roda automaticamente no build.
5. Com dois membros e um admin da organização alvo, conferir: tarefas pessoais
   mantidas; atribuição a um subconjunto invisível aos não selecionados; tarefa
   da equipe com execuções independentes; prioridades; geração na etapa;
   retorno sem duplicação; motivo registrado ao avançar com pendência; rotina
   no fuso correto. Confirmar que outra organização não aparece nas consultas.
6. Confirmar o job `task-routines-roll-day`, ou manter a sincronização ao abrir a
   fila como contingência. Orientar usuários com a interface antiga em cache a
   recarregar após a publicação.

## Pausa e reversão

A reversão operacional preserva dados. Não apagar tabelas, atividades, tarefas,
motivos de avanço ou o histórico dos checklists.

Para pausar a geração em uma organização, um operador autorizado configura o
UUID alvo na conexão e executa `scripts/pause-task-playbooks.sql`:

```sql
SELECT set_config('torque.task_pause_org', '<organization UUID>', false);
```

A pausa desliga a geração por etapa e por rotina naquela organização e devolve
os gatilhos de checklist ao caminho legado. Não apaga nem cancela execuções já
existentes. Abrir/sincronizar a fila não reativa o motor. Se necessário, reverter
também o frontend pela rotina de deploy do projeto.

Para reativar de forma explícita: `SELECT public.task_activate('<organization UUID>');`.
A conversão continua idempotente e não recria tarefas para negócios antigos.
