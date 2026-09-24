# WhatsApp ingress: preparação de ativação — 2026-09-24

## Mudanças

- Replay estrito preserva eventos malformados para recuperação; fluxo Edge atual
  preservado. ACK200 somente após commit, mantendo contrato HTTP atual.
- Modo de drenagem bloqueia entrada sem desligar processamento já aceito.
- Parser/preflight verifica todas as rotas locais/globais e confirma configuração
  integral. Não escreve no fornecedor nem altera rebind.

## Estado

Código preparado e testado; serviço não ativado. Migration29 não aplicada.
Economia adicional ativa: zero. Rollout depende de coordenação dos writers,
retry do fornecedor, recuperação após reinício e capacidade do piloto.

Detalhes e limitações: `docs/operations/supabase-capacity-ingress-readiness-2026-09-24.md`.


## Ponte de admissão Edge (continuação, 2026-09-24)

Preparada em `supabase/functions/whatsapp-webhook/edge-inbox-bridge.ts`, desligada
por padrão e limitada a `messages_update` por UUID resolvido no banco. Reutiliza
admissão durável em `_shared/whatsapp-ingress-inbox.ts`; nenhuma alteração de
schema ou rota. Falha de gravação/fila cheia retorna erro sem processamento
inline. Worker não recebe callback de admissão, evitando loop de reenfileiramento.

Teste do fornecedor registrou uma entrega para cada resposta 408/429/500/503,
sem reentrega na janela observada; resultado inconclusivo. Cutover permanece
bloqueado por recuperação e ordenação entre donos. Nenhuma economia adicional
contabilizada e nenhum recurso temporário do ensaio permanece ativo.

Referências: `services/whatsapp-ingress/README.md`, `.specs/STATE.md` e
`docs/operations/supabase-capacity-ingress-runtime-2026-09-24.md`.


## Controle de pausa e FIFO — 2026-09-24

SQL32 corrige avanço após dead_letter: eventos posteriores da mesma instância
ficam bloqueados até reconciliação. Adiciona pausa de novos claims com revisão
CAS e snapshot privado sem payload. Enqueue e conclusão de trabalho aceito seguem
funcionando; retomada recusa processamento ativo ou expirado ainda pendente.
CLI explícito usa arquivo de credencial privado, sem retry cego nem polling.

Não altera rotas/flags Edge, não cancela efeitos antigos em voo e não prova
recuperação do fornecedor. Operação/rollback:
`docs/operations/whatsapp-ingress-worker-handoff.md`.


SQL32 aplicada em produção: ledger real `20260924143904`. Validação de pausa,
revisão, tenant, claim e conclusão via service_role executada com ROLLBACK; fila
e controles finais zerados. Permissões privadas conferidas. Nenhuma mudança de
rota/flag/worker e nenhuma economia de invocações atribuída a esta proteção.


## Tickets de execução Edge — 2026-09-24

SQL33 prepara gate privado inline/queued com revisão CAS e tickets de execução
sem expiração. Admissão inline registra ticket antes dos efeitos; queued grava
na inbox antes do ACK. Worker só avança com gate queued e nenhum ticket. Mudar
para inline exige tickets e trabalho não concluído zerados. Pausa/FIFO continuam.
Até64 tickets por instância; erro ou resultado incerto exige reconciliação.

`WHATSAPP_EDGE_EXECUTION_INSTANCE_IDS` vazio por padrão. Somente messages_update
autenticados da instância resolvida entram. Conclusão acompanha a promise real,
inclusive após timeout HTTP12s. Modo instrumentado exige validação estrita;
falha não libera ticket nem cai silenciosamente no processamento antigo.

Sem ativação nesta entrega. Gate não cobre isolates antigos não instrumentados.
A documentação Uazapi não estabelece recuperação completa pré-commit: buffer
de erros em memória e histórico de mensagens não são diário durável de eventos.
Ponte Edge ainda consome invocações; nenhuma economia nova contabilizada.
Contrato: `docs/operations/whatsapp-ingress-worker-handoff.md`.


SQL33 aplicada em produção no ledger real `20260924151218`; arquivo-fonte
`20271021000033_whatsapp_edge_execution_gate.sql`. Smoke com service_role validou
admissão, revisão, tenant, ticket bloqueando claim, quitação e reabertura; ROLLBACK
removeu todos os dados de teste. Gates/tickets/fila/controles zerados, grants e
RLS conferidos. Edge instrumentada não implantada; nenhuma instância habilitada.
Validação:140 unit direcionados,3 SQL; build/Deno/ratchet TS passaram.151 falhas
unit herdadas permanecem; regressão strictfalse corrigida e rerodada. Lint mantém
cinco avisos anteriores de quotes. Revisão independente GPT-6 Sol concluída.
