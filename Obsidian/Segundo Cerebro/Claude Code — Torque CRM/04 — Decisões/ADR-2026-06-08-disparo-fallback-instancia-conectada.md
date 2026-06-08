---
data: 2026-06-08
status: aceito
tags: [whatsapp, disparo, lgpd, hotfix, instance-write-guard]
---

# ADR 2026-06-08 — Disparo cai para instância conectada quando lead não tem responsável

## Contexto

A feature `user_write_instance_strict` (vínculo user↔instância↔responsável, 2026-05-11) impunha
**1 vendedor = 1 instância de escrita**: o disparo de um lead só saía pela instância vinculada ao
seu responsável. Quando a flag está ON e o lead **não tem responsável** (ou o responsável não tem
instância, ou ela está inativa), o resolver compartilhado **lançava erro sem fallback**, bloqueando
o envio.

A flag estava **ON em PROD para a org Milennials** (override `organization_features.enabled = true`,
confirmado read-only em 2026-06-08), contrariando o plano original ("PROD intocada"). Resultado: na
prática, qualquer disparo de lead sem responsável falhava em todos os caminhos automatizados (copilot
outbound, followups, send-document, message-gateway, pipe/campaign-rule-dispatch). O CTO percebeu como
"o botão de disparo só funciona se o lead tiver responsável".

## Decisão

O vínculo responsável→instância passa a ser **preferência, não gate**.

- Quando o vínculo resolve uma instância conectada → usa a dela (preferência mantida).
- Quando NÃO resolve (`NO_RESPONSIBLE`, `NO_INSTANCE`, `INSTANCE_INACTIVE`) → **fallback para a
  primeira instância CONECTADA da org**, em vez de falhar.
- `LEAD_NOT_FOUND` (o lead nem existe) permanece erro real.

Implementação na camada TS (`whatsapp-dispatch.ts` + `instance-write-guard.ts`). **Sem migration** — a
RPC `get_lead_write_instance` e a flag permanecem inalteradas; o vínculo per-user segue válido como
preferência e pode ser reendurecido no futuro mexendo só no resolver.

## Alternativas consideradas

1. **Desligar a flag para Milennials** (`organization_features.enabled = false`). Rejeitada: removeria
   também o roteamento bom (mensagem do rep sai pela instância dele quando há responsável) e seria uma
   mudança operacional, não código — voltaria a quebrar no próximo cutover de outra org.
2. **Fallback no RPC SQL**. Rejeitada: o fallback de "primeira instância conectada da org" já existe na
   camada TS (`resolveInstance`); duplicar no SQL fragmentaria a regra e exigiria migration em PROD.
3. **Manter o gate e exigir backfill de responsável**. Rejeitada: viola o intent do CTO ("disparo
   sempre possível pela instância conectada") e deixa o sistema quebrado até o backfill.

## Consequências

- **Positivo**: disparo nunca depende de haver responsável; o sintoma some em todos os caminhos.
- **Trade-off (LGPD)**: relaxa o isolamento per-user que a feature impunha — leads sem responsável
  saem por instância compartilhada da org, reduzindo rastreabilidade "quem mandou de qual número"
  nesses casos. Aceito explicitamente pelo CTO. O isolamento permanece para leads COM responsável.
- A pendência §11/§3 do `feature-overview.md` ("aplicar Migration A em PROD em janela ociosa") está
  **superada pela realidade** — já está em PROD. Ver `feature-overview.md §13`.

## Refs

- `supabase/functions/_shared/whatsapp-dispatch.ts` — `resolveDispatchContext`
- `supabase/functions/_shared/instance-write-guard.ts` — `resolveStrictInstanceForCaller`
- `.specs/features/whatsapp-write-instance/feature-overview.md §13`
- `tests/integration/instance-write-guard.test.ts`
