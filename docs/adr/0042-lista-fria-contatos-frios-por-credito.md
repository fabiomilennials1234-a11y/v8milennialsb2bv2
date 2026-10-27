# 42. Lista Fria: contatos frios por crédito, importados como lead de uma seção própria

Date: 2026-10-27

## Status

Accepted (CTO, 2026-10-27). Desenho no board Miro `uXjVHlzya2A=` (capítulo "Torque · Lista Fria" e mockups). Entrega 1 na migration `20271217000000_lista_fria_fundacao.sql`.

## Context

O CTO pediu uma feature nova: o cliente escolhe uma fonte, Instagram ou Google Maps, e o Torque devolve uma lista de contatos (telefone e e-mail).

- **Instagram:** o cliente cola a URL de uma conta; a IA busca contato público dos seguidores dela.
- **Maps:** o cliente informa um nicho e uma cidade ("Dentistas", "São Paulo - SP"); a IA busca telefone e e-mail dos negócios.

Decisões fechadas em 27/10:

1. Maps roda no **gosom/google-maps-scraper** (open source), para baixar o custo. Instagram segue o modelo do Mailerfind: dado público do perfil, sem login do cliente.
2. **Busca por créditos**: 1 crédito = 1 contato novo e válido; quem já é lead não é cobrado.
3. A lista **só exporta e importa**. Sem disparo.
4. O **único teto é o saldo de créditos**: sem teto por job nem por plano.
5. O contato importado vira **lead**, numa **seção própria da tela de Leads** ("Lista fria"), **sem funil automático**.

Três caminhos pareciam servir e não servem:

- **Funil (`pipelines` / `pipeline_entries`).** Importar para um funil criaria card, acionaria a automação de entrada do funil e entraria nas métricas de venda. A decisão (5) é justamente não atribuir funil.
- **Reaproveitar a Cobrança (ADR-0040).** A Cobrança isola o inadimplente de `leads` por construção. Aqui o contrato é o oposto: o contato **é** um lead (o CTO pediu que apareça na lista de leads), só que numa seção separada.
- **Gate de plano (`feature_catalog` + `organization_features`).** Mesmo motivo do ADR-0040: para master a feature aparece em toda org. A flag é por org e fail-closed.

## Decision

**1. Flag por organização**, `organizations.feature_flags->'lista_fria' = true`, lida pelo `useFeatureFlag` (fail-closed, sem bypass de master) e no banco por `private.lista_fria_habilitada`. Ligada só na TorqueCRM. Duas permissões próprias (`lista_fria.view`, `lista_fria.edit`, `default_value = false`): admin e master passam, membro só com liberação. Mesmo desenho do ADR-0040.

**2. Tabelas próprias para a busca** (`lista_fria_buscas`, `lista_fria_resultados`, `lista_fria_creditos`). Só a **importação** escreve em `leads`. Leitura pela RLS contra `private.lista_fria_orgs_visiveis()`; escrita só por RPC `SECURITY DEFINER` (`private.lista_fria_exigir`: sessão, flag, `assert_org_access`, permissão). As RPCs do worker (`lista_fria_worker_*`) são só do `service_role`.

**3. A fronteira da seção é uma coluna: `leads.lista_fria_busca_id`.** Preenchida, o lead:

- aparece só na aba **Lista fria** de `/leads`; toda outra aba e a exportação o escondem (`applyLeadListFilters`, parâmetro `usaListaFria`, aplicado **só** em org com a flag: front novo com banco velho nunca referencia a coluna);
- nasce com `excluded_from_metrics = true` e `origin = 'lista_fria'`;
- **não dispara** o gatilho `lead_created` do motor de automações nem o webhook de saída `lead.created` (as duas funções de trigger ganham um retorno antecipado; o corpo base é o de produção em 27/10);
- não tem card em funil nenhum.

A marca só muda pelas RPCs (`BEFORE INSERT/UPDATE` com `app.lista_fria_rpc`), nunca por um `UPDATE` do usuário.

**4. Créditos.** Livro de créditos que só soma (`lista_fria_creditos`); o saldo é `SUM(delta)` da org. A busca **reserva** o limite que o cliente escolheu ao ser criada (advisory lock por org: duas abas não gastam o mesmo saldo) e **devolve a sobra** ao terminar, uma vez só (`creditos_devolvidos`). O worker cobra 1 crédito por contato novo e válido; contato que já é lead entra marcado `ja_e_lead` e não consome. Quem libera saldo, por ora, é o time Torque (`lista_fria_creditos_conceder`, só master): não há compra no produto.

**5. Execução fora do banco.** O banco é a fila (`lista_fria_worker_reivindicar` com `FOR UPDATE SKIP LOCKED`, heartbeat, recuperação de busca travada que devolve a reserva). Quem executa é um **worker em container**, fora das edge functions: coletar no Maps e ler sites passa do limite de tempo delas. O contrato do worker é só o conjunto de RPCs acima; trocar o provedor (gosom, Apify) não toca no banco.

## Consequences

- A seção "Lista fria" convive com os leads sem mexer em `classificacao`, que tem trigger e leis próprias (a lei do ERP e a da Relação, ver `lead-classificacao.ts`). Por isso é uma coluna, não uma quarta classificação.
- Como a coluna só é lida com a flag ligada, **o merge do front não depende da migration** para as demais orgs. Na TorqueCRM a flag é ligada pela própria migration, então o front só vê a aba depois do banco.
- Contato frio importado ocupa o telefone normalizado na org (`idx_leads_org_phone_unique`). Se o mesmo número escrever no WhatsApp depois, cai no lead da seção. É o comportamento certo (a pessoa responde), mas a tela do chat vai mostrar um lead sem funil.
- O gatilho `step_import_lead` (onboarding) marca "importou lead" também na importação da Lista fria. Não foi alterado: é ruído de onboarding, não de envio.
- **LGPD e termos de uso.** Raspar o Maps contraria os termos do Google; a lista de seguidores do Instagram só sai com login, e a raspagem automatizada contraria os da Meta. O risco do Maps é nosso (decisão 1). Contato de pessoa física exige finalidade, base legal (legítimo interesse), opt-out e registro da origem; a origem fica gravada no lead (`origin`, `notes`, `lista_fria_busca_id`). Disparo a partir da lista está fora do escopo por isso, e por reputação de chip.

## Fora desta entrega

- O worker (gosom + extração por IA + validação) e o adaptador do Instagram.
- Compra de créditos e cobrança.
- Levar um contato da Lista fria para um funil (ação manual). Hoje ele só sai da seção se a marca for retirada pelo time.
