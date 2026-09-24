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
