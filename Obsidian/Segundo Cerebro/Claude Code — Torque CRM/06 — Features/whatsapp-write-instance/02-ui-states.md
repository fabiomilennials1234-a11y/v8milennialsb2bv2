---
type: feature
title: Estados do composer — vínculo user ↔ instância de escrita
status: active
created: 2026-04-12
updated: 2026-04-12
tags: [uncategorized]
related: []
owner: gabriel
---

# Estados do composer — vínculo user ↔ instância de escrita

> Spec visual + microcopy + estados. Não há código. Engenheiro consome em etapa seguinte.
> Refs design: Linear (densidade), Stripe (clareza tabular), Vercel (whitespace + accent), Apple (hierarquia editorial), Airbnb (calor humano em vazios).
> Tokens consumidos: `src/index.css` (HSL via CSS vars). Sem hex, sem cor inline.

---

## Sumário de decisões críticas

1. **Unificar via `<ChatComposerShell>`**: shell único renderiza header opcional (banner) + slot do composer + slot de erro. Hoje há 2 composers paralelos (`ChatComposer` full e `ChatBubbleComposer`). Shell elimina divergência de microcopy/comportamento. Ambos os composers viram apenas "renderers de input".
2. **Vocabulário ao usuário**: nunca "instância". Sempre "número" ou "linha de WhatsApp". Vendedor não é técnico.
3. **CTA "Solicitar acesso a {ownerName}" — REJEITADO**. Justificativa: cria expectativa de fluxo ainda não existente (pedido + aprovação + handoff). Mais barato e honesto: usuário vê quem é o dono e fala fora do app, OU pede ao admin via Slack/voz. Sem placeholder de feature.
4. **Notas internas continuam habilitadas em Estado 2**. Toggle existente (já há aba/toggle no chat full). Bubble compact: notas não disponíveis hoje → manter ausente, não inflar escopo.
5. **Estado 3 substitui o composer (não desabilita)**. Composer disabled = "tente de novo, falhei sozinho". Card de erro = "isso não está configurado, aqui está o caminho". Diferenciação semântica importa.
6. **Banner é `role="status"` com `aria-live="polite"`**. Não é alerta urgente; é restrição contextual. `alert` ficaria intrusivo.
7. **Modal admin `Vincular número`** usa `Dialog` (shadcn) com lista virtual leve, não `Sheet`. Volume esperado: 5–40 instâncias por org. Lista, não wizard.

---

## Estado 1 — HABILITADO

User pode enviar. Composer renderiza como hoje. **Sem mudança visual.**

Critério de entrada (validação cliente, espelho do RPC `can_user_write_instance`):
- `currentUser.is_master === true`, OU
- `currentTeamMember.role === 'admin'` na org da instância, OU
- `instance.owner_team_member_id === currentTeamMember.id`.

Se qualquer for verdadeiro → renderiza Estado 1.

**Aceite**: nada quebrou. Mesmo Lighthouse, mesmo focus order, mesmo first-paint do composer.

---

## Estado 2 — BLOQUEADO_INSTANCIA_ALHEIA

User logado é membro (não admin/master), instância tem `owner_team_member_id` definido, owner ≠ user atual.

### Banner

#### Anatomia (full — `WhatsAppChat.tsx`)

```
┌──────────────────────────────────────────────────────────────────────┐
│  [icon 14px]  Esta conversa pertence ao número de {ownerFirstName}.  │
│               Você pode ler e adicionar notas internas.              │
└──────────────────────────────────────────────────────────────────────┘
```

- **Container**: `border-t border-border/60 bg-muted/40 px-4 py-2.5`. Fica imediatamente acima do composer (mesmo lugar onde hoje vive `<div class="p-3 border-t">`).
- **Layout interno**: `flex items-start gap-2.5`. Ícone alinha com a primeira linha de texto (não com o centro do bloco — alinhamento óptico).
- **Ícone**: `<Lock />` Lucide, `w-3.5 h-3.5`, `text-muted-foreground`, `mt-0.5` (alinhamento óptico). Justificativa: cadeado comunica restrição sem alarmar. `AlertCircle` foi descartado — sinaliza erro, não é o caso. `Info` é genérico demais.
- **Texto linha 1**: `text-[13px] font-medium text-foreground/85 leading-snug`. `{ownerFirstName}` em `font-semibold text-foreground`. Primeiro nome apenas (sobrenome polui em telas estreitas).
- **Texto linha 2**: `text-[12px] text-muted-foreground leading-snug mt-0.5`. Descreve o que ainda É permitido — afirmativo, não punitivo.
- **Sem CTA primário no banner**. Decisão deliberada (vide sumário item 3).
- **Hover banner**: nenhum. Banner é informativo, não interativo.

#### Anatomia (compact — `ChatBubblePanel.tsx`, ~380px)

Dois ajustes:
- Texto colapsa em **1 linha**: "Conversa do número de {ownerFirstName}." Linha 2 (notas internas) é suprimida porque o bubble compact não tem notas hoje.
- Padding reduzido: `px-3 py-2`. Tipografia: `text-[12px]` único nível.
- Ícone: `w-3 h-3`.

```
┌────────────────────────────────────────┐
│ [lock]  Conversa do número de Camila.  │
└────────────────────────────────────────┘
```

#### Microcopy (definitivo)

| Variante  | Texto                                                                                         |
|-----------|-----------------------------------------------------------------------------------------------|
| Full L1   | `Esta conversa pertence ao número de {ownerFirstName}.`                                       |
| Full L2   | `Você pode ler e adicionar notas internas.`                                                   |
| Compact   | `Conversa do número de {ownerFirstName}.`                                                     |
| Fallback  | `Esta conversa pertence ao número de outro vendedor.` (quando `ownerFirstName` indisponível)  |

**Sem emoji. Sem exclamação. Sem "ops" nem "infelizmente". Sem "você não tem permissão"** (linguagem punitiva — Linear/Stripe nunca punem o user).

#### Composer disabled (visual)

O composer **continua visível abaixo do banner** — não some. Trocar/sumir composer entre conversas causa salto de layout (anti-Apple).

- `<input>` / `<textarea>`:
  - `disabled` real (HTML).
  - `placeholder` substituto: **`Apenas o vendedor responsável pode enviar mensagens`**. Sem variáveis. Pega quem lê o placeholder antes do banner.
  - `cursor-not-allowed` no container. Não no input direto — UX de input desabilitado é confuso quando o cursor pisca.
  - `opacity: 0.55` no row inteiro do composer (input + ícones laterais). Não 0.5 (genérico) nem 0.4 (some demais em dark).
- Botões secundários (anexar, áudio, agendar, send): todos `disabled`. `pointer-events-none` no row. `aria-disabled="true"`.
- O **botão de send mantém o gradient gold** mesmo desabilitado, com `opacity-40` extra. Justificativa: um composer cinza-uniforme parece "sistema fora do ar". Manter o gold sob opacity comunica "isso existe, só não é seu agora" — Stripe usa esse pattern em forms read-only.
- Kbd hints (rodapé): suprimidos no Estado 2. Não há atalho útil aqui.

#### Notas internas

- **Full**: a aba/toggle "Notas" do `WhatsAppChat` (já existente — `ChatTabs` ou similar) **permanece habilitada e visualmente normal**. Indicador discreto: badge `Disponível` (`bg-success/10 text-success border-success/20 text-[10px] uppercase tracking-wider`) ao lado do label "Notas" enquanto o usuário estiver no estado bloqueado. Comunica afirmativamente o que está disponível.
- **Atalho**: pressionar `N` (sem foco em input) muda pra aba Notas. `Esc` volta. Já é convenção Linear (`N` = note).
- **Compact (bubble)**: notas internas não existem hoje. Não introduzir nesta etapa. Banner compact informa "Conversa do número de {ownerFirstName}." sem prometer notas.

#### Acessibilidade

- Banner: `role="status"` `aria-live="polite"`. Lido por screen reader **uma vez** quando entra em estado bloqueado, não a cada re-render. Implementação: montar/desmontar o banner controla anúncio.
- Input desabilitado: `aria-disabled="true"` + `aria-describedby` apontando para o id do banner. Screen reader lê o motivo ao tabular pro input.
- Foco: `Tab` pula composer disabled e vai pro toggle de Notas (próximo elemento focável). Não tabular para botões `disabled`.
- Contraste: `text-foreground/85` em `bg-muted/40` passa WCAG AA em ambos os temas (calculado com tokens atuais — light: 9.2:1, dark: 8.7:1).
- `prefers-reduced-motion`: o banner aparece com `transition: opacity 150ms ease-out` quando entra. Em `reduce`, troca pra `opacity 0ms` (instant).

---

## Estado 3 — ERRO_SEM_INSTANCIA

Composer **substituído** por `<EmptyComposerCard>`. Não desabilita — troca o componente. Diferenciação semântica de "configuração ausente" vs "permissão negada".

Card layout (full, compact descrito ao final):

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│       [icon 28px]                                        │
│                                                          │
│       {Título}                          ← text-[15px]    │
│       {Subtítulo, 1–2 linhas}           ← text-[13px]    │
│                                                          │
│       [CTA primário]   [CTA secundário?]                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

- **Container**: `border-t border-border/60 bg-background px-6 py-5` (full) / `px-4 py-4` (compact). Mesma altura mínima do composer normal (`min-h-[var(--chat-composer-min-h)]` + padding) para não saltar layout.
- **Alinhamento**: `flex flex-col items-start gap-3`. Texto + CTAs alinhados à esquerda (Linear/Stripe pattern para empty/error contextual). Centralização aqui pareceria modal, não in-line.
- **Ícone**: `w-7 h-7` (full) / `w-6 h-6` (compact). `text-muted-foreground` (NÃO `text-destructive` — não é destrutivo, é configuração ausente). Em uma faixa quadrada `rounded-xl border border-border/60 bg-muted/40 p-2.5` que enquadra o ícone — sutil, não decorativo. Stripe usa esse mesmo padrão em estados de "configure isto".
- **Título**: `text-[15px] font-semibold text-foreground tracking-tight`.
- **Subtítulo**: `text-[13px] text-muted-foreground leading-relaxed max-w-[52ch]`.
- **CTAs**: gap `gap-2`. Primário sempre primeiro.

### 3a — `error_code: NO_RESPONSIBLE`

Lead sem `responsible_user_id`.

- **Ícone**: `<UserPlus />` Lucide. Comunica "falta alguém aqui" sem alarmar. (`Plug2` e `Link2Off` são técnicos demais para este caso — falamos de pessoa, não de cabo.)
- **Título**: `Lead sem responsável`
- **Subtítulo**: `Defina um responsável para que ele envie mensagens por esta conversa.`
- **CTA primário**:
  - Texto: `Atribuir responsável`
  - Variant: `default` (gradient gold via `gradient-primary`)
  - Ícone: `<UserPlus className="w-4 h-4 mr-2" />`
  - Ação: abre o existente fluxo de atribuir responsável do lead (drawer ou modal já presente em `LeadDrawer` / detalhe do lead).
- **CTA secundário**: nenhum. Caminho único — fluxo limpo.

**Variante quando user é membro (não admin)** e não tem permissão de atribuir:
- Subtítulo: `Peça ao administrador para definir um responsável por este lead.`
- Sem CTA. Apenas texto. Stripe/Linear precedente: quando user não pode agir, não mostre botão fake. Botão sem ação é pior que ausência.

### 3b — `error_code: NO_INSTANCE` (admin/master)

Lead tem responsável, responsável não tem número vinculado.

- **Ícone**: `<Plug2 />` Lucide. Comunica "linha não conectada" (cabo desligado). Visualmente mais específico que `Link2Off`. Em comunicação interna pode-se chamar de "ícone de tomada" — um único pictograma carrega o conceito todo.
- **Título**: `{responsibleFirstName} ainda não tem um número de WhatsApp`
- **Subtítulo**: `Vincule um número para que {responsibleFirstName} possa responder pelos leads dele.`
- **CTA primário**:
  - Texto: `Vincular número` (não "Vincular instância" — vocabulário usuário)
  - Variant: `default` (gradient gold)
  - Ícone: `<Plug2 className="w-4 h-4 mr-2" />`
  - Ação: abre **Modal "Vincular número"** (spec abaixo) com `responsibleTeamMemberId` pré-selecionado.
- **CTA secundário**: `Trocar responsável` — `variant="ghost"`. Ícone: `<UserPlus className="w-4 h-4 mr-2" />`. Caminho de saída: às vezes a solução não é vincular número, é trocar responsável. Manter o atalho.

### 3b — `error_code: NO_INSTANCE` (não-admin)

Membro vê o mesmo card mas sem ações diretas.

- **Título**: `{responsibleFirstName} ainda não tem um número de WhatsApp`
- **Subtítulo**: `Peça ao administrador para vincular um número de WhatsApp ao perfil de {responsibleFirstName}.`
- **CTA**: nenhum. Apenas o texto. Mesmo princípio do 3a sem permissão.

### Estado loading do CTA

Quando o CTA primário dispara (ex: abrir modal já é instantâneo, mas no submit do modal vai haver loading):
- Botão: substitui ícone por `<Loader2 className="w-4 h-4 mr-2 animate-spin" />`. Texto permanece. `disabled`.
- Em `prefers-reduced-motion: reduce`, `Loader2` perde `animate-spin` e vira `<Loader2 className="w-4 h-4 mr-2 opacity-70" />` estático. Não engole o estado loading — mantém affordance visual mínima.

### Acessibilidade

- Card: `role="region"` `aria-label="Composer indisponível"`. Não `alert` — não é urgente, é configuração.
- Título: `<h3>` semântico (mantém hierarquia da tela; `WhatsAppChat` já tem `<h2>` como título da conversa).
- CTA primário: foco visível padrão (`focus-visible:ring-2 focus-visible:ring-ring`) — herda do shadcn `Button`.
- Tab order: ícone (não focável) → título (não focável) → subtítulo (não focável) → CTA primário → CTA secundário (se existir) → próximo elemento da página.
- `aria-live="polite"` no card quando substitui o composer dinamicamente (ex: lead troca de responsável e perde instância sem reload). Anúncio único.

---

## Modal "Vincular número"

Componente novo. Abre via CTA primário do Estado 3b (admin/master) ou via configuração de equipe (entry point secundário, fora do escopo desta etapa).

### Estrutura (shadcn `Dialog`)

```
┌─────────────────────────────────────────────────────────────┐
│  Vincular número de WhatsApp                            [×] │   ← header
│  Conecte um número de WhatsApp a {responsibleName}.         │   ← description
├─────────────────────────────────────────────────────────────┤
│  [Buscar número, instância ou telefone…]                    │   ← search
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ● Vendas SP                              [Disponível]│   │   ← row item
│  │   +55 11 9 9123-4567 · Conectado                     │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ○ Atendimento                            [Em uso]    │   │
│  │   +55 11 9 4321-7654 · Conectado                     │   │
│  │   Vinculado a Camila Souza                           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ...                                                        │
├─────────────────────────────────────────────────────────────┤
│                                  [Cancelar]   [Vincular]    │   ← footer
└─────────────────────────────────────────────────────────────┘
```

### Header

- Título: `text-[16px] font-semibold tracking-tight` — `Vincular número de WhatsApp`
- Description: `text-[13px] text-muted-foreground` — `Conecte um número de WhatsApp a {responsibleName}.`
- Close button (×): padrão shadcn `DialogClose`.

### Body

- **Search**: `<Input>` no topo, `placeholder="Buscar número, instância ou telefone…"`. `mb-3`. Filtra cliente-side (org típica = 5–40 instâncias). Foco automático ao abrir.
- **Lista**: scroll interno `max-h-[400px] overflow-y-auto`. Cada row:
  - **Container**: `flex items-start gap-3 px-3 py-2.5 rounded-lg border border-border/60 hover:bg-muted/40 cursor-pointer transition-colors`. Selecionado: `border-primary bg-primary/5 ring-1 ring-primary/30`.
  - **Radio dot**: 14px circle no leading. Selected = preenchido com `hsl(var(--primary))`.
  - **Linha 1**: `instance_name` (`font-medium text-[14px] text-foreground tracking-tight`) + badge de status à direita.
  - **Linha 2**: `{phone_number formatado} · {connectionStatus}` em `text-[12px] text-muted-foreground tabular-nums`.
  - **Linha 3** (condicional): `Vinculado a {currentOwnerName}` em `text-[11px] text-muted-foreground`.
- **Badges de status** (canto direito da Linha 1):
  - **Disponível** (instância sem owner): `bg-success/10 text-success border-success/20 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded`. Ordenar essas primeiro.
  - **Em uso** (instância com owner ≠ alvo): `bg-warning/10 text-warning border-warning/20`.
  - **Atual** (já é dono do alvo, edge case se reabrir o modal): `bg-primary/10 text-primary border-primary/20`.
- **Ordem da lista**: (1) Disponível, (2) Em uso, (3) Atual. Dentro de cada grupo: instâncias `connectionStatus = 'connected'` antes de desconectadas. Tie-break: alfabético por `instance_name`.

### Footer

- `[Cancelar]` `variant="ghost"` à esquerda do `[Vincular]` `variant="default"` (gradient gold).
- `[Vincular]` desabilitado até haver seleção. Loading state idêntico ao Estado 3 CTA (Loader2 + texto preservado).

### Estado vazio (org sem instâncias)

```
┌───────────────────────────────────────────────────┐
│                                                   │
│              [icon 32px]                          │
│                                                   │
│         Nenhum número conectado                   │
│         Conecte um número de WhatsApp na          │
│         configuração da organização para vinculá- │
│         lo a um vendedor.                         │
│                                                   │
│         [Ir para WhatsApp]                        │
│                                                   │
└───────────────────────────────────────────────────┘
```

- Centralizado verticalmente no body do modal (`min-h-[280px] flex flex-col items-center justify-center text-center px-6`).
- Ícone: `<MessageSquareDashed />` Lucide, `text-muted-foreground`, em quadradinho como Estado 3.
- CTA: navega para `/configuracoes/whatsapp` (rota existente da página de instâncias). `variant="default"`.

### Validação — vincular instância já-vinculada a outro user

Quando admin seleciona uma instância com badge "Em uso" e clica `Vincular`:

1. Footer dispara confirmação inline (não AlertDialog separado — duplo modal é antipattern Stripe/Linear). O footer expande para:

```
─────────────────────────────────────────────────────
  [icon] Substituir vínculo de Camila Souza?
  Camila perderá acesso de envio por este número.
                                  [Voltar]   [Confirmar e vincular]
─────────────────────────────────────────────────────
```

- **Bg**: `bg-warning/5 border-t border-warning/20`. `px-4 py-3`.
- **Ícone**: `<AlertTriangle className="w-4 h-4 text-warning" />`.
- **Texto**: `text-[13px] font-medium text-foreground` no header curto, `text-[12px] text-muted-foreground` na linha 2.
- **CTA "Voltar"**: `ghost`. Volta para o footer normal sem desfazer seleção.
- **CTA "Confirmar e vincular"**: `variant="destructive"` (gradient não — destructive comunica consequência). Loading state Loader2.

Microcopy alternativa quando `previousOwner` é o próprio usuário logado (admin se desvinculando):
- `Substituir o seu próprio vínculo neste número?`
- `Você perderá acesso de envio por este número.`

### Microcopy de sucesso

Após `set_instance_owner` resolver com sucesso:
- Modal fecha.
- Toast (`sonner`): título `Número vinculado`, descrição `{instanceName} agora pertence a {responsibleFirstName}.`. Variant: default (sem destructive/success colorido — Linear pattern, toast não precisa berrar).
- Card de Estado 3 desaparece, composer normal renderiza (assumindo realtime ou refetch — engenheiro cuida).

### Microcopy de erro

- RPC retorna `INVALID_OWNER` (responsável de outra org / inativo): toast destructive, título `Não foi possível vincular`, descrição `Este vendedor não está ativo nesta organização.`
- Erro de rede: toast destructive, título `Falha ao vincular número`, descrição `Verifique a conexão e tente novamente.`. Não fechar o modal — usuário tenta de novo.

### Acessibilidade

- `Dialog` shadcn já entrega: focus trap, restore focus, ESC fecha, aria-modal.
- Search input recebe foco ao abrir (`autoFocus`), porque modal é orientado a busca.
- Lista: navegação por seta ↑↓ (`role="radiogroup"` no container, `role="radio"` em cada row). `aria-checked` reflete seleção. Enter seleciona e move foco pro botão `Vincular`.
- Confirmação inline: quando expande, foco move pro `[Confirmar e vincular]` automaticamente (`aria-live="polite"` no container da confirmação).
- `prefers-reduced-motion`: `Dialog` overlay/content troca `data-state` animations por opacity instant.

---

## Considerações cross-superfície

| Aspecto              | Full (`WhatsAppChat`)                              | Compact (`ChatBubblePanel`, ~380px)                 |
|----------------------|----------------------------------------------------|------------------------------------------------------|
| Banner padding       | `px-4 py-2.5`                                      | `px-3 py-2`                                          |
| Banner texto         | 2 linhas (motivo + permissão)                      | 1 linha (motivo apenas)                              |
| Banner ícone         | `w-3.5 h-3.5`                                      | `w-3 h-3`                                            |
| Composer disabled    | Mantém visível com opacity 0.55                    | Mantém visível com opacity 0.55                      |
| Notas internas       | Aba Notas habilitada + badge "Disponível"          | Não disponível hoje — manter ausente                 |
| Estado 3 padding     | `px-6 py-5`                                        | `px-4 py-4`                                          |
| Estado 3 ícone       | `w-7 h-7` em quadradinho `p-2.5`                   | `w-6 h-6` em quadradinho `p-2`                       |
| Estado 3 título      | `text-[15px]`                                      | `text-[14px]`                                        |
| Estado 3 subtítulo   | `text-[13px] max-w-[52ch]`                         | `text-[12px] max-w-[36ch]`                           |
| CTA primário         | `size="default"`                                   | `size="sm"`                                          |
| Modal "Vincular"     | Abre full Dialog                                   | Abre full Dialog (sai do bubble — bubble não fecha)  |

**Tipografia consistente cross-superfície**: hierarquia preservada. Compact reduz tamanhos absolutos, mantém razões (título 1.15x do subtítulo, badge 0.75x do título, etc).

---

## Tokens / variáveis CSS usadas

Todas via `hsl(var(--token))` ou `hsl(var(--token) / <alpha>)`. **Sem hex.**

### Cores
- `--background` — fundo do composer e card de erro.
- `--foreground` — texto principal (banner L1, título do card).
- `--muted` / `--muted-foreground` — bg do banner (`/40`), bg do quadradinho do ícone (`/40`), texto do subtítulo, badge de instância "Em uso" wrapper.
- `--border` — borda do banner (top, herdado), borda do card de erro (top), borda dos rows do modal (`/60`).
- `--primary` — gradient gold no CTA primário, ring de seleção no modal (`/30`), badge "Atual" (`/10` text + `/20` border).
- `--success` — badge "Disponível" no modal (`/10` bg + `/20` border + text), badge "Disponível" da aba Notas.
- `--warning` — badge "Em uso", confirmação inline de substituição (`/5` bg + `/20` border).
- `--destructive` — CTA "Confirmar e vincular" destrutivo, toast de erro.
- `--ring` — focus visible nos botões e radio rows.

### Densidade chat (existentes)
- `--chat-composer-min-h: 44px` — preservar altura mínima no Estado 3 para não saltar layout.

### Gradientes utilitários (existentes)
- `.gradient-primary` — CTA primário (gold).

### Sombras
- `--shadow-md` — modal card.
- `--shadow-lg` — modal overlay (herdado do shadcn `Dialog`).

### Tipografia (Tailwind utilities)
- `text-[10px]` (badges, kbd hints), `text-[11px]` (linhas terciárias), `text-[12px]` (subtítulos compact, badges), `text-[13px]` (banner L1, subtítulo full), `text-[14px]` (instance_name), `text-[15px]` (título card full), `text-[16px]` (título modal).
- `font-medium` (banner L1), `font-semibold` (títulos, ownerFirstName), `font-sans` (kbd).
- `tracking-tight` (títulos), `tracking-wider` (badge uppercase).
- `tabular-nums` (telefone no modal).

### Motion
- Entrada banner: `transition-opacity duration-150 ease-out`. Reduzido a `0ms` em `prefers-reduced-motion: reduce`.
- Hover row do modal: `transition-colors duration-150 ease-out`.
- Botões: herdam `transition-all duration-150` do shadcn `Button`.
- Loader: `animate-spin` substituído por `opacity-70` estático em reduced motion.

---

## Aceite (checklist QA visual)

- [ ] Estado 1 idêntico ao baseline (zero regressão visual)
- [ ] Banner renderiza com ícone alinhado opticamente à 1ª linha de texto (não centralizado vertical)
- [ ] Composer disabled em Estado 2 mantém gradient gold no send com opacity 0.40 sobre 0.55 do row
- [ ] Notas internas continuam funcionando em Estado 2; badge "Disponível" presente na aba
- [ ] Estado 3 substitui composer (não desabilita) e mantém altura mínima do row original
- [ ] Ícone `<Plug2 />` em quadradinho `bg-muted/40` (não destructive, não accent)
- [ ] Membro sem permissão em 3a/3b vê texto explicativo e zero CTA (nada de botão fantasma)
- [ ] Modal abre com foco no search; lista navegável por ↑↓; Enter seleciona+move foco pro [Vincular]
- [ ] Lista do modal ordena: Disponível → Em uso → Atual; conectados antes de desconectados
- [ ] Confirmação inline quando vincular sobre um user existente; CTA "Confirmar e vincular" é `destructive`
- [ ] Toast de sucesso é neutro (Linear pattern), toast de erro é destructive e não fecha o modal
- [ ] Compact (bubble) usa todos os tamanhos reduzidos da tabela cross-superfície
- [ ] Dark mode: contraste banner ≥ 4.5:1 (foreground/85 sobre muted/40); checked em ambos os temas
- [ ] Light mode: WCAG AA em todos os textos
- [ ] `prefers-reduced-motion`: zero animação além de transições de cor; Loader2 vira estático
- [ ] Sem hex em nenhum lugar — `hsl(var(--token))` em 100% das cores
- [ ] Sem string "instância" exposta ao usuário em nenhuma microcopy (apenas em logs/devtools)

---

## Referências

- **Linear** — banner contextual `role="status"` discreto sobre composer; atalho `N` para notas; toast neutro pós-ação.
- **Stripe** — quadradinho de ícone (`bg-muted/40 p-2.5 rounded-xl`) para empty/error contextual, não decorativo; confirmação inline em footer ao invés de duplo modal; gradient preservado em disabled com opacity stack.
- **Vercel** — gold preservado em estados desabilitados (comunica "isso pertence a alguém", não "isso falhou"); whitespace generoso no Estado 3.
- **Apple** — alinhamento óptico do ícone com 1ª linha; tipografia editorial (tracking-tight em títulos, leading-snug em corpo); zero salto de layout entre estados.
- **Airbnb** — empty state do modal (org sem instâncias) com calor humano: caminho claro, sem culpa.

---

## Não-objetivos desta etapa

- Pedido de acesso ao owner (rejeitado, justificado).
- Notas internas no bubble compact (fora de escopo, manter assim até definir feature do bubble).
- Migração visual do composer atual para shell unificado em código (esta spec descreve o estado final; engenheiro decide se faz refactor incremental).
- Telemetria (eventos) — engenheiro define junto com analytics.
- Dark mode "ainda mais cinematográfico" — manter coerência com o resto do app; novidade visual é responsabilidade de outra spec.

---

## Histórico

- **2026-05-08** — Spec inicial. Definidos 3 estados + modal admin + variantes full/compact. Vocabulário usuário definido ("número", não "instância"). CTA "Solicitar acesso" descartado com justificativa.
