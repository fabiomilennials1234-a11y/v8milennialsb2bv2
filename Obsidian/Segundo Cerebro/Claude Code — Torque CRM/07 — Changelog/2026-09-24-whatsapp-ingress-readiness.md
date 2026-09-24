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
