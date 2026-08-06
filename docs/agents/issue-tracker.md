# Issue tracker: GitHub

Issues e PRDs deste repo vivem como GitHub issues em `fabiomilennials1234-a11y/v8milennialsb2bv2`. Use o `gh` CLI para todas as operações.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v` — `gh` does this automatically when run inside a clone.

## Convenções deste repo

- **PRD/épico** leva a label `prd`. As fatias de implementação são issues separadas que referenciam o PRD no corpo (`Part of #<prd>`). Ex.: PRD #1136 → issues #1137-1142.
- **Labels de domínio já em uso**: `bug`, `Feature`, `docs`, `api`, `prd`, `vault-health`, `ready-for-agent`.
- **PRs** saem de branch nova (`feat/...`, `fix/...`), nunca commit direto na `main`. Corpo do PR referencia a issue.
- Uma issue de decisão arquitetural costuma virar ADR em `docs/adr/` — ver `docs/agents/domain.md`.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number> --comments` and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments` then keep only `authorAssociation` of `CONTRIBUTOR`, `FIRST_TIME_CONTRIBUTOR`, or `NONE` (drop `OWNER`/`MEMBER`/`COLLABORATOR`).
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --comments`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (`gh api` on the sub-issues endpoint). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: GitHub's **native issue dependencies** — the canonical, UI-visible representation. Add an edge with `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). GitHub reports `issue_dependencies_summary.blocked_by` (open blockers only — the live gate). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Frontier query**: list the map's open children (`gh issue list --state open`, scoped to the map's sub-issues / task list), drop any with an open blocker (`issue_dependencies_summary.blocked_by > 0`, or an open issue in the `Blocked by` line) or an assignee; first in map order wins.
- **Claim**: `gh issue edit <n> --add-assignee @me` — the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far. Then carry the closure over to the Jira mirror: move the mirrored Tarefa's status and clear the `BLOQUEADO por #<n>` line from every Tarefa this closure just unblocked — see "Espelho no Jira", where that obligation is defined. Jira has no automatic equivalent to GitHub's dependencies; nothing does this for you.

## Espelho no Jira (camada de gestão)

O GitHub continua sendo o tracker canônico — é onde os skills publicam e onde o trabalho realmente vive. O Jira é **espelho de gestão**: existe para dar visibilidade de sprint e responsável a quem não abre o repo. Em qualquer divergência de conteúdo entre os dois lados, **o GitHub ganha**. O Jira carrega só título, link, status, sprint e responsável; corpo, discussão e labels ficam no GitHub e não são replicados.

### Acesso

Só pelas ferramentas MCP do Atlassian — `searchJiraIssuesUsingJql`, `getJiraIssue`, `createJiraIssue`, `editJiraIssue`, `createIssueLink`. **Não existe CLI de Jira neste ambiente**; não tente `jira`, `acli` ou equivalente.

**`createIssueLink` não gera hierarquia.** Este é um projeto *team-managed*: o pai vem do campo `parent` em `createJiraIssue`/`editJiraIssue`. `createIssueLink` só faz relações laterais (*relates*, *blocks*) e não prende nada ao Epic — usá-lo para isso produz História sem Epic no board.

- Site: `https://milennialstech-1785256858036.atlassian.net`
- Projeto: `SCRUM` — "Milennials Tech", *team-managed*
- cloudId: `e612e2e2-533a-4add-994d-2b1679fe5a98`

### Hierarquia

Três níveis, e nada além:

```
Epic (nível 1) > História ou Tarefa (nível 0) > Subtarefa
```

Subtarefa **não é item de sprint**: não aparece sozinha no board e não pode ir para uma sprint diferente da do pai.

**Converter Subtarefa em Tarefa pela API é recusado** — `editJiraIssue` sobre o campo `issuetype` devolve `O tipo de item selecionado é inválido`, porque a troca muda o item de nível na hierarquia. **Reparentar funciona** (campo `parent`); trocar o tipo, não. Subtarefa mal colocada se conserta mudando o pai, não o tipo.

### Mapeamento GitHub → Jira

| GitHub | Jira |
|---|---|
| Issue de PRD (label `prd`) | **Epic** |
| Issue de fatia (a que traz `Part of #<prd>`) | **História**, com o Epic correspondente como pai (campo `parent`) |
| Issue avulsa (`bug`, `docs`, `api` — sem PRD) | **Tarefa**, sem pai |
| Ticket de decisão do wayfinder (`wayfinder:<tipo>`) | **Tarefa**, com o Epic espelho do mapa como pai (campo `parent`) |
| — | **Subtarefa**: só checklist interno de execução dentro de uma fatia |

A subtarefa **nunca** é a unidade que o `/to-tickets` cria — o que ele cria vira História.

O legado anterior a esta convenção **não será arrumado retroativamente** — mexe-se nele só quando ele passa a atrapalhar. SCRUM-6, SCRUM-7 e SCRUM-8 nunca foram órfãs: eram Subtarefas do **próprio SCRUM-5**, provavelmente porque nasceram sob ele quando ele ainda era História, e a promoção para Epic as deixou penduradas direto num Epic. Foram reparentadas para **SCRUM-262** ("O plano de migração dos fluxos e do app do Make"), que é o lugar semanticamente certo. Seguem sendo Subtarefas — o tipo não muda (ver Hierarquia).

### Wayfinder é espelhado

**Regra vigente:** todo ticket de decisão do mapa vira uma **Tarefa** no Jira, filha do Epic espelho do mapa (campo `parent`), com responsável **Milennials Tech** e a descrição começando pela URL da issue do GitHub. O **mapa** em si (`wayfinder:map`) continua **só no GitHub** — o que ele espelha é o Epic, que recebe na descrição o link do mapa e o gist de uma linha por decisão fechada.

Isto **revoga** a regra anterior, que proibia espelhar ticket de decisão por ser ruído. O que ela não previu: o time — inclusive o dev do redesenho de funis — vive no Jira e **não abre o GitHub**. Sem o espelho, decisão que faz fronteira com outra pessoa fica invisível justamente para ela, e a fronteira só aparece no merge.

**Bloqueio não atravessa.** O GitHub tem dependência nativa entre issues; o Jira **não tem equivalente automático**. Então o estado de bloqueio viaja como **texto** na descrição da Tarefa — `BLOQUEADO por #<n>` — e quem fecha um ticket no GitHub é responsável por atualizar o texto das Tarefas que aquele fechamento destravou. Texto não se atualiza sozinho: bloqueio esquecido no Jira é pior que bloqueio nenhum, porque parece medido.

### Como os dois lados se acham

- A **primeira linha** do corpo da issue do GitHub traz `Jira: SCRUM-<n>`.
- A **descrição** da issue do Jira começa com a URL da issue do GitHub.

Assim nenhum lado fica órfão.

### Quem espelha

O agente que cria o lado GitHub cria o lado Jira na **mesma sessão**. Não existe job de sincronia automática — o espelho é manual e é responsabilidade de quem escreveu.

### Status

O workflow do SCRUM tem **quatro** estados:

| GitHub | Jira |
|---|---|
| aberto | "A fazer" (10000) ou "Fazendo" (10001) |
| — | "Testando" (10002) |
| fechado | "Feito" (10003) |

**"Testando" é estado de humano.** Fechar a issue no GitHub **não** autoriza mover de "Testando" para "Feito" no Jira — quem tira de "Testando" é a pessoa que validou. O agente que fecha no GitHub move para "Feito" apenas se a issue do Jira **não** estiver em "Testando".

### Primeiro Epic sob esta convenção

**SCRUM-5** — "Revisão/ Atualização de toda API do Torque" (`https://milennialstech-1785256858036.atlassian.net/browse/SCRUM-5`), promovido de História para Epic em 06/08/2026. O vínculo com o GitHub está **feito**: o Epic espelha o mapa **#1436**, e a descrição dele começa pela URL da issue.

É também o exemplo vivo do espelho do wayfinder: os 15 tickets de decisão do mapa estão no Jira como **Tarefas filhas do Epic**, de **SCRUM-250** a **SCRUM-264**, todas com responsável Milennials Tech. SCRUM-262 é a que herdou as três Subtarefas de legado (SCRUM-6/7/8).
