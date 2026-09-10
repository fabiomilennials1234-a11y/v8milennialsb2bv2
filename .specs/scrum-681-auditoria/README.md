# SCRUM-681 — Auditoria da identidade comercial

Épico [SCRUM-680](https://milennialstech-1785256858036.atlassian.net/browse/SCRUM-680). Task [SCRUM-681](https://milennialstech-1785256858036.atlassian.net/browse/SCRUM-681). Levantamento concluído em 2026-09-10; decisões de arquitetura e implementação continuam nas tarefas dependentes.

Base examinada: `origin/develop`, commit `215ff0bb9b0d8ad3b5189d10dd551778026753bb`, worktree isolado. Checkout original com alterações locais não foi incorporado. Este PR entrega somente documentação; nenhuma mudança de runtime ou migração.

## Leitura recomendada

| Entrega | Conteúdo | Jira |
|---|---|---|
| [Backend](backend.md) | Entidades, FKs, RLS de fonte, RPCs, evolução das migrations e consumidores | SCRUM-693 |
| [Frontend](frontend.md) | Rotas, formulários, painéis, funis, ações em massa, cache, realtime e permissões | SCRUM-694 |
| [Jornadas e integrações](integracoes-jornadas.md) | API atual, entrada, conversa, IA, workflows, campanhas, calendário, ERP e lacuna Make | SCRUM-695 |
| [Estado aplicado](producao.md) | Catálogo de produção, contagens e divergências verificadas | Complemento SCRUM-693 |
| [Evidência reproduzível](evidence/production-schema.json) | SQL somente de leitura + resultados sanitizados | Complemento SCRUM-693 |

## Premissas já decididas pelo CTO

- Contatos substituem Leads no produto; sem entidade Lead separada no modelo alvo.
- Contato pode existir sem empresa/negócio; empresa pode existir antes das pessoas.
- Contato pode ter várias empresas; vínculo N:N, sem empresa principal obrigatória no contato.
- Negócio tem no máximo uma empresa compradora e vários contatos; precisa de empresa ou contato. Empresa é escolhida no contexto do negócio.
- Nomes diferentes permanecem empresas distintas; sem agrupamento aproximado na migração.
- Disponibilidade final para todas as organizações; piloto apenas Milennials e TorqueCRM.
- Escopo inclui reconstrução necessária do frontend, migração, API e Make. PRs deste épico direcionados a develop.

## Conclusões que mudam a execução

1. **Não começar com rename de menu.** Abertura, autorização, projeção e painel de negócio exigem lead. Empresa-only precisa atravessar contratos de frontend, API e RPC.
2. **Parte de negócios já existe.** Deals e pipeline_entries separam identidade e posição; múltiplos negócios por lead/funil já são possíveis. Antigo useDeals da carteira foi removido. Evitar backlog duplicado apoiado em docs antigas.
3. **Fundação de contatos não é modelo alvo pronto.** Companies/contacts/deal_contacts existem e estão vazias na consulta de produção; contacts.company_id é singular. Migração antiga não entrega N:N, preservação integral de referências ou rollout do épico.
4. **Banco vivo difere da cadeia de fonte em RLS.** Registrar e reconciliar estado antes da aplicação. Policies/FKs de participantes também não demonstram integridade de tenant entre os dois lados; requer validação isolada.
5. **API evoluiu além do ADR inicial.** Já há deals e idempotência, mas identidade pública continua lead. Make publicado ainda não foi inspecionado; pacote não localizado neste checkout.

## Planejamento técnico versus implementação

| Prioridade | Trabalho ainda de planejamento técnico / grill-with-docs | Task | Implementação posterior |
|---|---|---|---|
| Primeiro | Identidade física canônica, IDs estáveis, N:N e invariantes do negócio | SCRUM-682 | SCRUM-688 |
| Alta | Receita, carteira, histórico e denominadores sem duplicação por participante | SCRUM-683 | SCRUM-690 |
| Alta | Tenant, visibilidade, sujeito de eventos e destinatário de mensagens | SCRUM-684 | SCRUM-688/690 |
| Alta | Jornadas reais, painel empresa-only, seleção por negócio, cache e protótipo | SCRUM-685 | SCRUM-689 |
| Alta | API/eventos, compatibilidade e inventário efetivo de Make | SCRUM-730 | SCRUM-731 |
| Antes do backfill | Colisões, mapeamento, reconciliação, efeitos colaterais e recuperação | SCRUM-686 | SCRUM-691 |
| Antes de liberar | IDs das duas orgs, gates, observabilidade e critérios de expansão | SCRUM-687 | SCRUM-692 |

Próxima sessão recomendada: **SCRUM-682**, começando pela pergunta técnica “evoluir a identidade física de leads ou migrar referências para contacts?”. Produto já decidiu o conceito; comparar estratégias com estas evidências, preservando IDs, histórico e compatibilidade. Nenhuma alternativa foi escolhida nesta auditoria.

## Validação e limites

Inspeção estática de código e definições posteriores às migrations fundadoras; consultas de catálogo e três contagens em produção, somente leitura. Referências de arquivo/linha e JSON verificados; revisão do diff sem alterações fora desta pasta. Testes da aplicação, RLS, UI e migração não foram executados: artefato documental, sem alteração de código. Cenários propostos estão nos inventários, não devem ser tratados como testes aprovados.

Lacunas de deploy, Make, população/colisões e ambiente de ensaio estão explicitadas nos relatórios e vinculadas às tasks de planejamento. Inventário registra alcance e fronteiras; não certifica ausência de bugs nem estima esforço pela contagem textual de arquivos.
