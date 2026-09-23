# Capacidade Supabase — plano para 1,4 milhão por ciclo

Data: 23/09/2026. Estado: proposta técnica, sem alteração de produto, fornecedor ou produção nesta fase. O pacote inicial de correções tem validação própria; este documento não afirma que aquele pacote entrega sozinho 1,4 milhão.

## Conclusão

**A meta exige reduzir entradas faturadas, além de eliminar crons vazios.** O webhook WhatsApp sozinho projeta 1.399.672 chamadas num ciclo de 31 dias pela média dos sete dias observados. Melhorar SQL, escrever menos logs ou retornar 200 mais cedo não elimina a chamada que já entrou na Edge Function.

Prioridade: medir o pacote inicial, filtrar grupos realmente desabilitados no fornecedor com sincronização segura e retirar progressivamente o processamento da rota de atualizações WhatsApp da cobrança por invocação. O destino possível é um serviço dedicado na infraestrutura existente, após verificar capacidade, disponibilidade e custos. Não está provado que o VPS atual comporta isso mantendo a experiência e o custo total.

## Base reproduzível e orçamento sem dupla contagem

Fonte: `docs/operations/supabase-capacity-edge-history-2026-09-23.json`. Sete janelas completas, de 16/09 22:00 a 23/09 22:00 UTC. `function_edge_logs`, sem OPTIONS; **não é o livro de faturamento**. Os números abaixo são produção; outros projetos da mesma organização precisam entrar no orçamento final.

| Grupo mutuamente exclusivo | Chamadas em 7 dias | Projeção para 31 dias |
|---|---:|---:|
| whatsapp-webhook | 316.055 | 1.399.672 |
| 12 funções atendidas pelas guardas iniciais | 110.946 | 491.332 |
| agent-message | 37.901 | 167.847 |
| whatsapp-api-proxy | 23.065 | 102.145 |
| process-workflow-executions, todos os modos | 23.394 | 103.602 |
| oraculo-briefing | 5.463 | 24.193 |
| attach-to-org-by-pending-invite | 2.980 | 13.197 |
| Todas as demais | 64.731 | 286.666 |
| **Total** | **584.535** | **2.588.655** |

Projeção de 30 dias: 2.505.150. Último dia: 91.761 chamadas, equivalentes a 2.844.591 em 31 dias se repetido; maior dia observado: 106.324. Usar média semanal para planejamento e último dia/picos para teste de resistência, sem chamar projeção de consumo medido.

As 12 guardas cobrem nove agendas por minuto, duas a cada dois minutos e uma a cada cinco: **440.640 ticks em 30 dias, 455.328 em 31 dias**. A economia máxima nunca é automaticamente todo o grupo de 491.332: chamadas de outros caminhos, trabalho útil e modo semanal continuam. `send-push`, por exemplo, teve 18.482 chamadas em sete dias, mais que os 10.080 ticks possíveis do cron por minuto; não atribuir todas ao cron.

Meta de 1,4 milhão é orçamento de engenharia, 70% da franquia de 2 milhões. Reserva de 600 mil serve a picos, falhas e crescimento, não deve ser preenchida deliberadamente por novas tarefas. Em 31 dias, meta corresponde a aproximadamente 45.161 chamadas/dia para **a organização inteira**. Capacidade de banco, disco, tráfego e Realtime têm seus próprios limites; acertar invocações não comprova ausência de outros excedentes.

## Fase A — comprovar economia do pacote inicial

As guardas preservam agendamento, claim atômico, retries e recuperação. Medir por pelo menos uma semana completa após estabilizar: chamadas HTTP, tarefas concluídas, idade da fila e erros. Amostrar também 24 horas úteis para detectar problemas cedo. Não aumentar cadência nem lote para fazer gráfico parecer melhor.

Para planejar, simular 50%, 80% e 100% dos ticks evitados: 227.664, 364.262 e 455.328 chamadas por ciclo de 31 dias. **80% é hipótese, não previsão comprovada**; percentual provável só existe depois de medir ocupação. Mesmo o teto deixa 2.133.327 chamadas mensais pela média histórica.

Oráculo sem entitlement evita chamadas condenadas a 403; quantificar separadamente. Attach corrige autenticação, não reduz chamada legítima. O probe de cron evita trabalho de banco, não sua chamada. Correção de reações pode diminuir retries, mas não recebe crédito sem identificar eventos e tentativas. A proposta de resumo continua fora do rollout econômico: habilita backlog de 25.900 conversas e pode acrescentar até 43.200 chamadas filhas por 30 dias, além de IA.

## Fase B — cortar grupos desabilitados antes da Edge

Documentação oficial [Definir Webhook Uazapi](https://www.postman.com/augustofcs/uazapi-v2/request/so8w6vz/definir-webhook) oferece `excludeMessages: isGroupYes`. Estado observado: 130 instâncias de organizações com captura desligada, seis com captura ligada. São instâncias cadastradas, não necessariamente conectadas.

Foram registrados 12.175 eventos descartados no último dia; isso **não equivale a 12.175 chamadas faturadas**, porque payloads e retries não têm relação garantida de um para um. Medir a economia por requests, não por contagem de logs internos. Não atribuir a reações o mesmo crédito que será dado ao filtro de grupos.

Implementar uma política comum nos caminhos criação, reconfigure manual e rebind. Persistir intenção/versionamento e reconciliação por instância; ler de volta filtros, eventos e ID do webhook. Organização desconhecida/erro de configuração não autoriza bloquear grupos. Habilitação só termina depois de retirar filtro remoto e verificar; desabilitação conserva guarda atual no servidor durante falha remota. Testar ligar/desligar/ligar, alteração concorrente, timeout do fornecedor, read-back inconclusivo, recuperação após reinício e grupos habilitados. Detalhes e arquivos em `docs/operations/supabase-worker-inventory.md`.

Nenhuma evidência consultada garante webhook Uazapi em lotes configuráveis. Não basear orçamento em “pedir ao fornecedor lotes de 20” nem esperar artificialmente para acumular mensagens de clientes.

## Fase C — rota de atualizações WhatsApp em serviço dedicado

Classificação HTTP real do último dia, realizada pelo agente principal sem expor URLs com segredo:

| Rota Uazapi | Chamadas | Erros |
|---|---:|---:|
| messages | 27.713 | 1.554 |
| messages_update | 25.085 | 2 |
| connection | 16 | 0 |

A rota `messages_update` corresponde a 47,5% desse dia. Primeiro candidato a retirar da Edge: essa rota inteira, mantendo `messages` e IA no caminho atual durante a primeira transição. Ela também processa edição, exclusão, pin e reação; não é apenas recibo de entrega. Isso exige serviço novo; não basta colocar proxy que repassa toda chamada à Edge.

Histórico fechado de sete dias confirmado posteriormente em `docs/operations/supabase-capacity-webhook-routes-2026-09-23.json`: `messages` 171.723 (760.488 por 31 dias), `messages_update` 144.166 (638.449 por 31 dias), `connection` 166 (735 por 31 dias). A soma é exatamente as 316.055 chamadas de webhook do orçamento; não é amostragem de logs de negócio.

### Infraestrutura realmente encontrada

`docker-compose.yml` contém somente frontend `web`. Existem serviços separados de calendário e documentos em `services/google-calendar-service/` e `services/quote-documents/`; isso prova padrão de container no repositório, não capacidade disponível nem implantação de ambos. Não foi encontrado worker de ingresso WhatsApp, broker Redis/BullMQ ou fila durável geral operando nesses serviços. Filas atuais e DLQ estão no Postgres e Edge. Documentação antiga contém contagens e descrições defasadas; prevalecem código e inventário vivo.

Consulta adicional ao Hostinger confirmou o VPS atual KVM 4: **4 vCPUs, 16 GiB RAM e 200 GiB de disco**. Na mesma semana, 336 amostras aproximadamente a cada 30 minutos: CPU média 60,81%, p95 das amostras 62,65%, máximo 65,03%; RAM média 10,01 GiB, p95 10,58 GiB, máximo 11,27 GiB. Disco usado chegou a 37,92 GiB. Evidência sanitizada: `docs/operations/supabase-capacity-vps-metrics-2026-09-23.json`.

Esses dados tornam plausível testar um container limitado no servidor atual, sem concluir que existe capacidade garantida: amostras de 30 minutos escondem rajadas e não atribuem consumo a cada serviço. Medir pico por segundo/minuto e concorrência com aplicações existentes; validar falha/reinício e disponibilidade antes de receber tráfego real. Não comprar nem ampliar infraestrutura com base apenas nessa média.

Criar serviço próprio, com orçamento de CPU/memória/conexões, credenciais restritas, healthcheck e observabilidade. Medir VPS atual antes: recursos livres nos horários de pico, disco, I/O, restart policy, TLS, domínio, monitoramento, backups e tolerância a falha. Dois processos no mesmo VPS não equivalem a alta disponibilidade. Se não houver redundância/fallback comprovado, não anunciar equivalência à disponibilidade atual.

### Transporte e durabilidade

Opção preferida para investigação: configurações Uazapi separadas por evento, mantendo mensagens/conexão no endpoint atual e enviando somente `messages_update` ao serviço novo. Documentação expõe IDs e ação de adicionar/atualizar webhook; **contrato de múltiplas configurações independentes precisa ser validado numa instância controlada**. `readWebhook` atual seleciona primeiro elemento, portanto não serve como verificação de duas rotas. Rollout deve provar ausência de duplicação e de lacunas entre configurações.

Se fornecedor não suportar separação confiável, gateway externo único pode rotear atualizações e repassar mensagens à Edge, mas passa a ser dependência de toda entrada. Isso amplia risco e exige desenho de disponibilidade antes de qualquer troca. Não esconder esse risco como simples mudança de URL.

Recebedor autentica segredo e resolve instância/organização no servidor. Enfileira evento duravelmente antes de confirmar recebimento. Persistência indisponível retorna falha; jamais ACK em memória. Worker aplica o mesmo serviço de negócio compartilhado, com idempotência por evento, escopo por organização/instância e ordenação necessária dos estados. Duplicatas toleradas; prometer “exactly once” end-to-end seria incorreto. Guardar resultado e tentativas, com retry limitado, atraso crescente e fila de falhas visível.

Postgres pode fornecer fila durável com leases. [Supabase Queues](https://supabase.com/docs/guides/queues) e [API pgmq](https://supabase.com/docs/guides/queues/pgmq) são alternativas oficiais, mas extensão, configuração e capacidade não foram verificadas aqui. Também é possível tabela transacional própria reutilizando padrões de claim existentes. Escolher após teste de impacto; fila custa escrita, WAL, armazenamento e manutenção. Não arquivar payload bruto indefinidamente.

Processamento usa lote apenas de itens já disponíveis; eventos chegam ao navegador via persistência atual + Realtime. Não introduzir minuto de espera, reduzir frequência visível do chat nem executar uma nova Edge por item — isso anularia economia. Lista de dependências e semântica de estados será complementada pela auditoria específica do handler.

### Aceite obrigatório antes do canário

Auditoria do handler `handleMessagesUpdateEvent`, em `whatsapp-webhook/index.ts:1248`, encontrou dois pontos que precisam de correção/teste antes da migração: update de recibo pode regredir `read` para `delivered`, e merge de reação pode incrementar contador em evento repetido. Não transportar esses defeitos supondo idempotência inexistente. A rota também chama `completeQuotePresentations`; preservar esse efeito comercial, não apenas atualizar bolhas do chat. Os contratos de edição, exclusão, pin, reação e confirmação precisam de replay/shadow comparativo sem efeitos duplicados. “UX intacta” é critério a provar, não conclusão da proposta.

- Mensagens diretas, mídias, grupos habilitados, desconexão e reconexão continuam no comportamento atual.
- Status repetido, fora de ordem e anterior à mensagem não regride confirmação nem perde atualização.
- Nenhum evento autenticado confirmado com 2xx fica sem persistência durável ou conclusão rastreável.
- Reinício durante processamento, rede interrompida, banco indisponível e lease expirado recuperam sem efeito duplicado.
- Organização errada, instância antiga e segredo inválido não modificam dados.
- Latência de recebimento até Realtime: p50/p95/p99 comparados com baseline por tipo e instância; sem regressão perceptível. Meta inicial adicional p95 <= 100 ms, sujeita a medição, nunca compensada com perda de durabilidade.
- Teste de pico baseado em maior minuto/segundo observado, não média de 0,6 request/s; no mínimo dobro do pico real com limite de recursos e backlog recuperável.
- Canário por instância, depois 5%, 25%, 50%, 100% do tráfego de atualizações; um único dono de efeitos por evento. Shadow pode comparar decisões, nunca duplicar escrita/envio.
- Rollback de rotas preserva fila pendente, idempotência e credenciais. Falha de serviço novo não pode virar perda silenciosa ou tempestade de retries.

## Cenários e distância até a meta

Auditoria paralela de frontend/IA mantém **zero economia numérica reservada** para proxy e agent-message. Candidatos: deduplicar `getStatus` simultâneo preservando intervalos de QR, reutilizar limites já consultados e separar consulta Meta de filtros internos. Consultas de presença, dashboard e reconciliação do chat são RPCs de banco em vários caminhos; não contá-las como Edge.

Copilot merece análise de admissão: trigger atual pode emitir HTTP por insert da fila, enquanto processador espera cinco segundos e chama `agent-message`. Agrupar mensagens dentro de funções já invocadas pode produzir N chamadas de entrada mais B chamadas de agente; isso não garante economia. Para reduzir chamadas, agrupar antes da fronteira HTTP ou compartilhar o serviço e admitir um único despertar por lote, preservando debounce, pausa humana e ordenação por conversa. Medir antes de mudar. Recibos também fecham apresentação de proposta comercial e podem definir `accepted_at` pela chegada; lote com espera artificial mudaria semântica e não é aceitável.

Equação sem dupla contagem: `total restante = B − C − G − M + E + O`, em que B é baseline, C são ticks realmente evitados, G requests de grupos eliminados, M requests restantes processados fora da Edge, E novas chamadas criadas pela solução e O outros projetos. Subtrair grupos antes de calcular a parcela migrada; a mesma request não pode gerar economia duas vezes.

| Cenário ilustrativo | Média de 7 dias projetada em 31 dias | Último dia repetido por 31 dias |
|---|---:|---:|
| Sem mudanças | 2.588.655 | 2.844.591 |
| Guardas evitam 80% dos ticks | 2.224.393 | 2.480.329 |
| Guardas 80% + 10% das requests webhook excluídas na origem | 2.084.425 | 2.316.605 |
| Guardas 80% + 20% das requests webhook excluídas na origem | 1.944.458 | 2.152.882 |
| Guardas 80% + 75% do webhook processado fora da Edge, sem crédito de grupos | 1.174.638 | 1.252.403 |
| Guardas 80% + todo ingresso WhatsApp processado fora da Edge, sem crédito de grupos | 824.721 | 843.095 |

Os percentuais são **sensibilidades**, não economia provável. Cenário de 75% exigiria mais que a rota de atualizações: incluir parte do processamento de mensagens no serviço externo, reaproveitando núcleo existente e mantendo Supabase como persistência/Auth/Realtime. Não está aprovado nem implementado. A rota de atualizações sozinha, com os 25.085 requests do último dia, pouparia 777.635 em 31 dias e deixaria **1.702.694** após hipótese de 80% de guardas, antes de outros projetos. Portanto, não promete 1,4 milhão sozinho.

Pelo histórico de sete dias, retirar somente a rota de atualizações deixa **1.585.943** após hipótese de 80% de guardas, antes dos outros projetos. O déficit até a meta é 185.943. Filtro de grupos poderia fechar parte ou todo esse déficit, mas só contaremos requests medidas e não pertencentes à parcela de atualizações já retirada. Não reduzir a precisão de recibos de leitura, a frequência visual ou a captura de grupos habilitados para fechar a conta.

**Caminho estrutural com maior margem matemática:** reutilizar todo o núcleo de `whatsapp-webhook` num serviço dedicado fora das Edge Functions. Pela média semanal, remover as 1.399.672 entradas deixa 1.188.983 chamadas em 31 dias mesmo antes das guardas; com hipótese de 80% de guardas, 824.721. No último dia repetido, fica 843.095 após guardas. Somar outros projetos, chamadas de fallback, retries remanescentes e qualquer fanout novo antes de concluir. `agent-message`, proxy e workflows permanecem nos respectivos grupos; essa conta não presume removê-los.

Isso mantém o plano Supabase e desloca execução, não o sistema de registro: banco, Auth, Storage e Realtime continuam Supabase. Extração deve reutilizar handler/serviços testados, evitando segunda implementação de normalização, tenant, IDs e efeitos. Um container Deno compatível pode ser avaliado para minimizar diferenças; dependências devem ser fixadas no build, com testes comparativos. Medir CPU, memória, conexões, I/O, disponibilidade e custo total do VPS antes de afirmar que cabe sem despesas adicionais. Se precisar ampliar infraestrutura, apresentar esse custo; não esconder excedente transferindo cobrança para outro fornecedor.

Para o cenário de 75% e último dia, sobra cerca de 147.597 até 1,4 milhão para outros projetos, chamadas adicionais e variação. A sobra não é garantia de escala: filhos `agent-message`, banco e tráfego também crescem. Simular crescimento separando parcelas fixas e variáveis, com volume por organização, mensagens e pico de simultaneidade.

## Decisão ao final de cada fase

1. Publicar pacote já validado e reconciliar gráfico HTTP com Usage por ciclo/organização. Registrar diferença de medição e faixa de previsão.
2. Implementar filtro remoto seguro, medir requests realmente suprimidas e recalcular distância até 1,4 milhão. Não retardar UX para bater orçamento.
3. Validar capacidade/HA/custo do serviço de atualizações; protótipo em ambiente isolado e canário antes de produção.
4. Recalcular com resultados da rota de atualizações, filtro de grupos e proxy/IA. Se ainda acima, migrar progressivamente mensagens para o mesmo núcleo externo, com os mesmos gates, até o ingresso completo se necessário. É o caminho que entrega maior margem matemática sem depender de percentuais não medidos de grupos/retries. Não assumir que uma fila, sozinha, economiza Edge.
5. Declarar meta alcançada somente com projeção de ciclo incluindo todos os projetos <= 1,4 milhão, margem nos dias úteis de pico, equivalência funcional/latência comprovada e todas as demais franquias verificadas.

Não há pergunta de produto bloqueando esta análise. Antes de execução da arquitetura externa, precisam estar concretos infraestrutura disponível, comportamento do fornecedor, orçamento técnico e desenho de rollback. Não é publicação autorizada por este documento.
