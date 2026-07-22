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

## Estado no GitHub (2026-07-21)

- `ready-for-agent` — **já existe** no repo (verde `#0E8A16`, "Triaged and ready for automated agent implementation"). Reusar, não recriar.
- `needs-triage`, `needs-info`, `ready-for-human`, `wontfix` — ainda não criadas. O `/triage` cria na primeira aplicação (`gh label create <nome>`), ou crie antes à mão.
- Labels de domínio que **não** são de triage e não devem ser confundidas: `bug`, `Feature`, `docs`, `api`, `prd`, `vault-health`.
