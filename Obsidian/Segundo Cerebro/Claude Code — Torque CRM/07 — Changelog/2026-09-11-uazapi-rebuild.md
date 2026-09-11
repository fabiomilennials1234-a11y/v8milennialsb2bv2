---
type: changelog
title: Reconstrução UAZAPI — início isolado
status: draft
created: 2026-09-11
updated: 2026-09-11
tags: [whatsapp, uazapi, contract-tests]
related: ["[[whatsapp-stability-plan]]"]
owner: gabriel
---

# Reconstrução UAZAPI — início isolado

## Mudanças

Cliente/provider alinhados a campos documentados de criação, mídia, menus, reações, histórico e quotas. Circuito isolado por servidor e credencial; criação não repetida após resposta perdida. Nenhum deploy em produção.

## Referências

- `supabase/functions/_shared/uazapi-client.ts`
- `supabase/functions/_shared/whatsapp-providers/uazapi-provider.ts`
- `tests/unit/uazapi-openapi-contract.test.ts`
- `.specs/uazapi-rebuild/STATE.md`

## Pendências

Provisionamento Supabase, contrato do servidor efetivo e homologação com destinatário controlado. Auditoria inicial usou checkout antigo; não representa main atual.

## Validação real de leitura

TorqueSDR: identidade remota confirmada, seis endpoints HTTP 200. Payloads estruturais anonimizados registrados. Paginação de chats e mensagens corrigida com base em respostas reais. Fornecedor devolveu quatro JIDs de grupo com flag individual; filtro final usa classificação normalizada. Custo da branch Supabase (US$ 0,01344/hora) segue aguardando confirmação exigida pelo conector. Não houve escrita em produção nem envio.

## Branch Supabase aprovada e provisionada

CTO confirmou custo e permanência durante reconstrução. Branch uazapi-rebuild, qtkohfnephshaxgtzksz, persistent=true, baseada no projeto de produção. Replay automático falhou no marcador do baseline; baseline do repo restaurado com 256 tabelas. Não representa ainda schema completo de produção atual. Seed restrito a org QA/TorqueSDR/credencial; zero crons ativos e mensagens importadas. RPC pela REST API negou anon (401), permitiu serviço (200); adapter com credencial da branch validou identidade e 451 chats individuais. Sem mudança remota de webhook ou envio. Evidência em .specs/uazapi-rebuild/branch-verification.json.
