# SPEC — Filtro do Inbox WhatsApp, repensado

**Status:** Aprovado (grill concluído 2026-07-23, CTO confirmou)
**Escopo:** `src/modules/communication/components/chat/list/ConversationList.tsx` (coluna esquerda do chat WhatsApp)
**Protótipo visual canônico:** https://claude.ai/code/artifact/50978691-3e45-4746-ba9e-901f972f3f3f
**Memória:** `chat-inbox-filter-redesign.md`

---

## Problem Statement

O filtro do inbox do WhatsApp é feio, mal organizado e raso. Hoje são três botões soltos (`Com lead` / `Humano` / `Grupos`) mais duas tabs (`Ativas` / `Arquivadas`), sem coerência visual e sem as dimensões que o vendedor realmente usa pra achar uma conversa entre 166+ ativas.

Falta o filtro mais óbvio de um CRM: **em que etapa/funil o lead está**. Também faltam Vendedor, Tag (o dado existe e não é filtrável), Qualificação, Aguardando-resposta e Fonte (IA vs humano). O layout atual já está apertado com 3 botões — não escala pra 8 dimensões empilhando mais botões.

## Solution

Modelo estilo Linear: o filtro nasce vazio, o vendedor adiciona só o que precisa via **"+ Filtro"**, e cada filtro ativo vira um **chip editável** (clica pra ajustar, ✕ pra remover). Um toggle rápido **Não lidas** fica sempre à mão. `Ativas`/`Arquivadas` continuam como tabs (é escopo, não filtro).

As dimensões novas (Funil, Etapa, Vendedor, Qualificação) exigem dados que hoje não vêm no contato — resolvidas por **enrichment client-side**: a lista já é montada no browser a partir de queries a `leads`/conversas; basta ampliar o `select` e somar uma query batch de entradas de funil pros `lead_id` em vista. Volume por org (~166 conversas) torna o filtro instantâneo no cliente.

Nomes de funil **não são hardcoded** — vêm de `usePipelineDisplayConfig()`, que cada org customiza (defaults: Oportunidades / Agendamentos / Orçamentos / Carteira). Etapa é dependente do Funil escolhido, honrando o invariante "lead pode estar em múltiplos funis ao mesmo tempo". Grupos saem de vez: o inbox mostra só conversas individuais.

## Decisões travadas

1. **Escopo:** só WhatsApp inbox (`ConversationList`). Meta e chat-bubble ficam pra depois.
2. **Dimensões (1 onda):** Funil · Etapa · Vendedor · Tag · Qualificação · Aguardando-resposta · Fonte (IA/humano) · Não-lidas · Com/sem lead · tab Arquivadas.
3. **Execução:** enrichment **client-side** (rota A) — estende `useWhatsAppContacts` + 1 query batch de pipe entries. RPC server-side (rota B) = débito registrado; gatilho dela é o limite de 8000 msgs, não o filtro.
4. **UX:** busca · toggle Não-lidas · "+ Filtro" · chips vivos · tabs Ativas/Arquivadas. Dark-first, sem emoji, ícones lucide.
5. **Combinação:** AND entre dimensões, OR dentro da mesma dimensão.
6. **Grupos:** removidos — só conversas individuais.
7. **Persistência:** localStorage por usuário (`usePersistedState`). Busca e tab efêmeros.
8. **Nomes de funil:** de `usePipelineDisplayConfig()`, nunca hardcodar.
9. **Etapa:** dependente do Funil; fallback agrupado-por-funil quando sem funil escolhido.

## User Stories

1. Como vendedor, quero filtrar o inbox por **etapa do funil** (ex: só "Agendado"), para trabalhar um recorte por vez.
2. Como vendedor, quero combinar **Etapa + Vendedor + Tag** ao mesmo tempo, para achar exatamente a conversa que preciso.
3. Como vendedor, quero um toggle **Não lidas** de 1 clique, para varrer pendências rápido.
4. Como vendedor, quero filtrar **Aguardando resposta** (última mensagem foi do lead), para não deixar ninguém no vácuo.
5. Como vendedor, quero filtrar por **Fonte** (IA vs humano), para revisar o que o copiloto respondeu.
6. Como vendedor, quero que meu filtro **persista** entre visitas, para não remontar o recorte toda hora.
7. Como admin, quero que os nomes de funil no filtro **reflitam os nomes que renomeei** na minha org.
8. Como vendedor, quero que o inbox mostre **só conversas individuais**, sem grupos poluindo.
9. Como vendedor, quero ver na linha da conversa a **etapa** e as **tags**, para reconhecer o contexto sem abrir.

## Fatiamento

- **S1 — Enrichment:** estende `useWhatsAppContacts` (`responsible_id/sdr_id/closer_id`, `qualification_tier`) + query batch de entradas de funil pros `lead_id`; amplia `ChatContact`. Dados puros, sem UI. Testes de unidade do enrichment.
- **S2 — Shell do filtro:** modelo de estado + `FilterBar` (menu "+ Filtro", chips vivos, toggle Não-lidas), semântica AND/OR, persistência localStorage, engine de filtro client-side. Liga as dimensões baratas (Tag, Qualificação, Fonte, Aguardando, Com/sem lead). Remove os 3 toggles antigos + grupos.
- **S3 — Funil + Etapa:** Funil via `usePipelineDisplayConfig` (rótulo/ordem/visibilidade por org); Etapa dependente do Funil com fallback agrupado; match "lead tem entry no funil F na etapa E" honrando multi-pipe.
- **S4 — Polish + linha:** pill de etapa + tags + ícone de fonte na linha da conversa; contagem reativa de Ativas/Arquivadas; motion, foco de teclado, `prefers-reduced-motion`, a11y; e2e Playwright.

## Pontas de implementação

- **"Vendedor" = qual papel?** Default = responsável (dono do lead); expansível pra SDR/closer se pedido.
- **Drift "Todos os vendedores":** o dropdown da screenshot **não existe na branch `feat/omie-erp-foundation`**. Verificar prod vs repo antes de codar — se existe em prod, absorver no novo modelo; se é fantasma, o filtro Vendedor cobre.

## Riscos / notas

- `ChatContact` hoje (chat/types.ts): phone, push_name, last_message, last_message_direction, last_message_sent_source (manual/copilot/workflow), unread_count, lead_id, lead_name, conversation_id, archived_at, tags[], is_group.
- Lista derivada das últimas 8000 msgs — enrichment é bounded pelo nº de leads em vista, custo baixo. Se algum dia a org estourar esse teto, rota B (RPC paginado) vira necessária — débito separado deste SPEC.
- Multi-tenancy: toda query nova filtra `organization_id`; RLS é o gate final.
