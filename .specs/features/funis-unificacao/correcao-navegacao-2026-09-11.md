# Navegação canônica — correção do PR #2092

Status: migration aplicada em produção em 2026-09-11T19:17:08Z, autorizada
por Gabriel na sessão; publicação do frontend pelo PR #2101 em andamento.

Apply reconciliou 399 entidades e as cinco ocultações previstas, sem divergências.
Transação repetível comparou hashes integrais antes/depois de 49.562 entradas,
4.778 etapas e 1.952 eventos de venda, identidade dos funis e defaults de orgs;
todos preservados. Ledger registra versão `20271019000020`. SHA-256 do SQL:
`6f0f77113a5dd1ee7b945b086fe80ebc66c371c47647db48871069b3cf8b3b5a`.
Snapshot pré/pós e rollback condicional guardados em diretório operacional
privado, fora de Git. A aplicação abortaria diante de mudança após snapshot,
diferença no pós-estado esperado ou alteração das invariantes.

## Contrato

Funil continua entidade única em `pipelines`, identificado por UUID. Não há
recriação das seis views demolidas no épico SCRUM-614. `pipelines.name` segue
canônico. Visibilidade pertence à entidade: `config.navigation.is_visible`;
ausência significa visível. Ordem pertence apenas a `display_order`, preservando
o contrato de reordenação existente. `is_active` continua estado operacional,
independente da presença no menu. Leitores não inferem existência por `type`/slug.

## Migração de estado histórico

`supabase/migrations/20271019000020_restore_pipeline_navigation.sql` importa
estado anterior ao merge #2092 (`2026-09-10T21:13:04Z`). Tipo/slug são usados
somente como identificação da origem nesta importação, nunca regra permanente.

- Registro semeado sem `pipeline_display_config` fica oculto.
- Registro semeado com configuração preserva visibilidade; `upsell` permanece
  fora da navegação. Confirmação de organização com feature efetiva
  `merged_opportunity_funnel` fica oculta, como antes.
- Feature efetiva segue snapshot ativo da assinatura, plano quando snapshot
  ausente, override de organização não expirado e catálogo apenas para chave
  ausente. Assinaturas ativas duplicadas bloqueiam a migration, sem escolher
  configuração arbitrária. Overrides considerados pertencem à organização. Privilégio master individual
  não é convertido em configuração global do tenant.
- Entidades customizadas preservam visibilidade (inclusive temporárias encerradas;
  cada superfície mantém seu próprio filtro de ciclo de vida).
- Ordem histórica vira rank por organização: antigos registros ordenados por
  posição legada, permanentes por `display_order`, temporários por criação
  decrescente. Empates recebem UUID como desempate determinístico.
- Entidades posteriores ao cutoff e navegação já explicitamente configurada
  permanecem intocadas. JSON adicional é preservado. Segunda execução não altera
  linhas nem timestamps.

Nomes, IDs, negócios, etapas, valores, vínculos, `is_active`, default da organização,
permissões e RLS não são alterados. O trigger existente atualiza `updated_at`
apenas nas entidades reconciliadas. Nenhum trigger é desabilitado.

## Evidência e limites

Leitura de produção em 2026-09-11 confirmou configuração JSON objeto ou NULL em
todos os registros, sem `navigation` preexistente. Trigger de UPDATE geral toca
somente `updated_at`; demais triggers são de DELETE ou UPDATE de outras colunas.

Ensaio SQL reproduz estado em PostgreSQL real com schema mínimo extraído do
baseline e conferido em produção: `tests/integration/sql/pipeline-navigation/`.
Cobre isolamento do JOIN por organização, visibilidade ausente/oculta, override
ativo/expirado, plano/snapshot/override false/catálogo, cutoff, navegação explícita, JSON extra/NULL, estado operacional,
ordenação permanente/temporária e três aplicações da migration. Esse subset não atesta RLS,
FKs ou motores de negócios do schema completo. Publicação exige também snapshot
operacional e validação das superfícies consumidoras.

## Resultado do ensaio — 2026-09-11

Sequência completa `00 → 01 → migration → 02 → migration → 03 → 04 → migration → 05`
concluiu com exit 0. Dezenove entidades sintéticas em PostgreSQL real. Segunda
aplicação provou idempotência incluindo `updated_at`; terceira, após mudança de
catálogo e inclusão da 19ª entidade, preservou todas as decisões já importadas.

Preview `ykkgxuappirocdndcdhm` foi destruída no cleanup; evento
`deleted-and-verified` e listagem posterior confirmaram ausência. Nenhuma outra
branch foi alterada. Log local do ensaio: `/tmp/torque-funnel-db.log`.

Build de produção passou em 1m54. Lint e dependências passaram pelos ratchets.
Testes focais de navegação, seletores e referências salvas passaram. Validação
global executada em Node 24, versão usada pela CI: `test:ratchet` reprova duas
falhas de `guided-condition.test.ts` também reproduzidas na base limpa
`23cbd6796` (115 passam / mesmas duas falham em ambas), além de 149 falhas
toleradas pelo baseline. `espelhos-sem-leitores` passou no retry automático.
`typecheck:ratchet` reporta os mesmos 65 diagnósticos fora do baseline na base
limpa e nesta branch, sem diagnósticos adicionais. Gates globais não estão
verdes; comparação confirmou essas pendências preexistentes. Nenhum baseline
ou dependência foi alterado para acomodar falhas.

### Reprodução

Executar na raiz do checkout com `SUPABASE_ACCESS_TOKEN` injetado no ambiente
pelo runtime seguro, sem valor literal no comando, arquivo versionado ou log.
O nome de preview deve ser novo. `--allow-concurrent` corresponde à autorização
explícita recebida para este ensaio paralelo. O wrapper lê arquivos antes de
criar e destrói somente a preview criada, inclusive em falha.

```bash
node scripts/supabase-branch-win.mjs ensaio qa-studio-funnel-navigation-20260911 --allow-concurrent \
  tests/integration/sql/pipeline-navigation/00-preview-schema.sql \
  tests/integration/sql/pipeline-navigation/01-fixtures.sql \
  supabase/migrations/20271019000020_restore_pipeline_navigation.sql \
  tests/integration/sql/pipeline-navigation/02-assertions.sql \
  supabase/migrations/20271019000020_restore_pipeline_navigation.sql \
  tests/integration/sql/pipeline-navigation/03-idempotence.sql \
  tests/integration/sql/pipeline-navigation/04-catalog-fixture.sql \
  supabase/migrations/20271019000020_restore_pipeline_navigation.sql \
  tests/integration/sql/pipeline-navigation/05-catalog-assertion.sql
```

## Projeção somente leitura em produção

CTE real da migration projetou 399 entidades históricas; 395 receberiam valor
numérico diferente em `display_order` pela normalização em rank global. Isso
preserva a ordem relativa antiga por grupo e elimina colisões entre posições
legadas e customizadas; não representa 395 funis ocultados.

Cinco entidades seriam ocultadas:

| Organização | Funil |
|---|---|
| TorqueCRM | Qualificação |
| TorqueCRM | Confirmação |
| TorqueCRM | Propostas |
| Milennials | Agendamentos |
| Nicolodi Consultoria | Agendamentos |

Projeção não aplicou UPDATE. Quantidades devem ser conferidas novamente no
instante de publicação, porque produção permanece recebendo alterações.

## Rollout e retorno direcionado

1. Após autorização de produção e revisão do PR, capturar snapshot protegido por
   `pipeline_id` e `organization_id` de `config`, `display_order` e `updated_at`
   das linhas candidatas, junto ao pós-estado esperado. Registrar contagens e
   invariantes de `pipeline_entries`, etapas, IDs/vínculos, ledger financeiro e
   defaults das organizações. Snapshot pertence a artefato operacional privado,
   sem dados de cliente em Git.
2. Aplicar migration primeiro, transacionalmente. Conferir linhas reconciliadas,
   cinco ocultações previstas ou justificar qualquer diferença; comparar
   contagens/invariantes operacionais com snapshot. A versão anterior do front
   ignora o campo novo enquanto o deploy não chega.
3. Publicar frontend depois. Validar menu, hub e seletores, incluindo org sem
   funis, entidade oculta com negócios, criação explícita e reordenação. Revalidar
   filtros próprios de temporários encerrados em cada superfície.
4. Se necessário retornar, usar snapshot somente nas linhas cujo estado atual
   ainda corresponda ao pós-estado registrado pelo apply. Divergência significa
   decisão posterior: não sobrescrever; reconciliar por entidade. Restaurar
   apenas campos tocados (`config`/`display_order`); trigger normal mantém
   `updated_at`. Nunca reconstruir defaults genéricos nem excluir negócios.

O retorno do frontend deve ser coordenado com esse retorno dos dados. Não há
script genérico de rollback: sem snapshot do apply, um reset apagaria escolhas
posteriores. Ensaio de schema mínimo não substitui comparação operacional em
produção nem demonstra políticas RLS ou motores completos.
