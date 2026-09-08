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

Schema novo: `20271017000000_dashboards_viram_templates.sql`.
Carga inicial separada: `scripts/seed-metrics-studio-templates.sql`.
Não semeia no caminho de leitura.

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

## Próximos passos de release

1. UI admin/membro/master: reload, troca de org/aba, períodos e erros/retry.
2. Medir ledger/painéis/ACL de produção, capturar rollback,
   aplicar schema e carga inicial, publicar classificador e integrar frontend.
3. Smoke test e atualizar este status. Cada preview é encerrada ao fim do seu ensaio.
