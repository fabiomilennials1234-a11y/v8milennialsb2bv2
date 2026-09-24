---
type: changelog
title: WhatsApp ingress — preparação e piloto de fila
status: active
created: 2026-09-24
updated: 2026-09-24
tags: [whatsapp, performance, supabase, ingress]
owner: gabriel
---

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


## Webhook live atualizado — 2026-09-24

Versão119 implantada com patch mínimo sobre118.53 arquivos anteriores intactos;
index delega updates ao módulo canônico novo, quotes recebe propagação estrita
de falhas; V2 preserva campos extras.56 arquivos publicados conferidos byte a byte.
Status não regride com receipt atrasado; reação repetida não incrementa contagem;
falhas de persistência não viram sucesso. Alvos ausentes continuam permissivos
no caminho live. Nenhuma rota/flag/worker ativado; economia Edge adicional zero.

Validação:89 testes direcionados+16 do bundle real, build/TS e Deno do módulo
passaram.151 falhas unit e5 avisos lint anteriores permanecem. Gate operacional
refinado: retry Uazapi não bloqueia absolutamente piloto na MESMA URL Edge;
continua risco preexistente, com novas rejeições da fila a controlar. Próximo
bloqueio concreto: TorqueSDR teve7 logs de receipts sem alvo em24h; worker estrito
pode travar FIFO nesses casos. Definir desfecho auditado antes de ativar.
Evidências e sequência: `docs/operations/whatsapp-live-update-parity-2026-09-24.md`.


## SQL34 em produção; piloto ainda desligado — 2026-09-24

Ledger de produção `20260924155231` registra SQL34
(`20271021000034_whatsapp_ingress_completion_outcome.sql`). Schema prepara
adiamento de receipts sem alvo por até cinco minutos e registro explícito do
desfecho; lane adiada não segura os eventos regulares. Pausa, tickets e
barreira de dead letter regular continuam aplicáveis.

Worker segue pausado; rota do fornecedor não mudou. Piloto Edge → inbox ainda
não recebe tráfego. Aplicar migration não comprova deploy/merge final do código
nem gera economia de invocações Edge. O bloqueio descrito acima passou a ter
política de desfecho preparada no banco, mas depende de ativação e observação
do worker para validar comportamento em produção.

### Atualização operacional — piloto ligado em24/09/2026 às16:04 UTC

TorqueSDR `messages_update` agora passa pela Edge v121 para inbox e worker único
na VPS. Gate queued/revision2; worker retomado/revision2; provider/URL inalterados.
Recibo controlado de mensagem já lida:200, processed em1,84s, uma tentativa,
sem erro; nenhuma mensagem enviada. SQL34 ledger20260924155231;58 arquivos live
conferidos.149 testes direcionados e quatro integrações SQL aprovados; suíte
completa13.780 aprovados e151 falhas idênticas às anteriores.

**Rota direta VPS ainda desligada; economia Edge desta ponte=zero.** Documentação
Uazapi declara que messages_update não repete entrega HTTP malsucedida. Falta
recuperação/reconciliação testada antes da migração direta. Estado anterior de
piloto desligado registra preparação; esta entrada supersede esse estado.
Procedimento/readbacks: `docs/operations/whatsapp-edge-to-inbox-pilot.md`.


## Recuperação parcial de recibos — 2026-09-24

SQL35 aplicado em produção (ledger `20260924163948`). Estado/cursor e lacunas
privados, lease de dois minutos, página de 50 mensagens outgoing conhecidas na
janela fixa de sete dias. RPC admite somente avanço confirmado entregue/lida;
worker usa origem confiável da fila para impedir efeitos comerciais e limitar
alvo a ID exato/chat/org/instância. Payload externo não concede esse privilégio.

Recuperação não recompõe eventos de edição/exclusão/reação/pin, nem eventos
perdidos antes da persistência. Rota direta permanece bloqueada; ponte Edge
atual não economiza invocações. Flags e evidência operacional atualizada:
`docs/operations/whatsapp-receipt-recovery-2026-09-24.md`.

Ativação: imagem `recovery-20260924-v3`, worker único, pausa retomada/revision4.
Recuperação ligada só TorqueSDR; primeira página finalizada às16:45:09UTC:50
verificadas,0 correções confirmadas,9 inconclusivas persistidas,0 erros. Cursor
avançou/lease liberada; demais páginas pendentes.194 testes direcionados e
integração SQL aprovados. Provider e Edge v121 inalterados; rota direta OFF.

Ciclo automático confirmado às16:49:34UTC: mais50 mensagens,11 estados de leitura
recuperados,8 inconclusivas,0 erros.11 eventos completed/processed,1 tentativa;
11 alvos exatos conferidos. Total parcial:100 verificadas,11 reparadas,17 lacunas.
PR2178 merge `d28871396`;198 testes direcionados +3 integrações SQL aprovados.
GitHub Actions não iniciou por cobrança/limite da conta. Rota direta permanece
OFF; economia de invocações desta recuperação=zero.


## FileDownloaded FIFO barrier repaired — 2026-09-24

TorqueSDR's FileDownloaded head failed strict validation eight times, blocking
61 pending updates while the process remained alive. SQL36 (production ledger
20260924185213) and worker notification-20260924-v2 add a strict observed-shape
provider_notification outcome and one-shot audited replay, preserving payload
and order. Claims paused at revision 5 and resumed at revision 6.
The dead letter completed as a notification; pending and new natural traffic
drained. Readback: 109 normal processed, 23 recovery processed, one notification,
zero noncompleted events. New /worker-health and Docker probe detect blocked or
aged queues independently of direct admission. Healthy with zero restarts;
179 focused unit tests and three SQL integrations passed. Provider and Edge v121
remain unchanged; direct routing remains off. Remaining activation gates:
`docs/operations/whatsapp-direct-route-next-gates-2026-09-24.md`.
