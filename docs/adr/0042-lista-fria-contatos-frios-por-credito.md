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

**5. Execução fora do banco.** O banco é a fila (`lista_fria_worker_reivindicar` com `FOR UPDATE SKIP LOCKED`, heartbeat, recuperação de busca travada que devolve a reserva). Quem executa é um **worker em container**, fora das edge functions: coletar no Maps e ler sites passa do limite de tempo delas. O contrato do worker é só o conjunto de RPCs acima; trocar o provedor (gosom, Apify) não toca no banco. O worker do Maps está em `services/lista-fria-worker` (Node 24, sem dependências): lê o CSV **parcial** do gosom a cada 5 s e ingere só o que é novo, por isso "parar e ficar com o que achou" funciona. Contrato do gosom **medido na imagem real** (o spec que ela serve diverge da resposta: chaves maiúsculas, `lang` ISO curto); detalhes no README do worker.

**6. Instagram via Apify, Actor `data-slayer/instagram-followers-scraper---no-login` (modo enriched).** Único dos avaliados que devolve o contato publicado no perfil (e-mail comercial, e-mail da bio, telefone, links); o Actor oficial da Apify declara que não extrai e-mail nem telefone. Só dado público, sem login. A execução é abortada ao atingir o limite de créditos, e `maxTotalChargeUsd` limita o gasto nosso por busca. O Actor cobra por seguidor processado (US$ 0,012), o cliente por contato válido: o preço do crédito tem de cobrir o rendimento real, que ainda não foi medido.

**Medido (28/10, Apify real):** o acesso sem login do Instagram entrega só a **primeira página (~50) de seguidores** por conta-alvo; dois Actors diferentes bateram no mesmo teto. Rendimento de contato válido: 21,6% numa conta de nicho de negócios (US$ 0,055 por contato) e 2% numa conta generalista (US$ 0,53). Uma busca de Instagram por Apify rende no máximo ~10 contatos. Isso pesa mais que o custo na decisão de produto: volume exige várias contas-alvo por busca ou login real.

**7. Instagram com login real, como segundo provedor (sem custo em dólar).** Decisão do CTO em 28/10 de tentar uma abordagem sem custo de Apify. Serviço Python separado (`services/instagram-coletor`, biblioteca `instagrapi` fixada) com contas dedicadas de Instagram. As credenciais ficam só no volume do serviço (nunca no banco nem no worker; `sessionid` preferível a senha); o worker o consulta pela mesma interface da Apify. Trade-off aceito: troca-se dinheiro por **risco de conta** (viola os termos da Meta; a conta cai) e por **ritmo** (uma requisição por perfil: cerca de 2 h por 800 contas, estimativa de projeto). Proteções: pausa aleatória e pausa longa, teto diário por conta, sessão reutilizada, **parada ao primeiro checkpoint sem tentar outra conta**, cooldown por sinal brando, prazo por chamada, handlers interativos da biblioteca desligados. Seguidores de Instagram são majoritariamente pessoas físicas: o risco de LGPD é maior que o de dado de empresa. **Não foi exercitado contra o Instagram real** (sem conta no ambiente de desenvolvimento).

**8. Leitura de site e IA são cercadas.** O endereço do site vem do Maps (texto de terceiro) e o worker tem a chave de serviço no ambiente: a leitura valida o IP na conexão, só 80/443, redirecionamento à mão, corpo e tempo limitados (`ssrf.ts`). A API do gosom não tem autenticação e nunca é publicada. Título e categoria do Maps entram na IA como dado, com saída forçada por ferramenta; IA fora do ar nunca derruba nem decide gasto.

## Consequences

- A seção "Lista fria" convive com os leads sem mexer em `classificacao`, que tem trigger e leis próprias (a lei do ERP e a da Relação, ver `lead-classificacao.ts`). Por isso é uma coluna, não uma quarta classificação.
- Como a coluna só é lida com a flag ligada, **o merge do front não depende da migration** para as demais orgs. Na TorqueCRM a flag é ligada pela própria migration, então o front só vê a aba depois do banco.
- Contato frio importado ocupa o telefone normalizado na org (`idx_leads_org_phone_unique`). Se o mesmo número escrever no WhatsApp depois, cai no lead da seção. É o comportamento certo (a pessoa responde), mas a tela do chat vai mostrar um lead sem funil.
- O gatilho `step_import_lead` (onboarding) marca "importou lead" também na importação da Lista fria. Não foi alterado: é ruído de onboarding, não de envio.
- **LGPD e termos de uso.** Raspar o Maps contraria os termos do Google; a lista de seguidores do Instagram só sai com login, e a raspagem automatizada contraria os da Meta. O risco do Maps é nosso (decisão 1). Contato de pessoa física exige finalidade, base legal (legítimo interesse), opt-out e registro da origem; a origem fica gravada no lead (`origin`, `notes`, `lista_fria_busca_id`). Disparo a partir da lista está fora do escopo por isso, e por reputação de chip.

## Fora desta entrega

- **Instagram em produção:** o adaptador (Apify) está escrito e testado contra o contrato documentado, mas falta uma execução real com `APIFY_TOKEN` (`validar-contra-apify.ts`). Sem o token, o worker fecha a busca como `instagram_indisponivel` e devolve a reserva. Custo por contato válido ainda não medido: o Actor cobra por seguidor processado.
- Checar se o número tem WhatsApp (exige instância conectada da própria org). "Verificado" hoje é formato válido / MX.
- Cobertura por grade de coordenadas; hoje a cidade é coberta por sinônimos e bairros que a IA sugere.
- A IA do worker só foi exercitada com `fetch` falso, não contra a API da Anthropic.
- Compra de créditos e cobrança.
- Levar um contato da Lista fria para um funil (ação manual). Hoje ele só sai da seção se a marca for retirada pelo time.
