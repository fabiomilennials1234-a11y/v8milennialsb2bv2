# Capacidade Supabase Pro — entrega de 23/09/2026

## Objetivo e critério de sucesso

Reduzir trabalho ocioso e chamadas rejeitadas sem reduzir cadência de envio, remover funcionalidades, apagar histórico comercial ou enfraquecer isolamento entre organizações. Preparar implantação para 24/09; produção não foi alterada nesta entrega.

Sucesso financeiro exige medir a organização inteira, inclusive wallet, no ciclo de cobrança. Testes de código não demonstram economia mensal. A primeira entrega reduz desperdício; não garante ficar abaixo da franquia nem cancelar a restrição anunciada para 24/09.

## O que significa 1,4 milhão

A franquia Pro de Edge Functions é 2 milhões de invocações por ciclo. A meta operacional proposta é usar até 70%: **1,4 milhão**, deixando **600 mil / 30%** para picos, novas organizações e tentativas de recuperação. Não é outro limite do Supabase, nem número de usuários suportados.

Em um ciclo de 31 dias, isso equivale a aproximadamente 45.161 chamadas/dia; o limite de 2 milhões equivale a 64.516/dia. Em 30 dias, 46.667 e 66.667. O orçamento precisa incluir todos os projetos e acompanhar dias úteis, campanhas e sazonalidade.

## Linha de base

Painel da organização em 23/09: ciclo 27/08–27/09 com **2.182.221 / 2.000.000** invocações, sendo **2.176.579** no CRM. Ciclo anterior do CRM: **2.439.645**. Spend Cap ativo. Otimizar agora reduz novas chamadas; não subtrai consumo já contabilizado nem garante a remoção imediata do aviso.

Logs de entrada de funções do projeto CRM, sete janelas de 24 horas entre 16/09 22:00 UTC e 23/09 22:00 UTC, excluindo OPTIONS: **584.535 chamadas**. Média **83.505/dia**; projeção aritmética **2.505.150 / 30 dias** ou **2.588.655 / 31 dias**. Essa projeção não inclui wallet. Logs não são o livro de faturamento; semanas futuras podem diferir. Parte dos erros históricos já não aparece no último dia, portanto não contabilizar sua correção novamente como economia futura.

| Função | Chamadas em 7 dias | Leitura |
|---|---:|---|
| whatsapp-webhook | 316.055 | 54,1% do total; maior alavanca depende dos eventos recebidos |
| agent-message | 37.901 | Trabalho de IA; batching já existe |
| process-workflow-executions | 23.394 | Inclui execução, triggers e sondas de saúde |
| whatsapp-api-proxy | 23.065 | Requisições do produto/provedor; não limitar indiscriminadamente |
| send-push | 18.482 | Histórico inclui chamadas com erro; guarda canônica evita fila vazia |

Histórico sanitizado completo: [JSON](../docs/operations/supabase-capacity-edge-history-2026-09-23.json). Inventário de **71 crons ativos**, predicados e oportunidades: [workers](../docs/operations/supabase-worker-inventory.md).

## Mudanças do pacote

| Onde | Antes → depois | Efeito para usuário / custo |
|---|---|---|
| 12 invokers SQL de cron | Chamava Edge a cada tick → primeiro verifica se existe trabalho elegível | Mesma frequência, fila vazia dispensa Edge; fila continua dona de claims/retries |
| Histórico, IA, mensagens agendadas, push, Copilot V2, mass-send, mídia e DLQ | Guardas específicas, incluindo recuperação prevista no worker | Evita remover trabalho atrasado ao tentar economizar |
| Pipe, campanhas, blast oficial e feedback | Guardas preservam waits expirados, leases, lote liberado, provider e modo weekly | Não modifica horários comerciais nem ritmo de disparo |
| Workflow / cron-health-check | noop_probe caía no processamento → retorna saúde após autenticação | Evita consultas e claims por uma sonda; a invocação da sonda continua existindo |
| Sidebar / Oráculo | Consultava briefing sem feature e repetia 4xx → espera permissões, não consulta sem feature, não repete 4xx | Menos rejeições; autorização continua no servidor; cache isolado por usuário/organização |
| WhatsApp / reações de grupo | Reação tentava achar alvo antes da política de grupos → ignora quando grupo identificado e captura explicitamente desativada | Evita erros/retries nessa condição; conversas diretas e grupos habilitados mantêm persistência |
| Associação por convite | Leitura incorreta de `getUser()` gerava 401 mesmo com JWT válido → usa `data.user` validado | Restaura associação legítima sem ampliar permissões; não contabilizar como economia garantida |
| Comando / aguardando resposta | Buscava leads mesmo com nome/responsável já completos → busca só enriquecimentos ausentes | Menos leitura/tráfego de banco; não altera seleção do RPC nem a lista exibida |

Migrations: `20271021000026_cron_skip_idle_dispatch.sql` e `20271021000027_cron_skip_idle_campaigns.sql`, com rollbacks correspondentes. Dois índices parciais pequenos, somente linhas em processing, atendem sondas de recuperação. Nenhum índice de mensagens ou logs foi removido.

## Quanto pode economizar

As agendas dos 12 workers permitem evitar, **no máximo**, **440.640 chamadas / 30 dias** ou **455.328 / 31 dias** se todos esses ticks estiverem ociosos. É teto teórico, não previsão. Trabalho real continua chamando Edge; backlog que não progride também continua chamando até ser resolvido.

Cálculo auditável: nove agendas por minuto, duas a cada dois minutos e uma a cada cinco minutos = **14.688 ticks/dia**. A execução independente do modo weekly permanece fora da economia. No histórico, jobs full aguardando janela continuam acionando o worker conservadoramente; não duplicamos sua regra de janela no SQL.

Aplicando apenas esse teto à projeção observada: 2.588.655 − 455.328 = **2.133.327 / 31 dias**, ainda acima de 2 milhões. Portanto os guards sozinhos não cumprem a meta. Gates de briefing, reações e enriquecimento ajudam, mas sua economia não foi somada por falta de medição causal.

Últimas 24 horas observadas: 954 chamadas de briefing, 670 respostas 403; 52.814 chamadas de webhook, 1.556 erros HTTP; logs internos registraram 12.175 descartes de mensagens de grupo e 1.589 erros “Reaction target unavailable”. Log interno não equivale necessariamente a invocação única. Não assumir que todo erro de reação vem de grupo nem que todos os 403 são plano sem feature.

Maior próxima alavanca: impedir no provedor eventos de grupos desativados de chegar ao Supabase. Um early return dentro da Edge já foi faturado. O filtro externo exige sincronização confiável ao habilitar grupos, configuração por instância e validação do fornecedor. Não aplicar filtro global que torne grupos habilitados invisíveis.

## Banco e outros custos

Banco CRM medido: **9,89 GB**; wallet **4,18 GB**. `whatsapp_messages` ocupa aproximadamente **5,95 GB**, incluindo **2,95 GB** de índices; `runtime_logs`, **727 MB**, incluindo **527 MB** de índices. Painel mostrava **18 GB de disco provisionado por projeto**, contra 8 GB incluídos por projeto. Disco provisionado, tamanho lógico do banco e Storage de arquivos são medidas diferentes.

Não encontramos duplicatas estruturais exatas nos índices auditados de mensagens/logs. Índice com poucas leituras não prova inutilidade. Logs já possuem retenção automática: 2 dias para webhook e 30 dias para outros tipos; não reduzir sem avaliar suporte/auditoria. Apagar linhas não reduz automaticamente disco provisionado.

A tela Comando tem consulta de mensagens cara; uma amostra de plano levou 17,159 s, principalmente leitura de heap. Este pacote reduz enriquecimento redundante, mas **não reescreve a consulta pesada**. Evoluir resumo incremental com campos de última mensagem humana/recebida é trabalho próprio: precisa equivalência funcional, backfill controlado e medição. Adicionar índices grandes às cegas aumenta disco e custo de escrita.

Manter Pro sem excedentes exige tratar separadamente invocações, disco, compute e recursos extras. A configuração Small + Micro visível no painel não equivale à mensalidade Pro isolada; não fazer downgrade sem medir memória/CPU e latência.

## Implantação proposta e reversão

1. Conferir diff, checks e resultados de validação deste pacote. Confirmar live ainda corresponde às versões auditadas; outras entregas podem mudar invokers/worker desde 23/09.
2. Sob autorização de produção, usar `lock_timeout = '3s'` e timeout de execução; aplicar somente as duas migrations novas, pelo procedimento aprovado do projeto. **Não executar db push irrestrito de toda a cadeia pendente.** Confirmar versões no ledger e grants efetivos no alvo: anon/authenticated false, service_role true.
3. Publicar apenas as Edge Functions alteradas e frontend pelo fluxo normal do projeto. Não alterar Spend Cap, plano, compute ou configuração global do provedor.
4. Smoke: mensagem direta, reação em grupo desativado/ativado, mensagem agendada vencida, fila vazia, recuperação de lease, campanha/pipe com timeout, lote oficial, push elegível, briefing permitido/negado e noop_probe autenticado/não autenticado.
5. Comparar janelas equivalentes de 24 horas e 7 dias. Verificar invocações por função e total da organização, erros, idade do item elegível mais antigo, throughput e tempo de entrega. Economia acompanhada de fila parada é regressão.
6. Se trabalho elegível não progride na cadência anterior ou erro sobe em cenário tocado, aplicar rollback correspondente e restaurar versões anteriores de Edge/frontend. SQL da guarda é read-only sobre filas, portanto rollback não requer reconstruir dados de negócio.

Ferramenta de observação de banco: [SQL read-only](../scripts/sql/supabase-capacity-observe.sql). Não resetar estatísticas nem rodar consultas pesadas em loop.

## Falha dos resumos: proposta separada

O cron `summarize-conversations-batch` falhou 144 vezes no último dia. Erro SQL observado: referência ambígua a `organization_id` no claim. O conflito entre parâmetro de retorno PL/pgSQL e coluna precisa usar a constraint UNIQUE explicitamente. Porém existem **25.900 conversas elegíveis e nenhum job criado**. Restaurar o claim desbloqueia trabalho antes inexistente: até 1.440 chamadas-filhas/dia no lote padrão, além de uso de IA. Correção proposta fica fora das migrations de implantação deste pacote; exige orçamento e controle do backlog. Não contar a ausência de execução como otimização saudável.

## Validação remota

Branch temporária `swwbzojcsawnexhpmzgl`, criada para teste sem dados, foi excluída e a ausência confirmada pela API em 23/09. Custo informado pelo conector: US$ 0,01344/hora. Tentativa de fixture transacional falhou com SQLSTATE `42501`, `permission denied for schema net`, antes de executar assertions. Portanto **migrations não estão validadas no Supabase remoto**. Testes em PostgreSQL embutido PGlite passaram com HTTP substituído por coletor local; não substituem validação de permissões/pg_net no ambiente final. Nenhuma migration aplicada em produção. Um novo ensaio remoto precisa de ambiente/permissão adequados e autorização para outra branch temporária.

## Limites da entrega

- Não promete remover restrição do ciclo atual: o consumo já ultrapassou a franquia. Conferir painel/suporte do Supabase; não desativar Spend Cap como suposta otimização.
- Não promete 1,4 milhão sem medir após implantação e reduzir eventos/fanout adicionais.
- Não remove clientes, histórico comercial, monitores de saúde ou recuperação de filas.
- Validação, revisão e estado final de release registrados no PR; produção exige autorização explícita.

## Referências oficiais

- [Invocações Edge: franquia, OPTIONS e cobrança](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations)
- [Disco provisionado e franquia](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size)
- [Tamanho de banco e disco](https://supabase.com/docs/guides/platform/database-size)

## Evidências de verificação local

Instalação isolada via `npm ci`, respeitando package-lock. Dependências do checkout original não foram alteradas.

- `npm run build`: passou (warnings preexistentes de chunks/circularidade/chaves duplicadas).
- `npm run typecheck:ratchet`: passou, zero erros introduzidos; 464 ocorrências herdadas no total.
- `npm run lint:deps:check`: passou, 131 violações herdadas.
- Suíte focada de nove arquivos: **52 testes passaram**, incluindo hooks Comando/briefing, autenticação de convites, handler real de reações, noop_probe e recuperação de workflows.
- `node --test tests/integration/cron-idle-dispatch.test.mjs tests/integration/cron-idle-campaigns.test.mjs`: **2 suítes SQL passaram**, incluindo cenários positivos/negativos, grants, recuperação, rollback e reaplicação.
- `node --test tests/integration/summary-claim.test.mjs`: proposta de resumos reproduz erro 42702 e valida correção/rollback; **fora do rollout**.
- Ratchet de lint retorna cinco avisos de código de propostas comerciais fora do diff, reproduzidos no checkout base. Baselines não foram ampliados.
- Ratchet unitário amplo retorna 170 falhas além do baseline versionado. Checkout limpo `961c226d3`, com mesmas dependências e retry, reproduziu exatamente as mesmas 170 chaves: **zero regressões novas**. Prova em `docs/operations/supabase-capacity-test-delta.json`. Não equivale a suíte inteira verde.
- Scanner de secrets: nenhum achado nos arquivos alterados; execução completa acusa um achado herdado em `scripts/ops/repair-loofting-bulk-pipeline-move.sql:18`, arquivo idêntico à base. Sem reproduzir valor no relatório.
- Sem E2E em produção nem teste de carga; ensaio remoto descrito acima não concluiu.

Review de segurança independente não encontrou bloqueador novo nos guards, hook, noop_probe, reações ou autenticação. `SECURITY DEFINER` mantém search_path fixo e revoga execução de PUBLIC/anon/authenticated. Conferência de privilégios passou no banco de teste local; obrigatória novamente no alvo real do apply.
