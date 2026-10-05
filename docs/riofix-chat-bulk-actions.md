# Seleção de conversas — Riofix

## Pedido e escopo

Adicionar ao chat da Riofix um botão para selecionar conversas por checkbox,
arquivar todas as marcadas e permitir exclusão com confirmação. A funcionalidade
fica restrita à organização Riofix. Solicitação aprovada pelo usuário em
05/10/2026, seguida de autorização para abrir PR e verificar impacto na main.

- As conversas são identificadas por caixa e telefone, inclusive quando o mesmo
  contato aparece em duas caixas.
- “Selecionar todas” abrange apenas conversas carregadas no filtro atual.
- Alterar organização, caixas, busca, aba ou filtros limpa a seleção.
- Exclusão exige administrador, confirmação e usa a lixeira existente (30 dias).
- Arquivadas permitem desarquivar pela mesma seleção.
- Lotes usam no máximo três solicitações simultâneas. A lista atualiza uma vez
  por lote; falhas ficam selecionadas para nova tentativa.
- Não altera banco, automações de vendedores, envio de mensagens ou outras orgs.

## Validação

Testes exercitam a lista real com o cliente de rede substituído por respostas
controladas: isolamento Riofix, caixa correta, filtro, confirmação, administrador,
falha parcial e bloqueio de ações repetidas. Hook de seleção verifica retorno de
uma ação anterior depois de sair e voltar ao mesmo filtro. O executor verifica
concorrência e deduplicação por identidade completa.

Resultado local: 35 testes aprovados em seis arquivos; ESLint dos arquivos
alterados e build de produção aprovados. Smoke no Chrome com a lista real:
163 conversas virtualizadas, arquivamento somente das 27 filtradas, confirmação
antes de excluir, viewport mobile de 390px sem overflow e zero erros JavaScript.
A seleção/desarquivação em Arquivadas depende da navegação desktop que já existe;
o mobile continua sem acesso à aba Arquivadas.

As duas revisões independentes terminaram sem achados pendentes após corrigir o
registro de erros parciais. O merge simulado com `e20e76d23` não tem conflitos.

Gates preexistentes impedem considerar o CI todo aprovado:

- `useConversasUnificadas.test.tsx` falha na inicialização do mock, antes de
  coletar testes. Consta no baseline e foi reproduzido em checkout limpo da main.
- O gate de dependências aponta as mesmas três violações na branch e na main
  limpa: dois ciclos em ContextPanel e o hook órfão useSidebarCollapsed.
- O CI de lint aponta cinco warnings em arquivos de cotações não alterados.
- Integration/pgTAP falham no preparo do banco por coluna `from_pipeline_id`
  inexistente; também houve rate limit do registro de imagens Docker.
- O autoteste de gitleaks aponta arquivos de operações já existentes; o scan de
  segredos do diff passou. Esses jobs já aparecem falhando no commit da main.

Nenhum baseline ou gate foi desabilitado/ampliado. Os problemas gerais não são
uma garantia sobre a mudança: a PR deve continuar passando por revisão antes de
merge, e não deve ser apresentada como CI verde.

Sem operação em conversas reais de produção. A integração usa os mesmos
endpoints já utilizados nas ações individuais; RLS e verificação de administrador
no RPC continuam no servidor. O RPC legado de exclusão verifica administrador,
mas não faz uma checagem explícita de organização no próprio corpo; esta PR não
altera esse contrato. O cliente restringe a organização ao membro atual e às
linhas acessíveis exibidas. Endurecer o RPC legado é trabalho de segurança
separado, não uma garantia nova fornecida pelo controle visual.

## Investigação de lentidão em 05/10/2026

Consultas somente de leitura, via logs e EXPLAIN ANALYZE com a sessão de um
administrador Riofix. Horários abaixo em Brasília (UTC−3).

| Evidência | Resultado |
| --- | --- |
| Lista de uma caixa, limite 500 | 163 conversas em 82,1 ms no banco |
| Lista unificada, mesma caixa e limite | 163 conversas em 81,2 ms |
| Manifesto da conversa informada | 14,3 ms no banco |
| Requisições Riofix às 10h04–10h05 | 504; mensagens aguardaram 346 s e instâncias 360 s |
| Requisições Riofix perto das 11h01 | 503; espera de até 339 s |
| Banco | postmaster reiniciado às 11h06m42s |
| Rotinas 09h–12h04 | 212 falhas “job startup timeout”, 27 “connection failed”, 19 “server restarted” |
| Logs perto das 12h04 | conexões interrompidas e timeout do gerenciador de Realtime |
| Riofix 12h00–12h10 | p95 de API 16,1 s, máximo 75,2 s |
| Riofix 12h10–12h20 (janela observada) | p95 de API 190 ms, máximo 557 ms |
| Snapshot às 12h23 | zero esperas por lock; zero falhas de cron nos últimos dez minutos |

Conclusão: há evidência de indisponibilidade/intermitência de API e banco que
atingiu várias consultas da Riofix, além do chat. O reinício e as falhas de
conexão são confirmados; a causa operacional que os provocou não é identificável
somente por estes logs. Não atribuir a lentidão ao número de conversas nem
prometer que arquivá-las resolverá o incidente. O período saudável observado não
prova que a intermitência foi corrigida permanentemente.

Os tempos de banco não incluem rede nem renderização. As estatísticas de API
Riofix filtram URLs pelo UUID da organização/instância; RPCs POST não expõem seus
argumentos na URL e ficam fora dessa agregação. Não foi reproduzida a sessão do
navegador de Leonardo. Nenhum restart, ajuste de capacidade ou mudança de cron
foi executado durante esta investigação.
