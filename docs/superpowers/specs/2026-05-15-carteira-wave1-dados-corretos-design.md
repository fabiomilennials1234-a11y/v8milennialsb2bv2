# Wave 1 — Dados Corretos: Design Spec

> **Data:** 2026-05-15
> **Status:** Aprovado
> **Escopo:** 4 tasks — Tendência, Engagement real, Tipar any, Extrair formatBRL
> **Plano mãe:** `docs/superpowers/plans/2026-05-15-carteira-worldclass-waves.md`

---

## W1.1 — Tendência (placeholder → real)

### Schema

```sql
ALTER TABLE upsell_clients ADD COLUMN trend TEXT CHECK (trend IN ('up','stable','down'));
```

### Cálculo (cron)

Localização: `supabase/functions/_shared/portfolio-health.ts`

```ts
export function deriveTrend(
  lastThreeTickets: number[],
  historicalAvg: number,
): "up" | "stable" | "down" {
  if (lastThreeTickets.length < 3 || historicalAvg <= 0) return "stable";
  const recentAvg =
    lastThreeTickets.reduce((s, v) => s + v, 0) / lastThreeTickets.length;
  if (recentAvg > historicalAvg * 1.1) return "up";
  if (recentAvg < historicalAvg * 0.9) return "down";
  return "stable";
}
```

Integração no cron (`calculate-portfolio-health/index.ts`):
- `lastThreeTickets` já é calculado (linha 135)
- `historicalAvg` = `avgTicket` já calculado (linha 125)
- Chamar `deriveTrend(lastThreeTickets, avgTicket)` e incluir no `.update()`

### Frontend

Localização: `src/components/carteira/CarteiraClientTable.tsx` (linha 250)

Substituir `<span className="text-[13px] text-[#3f3f46]">—</span>` por:

| Valor | Ícone | Cor |
|-------|-------|-----|
| `up` | `TrendingUp` (lucide) | `text-[#22c55e]` (verde) |
| `stable` | `Minus` (lucide) | `text-[#71717a]` (cinza) |
| `down` | `TrendingDown` (lucide) | `text-[#ef4444]` (vermelho) |
| `null` | `—` | `text-[#3f3f46]` |

Adicionar `trend` à interface `CarteiraClient` e ao select do `usePortfolioHealth`.

### Testes

Arquivo: `tests/unit/portfolio-health.test.ts`

Cenários:
- 3 tickets crescentes vs avg baixo → `up`
- 3 tickets decrescentes vs avg alto → `down`
- 3 tickets ~= avg → `stable`
- < 3 tickets → `stable`
- historicalAvg = 0 → `stable`
- Exatamente no threshold (±10%) → `stable`

---

## W1.2 — Engagement Real (fixo 50 → dados reais)

### Fontes de dados

| Fonte | Tabela | Campo | Join path |
|-------|--------|-------|-----------|
| Engagement score IA | `conversation_context_summary` | `engagement_score` (0-100) | `upsell_clients.lead_id = conversation_context_summary.lead_id` |
| WhatsApp recência | `whatsapp_messages` | `direction='incoming'`, `timestamp` | `upsell_clients.lead_id = whatsapp_messages.lead_id` |

### Cálculo

Localização: `supabase/functions/_shared/portfolio-health.ts`

```ts
export function calculateEngagementScore(
  contextEngagement: number | null,
  daysSinceLastIncoming: number | null,
): number {
  const ctxScore = contextEngagement ?? null;
  const waScore = daysSinceLastIncoming != null
    ? whatsappRecencyToScore(daysSinceLastIncoming)
    : null;

  if (ctxScore != null && waScore != null) {
    return Math.round(ctxScore * 0.6 + waScore * 0.4);
  }
  if (ctxScore != null) return ctxScore;
  if (waScore != null) return waScore;
  return 50; // fallback neutro
}

function whatsappRecencyToScore(days: number): number {
  if (days <= 3) return 100;
  if (days <= 7) return 75;
  if (days <= 14) return 50;
  if (days <= 30) return 25;
  return 0;
}
```

### Integração no cron

Localização: `supabase/functions/calculate-portfolio-health/index.ts`

Na function `processClient()`:

1. Query `conversation_context_summary` por `lead_id`:
   ```ts
   const { data: ctxSummary } = await supabase
     .from("conversation_context_summary")
     .select("engagement_score")
     .eq("lead_id", client.lead_id)
     .maybeSingle();
   ```

2. Query última msg incoming do WhatsApp:
   ```ts
   const { data: lastIncoming } = await supabase
     .from("whatsapp_messages")
     .select("timestamp")
     .eq("lead_id", client.lead_id)
     .eq("direction", "incoming")
     .order("timestamp", { ascending: false })
     .limit(1)
     .maybeSingle();
   ```

3. Calcular:
   ```ts
   const daysSinceIncoming = lastIncoming
     ? Math.round(daysBetween(new Date(lastIncoming.timestamp), now))
     : null;

   const engagement = calculateEngagementScore(
     ctxSummary?.engagement_score ?? null,
     daysSinceIncoming,
   );
   ```

4. Substituir `ENGAGEMENT_DEFAULT` pelo valor calculado nas `dims`.

5. Passar `daysSinceLastWhatsAppReply: daysSinceIncoming` pro `detectSignals()` (hoje é `null`).

### Fallback safety

- `client.lead_id` pode ser `null` → engagement = 50 (neutro)
- `conversation_context_summary` pode não existir pra lead → usa só WhatsApp
- `whatsapp_messages` pode estar vazio → usa só context summary
- Ambos vazios → 50 (comportamento idêntico ao atual)

### Testes

Arquivo: `tests/unit/portfolio-health.test.ts`

Cenários `calculateEngagementScore`:
- Ambos presentes → weighted combo (60/40)
- Só context → 100% context
- Só WhatsApp → 100% WhatsApp
- Nenhum → 50

Cenários `whatsappRecencyToScore`:
- 0 dias → 100
- 3 dias → 100
- 7 dias → 75
- 14 dias → 50
- 30 dias → 25
- 60 dias → 0

---

## W1.3 — Tipar `any` em 5 componentes

### Mapeamento

| Arquivo | Prop atual | Tipo correto |
|---------|-----------|-------------|
| `ClienteCopilotSuggestion.tsx:10` | `alerts: any[]` | `Tables<"client_alerts">[]` |
| `ClienteCopilotSuggestion.tsx:11` | `lastOrder: any \| null` | `Tables<"upsell_orders"> \| null` |
| `ClienteProductsTable.tsx:15` | `products: any[]` | `Tables<"upsell_client_products">[]` |
| `ClienteOrderHistory.tsx:9` | `orders: any[]` | `Tables<"upsell_orders">[]` |
| `ClienteTimeline.tsx:9-10` | `orders: any[]`, `alerts: any[]` | `Tables<"upsell_orders">[]`, `Tables<"client_alerts">[]` |
| `ClienteDetailPage.tsx:101-110` | `(client?.lead as any)` | Query select tipado com `.lead` join |

### Abordagem ClienteDetailPage

O `.select("*, lead:leads(name, phone, email, company)")` retorna join tipado. Definir tipo derivado:

```ts
type ClientWithLead = Tables<"upsell_clients"> & {
  lead: Pick<Tables<"leads">, "name" | "phone" | "email" | "company"> | null;
};
```

Usar no `useQuery<ClientWithLead>()`. Elimina todo `as any`.

### Verificação

- `npm run lint` sem erros novos
- `npm run build` sem erros TS
- Zero `any` restante nos 5 arquivos

---

## W1.4 — Extrair formatBRL duplicado

### Novo arquivo

Localização: `src/lib/format.ts`

```ts
export function formatBRL(value: number, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits,
  }).format(value);
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

export function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
```

### Arquivos a alterar

7 componentes — remover `formatBRL` local, importar de `@/lib/format`:

1. `CarteiraKPIs.tsx` (linha 3-8)
2. `CarteiraAlertBanner.tsx` (linha 6)
3. `CarteiraClientTable.tsx` (linha 43-48)
4. `CarteiraClientPreview.tsx` (linha 19-24)
5. `ClienteMetrics.tsx` (linha 30-35)
6. `ClienteOrderHistory.tsx` (linha 14-19)
7. `ClienteTimeline.tsx` (linha 22-27)

Também extrair `formatDate` duplicado onde aplicável (ClienteMetrics, ClienteReorderTimeline, ClienteOrderHistory, ClienteTimeline).

### Verificação

- `grep -r "const formatBRL" src/components/carteira/` → 0 resultados
- `npm run build` sem erros

---

## Ordem de execução

| # | Task | Commit |
|---|------|--------|
| 1 | W1.4 — formatBRL | `refactor(carteira): extract shared format utils` |
| 2 | W1.3 — tipos | `refactor(carteira): replace any types with Supabase table types` |
| 3 | W1.1 — tendência | `feat(carteira): add trend calculation and display` |
| 4 | W1.2 — engagement | `feat(carteira): wire real engagement score from WhatsApp + context summary` |

W1.4 → W1.3 primeiro porque limpam código, facilitando edições em W1.1 e W1.2.
