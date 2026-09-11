# Funis canônicos

## O que é

Funil é entidade única em `pipelines`, com UUID, etapas e negócios canônicos.
SCRUM-614 removeu seis espelhos legados; a correção de navegação preserva essa
arquitetura.

## Como funciona

Nome: `pipelines.name`. Ordem: `display_order`. Visibilidade explícita:
`config.navigation.is_visible`, com default visível quando ausente. Estado
operacional: `is_active`, independente da exibição no menu.

## Regras de negócio

- Funil semeado antigo que já não aparecia não deve reaparecer por troca de fonte.
- Criação explícita de nova entidade não depende de catálogo de tipos técnicos.
- Ocultar preserva negócios, etapas, identidade e vínculos.
- Temporários encerrados podem aparecer no hub; filtros de ciclo de vida são
  responsabilidade da superfície, não da visibilidade da entidade.

## Histórico

- 2026-09-11 — Correção implementada em branch; publicação pendente.
  `supabase/migrations/20271019000020_restore_pipeline_navigation.sql` reconcilia
  estado anterior ao merge #2092 sem alterar `is_active`. Ensaio PostgreSQL
  aprovado com 19 entidades, idempotência e três aplicações; preview destruída
  e ausência confirmada. Schema mínimo não atesta RLS/FKs/motores completos.
  Nenhuma escrita em produção. Ensaio, projeção e rollout:
  `.specs/features/funis-unificacao/correcao-navegacao-2026-09-11.md`.
