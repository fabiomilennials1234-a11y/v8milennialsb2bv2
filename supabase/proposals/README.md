# SQL planejado, fora da cadeia automática

Não aplicar estes arquivos com `db push`. Não são migrations concluídas.

## Aposentadoria de rating/calor — SCRUM-647

`20270925000000_aposenta_calor_e_rating.sql` foi criado no commit `7fd0a9ca`
explicitamente como **não aplicado**. Consulta READ ONLY em produção em
2026-09-08 confirmou ausência no ledger por versão e nome, além da existência
de `leads.rating`. O corpo original permanece integralmente preservado aqui;
o rollback permanece em `supabase/migrations/rollback/`.

A sequência automática executava esta proposta antes de
`20271008000000_leitores_saem_dos_espelhos.sql` (já aplicada em produção).
A alteração da função UTM invalidava o preflight dessa migration; seu corpo
posterior ainda depende de rating. Isso não é corrigido desativando o hash.

Para retomar a aposentadoria: recapturar dependências e contratos atuais,
revisar a compatibilidade com a demolição dos espelhos, ensaiar backup e
restauração, coordenar os consumidores e publicar uma **nova versão** de
migration após a cadeia atual. Não mover o arquivo antigo de volta como se
fosse seguro reaplicar o plano de 03/09. Nenhum dado de rating é removido pelo
rollout de métricas #2040.
