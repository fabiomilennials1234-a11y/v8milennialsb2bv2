# Supabase Edge: projeção conjunta — 2026-09-24

## Estado medido

Os dois projetos pertencem à organização Pro `rovcfbcyfmmrxadzovvf`. No intervalo fixo **23/09 15:30–24/09 15:30 UTC**, `function_edge_logs` registrou **85.423** chamadas HTTP não-OPTIONS no CRM e **zero** no `torque-wallet-motor100`. O segundo projeto não tem Edge Functions publicadas na listagem atual. Zero linhas de log não é leitura do medidor de cobrança.

O painel oficial **Organization Usage**, filtro **All projects**, mostrava às ~**24/09 15:55 UTC** um ciclo **24/09–27/09/2026** e **36.406 / 2.000.000** invocações Edge (2%, overage zero). Supabase informa atraso de atualização de até **1 hora**; portanto esse acumulado parcial não se compara diretamente à janela fixa de logs nem deve ser extrapolado como ciclo de 31 dias. O painel declara que a organização ainda não excedeu a franquia Pro neste ciclo. Leitura: [Organization Usage](https://supabase.com/dashboard/org/rovcfbcyfmmrxadzovvf/usage); valores redigidos na [evidência JSON](supabase-capacity-projection-2026-09-24.json).

O CRM teve **53.857** chamadas à rota `whatsapp-webhook` (~63% do total), das quais **25.950** foram à rota `messages_update` (~30% do total). A observação separada de **538** updates bem-sucedidos de TorqueSDR em `runtime_logs` mede processamento, não invocações faturadas; serve apenas como escala aproximada do piloto. O piloto Edge→inbox da TorqueSDR foi ligado às16:04 UTC, mantendo a chamada Edge e a URL do provider; a rota direta ao VPS continua desligada. Portanto **economia realizada atribuível ao piloto: zero**. Fonte agregada, sem URLs, payloads ou chaves: [evidência JSON](supabase-capacity-projection-2026-09-24.json).

O histórico anterior de sete dias registra **584.535** chamadas CRM e **144.166** updates; wallet registra zero. Janelas diferem: sete dias terminam em 23/09 22:00 UTC, enquanto a amostra recente atravessa a implantação da migration 31 de cron às 24/09 03:46 UTC. Não atribuir diferenças entre janelas somente à migration; calendário, tráfego, incidentes e ingestão tardia dos logs também mudam a contagem.

## Cenários, não economia contabilizada

Cada linha multiplica uma taxa observada por **31 dias corridos**. Mês de faturamento pode ter outra duração e começar em outra data. Taxa, mix, crescimento e retries podem variar.

| Cenário | Projeção 31 dias | Distância da meta interna de 1,4M |
| --- | ---: | ---: |
| Últimas 24h constantes, sem novo corte | 2.648.113 | +1.248.113 |
| Mesma taxa, **hipótese** de remover 538 updates/dia do piloto | 2.631.435 | +1.231.435 |
| Mesma taxa, **hipótese** de remover todos os 25.950 updates/dia | 1.843.663 | +443.663 |
| Taxa média dos sete dias antigos, sem novo corte | 2.588.655 | +1.188.655 |
| Sete dias antigos, **hipótese** de remover todos os updates | 1.950.206 | +550.206 |

Mesmo a remoção de **todos** os updates não comprova 1,4M. O piloto TorqueSDR representaria cerca de **16.678 chamadas/31 dias**, se seu contador de sucesso coincidisse com invocações, premissa ainda não verificada. Redução de cron prevista em planos anteriores não entra nessas contas: migration 31 já foi aplicada durante a janela recente, e a economia incremental exige medição por função depois da mudança. Evitar somar novamente percentual hipotético de cron sobre taxa que já pode incorporá-lo.

A [documentação oficial](https://supabase.com/docs/guides/platform/manage-your-usage/edge-function-invocations) diz que Pro inclui **2 milhões** de Edge Function invocations por ciclo para a organização inteira, soma todos os projetos, cobra chamadas independentemente do HTTP status e não cobra preflight OPTIONS. **1,4M é meta interna**, com margem abaixo da franquia oficial. Logs de invocação são proxy operacional, não substituem Usage/invoice. [Regras de faturamento da organização](https://supabase.com/docs/guides/platform/billing-on-supabase).

Outros medidores do mesmo painel: **Storage 45,141 / 100 GB**, **Egress 1,501 / 250 GB** e **Realtime Messages 44.457 / 5.000.000**, todos sem overage exibido. A vírgula no painel representa decimal nos valores em GB. Cada projeto mostra **18 GB de disco provisionado**, frente a **8 GB incluídos por projeto**; o painel ainda registra **0 GP3 GB-Hrs** de overage neste ciclo parcial. Compute registra **11 horas Micro ($0,15)** e **11 horas Small ($0,23)**, com **US$ 10 de créditos de compute** no plano. Disco e compute têm regras próprias de cobrança: atingir 1,4M invocações não garante ausência de custo adicional total. Não inferir valor final de fatura de um ciclo recém-iniciado.

## Próximos consumidores a medir

Depois do webhook, sete dias antigos mostram `agent-message` **37.901**, `process-workflow-executions` **23.394**, `whatsapp-api-proxy` **23.065** e `send-push` **18.482** chamadas. Funções de cron/worker aparecem em blocos próximos a **10 mil por sete dias** cada; várias somadas competem com o webhook. Há chamadas de produto e recuperação nesses totais. Separar cron ocioso de trabalho devido com contadores próprios antes de prometer corte. Para o webhook, `messages` (mensagens normais) continua no Edge durante piloto de receipts; não contar todo `whatsapp-webhook` como economia.

Medida de fechamento: acompanhar **Organization Usage** até o fim do ciclo e, quando disponível, por projeto; comparar com janelas fechadas de `function_edge_logs`, excluindo OPTIONS, e registrar diferença. Após cada ativação, medir chamadas por função e rota no mesmo horário e dia da semana; conferir 5xx, backlog, dead letters e latência. Economias entram no orçamento somente quando a rota realmente sai do Edge e a queda aparece no medidor da organização.

## Candidato seguinte após os updates

Prioridade de **análise futura**, sem ativação nesta entrega: rota WhatsApp `messages`. Foi o maior grupo remanescente identificável no webhook: **171.723 invocações em sete dias**, ou **~760.488 em 31 dias** se a taxa persistir. Na janela recente, webhook total menos `messages_update` dá **27.907/dia** e **no máximo 865.117/31 dias** para todas as outras rotas somadas; não atribuir esse teto inteiro a `messages`. A rota executa persistência de mensagens e efeitos posteriores de workflow/Copilot; reduzir seu tráfego Edge exige preservar esses efeitos, ordenação, deduplicação, recuperação e latência de resposta ao cliente.

No cenário **inteiramente hipotético** em que todos os updates saíssem do Edge, a distância de **443.663/31 dias** até 1,4M exigiria deslocar **~58,3%** das invocações históricas da rota `messages` (443.663 ÷ 760.488). É uma meta de cobertura, não economia prevista: um piloto pequeno ou uma ponte Edge → inbox continua contabilizado como Edge. Primeiro medir `messages` por instância e eventos já processados por hora; depois projetar cobertura de um subconjunto real, testar contrato de entrega da rota direta, efeitos comerciais e rollback por instância. Só então decidir migração de rota. Uma redução isolada de `agent-message` (37.901/7 dias, ~167.847/31 dias) ou `process-workflow-executions` (23.394/7 dias, ~103.602/31 dias) não fecha o gap, mesmo no limite irreal de eliminar 100% das chamadas.

Não somar uma segunda economia genérica de cron: SQL31 entrou às **24/09 03:46 UTC**, no meio da amostra recente, e já adicionou seis filtros de trabalho ocioso. O histórico de sete dias anterior representa situação pré-mudança; falta uma janela fechada pós-SQL31 por função para distinguir chamadas poupadas de chamadas de trabalho real. A rota `messages` também pode variar por dia e por mix de instâncias; confirmar no medidor da organização após qualquer desvio efetivo do Edge.
