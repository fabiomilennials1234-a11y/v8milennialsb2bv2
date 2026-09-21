# Condição de origem sem opções — 2026-09-21

## Evidência e causa

`GuidedOriginPicker` usa `useLeadOriginOptions`, que consulta IDs reais de
`lead_origins` por organização. Em produção, 24 organizações não têm nenhum
registro nessa tabela. Não há trigger de inicialização de origens em
`organizations`. O schema atual exige `organization_id`, e os registros
existentes são por organização, ao contrário do antigo registry global arquivado.

A consulta vazia reproduz a mensagem da captura. O teste SQL de criação de
organização falhou com `0 !== 13` antes da correção. A organização específica
da captura ainda não foi informada; a ausência de catálogo foi confirmada,
entre outras, na Loofting e Pesco. Não atribuir o relato a uma organização sem
essa confirmação.

## Correção preparada

- Migration `20260921165709_seed_organization_lead_origins.sql`: inicializa as
  13 origens canônicas em novas organizações, com UUIDs próprios.
- Helper idempotente, com `ON CONFLICT DO NOTHING`, sem grants de execução a
  PUBLIC, anon, authenticated ou service_role. Trigger recebe apenas `NEW.id`.
- `scripts/ops/repair-empty-origin-catalogs.sql`: preenche somente catálogos
  inteiramente vazios; não altera leads, workflows nem catálogos existentes.
- Nenhum fallback com IDs fictícios ou origens de outras organizações na UI.

## Verificação

PGlite: criação por role authenticated (sem INSERT no catálogo), busca por nome,
IDs persistentes, isolamento entre organizações, tentativa negada de executar
helper, preservação de nome personalizado/inatividade/UUID, reparo idempotente
e rollback de schema preservando identidades. Teste incluído no CI.

Revisão de segurança conforme `.claude/skills/security-rubric/SKILL.md`: sem
mudança nas RLS existentes; search_path vazio, relações qualificadas e funções
sem acesso direto pelos clientes. Não foram criadas branches pagas.

## Aplicação pendente

Não aplicado em produção. Não exige build ou alteração de frontend.
Após autorização: conferir o baseline, aplicar somente esta migration,
verificar grants e ledger, ensaiar script com ROLLBACK, executar com COMMIT e
confirmar catálogos vazios = zero. Reabrir/recarregar o editor para refazer a busca.
Se a organização do relato já tiver catálogo, investigar a sessão/RLS específica
antes de declarar o incidente resolvido.

Rollback executado em teste: `scripts/ops/rollback-origin-catalog.sql`. Remove
somente funções/trigger; preserva UUIDs que condições possam ter referenciado.
