---
type: howto
title: Regenerar Types Supabase
status: active
created: 2026-05-15
updated: 2026-05-15
tags: [howto, types, supabase, typescript]
related: ["[[aplicar-migration-prod]]", "[[Schema]]"]
owner: gabriel
---

# Como regenerar `src/integrations/supabase/types.ts`

> Arquivo é **auto-gerado** (270KB). Nunca editar manualmente.

## Quando regenerar

- Após migration nova aplicada (dev ou prod)
- Após mudança em RPC (assinatura)
- Tipos quebrando no IDE/build sem motivo aparente

## Passos

### 1. Backup (precaução)

```bash
cp src/integrations/supabase/types.ts src/integrations/supabase/types.ts.bak
```

### 2. Regen a partir do projeto remoto

Da source que reflete melhor — geralmente **prod**:

```bash
supabase gen types typescript --project-id jsjsmuncfkbsbzqzqhfq \
  > src/integrations/supabase/types.ts
```

Ou DEV se quer pegar migrations ainda não em prod:

```bash
supabase gen types typescript --project-id bcfadphgsibjzivtbjvc \
  > src/integrations/supabase/types.ts
```

### 3. Diff

```bash
diff src/integrations/supabase/types.ts.bak src/integrations/supabase/types.ts | head -50
```

Mudanças esperadas refletindo migration nova. Se mudança em tabela não tocada,
investigar (schema drift?).

### 4. Build check

```bash
npm run build
```

Erros TS comuns:
- Tabela renomeada → grep + fix call sites
- Coluna removida → grep + fix
- RPC removida → atualizar caller

### 5. Commit

```bash
git add src/integrations/supabase/types.ts
git commit -m "chore(types): regen Supabase types after <migration>"
```

### 6. Cleanup

```bash
rm src/integrations/supabase/types.ts.bak
```

## Gotchas

- **Source matters**: regen de prod ≠ regen de dev se migrations divergiram.
- **Tipos com `unknown`**: se gerar `unknown` em vez de tipo, migration tem
  erro de definição.
- **Custom types**: alguns campos JSONB têm tipo `Json` genérico — usar type
  assertion no caller.
- **CLI version**: garantir `supabase` CLI atualizada:
  ```bash
  brew upgrade supabase/tap/supabase   # macOS
  scoop update supabase                # Windows
  ```

## Por que isso é frágil

- 270KB de TS gerado, qualquer regen muda hashes/whitespace
- Diff difícil de revisar manualmente
- Build fail só aparece depois — não há type check inline
- Auto-completar do IDE quebra silenciosamente se tipo errado
- Recomendo regen + build + smoke test sempre juntos
