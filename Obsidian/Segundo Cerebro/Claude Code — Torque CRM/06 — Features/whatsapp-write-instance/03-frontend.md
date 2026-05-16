---
type: feature
title: Etapa C — Frontend (vínculo user ↔ instância de escrita)
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---



# Etapa C — Frontend (vínculo user ↔ instância de escrita)

> Implementação dos estados visuais de `[[02-ui-states]]`. Backend (Etapa A + B) já completo; flag `user_write_instance_strict` continua **OFF default**. Esta etapa não muda comportamento legado quando flag está OFF e o lead da conversa segue o caminho atual.

## O que é

Camada frontend que consome a RPC `get_lead_write_instance` (Etapa A), cruza com identidade do user na org e renderiza o composer no estado correto:

- **Estado 1 (HABILITADO)** — composer original, zero overlay.
- **Estado 2 (BLOQUEADO_INSTANCIA_ALHEIA)** — banner contextual + composer visualmente desabilitado (opacity stack). Notas internas continuam funcionando no full.
- **Estado 3 (ERRO_SEM_INSTANCIA / NO_RESPONSIBLE)** — substitui composer por card de erro com CTA correto por sub-variante (admin vs membro).

## Como funciona

### Hook `useLeadWriteInstance(leadId)`

`src/hooks/useLeadWriteInstance.ts`

Assinatura:

```ts
export function useLeadWriteInstance(leadId: string | null | undefined): {
  state: LeadWriteInstanceState;
  isLoading: boolean;
  refetch: () => void;
};

export type LeadWriteInstanceState =
  | { status: "loading" }
  | {
      status: "ok";
      instanceId: string;
      instanceName: string;
      ownerTeamMemberId: string | null;
      responsibleUserId: string;
      isOwn: boolean;
      canWrite: boolean;
      ownerName?: string;
      ownerFirstName?: string;
    }
  | {
      status: "error";
      errorCode: WriteInstanceErrorCode;
      responsibleUserId: string | null;
      ownerName?: string;
      ownerFirstName?: string;
      responsibleName?: string;
      responsibleFirstName?: string;
    };
```

Fluxo:

1. Chama RPC `get_lead_write_instance(p_lead_id)` via TanStack Query (`queryKey: ['lead-write-instance', orgId, leadId]`, `staleTime: 30s`).
2. Quando `error_code` é não-NULL → `status: "error"` com `errorCode`.
3. Sucesso → resolve `isOwn` (owner == currentTeamMember.id) e `canWrite` (`isOwn || isAdmin || isMaster`).
4. Lookup paralelo em `team_members` por nome (owner/responsável) para microcopy. Cache 5min.
5. Quando `leadId` é null/undefined, retorna `status: "loading"` sem disparar RPC.

Type cast intencional `supabase.rpc as unknown as ...` — `src/integrations/supabase/types.ts` ainda não foi regenerado pós-Etapa A (MCP bloqueado). O contrato é validado via `GetLeadWriteInstanceResult` em `src/types/user-write-instance.ts`.

### Componente `<ChatComposerShell>`

`src/components/chat/composer/ChatComposerShell.tsx`

Wrapper único para o composer (full e compact). Props:

- `leadId: string | null | undefined` — quando ausente, renderiza `innerComposer` direto (legado preservado).
- `variant: "full" | "compact"` — densidade conforme tabela de spec UI.
- `innerComposer: React.ReactNode` — composer já configurado pelo caller (`ChatComposer` em `WhatsAppChat.tsx` ou `ChatBubbleComposer` no bubble).
- `onAssignResponsible?` — CTA Estado 3a.
- `onLinkInstance?` — CTA Estado 3b (admin/master).
- `onChangeResponsible?` — CTA secundário Estado 3b.

Decisões:

- Estado 2 mantém `innerComposer` montado abaixo do banner com wrapper `pointer-events-none + opacity-[0.55] + aria-hidden="true"`. Não desmonta para evitar layout shift e preservar foco. Notas internas no full continuam acessíveis.
- Estado 3 SUBSTITUI composer por `<EmptyComposerCard>` interno; mantém `min-h-[var(--chat-composer-min-h,44px)]` para preservar altura mínima.
- Sem hex; 100% via tokens CSS (`bg-muted/40`, `bg-success/10`, `text-warning`, etc).
- `prefers-reduced-motion`: `motion-reduce:transition-none` + `motion-reduce:animate-none` em todos os componentes animados.
- Banner: `role="status"` + `aria-live="polite"`, ícone `<Lock />` alinhado opticamente à 1ª linha (`mt-0.5`).
- Card de erro: `role="region"` + `aria-label="Composer indisponível"` — não `alert` (não é urgente).

### Modal `<InstanceOwnerModal>`

`src/components/chat/admin/InstanceOwnerModal.tsx`

`Dialog` shadcn. Lista instâncias da org via `useWhatsAppInstances()`. Vincula via RPC `set_instance_owner(p_instance_id, p_new_owner_team_member_id, p_reason)`.

Fluxo:

1. Search filtra cliente-side (org típica = 5–40 instâncias).
2. Lista ordenada: Disponível (sem owner) → Em uso (outro owner) → Atual (target já é owner). Conectados antes de desconectados; alfabético.
3. Cada row: `role="radio"` com `aria-checked`. Container `role="radiogroup"` com navegação `↑↓` + Enter.
4. Selecionar instância "Em uso" → footer expande com confirmação inline (`bg-warning/5`) e CTA `destructive` "Confirmar e vincular". Sem AlertDialog separado (anti-pattern Stripe/Linear).
5. Empty state: "Esta organização ainda não tem números de WhatsApp configurados" + CTA `Ir para WhatsApp`.
6. Sucesso: toast neutro (Linear pattern), invalida `["lead-write-instance"]` e `["whatsapp_instances"]`.
7. Erros tratados: `INVALID_OWNER` (membro inativo/cross-org), `FORBIDDEN` (não é admin/master), genérico (rede).

### Integração no full (`WhatsAppChat.tsx`)

O bloco do composer original passa a ser `innerComposer` do shell quando `leadId` está disponível:

```tsx
<ChatComposerShell
  leadId={leadId ?? null}
  variant="full"
  onAssignResponsible={onOpenLeadModal}
  onLinkInstance={() => setIsLinkInstanceOpen(true)}
  onChangeResponsible={onOpenLeadModal}
  innerComposer={<div className="p-3 border-t ...">...</div>}
/>
```

Quando `leadId` é null/undefined (ex: conversa nova sem lead resolvido), legado é preservado: shell renderiza inner direto sem RPC.

`InstanceOwnerModal` é montado lazy quando há erro e existe `responsibleUserId` resolvido.

### Integração no compact (`ChatBubbleThread.tsx`)

Resolve `leadId` via `useLeadByPhone(phoneNumber)`. Mesmo padrão:

```tsx
<ChatComposerShell
  leadId={leadId}
  variant="compact"
  onLinkInstance={() => setIsLinkInstanceOpen(true)}
  innerComposer={
    canReply ? (
      <ChatBubbleComposer ... leadId={leadId} />
    ) : (
      <ChatBubblePermissionBanner />
    )
  }
/>
```

Bubble não tem fluxo de "atribuir responsável" — `onAssignResponsible` omitido; Estado 3a degrada para texto sem CTA.

### Como `leadId` propaga até o envio

1. `WhatsAppChat.tsx` `ChatWindow` recebe `leadId` via prop (resolvido em `WhatsAppChat` raiz a partir de `selectedLead?.id ?? selectedContact?.lead_id`).
2. `useSendWhatsAppMessage` e `useSendWhatsAppMedia` (`src/hooks/chat/useWhatsAppSend.ts`) aceitam param opcional `leadId`.
3. Quando presente, é encaminhado ao body do POST do proxy (`evolution-api-proxy` legado ignora; `whatsapp-api-proxy` consome quando flag ON, gera 409 em mismatch ou 403 sem autorização).
4. Quando `undefined`, body permanece como hoje (legado preservado).

Ponto único de mudança backend → frontend: param `leadId` no input das mutations.

## Regras de negócio

- Flag `user_write_instance_strict` OFF (default): UI continua mostrando os estados (banner, card de erro), mas backend NÃO bloqueia envio. Isto permite roll-out gradual: UI primeiro, depois flip-on por org.
- Admin e master sempre veem `canWrite=true` quando `state.status === "ok"` (mesmo bypass que o backend).
- `isVirtualTeamMember` (master shadow user) é tratado em `useTeamMembers` — não impacta a comparação `owner_team_member_id === currentTeamMember.id` porque o IDvirtual nunca casa com um UUID real em `whatsapp_instances`.
- Vocabulário ao usuário: "número" / "linha de WhatsApp", nunca "instância" (essa string só aparece em logs/devtools).

## Edge cases

- `leadId` null/undefined → renderiza inner direto, sem RPC, sem skeleton.
- RPC retorna lista vazia (não esperado) → mapeia para `LEAD_NOT_FOUND` no client.
- `instance_id` ou `instance_name` null com `error_code` null (defensive) → fallback `NO_INSTANCE`.
- `owner_team_member_id` null → `isOwn=false`, mas se `isAdmin/isMaster` ainda `canWrite=true`.
- Modal admin sem instâncias na org → empty state com CTA navegando p/ `/configuracoes` (rota existente).
- Modal admin selecionando instância "Em uso" pelo próprio user logado: confirmação inline ainda aparece (semântica preservada — vendedor anterior é o próprio user, não há texto especial nesta versão; pode ser refinado em E).

## Áreas frágeis tocadas

- **WhatsApp/Uazapi (chat)**: `useWhatsAppSend` ganhou param `leadId` opcional. Sends continuam via `evolution-api-proxy` (não-breaking). Quando frontend migrar 100% para `whatsapp-api-proxy`, o param já estará lá.
- **Permissões**: novo gate `canWrite` co-existe com `useCanReplyOnInstance(*)`. O legado segue ativo p/ bordas que ainda dependem dele (lista lateral, indicadores). Comentário `// TODO Etapa D: deprecate after rollout` deixado nos pontos substituídos.

## Pendências

- **Etapa D**: limpeza dirigida — remover gates redundantes `useCanReplyOnInstance`/`useCanReplyOnInstanceByName` dos composers e do `ChatBubblePermissionBanner` quando o vínculo `owner_team_member_id` cobrir 100% das orgs ativas. Antes da limpeza, regenerar `src/integrations/supabase/types.ts` para tipar a coluna nova.
- **Etapa E**: rollout — script de backfill por org + flip da flag `user_write_instance_strict` por org com observabilidade (Sentry tags + logRuntime).
- **Refatoração futura**: extrair o composer inline de `WhatsAppChat.tsx` para `<ChatComposerFull>` reutilizável (hoje é JSX inline). Evita repetição entre full e potenciais novos contextos.

## Histórico

- **2026-05-08** — Etapa C completa. Hook `useLeadWriteInstance`, componente `ChatComposerShell` (full + compact), modal `InstanceOwnerModal`, send hooks com param `leadId`. Testes unitários cobrindo a matriz de estados (16 passing). Flag OFF preserva legado 1:1.
