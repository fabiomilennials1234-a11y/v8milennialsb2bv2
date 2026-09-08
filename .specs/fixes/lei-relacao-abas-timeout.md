# Correção do carregamento das abas da Lei da Relação

## Causa e reprodução

O campo calculado da migration 20271018000000 era avaliado para cada lead e
repetia as policies das tabelas relacionadas. O smoke com service_role não
reproduzia esse custo. Com claims de um administrador Chiquê e SET LOCAL ROLE
authenticated, a contagem de Perdido estourou statement_timeout de 8s dentro
de get_my_organization_ids, chamado pelo campo calculado.

## Correção

Migration 20271018000001 adiciona coluna indexada leads.relacao_negocios.
PostgREST resolve o campo como coluna: filtros, contagens e paginação existentes
não precisam de mudança no frontend. A função anterior continua como cálculo
canônico, executado pelos triggers ao mudar negócios, entradas, vendas/estornos,
ativação de pipelines e etapas. Alterações de vínculo atualizam origem e destino.

A coluna usa a mesma RLS de leads. Um BEFORE trigger recalcula inclusive valores
escritos diretamente por clientes, impedindo falsificar a classificação. Funções
de manutenção têm search_path fixo, escopo por organização e EXECUTE vedado a
anon/authenticated. O refresh bloqueia o lead antes de calcular para serializar
alterações concorrentes. Não foram alteradas policies nem o significado da regra.

## Validação

- Migration real e testes da regra anterior passaram no preview, com rollback.
- Testes novos cobrem backfill, ganho, transferência, exclusão, etapas, pipeline
  inativo, estorno, projeção consistente e tentativa autenticada de falsificação.
- Leitura negativa de outro tenant e grants de manutenção conferidos.
- Ensaio transacional em produção com dados reais: a mesma contagem autenticada
  passou de timeout >8s para 4,678ms (EXPLAIN ANALYZE), seguido de rollback.
- Nenhum arquivo TypeScript de runtime mudou; não há novo build de frontend necessário
  para a correção entrar em vigor.

## Produção

Autorização de implantação/merge persiste da sessão; esta mudança corrige o
incidente reportado imediatamente após a liberação autorizada.
Migration aplicada em 2026-09-08 17:59:10 UTC; ledger 20271018000001.
SHA-256: a2df4343c0201e05b56cdfa1426217d05fbfb313a5f7ca61f147582ae59eff97.
Inicialização separada: scripts/sql/backfill-lead-relacao.sql, idempotente por
organização, só escreve a projeção derivada. Não altera negócios nem vendas.

Rollback emergencial deve manter a coluna até o frontend ser compatível com
outra estratégia de consulta; remover a coluna reintroduz o filtro lento.
