# Triage Labels

As skills falam em cinco papéis canônicos de triage. Esta tabela mapeia cada papel para a string de label real usada no tracker deste repo.

| Label in mattpocock/skills | Label in our tracker | Meaning                                  |
| -------------------------- | -------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`       | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`         | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`    | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`    | Requires human implementation            |
| `wontfix`                  | `wontfix`            | Will not be actioned                     |

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the corresponding label string from this table.

Edit the right-hand column to match whatever vocabulary you actually use.

## Estado no GitHub (medido 2026-08-11)

As cinco de triage **existem todas**. Nenhuma precisa ser criada; aplicar direto.

| Label | Cor | Origem |
| --- | --- | --- |
| `needs-triage` | `#FBCA04` | criada em 2026-08-11 |
| `needs-info` | `#FEF2C0` | criada em 2026-08-11 |
| `ready-for-agent` | `#0E8A16` | já existia — reusada, não recriada |
| `ready-for-human` | `#1D76DB` | criada em 2026-08-11 |
| `wontfix` | `#FFFFFF` | criada em 2026-08-11 |

Labels que **não** são de triage e não devem ser confundidas — 11 no total, o repo tem 16: `bug`, `Feature`, `docs`, `api`, `prd`, `vault-health`, `wayfinder:map`, `wayfinder:prototype`, `wayfinder:research`, `wayfinder:grilling`, `wayfinder:task`.

> A versão anterior desta seção listava 6 labels de domínio e **não sabia das 5 `wayfinder:*`** — que já existiam quando ela foi escrita ou surgiram depois sem passar por aqui. Antes de afirmar o estado do tracker, meça: `gh label list --limit 60`.
>
> `Feature` com maiúscula é anomalia herdada e **não** está nesta tabela de propósito. Não renomear nem apagar sem decisão — issues antigas apontam para ela.
