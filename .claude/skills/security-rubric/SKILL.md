---
name: security-rubric
description: Checklist de segurança do Torque CRM, disparado pelo DIFF. Use sempre que a mudança tocar RLS, multi-tenant, permissões, auth, secrets, CORS, PII, payment, Copilot ou WhatsApp/Uazapi — e antes de abrir PR que encoste nessas áreas.
---

# Rubric de Segurança — Torque CRM

Disparado pelo **diff**, não por protocolo. Se o que você mudou toca uma das áreas frágeis, roda. Se não toca, não roda.

Áreas frágeis: **RLS · multi-tenant · permissões · auth · secrets · CORS · PII · payment · Copilot · WhatsApp/Uazapi**.

## Escopo: o que o diff cria, altera ou torna alcançável

| Achado | Ação |
|---|---|
| Defeito em linha **adicionada/modificada** | Bloqueia. Conserta antes de shippar. |
| Defeito **pré-existente** em arquivo que o diff só encostou | Não bloqueia. Reporta como `HERDADO — arquivo:linha — o quê` → vira issue. |
| Defeito pré-existente que o diff **piorou, propagou ou tornou alcançável** (expôs a `anon`, publicou o bucket, roteou input não-confiável até ele) | Bloqueia. Diga qual mudança abriu o caminho. |

Sem prova de que a linha é nova, trate como herdado e siga. **Não faça arqueologia** — um `git blame` na linha, no máximo. Ancore em `git diff <base>...HEAD`.

Espelho mecânico no CI: `npm run typecheck:ratchet`, `npm run lint:ratchet`, `npm run lint:deps:check` — reprovam só o introduzido.

## Checklist

- [ ] **RLS** — policy nova usa `get_my_organization_ids()` / `get_my_admin_organization_ids()` / `is_master_user()`. **Nunca** `SELECT ... FROM team_members` inline (recursão infinita quando Realtime avalia `apply_rls()`).
- [ ] **Multi-tenant** — toda query filtra `organization_id`; o org vem do auth context, **nunca do body**.
- [ ] **EXECUTE grants** — função nova não expõe EXECUTE a `anon`/`authenticated`/`PUBLIC` sem intenção. **Revogue dos três e confira** — ver abaixo, nenhum revoke sozinho basta.
- [ ] **search_path** — toda função `SECURITY DEFINER` com `search_path` pinado.
- [ ] **service_role NÃO é backstop** — ele tem `BYPASSRLS=true` em prod. RLS não te salva atrás de uma edge function service_role. Cheque IDOR na mão.
- [ ] **Secrets** — nenhum token/chave em código, log ou commit. Secrets em env/vault deny-all.
- [ ] **CORS / edge fn** — mantém `Deno.serve(withErrorBoundary('nome', handler))` + `withSecurityHeaders(getCorsHeaders(req))` + OPTIONS early return. Header custom (`x-torque-*`) precisa estar na allowlist do `cors.ts`, senão o preflight mata todo `functions.invoke`.
- [ ] **PII** — dado pessoal não vaza em log, bucket público ou resposta não-escopada por org.
- [ ] **Auth** — verificação server-side real. Check só no frontend não conta.
- [ ] **Payment** — idempotência + verificação de assinatura do webhook.
- [ ] **Injection** — input parametrizado. Sem SQL injection, sem prompt injection em edge fn/Copilot.
- [ ] **Migration** — só schema. `DO`/backfill de dado de cliente não entra (guarda F4: URL errada vira erro de schema recuperável, não mudança de dado).

## Função nova: o EXECUTE chega por DOIS caminhos

Este projeto tem as duas armadilhas ao mesmo tempo, e elas se escondem uma atrás da outra:

1. **Grant implícito via `PUBLIC`** — toda função nasce com `EXECUTE TO PUBLIC`. `REVOKE FROM anon` aqui é **no-op**: anon nunca teve grant próprio, herdava de PUBLIC.
2. **Grant explícito via `ALTER DEFAULT PRIVILEGES`** — o projeto concede EXECUTE a `anon` e `authenticated` **nominalmente** em toda função nova do schema `public`. `REVOKE FROM PUBLIC` **não toca** nesses.

Revogar só de um lado deixa a função aberta. Sempre os três:

```sql
REVOKE ALL     ON FUNCTION public.<fn>(<assinatura>) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.<fn>(<assinatura>) FROM anon;
REVOKE EXECUTE ON FUNCTION public.<fn>(<assinatura>) FROM authenticated;  -- se não for pra usuário logado
GRANT  EXECUTE ON FUNCTION public.<fn>(<assinatura>) TO service_role;     -- só quem precisa
```

**A conferência não é opcional** — é ela que fecha o item:

```sql
SELECT has_function_privilege('anon',          'public.<fn>(<assinatura>)', 'EXECUTE') AS anon,
       has_function_privilege('authenticated', 'public.<fn>(<assinatura>)', 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  'public.<fn>(<assinatura>)', 'EXECUTE') AS service_role;
```

Sem a linha de verificação rodada **contra o alvo do apply**, o item de grants não passa. Migration verde e PR verde não provam nada aqui: o grant é concedido pelo banco no momento do `CREATE`, não pelo seu SQL.

> Custou caro em 2026-07-29: `import_lead_into_custom_pipeline` (SECURITY DEFINER, insere em `leads`) subiu para prod com `REVOKE FROM PUBLIC` feito conforme a versão anterior desta rubric — e ficou executável por `anon` por 40s, até o `has_function_privilege` denunciar. A rubric anterior ensinava metade da regra.

## Saída

```
## Segurança
Bloqueia: <arquivo:linha — o quê — o que fazer>   (ou "nada")
Herdado:  <arquivo:linha — o quê>                 (ou "nenhum")
```

Item de segurança reprovado bloqueia mesmo com tudo mais verde. Sem override por conveniência.
