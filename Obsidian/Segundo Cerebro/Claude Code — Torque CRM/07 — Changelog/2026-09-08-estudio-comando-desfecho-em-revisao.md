---
type: changelog
title: "Estúdio, Comando e desfecho independente — em revisão"
status: draft
created: 2026-09-08
updated: 2026-09-08
tags: [changelog, metricas, comando, funis]
related: []
owner: gabriel
branch: feat/concluir-metricas-comando
---

# Estúdio, Comando e desfecho independente

**Implementado na branch; não publicado em produção nesta sessão.**
Escopo: #1994, #1996, #1990, #1972 e correção de mês 61323102.

## Implementação

- Recompra da main preservada e testes existentes conferidos.
- Quatro templates editáveis: Visão Geral, Performance, Saúde e Mapa,
  reutilizando os componentes reais. CRUD de abas, confirmação de exclusão,
  catálogo de cards e persistência com erro/retry.
- Fila de salvamento por org+aba; trocar o destino não descarta uma edição
  anterior. UPDATE, nunca upsert, para não ressuscitar aba excluída.
- Datas e metas mensais no fuso da organização. Intervalo incompleto conserva
  o último período completo. Mapa usa a base inteira, explicitamente.
- Comando com Próximos Passos; fluxo outbound especializado preservado.
  Analytics avançado continua master e passa a ser acessível pelo Estúdio.
- Causa dos dois hooks do Comando reproduzida: chamada supabase.rpc sem vínculo
  com o cliente falhava antes do HTTP. Regressão coberta com cliente real/fetch
  controlado. Erro não se transforma em “nenhuma pendência”.
- Ganho/perda sai da atribuição manual, do preenchimento automático, da
  aprovação master e do plano ativo do classificador, inclusive determinístico.
  Papéis de reunião e vocabulário histórico para exibição são preservados.
- Main #2037 incorporada: Estúdio nativo, sem reintroduzir rollout por org.

## Banco e histórico

Schema novo: `20271017113742_dashboards_viram_templates.sql`.
Carga inicial separada: `scripts/seed-metrics-studio-templates.sql`.
Não semeia no caminho de leitura.

O CI identificou nova colisão: #2039 ocupou 20271017000000 na main durante o
trabalho. Schema e rollback desta entrega foram somente renomeados para
20271017113742, **sem alterar o SQL já testado**. O ledger da preview anterior
foi descartado junto com o projeto; nenhuma dessas versões rodou em produção.

O SQL de ensaio 20271005 foi aplicado e revertido apenas na preview, sem
fixtures válidas. A main depois ocupou esse prefixo. Ele foi arquivado intacto
em `.specs/project/preview-history/`, fora da cadeia de migrations.

Arquivos 20270921000030 e 20270921000040 reconciliados com os applies antigos do
#1972 já observados no ledger de produção: **não reaplicar**.
Removida somente a cópia duplicada 20270918000050 de org_plural, após conferir
origem e igualdade do SQL; 20270920000010 permanece. Recuperável pelo Git.

## Verificação e bloqueios

- 67 testes focados em 11 arquivos passaram também após a integração #2037.
- Lint, typecheck, dependências e build passaram no worktree isolado; sem
  regressões introduzidas nos ratchets.
- Revisão encontrou divergência adicional entre fuso do navegador e da org
  no motor/compositor/exportação e entre trimestre inteiro/até hoje. Corrigida;
  42 testes de período, intervalo e metas passaram, incluindo meses distintos.
- Deno check do classificador passou no worktree isolado.
- O teste de contrato de registry foi expandido sem retirar aliases antigos.
- Suíte ampla: 10 falhas do lint eram bash/grep ausentes no PATH; passaram com
  ambiente corrigido. Deep-link depois sofreu timeout. Nenhum baseline ampliado.
- Primeira rodada SQL bloqueada por fixtures sem autenticação/quota; corrigidas,
  mas a preview foi encerrada externamente durante a suspensão do ambiente.
- Outro checkout/stash foi criado por sessão concorrente em 08/09. Esta tarefa
  segue em `.worktrees/concluir-metricas-comando`; stash original preservado.

### Ensaio remoto concluído em 08/09

Preview `uyneehawvzvjwamjbssd`: baseline + schema + seed passaram; preservação
e ordem, RLS positiva/negativa de membro/admin/master, isolamento entre orgs,
exclusão e trigger de org nova passaram. Rollback preservou painel autoral e
template editado; removeu somente templates intactos. Reapply e seed repetido
mantiveram 9 painéis, sem duplicação. EXECUTE das duas funções privadas:
anon/authenticated/service_role = false no alvo.

O lifecycle excluiu essa preview e confirmou sua ausência. O ensaio anterior
`yryqrjoyiozvnuelvbno`, que falhou no provisionamento inicial, também foi
excluído e conferido automaticamente.

**Lei de custo registrada em AGENTS.md e no runbook:** cleanup imediato no
sucesso/erro, com confirmação de ausência; falha de cleanup bloqueia conclusão.
7 testes cobrem proteção de prod/outras branches e falhas de criação/exclusão.
Finally não executa enquanto o computador está suspenso/desligado: revisar
inventário ao retomar. Não é uma garantia de TTL externo.

CTO autorizou produção após testes/review e uma segunda preview para QA.
`codex-condicional-20260907` permanece preservada: PR #2038 aberto não prova
que seu banco temporário já foi liberado. Exclusão condicionada ao fim do uso.

**Ainda bloqueia release:** QA visual/E2E autenticado, review/CI, deploy e
smoke test do alvo. Autorização CTO já recebida nesta sessão, condicionada aos gates.
Scripts positivos/negativos: `.specs/project/studio-preview-*.sql`.

### QA autenticado — operações passaram, validação visual ainda parcial

`gdsoctoimwcxpqhumxof`: login real, quatro abas, cópia de template, renomeação,
ordenação, limpeza e exclusão passaram, com leitura de confirmação no banco.
390px sem overflow da página. Preview excluída e ausência confirmada.
Capturas iniciais ainda continham tooltip do suporte e carregamento transitório:
não aprovam o visual final. Runner reforçado para esperar cards e fechar avisos.
O baseline reconstruído não contém todas as migrations atuais; 400/404 de
objetos herdados (ex. negocio_projetado) impedem tomar este ensaio como prova
dos números em produção. Nenhum mock de resposta de negócio foi usado.

CI inicial #2040: CodeQL e secrets passaram; migration guard (colisão acima) e
MOC falharam. Corrigir e reexecutar, sem ampliar baseline ou ignorar gates.

### CI após correção — bloqueio histórico identificado

Rodada `34241659690`, commit `2cb5c9a5`: Lint & Build, Unit Tests (ratchet), Edge
Function Tests, Workflow System Tests passaram; CodeQL, secrets e ambos os
checks do vault também passaram. Migration guard local confirmou zero
duplicatas e zero colisões com origin/main após renumeração.

Integration Tests, RLS Invariants e E2E **não chegaram a executar suas suítes**:
os três pararam no bootstrap de
`20270925000000_aposenta_calor_e_rating.sql`, statement 16, com
`BACKUP rating incompleto: 0 copiadas vs 0 na origem` (`P0001`). A guarda de
backup dessa migration exige dados existentes, incompatível com banco vazio.
Arquivo idêntico à main, originado em `7fd0a9ca`; não foi alterado aqui.

**Release bloqueado:** corrigir a preparação histórica do CI sem reescrever
migrations já aplicadas, concluir a validação funcional contra schema atual e
obter revisão. Não desabilitar gates nem considerar os três jobs como aprovados.
PR permanece rascunho: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/pull/2040

### Capturas finais e cleanup

Ensaio `pypwjcledasqroyagqfz`: ações autenticadas repetidas com sucesso e
capturas após as animações finitas. Conteúdo dos KPIs conferido, templates
renderizados, layout desktop e 390px inspecionados. QA visual administrativo
concluído; os estados sem dados não validam a semântica das métricas nem
substituem E2E sobre schema atual. As capturas ficam em
`test-results/studio-ui/` (artefatos locais ignorados, somente fixtures).

O ensaio intermediário `cffatewwkndtlbkmwxyt` e o final
`pypwjcledasqroyagqfz` foram excluídos pelo lifecycle, com ausência confirmada.
Todas as previews desta tarefa foram encerradas. A preview condicional de
outra tarefa continua preservada até confirmação de que seu uso acabou.

## Próximos passos de release

1. UI admin/membro/master: reload, troca de org/aba, períodos e erros/retry.
2. Medir ledger/painéis/ACL de produção, capturar rollback,
   aplicar schema e carga inicial, publicar classificador e integrar frontend.
3. Smoke test e atualizar este status. Cada preview é encerrada ao fim do seu ensaio.

## Ajustes locais — exclusão, persistência e plano de preservação

CTO esclareceu que o desaparecimento ocorre **em produção**, não na demo.
Leitura READ ONLY encontrou 32 abas em 19 orgs, 20 vazias; vazio não comprova
perda e nenhuma aba real foi alterada. A tabela não possui trigger de histórico
de layout (somente atualização de timestamp). Organização/horário do incidente
específico ainda precisam ser identificados antes de atribuir causa definitiva.

Reproduzida uma corrida no hook real: refetch atrasado substitui o cache por
layout antigo depois do save, e voltar à aba mostra menos cards. Teste falhou
antes e passou após cancelar leituras anteriores ao save e preservar o rascunho
nas leituras durante debounce/escrita/retry. Catálogo indisponível agora mantém
o card identificado na tela, sem descartar sua configuração.

Menu de exclusão/renomeação/ordenação acessível ao admin também no modo de
visualização; exclusão mantém confirmação com nome e efeito para toda a org.
Membro continua sem ações de escrita. 33 testes direcionados e ESLint passaram;
Playwright local confirmou criação/exclusão fora da edição, cancelamento,
persistência da exclusão após reload e layout móvel sem overflow.

Plano operacional em `docs/metrics-studio-rollout.md`: backup externo e ensaio,
templates aditivos, comparação de todos os campos do legado, ordem de release,
canário e recuperação por ID. O seed ganhou transação, locks com timeout e
asserção de preservação integral. **Esta nova versão do seed ainda requer
ensaio SQL antes de release.** Nenhuma migration, seed ou frontend foi aplicado
em produção nesta etapa; nenhuma nova branch efêmera foi criada.

## Reconciliação autorizada e ensaio SQL — 2026-09-08 19:07 UTC

CTO autorizou reconciliar as migrations e os testes bloqueantes. O ledger de
produção confirma que a aposentadoria de rating (`20270925000000`) nunca foi
aplicada, enquanto leitores posteriores e demolição dos espelhos já foram.
A proposta foi preservada integralmente em `supabase/proposals/`, fora da
cadeia automática; nenhuma migration aplicada foi editada. O seed sintético
foi atualizado para entradas/etapas canônicas. Os 14 testes de recriação de
etapa passaram com mock RPC atualizado; rodada local teve 287 testes verdes.

CI `34266909890`, commit `9841adf0`: cadeia completa + seed passaram. O ensaio
do Estúdio comprovou preservação integral, backup privado sem grants de API,
restauração exata, rollback/reapply DDL sem remover abas, ACL, isolamento
member/admin/master, exclusão e templates de org nova. Esta evidência supera
a pendência anterior de ensaio do seed. Backup fica no próprio banco, não em
arquivo externo; o plano atual está em `docs/metrics-studio-rollout.md`.

O job segue vermelho pela suíte geral pgTAP (97 arquivos, 1959 asserções):
contratos/fixtures legados, funções/views demolidas, planos TAP inconsistentes
e controles de permissões a diagnosticar. Detalhes na revisão
`docs/metrics-studio-review-20260908.md`. Não houve bypass de gates, merge,
deploy ou escrita em produção. Nenhuma branch Supabase nova foi criada.
