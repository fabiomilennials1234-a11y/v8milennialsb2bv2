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

## Continuação — contratos reais e backend QA

CTO forneceu destinatário controlado e autorizou envios. Texto, imagem, documento, menu, áudio, voz, vídeo, figurinha, contato e localização exercitados. Edição/reação/pin/unpin/leitura/exclusão de mensagem própria e ciclo sender também passaram. Pastas sender de teste removidas. Pending/messageTimestamp e sending observados exigiram normalização nova; hibernação, janela de monitor e recuperação history corrigidos. Exact retornou 404; localização zero retornou 400: divergências registradas, não mascaradas.

Schema atual restaurado somente em QA: 334 tabelas, 979 políticas, 1.053 funções públicas e 4.218 colunas comparadas. Oito funções com URL fixa de produção redirecionadas para QA; zero crons. Snapshot não copiou dados comerciais. Status automático MIGRATIONS_FAILED permanece distinguido da restauração manual; DEFAULT ACL da plataforma não reaplicada. Branch retida com aprovação anterior.

Quatro Edge Functions publicadas em QA. JWT real validou 401/403/200 e envio queued. Envelope SSE real, com chat objeto e reação em messages, reproduzido no webhook: uma mensagem/uma reação mesmo com duplicatas, DLQ vazia. Reações usam compare-and-swap e não disparam nova conversa. App QA autenticado carregou a caixa TorqueSDR.

179 testes direcionados, Deno check de três handlers, build, lint e tipos verificados. Inventário das 139 operações registra 32 referências estáticas e 23 sondas, sem afirmar cobertura integral de produto. Estado e limitações atualizados em `.specs/uazapi-rebuild/STATE.md`; evidências em `live-verification-2026-09-11.json`. PR #2099 continua draft, sem produção.

Teste visual adicional encontrou SELECT sem metadados de ações. Query passou a carregar reactions/edited/pinned_at/deleted_at; reação real agora renderiza após reload. Composer mantém queued como pending, incluindo fallback persistido e bolha otimista. Mais 43 testes passaram, total 224 em 15 arquivos; build e lint repetidos após correção frontend.
