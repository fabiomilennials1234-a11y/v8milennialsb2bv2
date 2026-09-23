# Preços de mercado (CRM B2B) e custo de insumo por organização

**Data da pesquisa / data de acesso de todas as URLs**: 2026-08-26
**Contexto**: levantamento de fato para decisão de precificação do Torque CRM. **Não contém recomendação de preço.**
**Regra de método**: só entra número que veio da página oficial do próprio fornecedor (página de preços, doc oficial, rate card publicado pelo fornecedor). Blog, comparador, cupom e agregador **não** valem — o que só existe nessas fontes está na seção `NÃO CONFIRMADO EM FONTE PRIMÁRIA`, no fim, com a fonte secundária nomeada. Nenhuma lacuna foi preenchida por estimativa.
**Nota de captura**: páginas com renderização JS (Kommo, Pipedrive, RD Station, Ploomes, Agendor, DataCrazy, HubSpot BR, uazapi, NotificaMe) foram lidas com browser real e o texto extraído do DOM renderizado. As tarifas da Meta vieram do CSV oficial linkado na doc de desenvolvedores.

---

## 1. Resumo — o que a pesquisa decide (15 linhas)

1. **O corte do self-serve não é um preço, é um formato de plano.** Quem vende por assento corta cedo; quem vende por conta (flat) não corta.
2. **DataCrazy não corta em lugar nenhum**: os quatro tiers, inclusive o Business de **R$ 2.997/mês**, levam ao mesmo `crm.datacrazy.io/register`. É o teto de self-serve mais alto da amostra brasileira.
3. **Agendor corta em R$ 156/usuário/mês com mínimo de 10 usuários** — ou seja, self-serve até ~R$ 1.560/mês; acima disso, "Falar com Vendas".
4. **RD Station corta acima do Pro (R$ 131/usuário/mês)**: o Advanced é "Preço sob consulta", mínimo 4 usuários.
5. **Kommo corta acima do Pro (R$ 232/usuário/mês, ciclo de 6 meses)**: o Empresarial é "Sob medida".
6. **HubSpot corta em US$ 150/assento/mês**: Free, Starter e Professional têm "Comprar agora"; Enterprise só "Falar com o Vendas".
7. **Pipedrive não corta**: os quatro planos, até US$ 89/licença/mês, são autocompra. Não existe tier "fale com vendas" na página de preços.
8. **Ploomes é o oposto de todos**: publica **um único preço** (Básico R$ 85/usuário/mês, mínimo 3 usuários = R$ 255/mês) e **todos os 8 módulos** — incluindo Workflow, Analytics e os dois de IA — são "Preço sob Consulta".
9. **Faixa de entrada praticada no Brasil, em BRL, por assento**: R$ 0 (Agendor Gratuito 3 users; RD Free 4 users) → **R$ 59** (Agendor Pro) → **R$ 73** (RD Basic) → **R$ 77** (Kommo Básico, 6 meses) → **R$ 85** (Ploomes Básico).
10. **Faixa de entrada por conta (flat, não por assento)**: **R$ 297/mês** (DataCrazy Starter, 4 membros, 3 conexões, 5 mil leads).
11. **Dois dos sete cobram em dólar mesmo no site brasileiro**: Pipedrive (US$) e HubSpot (o `br.hubspot.com` mostra seletor "USD ($)").
12. **Escada de desconto por ciclo, quando publicada**: Kommo 6/9/12/24 meses (−10% / −16% / −25%); DataCrazy semestral −17% e anual −28%; RD Station anual −10%; Pipedrive anual "até 26%"; HubSpot Starter US$7 anual vs US$20 mensal.
13. **Trial**: Kommo 14 dias sem cartão; Pipedrive 14 dias sem cartão; Agendor 7 dias sem cartão; Ploomes 14 dias; HubSpot Free sem cartão. **Ninguém da amostra pede cartão.**
14. **Plano gratuito permanente existe em 3 dos 7**: Agendor (3 users), RD Station (4 users), HubSpot (2 users). Kommo, Pipedrive, Ploomes e DataCrazy não têm.
15. **Custo de insumo é irrisório perto do ticket**: WhatsApp utility no Brasil custa **R$ 0,0350/mensagem**, marketing **R$ 0,3217**; uma instância Uazapi sai de **R$ 19,00** a **R$ 0,65**/mês conforme o plano; gpt-4.1-mini custa **US$ 0,40 / US$ 1,60** por 1M tokens in/out.

---

## 2. PARTE 1 — Mercado

### 2.1 DataCrazy (datacrazy.io)

Fonte: <https://datacrazy.io/planos/> — acesso 2026-08-26.

| Item | Starter | Essential | Pro | Business |
|---|---|---|---|---|
| Preço mensal | **R$ 297/mês** | **R$ 460/mês** | **R$ 997/mês** | **R$ 2.997/mês** |
| Preço semestral (−17%) | R$ 246,20/mês | R$ 379,83/mês | R$ 822,81/mês | R$ 2.470,11/mês |
| Preço anual (−28%) | R$ 211,75/mês | R$ 330,73/mês | R$ 713,18/mês | R$ 2.124,52/mês |
| Anual à vista | R$ 2.540,97/ano | R$ 3.968,72/ano | R$ 8.558,11/ano | R$ 25.494,22/ano |
| Usuários inclusos | Até 4 membros | Até 15 membros | Até 40 membros | Ilimitados |
| Preço do usuário extra | **não publicado** | **não publicado** | **não publicado** | n/a |
| Conexões de atendimento | **até 3 conexões** (WhatsApp, Instagram e outros) | **até 10** | **até 50** | **ilimitadas** |
| Leads | Até 5 mil | Até 100 mil | Até 500 mil | Ilimitados |
| Pipelines / etapas | Até 5 pipelines, até 8 etapas | Até 20 pipelines, até 15 etapas | Ilimitadas, até 25 etapas | Ilimitadas, até 25 etapas |
| Automações | 8 | 20 | 80 | Ilimitadas |
| Webhooks | 3 | 15 | 80 | Ilimitados |
| Rate limit | 60 req/min (Webhook) | 120 req/min (API/Webhook) | 120 req/min | 120 req/min |
| API / MCP | Sem API | Acesso à API + MCP | API + MCP | API + MCP |
| **IA e limite** | **1M tokens** para uso da Crazy IA | **1M tokens** | **1M tokens** | **1M tokens** |
| Plano gratuito | não publicado na página de planos | — | — | — |
| Trial | ver seção de não-confirmados | — | — | — |

**Corte self-serve**: **não existe.** A escada de desconto é a mesma nos quatro (semestral −17%, anual −28%), e o CTA de cada um dos quatro cards de plano — Starter, Essential, Pro **e Business (R$ 2.997/mês)** — aponta para `https://crm.datacrazy.io/register`. Os únicos CTAs de vendas na página são "AGENDAR DEMONSTRAÇÃO" (cal.com), oferecidos em paralelo, não no lugar da compra.

**Observação de fato**: o teto de 1M tokens de IA é **idêntico nos quatro planos** — a IA não escala com o tier.

---

### 2.2 Kommo (kommo.com)

Fontes: <https://www.kommo.com/br/precos/compare-planos/> (BRL, para onde `kommo.com/pricing/` redireciona em pt-BR) e <https://www.kommo.com/pricing/> (USD) — acesso 2026-08-26.

| Item | Básico | Avançado | Pro | Empresarial |
|---|---|---|---|---|
| **BRL — 6 meses** | **R$ 77**/usuário/mês | **R$ 129** | **R$ 232** | Sob medida |
| BRL — 9 meses | R$ 69 (−10,4%) | R$ 115 (−10,9%) | R$ 206 (−11,2%) | Sob medida |
| BRL — 1 ano | R$ 65 (−15,6%) | R$ 108 (−16,3%) | R$ 194 (−16,4%) | Sob medida |
| BRL — 2 anos | R$ 58 (−24,7%) | R$ 97 (−24,8%) | R$ 174 (−25,0%) | Sob medida |
| USD — 6 meses | US$ 15/usuário/mês | US$ 25 | US$ 45 | Custom |
| Leads ativos | 2.500 por licença | 5.000 por licença | 10.000 por licença | Customizado |
| **Créditos de IA** | **750 créditos/usuário/mês** | **1.250/usuário/mês** | **2.250/usuário/mês** | Customizado |
| Agentes de IA | não inclui | **até 3 agentes** | **até 50 agentes** | Customizado |
| Canais (WhatsApp/Instagram) | 1 número WhatsApp + 1 conta Instagram; +1 por usuário adicional | 3 números WhatsApp + 3 contas Instagram | **Canais ilimitados** | Ilimitados |
| Automação | não inclui | Automação de funis, transmissão, bots sem código | + reservas, ativação de público, ROI de campanha | + SSO, SLA, backups |
| Limite de funis | **não publicado numericamente** | — | — | — |

- **Ciclos**: "Oferecemos assinaturas de **6, 9, 12 e 24 meses**, com preços por usuário em USD ou BRL, e opção de pagamento em parcelas mensais." Não há plano de 1 mês — o compromisso mínimo é 6 meses.
- **Trial**: "experimente gratuitamente por **14 dias**. Não é necessário informar dados de cartão de crédito."
- **Plano gratuito permanente**: **não existe** na página de preços.
- **Corte self-serve**: **acima do Pro (R$ 232/usuário/mês no ciclo de 6 meses)**. Básico, Avançado e Pro têm preço fechado e "Registre-se"/"Teste grátis"; o **Empresarial** é "Sob medida / Conforme configuração / Como funciona?" — sem preço.

---

### 2.3 Pipedrive (pipedrive.com/pt)

Fontes: <https://www.pipedrive.com/pt/pricing> e <https://support.pipedrive.com/en/article/usage-limits-in-pipedrive> (artigo atualizado em 25/08/2026) — acesso 2026-08-26.

| Item | Lite | Growth | Premium | Ultimate |
|---|---|---|---|---|
| Preço anual (por licença/mês) | **US$ 14** | **US$ 24** | **US$ 49** | **US$ 69** |
| Cobrança anual à vista | US$ 168/licença/ano | US$ 288 | US$ 588 | US$ 828 |
| Preço mensal (por licença/mês) | **US$ 19** | **US$ 34** | **US$ 64** | **US$ 89** |
| Desconto anual calculado | −26,3% | −29,4% | −23,4% | −22,5% |
| Leads + negócios (por conta) | 2.500 × licenças (teto 300.000) | 5.000 × licenças (teto 300.000) | 15.000 × licenças (teto 300.000) | 20.000 × licenças (teto 300.000) |
| Contatos | **sem limite** ("Pipedrive has no usage limits for contacts") | idem | idem | idem |
| Campos personalizados (conta) | 30 | 100 | 300 | 500 |
| **Automações (por conta)** | **N/A** | **50** | **150** | **250** |
| Condições if/else por automação | N/A | 3 | 10 | 20 |
| Sequências (por conta) | N/A | 5 | 25 | 50 |
| Relatórios Insights (por usuário) | 15 | 50 | 250 | 500 |
| **Créditos de enriquecimento de dados** | N/A | N/A | **100 créditos** | **500 créditos** |
| Times / grupos de visibilidade / perfis de permissão | N/A | N/A | 15 / 15 / 15 | 25 / 25 / 25 |
| Tokens de API (conta) | 30.000 × licenças (teto 100M) | 60.000 × licenças | 150.000 × licenças | 210.000 × licenças |
| Limite de funis | **não publicado** | — | — | — |
| Conexões de WhatsApp | **não publicado** (não é canal nativo da tabela de preços) | — | — | — |

- **Moeda**: o site em português exibe **US$**, não BRL. Rodapé: "Nossos preços não incluem o IVA."
- **Desconto do site**: a própria página anuncia "(Economize **até 26%**)" no toggle anual.
- **Trial**: "Teste gratuito de **14 dias. Não é necessário cartão de crédito**", em todos os quatro planos.
- **Plano gratuito permanente**: não existe.
- **Extensões (add-ons, preço "a partir de", por conta)**: LeadBooster US$ 32,50 · Projects US$ 16 · Campaigns US$ 13,33 · Visitantes da web US$ 41 · Smart Docs US$ 32,50.
- **Limites de profundidade de automação** (doc oficial): 10 ações por caminho, 10 delays por caminho (3 no Growth), 90 dias de duração total por caminho, 7 dias máximo em qualquer passo de "wait for condition".
- **Corte self-serve**: **não há.** Os quatro planos são autocompra até US$ 89/licença/mês. A página de preços não apresenta nenhum tier "fale com vendas" nem Enterprise.

---

### 2.4 RD Station CRM (rdstation.com)

Fonte: <https://www.rdstation.com/planos/crm/> — acesso 2026-08-26.

| Item | Free | Basic | Pro | Advanced |
|---|---|---|---|---|
| Preço mensal | **Gratuito** | **R$ 73,00**/usuário | **R$ 131,00**/usuário | **Preço sob consulta** |
| Preço anual (−10%) | — | **R$ 65,70**/mês por usuário | **R$ 117,90**/mês por usuário | sob consulta |
| Mínimo de usuários | máximo de 4 usuários | 1 | **mínimo de 4** | **mínimo de 4** |
| Funis de vendas | **1** | Ilimitado | Ilimitado | Ilimitado |
| Etapas por funil | 5 | 12 | 12 | 12 |
| **Automações** | — | **até 50 automações por modelo** | **até 100 automações** (modelos prontos + personalizadas) | **até 100** + automações personalizadas |
| Envio/recebimento de e-mail | 200/mês | Ilimitado | Ilimitado | Ilimitado |
| Modelos de e-mail | 3 templates | Ilimitado | Ilimitado | Ilimitado |
| Rastreamento de fontes | 50 | Ilimitado | Ilimitado | Ilimitado |
| Motivos de perda | 50 | Ilimitado | Ilimitado | Ilimitado |
| Importação / exportação | 1.000 / 1.000 | 10.000 / 50.000 | 10.000 / 50.000 | 10.000 / 50.000 |
| Armazenamento | 500 MB | 2 GB | 10 GB | 50 GB |
| Perfis de permissão | — | — | 1 perfil | 10 perfis |
| Visões de trabalho | 2 | 6 | 6 | 6 |
| **IA (LYNN)** | Copiloto de IA | Playbook com IA, Insights de relatórios (perguntas fechadas) | Insights (perguntas abertas), Sugestões de tarefas com IA | Priorização Inteligente, Interface Inteligente no WhatsApp |
| **Limite numérico de IA** | **não publicado — nenhum crédito/token/mensagem é declarado em nenhum tier** | | | |
| WhatsApp | WhatsApp nativo; extensão para WhatsApp Web | mensagens personalizadas: **10 por usuário** | **20 por usuário** | **20 por usuário** |
| Conexões de WhatsApp | **não publicado** — o modelo é extensão sobre o WhatsApp Web, não canal multi-número | | | |
| Limite de leads/contatos | **não publicado** (o Free é descrito como "sem limite de tempo nem de contatos") | | | |

- **Moeda**: BRL. A página afirma "Transparência total: Planos cobrados em real, sem taxas escondidas".
- **Corte self-serve**: **acima do Pro (R$ 131/usuário/mês)**. Free tem "Crie sua conta"; **Basic e Pro têm "Compre agora"** (além de um "Fale com vendas" oferecido em paralelo); **Advanced tem apenas "Fale com vendas"** e "Preço sob consulta".

---

### 2.5 HubSpot Sales Hub (br.hubspot.com / hubspot.com)

Fontes: <https://br.hubspot.com/pricing/sales> e <https://www.hubspot.com/pricing/sales> — acesso 2026-08-26.

| Item | Ferramentas gratuitas | Starter | Professional | Enterprise |
|---|---|---|---|---|
| Preço anual (por licença/mês) | **US$ 0** | **US$ 7** | **US$ 90** | **US$ 150** |
| Preço mensal (por licença/mês) | US$ 0 | **US$ 20** | **US$ 100** | não publicado |
| Licenças inclusas | até 2 usuários | modelo Core Seats | modelo Sales Seats | modelo Sales Seats |
| Taxa de onboarding obrigatória | — | — | **US$ 1.500 (única)** | **US$ 3.500 (única)** |
| **Créditos de IA** | — | **500 Créditos HubSpot** | **3.000 Créditos HubSpot** | **5.000 Créditos HubSpot** |
| Preço do crédito extra | **US$ 9,00 por 1.000 créditos** (pagando anualmente) | idem | idem | idem |
| Consumo de crédito (exemplos oficiais) | Customer Agent 50 créditos/conversa resolvida · Data Agent 10 créditos/execução · Prospecting Agent 100 créditos/recomendação | | | |
| **Automação (workflows)** | — | dispara tarefas e notificações em mudança de fase | **até 300 workflows** | **até 1.000 workflows** |
| **Pipelines de negócios** | **1** | **2** | **15** | **100** |
| Painéis de relatórios | 10 painéis, 50 relatórios/painel | 30 painéis | 75 painéis | 100 painéis |
| Relatórios personalizados | — | — | até 100 | até 500 |
| Minutos de chamada | — | 500 min | 3.000 min | 12.000 min |
| Números de telefone HubSpot | — | 1 | até 3 | até 5 |
| Transcrição de chamadas | — | — | 750 h/conta/mês | 1.500 h/conta/mês |
| Sequências | — | — | 5.000/conta, até 500 e-mails/usuário/dia | 5.000/conta, até 1.000 e-mails/usuário/dia |
| Pontuação de leads | — | — | até 5 pontuações | até 10 |
| Snippets / modelos de e-mail | 3 / 3 | 5.000 / 10.000 | 5.000 / 10.000 | 5.000 / 10.000 |
| Links de reunião | 1 (com marca HubSpot) | 1.000 | 1.000 | 1.000 |
| Limite de contatos | **não publicado na página de Sales Hub** | | | |
| Conexões de WhatsApp | **não publicado** (a tabela cobre chat, e-mail e Facebook Messenger) | | | |

- **Moeda no site brasileiro**: o `br.hubspot.com` exibe seletor **"USD ($)"** e todos os valores em US$. Não há tabela em BRL.
- **Trial / gratuito**: "US$ 0/mês — Gratuito para até 2 usuários. **Sem necessidade de cartão de crédito.**"
- **Corte self-serve**: **em US$ 150/assento/mês.** Free = "Comece gratuitamente"; **Starter = "Comprar agora"**; **Professional = "Comprar agora"** (com "Falar com o Vendas" ao lado); **Enterprise = apenas "Falar com o Vendas"**.

---

### 2.6 Agendor (agendor.com.br)

Fonte: <https://www.agendor.com.br/planos-precos> — acesso 2026-08-26.

| Item | Gratuito | Pro | Performance | Corporativo |
|---|---|---|---|---|
| Preço | **R$ 0** | **R$ 59**/mês por usuário | **R$ 83**/mês por usuário | **R$ 156**/mês por usuário |
| Usuários | Até 3 usuários | Ilimitado | Ilimitado | **Mínimo de 10 usuários** |
| Cadastro de empresas | Até 10.000 | Ilimitado | Ilimitado | Ilimitado |
| Cadastro de pessoas | Até 10.000 | Ilimitado | Ilimitado | Ilimitado |
| Cadastro de negócios | Até 1.500 | Ilimitado | Ilimitado | Ilimitado |
| Armazenamento | 2 GB | Ilimitado | Ilimitado | Ilimitado |
| Funil de vendas | **Até 1 funil** | Múltiplos funis | Múltiplos funis | Múltiplos funis |
| Automações (tarefas / negócios / e-mails) | — | — | **incluído** | incluído |
| Modelos de proposta | — | Até 1 modelo | Até 200 modelos | Até 200 modelos |
| Modelos de e-mail | — | Até 3 modelos | Ilimitados | Ilimitados |
| **IA** | — | — | **Sugestões Inteligentes ✨** e **Telefone Virtual Inteligente ✨ (com ChatGPT)** — cobrado à parte | idem, cobrado à parte |
| **Limite numérico de IA** | **não publicado** | | | |
| **WhatsApp** | Extensão para WhatsApp Web (todos os planos) | **WhatsApp Sync: R$ 49/número/mês** | R$ 49/número/mês | R$ 49/número/mês |
| Perfis de permissão / MFA | — | MFA sim | MFA sim | + controle de acesso por IP |
| Gerente de conta | — | Sob demanda | Sob demanda | Incluso no plano |

- **Ciclos**: "Oferecemos descontos em assinaturas semestrais e anuais" — **o percentual não é publicado**.
- **Trial**: "Ganhe **7 dias** de bônus para testar nossos recursos Pro! — ***Não pedimos cartão de crédito***."
- **Plano gratuito permanente**: **sim**, até 3 usuários.
- **Corte self-serve**: **em R$ 156/usuário/mês com mínimo de 10 usuários** (≈ R$ 1.560/mês). Gratuito, Pro e Performance têm "Criar conta grátis"; **Corporativo tem "Fale com um consultor" / "Falar com Vendas"**.

---

### 2.7 Ploomes (ploomes.com)

Fonte: <https://www.ploomes.com/precos> — acesso 2026-08-26.

| Item | Ploomes Básico | Módulos extras (8) |
|---|---|---|
| Preço | **R$ 85,00/mês por usuário** | **"Preço sob Consulta"** em todos |
| Mínimo de usuários | **Mínimo de 3 usuários** ("mas sem máximo pré-definido") | — |
| Modelo de cobrança do módulo | — | "Valor mensal acrescido ao valor de cada usuário para **todos** os usuários da conta" |
| O que o Básico entrega | Múltiplos funis personalizados · organização de históricos e tarefas · gestão da base de clientes · painéis e relatórios | — |
| Módulos sob consulta | — | Workflow (automação de funis) · Formulários externos · Propostas e documentos · CPQ · Analytics · Produtos do cliente (base instalada) · **Biblioteca com IA** · **Assistente de IA** |
| Limite de leads/contatos/funis | **não publicado** | — |
| **Limite de IA** | **não publicado** | — |
| Conexões de WhatsApp | **não publicado** (WhatsApp aparece apenas como canal de suporte e como serviço "Suporte especial") | — |
| Serviços profissionais (todos sem preço) | Account Manager · Integrações · White Label · Implementação · Acesso à API · Suporte especial | — |
| Formas de pagamento | Boleto, transferência, cartão de crédito, PIX | — |

- **Plano gratuito**: "**Não**, o Ploomes não oferece uma versão gratuita permanente."
- **Trial**: "período de teste gratuito de **14 dias**". Exigência de cartão: **não declarada**.
- **Corte self-serve**: **efetivamente no piso.** Um único preço publicado (R$ 85/usuário/mês, mínimo 3 = **R$ 255/mês**), e todo o resto — inclusive automação e IA — só via "Peça sua demonstração" / "Preço sob Consulta". É o modelo mais fechado dos sete.

---

### 2.8 Tabela-resumo: onde cada um para de vender sozinho

| Fornecedor | Último tier autocompra | Preço desse tier | Primeiro tier "fale com vendas" | Teto self-serve estimado (conta pequena) |
|---|---|---|---|---|
| **DataCrazy** | **Business** | R$ 2.997/mês (flat) | **nenhum** | **R$ 2.997/mês** |
| **Pipedrive** | **Ultimate** | US$ 89/licença/mês (mensal) | **nenhum** | sem teto declarado |
| **HubSpot** | Professional | US$ 90–100/assento/mês | **Enterprise** (US$ 150/assento) | US$ 150/assento |
| **Kommo** | Pro | R$ 232/usuário/mês (6 meses) | **Empresarial** ("Sob medida") | R$ 232/usuário |
| **Agendor** | Performance | R$ 83/usuário/mês | **Corporativo** (R$ 156/usuário, mín. 10) | ~R$ 1.560/mês |
| **RD Station CRM** | Pro | R$ 131/usuário/mês (mín. 4) | **Advanced** ("Preço sob consulta") | R$ 524/mês (4 × 131) |
| **Ploomes** | Básico | R$ 85/usuário/mês (mín. 3) | **todo e qualquer módulo** | R$ 255/mês |

---

## 3. PARTE 2 — Custo de insumo por organização

### 3.1 Uazapi — custo por instância

Fonte: <https://uazapi.dev/> (seção "Preço") — acesso 2026-08-26. `uazapi.com` devolve HTTP 404; o domínio vivo do produto é `uazapi.dev`.

| Plano | Preço | Dispositivos (instâncias) | Custo por dispositivo (declarado pelo próprio site) |
|---|---|---|---|
| (sem nome, "até N dispositivos") | **R$ 38 / mensal** | **2** | **"R$ 19,00 por dispositivo"** |
| **Servidor LITE** | **R$ 138 / mensal** | **até 100** | **"R$ 1,38 por dispositivo"** |
| **Servidor PRO** | **R$ 195 / mensal** | **até 300** | **"R$ 0,65 por dispositivo"** |

Incluso em todos: geração de QR code e conexão pelo próprio sistema, **envio de mensagens ilimitado**, gerenciamento de grupos, webhook, documentação completa.
Trial / reembolso: a página tem um FAQ "Se eu não gostar do serviço, posso pedir meu dinheiro de volta?" — o conteúdo do accordion **não é renderizado no DOM inicial**, então nenhum número foi confirmado.

---

### 3.2 NotificaMe Hub — custo por canal / subconta

Fonte: <https://notificamehub.com.br/> (seção de planos) — acesso 2026-08-26. `notificame.com.br` e `hub.notificame.com.br` são apenas redirects.

| Plano | Preço | Canais inclusos |
|---|---|---|
| **Starter** | **R$ 120/mês** | **1 canal social** à sua escolha (WhatsApp Business API, Instagram, Facebook Messenger, SMS, Telegram, Web Chat, Google Business, Mercado Livre, TikTok, YouTube) |
| **Revenda** (marcado "Popular") | **"Fale conosco"** | **a partir de 10 canais** |
| **Enterprise** | **"Fale conosco"** | **+100 canais** |

Taxas de ativação, pagas **uma única vez**:
- **Ativação de canal API OFICIAL: R$ 150,00**
- **Ativação de canal Mercado Livre / OLX / Magalu / LinkedIn: R$ 50,00**

Trial: **"Testar por 3 dias grátis"** (repetido em todos os CTAs da home).
Política: "não realizamos reembolsos caso a cobrança já tenha sido efetuada."
**Custo por conversa: não publicado.** A assinatura é por canal contratado; a página não expõe nenhuma tarifa por conversa ou por mensagem. Ver seção de não-confirmados.

---

### 3.3 WhatsApp Cloud API (Meta) — tarifa por categoria, BRASIL

Fontes primárias:
- Doc: <https://developers.facebook.com/docs/whatsapp/pricing> e <https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing>
- **Rate card oficial em BRL** (CSV linkado na própria doc, cabeçalho: *"Cost per message in BRL on the WhatsApp Business Platform, effective July 1, 2026"*)
- **Rate card oficial em USD** (mesmo formato)
Acesso 2026-08-26.

**Modelo**: cobrança **por mensagem**, não por conversa, desde 1º de julho de 2025. "You are only charged when a template message is delivered. All non-template messages are free."

Linha `Brazil` do rate card, colunas `Market, Currency, Marketing, Utility, Authentication, Authentication-International, Service`:

| Categoria | BRL por mensagem | USD por mensagem |
|---|---|---|
| **Marketing** | **R$ 0,3217** | US$ 0,0625 |
| **Utility (Utilidade)** | **R$ 0,0350** | US$ 0,0068 |
| **Authentication (Autenticação)** | **R$ 0,0350** | US$ 0,0068 |
| Authentication-International | `n/a` (Brasil não tem tarifa internacional) | `n/a` |
| **Service (Serviço)** | **`n/a` — gratuito** | `n/a` |

**Vigência declarada no arquivo**: *effective July 1, 2026*, no fuso horário da conta do WhatsApp Business.

Regras de gratuidade, da doc oficial:
- **Service é gratuito para todas as empresas** desde 1º de novembro de 2024.
- "**All non-template messages are free**" dentro de uma janela de atendimento aberta.
- "**Utility templates delivered within an open customer service window are free**" — utility dentro da janela de 24h **não é cobrado**.
- Janela de "free entry point": mensagens gratuitas por **72 horas**.

**Níveis de volume (Brasil)**, do rate card de volume tiers em BRL: para **utility**, faixa `0 – 250.000` mensagens/mês = *List rate* R$ 0,0350, desconto **0%**; para **authentication**, faixa `0 – 500.000` = *List rate* R$ 0,0350, desconto **0%**. Nenhuma outra faixa é declarada para o Brasil (as demais colunas vêm `n/a`). Marketing **não tem** níveis de volume.

---

### 3.4 Supabase

Fonte: <https://supabase.com/pricing> — acesso 2026-08-26.

**Plano Pro: US$ 25/mês.** Inclui:

| Recurso | Incluso no Pro | Preço do excedente |
|---|---|---|
| Disco de banco | 8 GB por projeto | **US$ 0,125 por GB** |
| **File storage** | **100 GB** | **US$ 0,0213 por GB** |
| **Egress** | **250 GB** | **US$ 0,09 por GB** |
| **Cached egress** | 250 GB | **US$ 0,03 por GB** |
| MAUs | 100.000 | US$ 0,00325 por MAU |
| Créditos de compute | US$ 10/mês em créditos de compute | — |

---

### 3.5 Google Gemini — preço por 1M tokens

Fonte: <https://ai.google.dev/gemini-api/docs/pricing> (paid tier) — acesso 2026-08-26.

| Modelo | Input / 1M tokens | Output / 1M tokens | Context caching |
|---|---|---|---|
| `gemini-3.7-flash` | US$ 0,75 (até 31/12/2026; US$ 1,50 a partir de 01/01/2027) | US$ 3,75 (US$ 7,50 a partir de 01/01/2027) | US$ 0,075 (US$ 0,15 a partir de 01/01/2027) |
| `gemini-3.6-flash` | US$ 0,75 (US$ 1,50 em 2027) | US$ 3,75 (US$ 7,50 em 2027) | — |
| `gemini-3.5-flash` | US$ 1,50 | US$ 9,00 | US$ 0,15 |
| `gemini-2.5-pro` | US$ 1,25 (prompt ≤200k) / US$ 2,50 (>200k) | US$ 10,00 (≤200k) / US$ 15,00 (>200k) | US$ 0,125 / US$ 0,25 |
| `gemini-2.5-flash` | US$ 0,30 | US$ 2,50 | — |
| `gemini-2.5-flash-lite` | US$ 0,10 | US$ 0,40 | — |
| **`gemini-embedding-001`** (o que o Torque usa, 1536d) | **US$ 0,15** | — (embedding não tem output cobrado) | — |
| `gemini-embedding-2` | US$ 0,20 (texto) / US$ 0,45 (imagem, = US$ 0,00012 por imagem) | — | — |

---

### 3.6 OpenAI — gpt-4.1-mini

Fonte: <https://developers.openai.com/api/docs/pricing> (tier Standard; `platform.openai.com/docs/pricing` redireciona 301 para lá) — acesso 2026-08-26.

| Modelo | Input / 1M | **Cached input / 1M** | Output / 1M |
|---|---|---|---|
| **`gpt-4.1-mini`** | **US$ 0,40** | **US$ 0,10** | **US$ 1,60** |
| `gpt-4.1` | US$ 2,00 | US$ 0,50 | US$ 8,00 |
| `gpt-4o-mini` | US$ 0,15 | US$ 0,075 | US$ 0,60 |

O cache do gpt-4.1-mini custa **25% do input normal** (US$ 0,10 vs US$ 0,40).

---

## 4. NÃO CONFIRMADO EM FONTE PRIMÁRIA

Cada item abaixo foi procurado na página oficial do fornecedor e **não foi encontrado**. Quando existe fonte secundária que sugere um número, ela está nomeada — e o número **não** foi adotado.

### Parte 1 — Mercado

1. **DataCrazy — trial.** A página de planos não menciona trial nem duração. O link de cadastro (`crm.datacrazy.io/register`) aparece no resultado de busca com o título "Cadastre-se agora mesmo no CRM Datacrazy e libere o teste gratuito", mas a duração não é declarada em fonte primária. Fonte secundária que sugere preços diferentes: `descontosecupons.com.br` afirma "Starter R$297, Essential R$460 e Pro R$807" — **o Pro em fonte primária é R$ 997/mês**, ou seja, a fonte secundária está errada. Descartada.
2. **DataCrazy — preço do usuário extra.** Não publicado em nenhum tier. Os planos são por faixa de membros (4 / 15 / 40 / ilimitado), sem preço de assento avulso.
3. **DataCrazy — o que é "1M tokens da Crazy IA"** (por mês? por ciclo? acumula?). A página só diz "1M tokens para uso da Crazy IA" nos quatro planos.
4. **Kommo — limite numérico de funis por plano.** A tabela comparativa da página `/br/precos/compare-planos/` tem a seção "Canais" e "Organize seu fluxo de trabalho" em accordion que não renderiza os valores no DOM.
5. **Kommo — limites de canais por tier em BRL.** Os números por tier (1 WhatsApp + 1 Instagram no Básico com +1 por usuário adicional; 3+3 no Avançado; ilimitado no Pro) vieram da página **em inglês** `kommo.com/pricing/` — que é fonte primária, mas o link "Limites de canais" da página BR abre um tooltip que não expôs o texto. A equivalência entre as duas páginas não foi verificada célula a célula.
6. **Pipedrive — limite de funis (pipelines) por plano.** O artigo oficial de limites (`usage-limits-in-pipedrive`) não lista pipelines.
7. **Pipedrive — créditos de IA.** O Pipedrive **não publica "créditos de IA"**. O que existe no doc oficial é **"Data enrichment credits"** (100 no Premium, 500 no Ultimate) — que é enriquecimento de dados, não IA generativa. Não tratar como equivalente.
8. **Pipedrive — preço em BRL.** O site em português cobra em US$. Fontes secundárias (`stackhorse.com`, `pipecon.com.br`, `affinco.com`) publicam conversões em reais (R$ 80, R$ 222, R$ 336, R$ 450 etc.) com câmbio estimado — **nenhuma é tabela do fornecedor**. Descartadas.
9. **Pipedrive — conexões de WhatsApp.** Não é canal nativo listado na página de preços nem no doc de limites.
10. **RD Station CRM — limite numérico de IA.** Nenhum crédito, token ou cota de mensagens de IA é declarado em qualquer tier; a IA (LYNN) é gateada por funcionalidade, não por consumo.
11. **RD Station CRM — número de conexões de WhatsApp.** O modelo é extensão sobre WhatsApp Web; a única cota numérica publicada é "mensagens personalizadas: 10 por usuário (Basic) / 20 por usuário (Pro e Advanced)".
12. **RD Station CRM — limite de leads/contatos.** Não publicado em nenhum tier.
13. **RD Station CRM — duração do trial.** A página de planos não menciona período de teste (o Free é permanente e faz as vezes disso).
14. **HubSpot — preços em BRL.** O site brasileiro cobra em USD. Fontes secundárias (`salesdorado.com`, `aconcaia.com`, `winningsales.com.br`) publicam valores em € e conversões estimadas em R$ com ressalva de câmbio. Descartadas.
15. **HubSpot — limite de contatos** por tier do Sales Hub. Não aparece na página de preços de Sales.
16. **HubSpot — conexões de WhatsApp.** A tabela cobre chat, e-mail e Facebook Messenger; WhatsApp não é linha da comparação de Sales Hub.
17. **HubSpot — preço mensal do Enterprise.** Só o valor anual (US$ 150/assento/mês) é publicado; o mensal exige contato.
18. **Agendor — percentual de desconto semestral e anual.** A página diz textualmente "Oferecemos descontos em assinaturas semestrais e anuais" e **não publica o percentual**. (Uma leitura automatizada anterior da mesma URL reportou "10% para anual" — esse número **não existe** no texto renderizado da página e foi descartado.)
19. **Agendor — limite numérico de IA.** "Sugestões Inteligentes" e "Telefone Virtual Inteligente (com ChatGPT)" aparecem como "Cobrado à parte", sem preço nem cota publicados.
20. **Agendor — limite de automações.** A comparação marca automações como incluídas/não incluídas por tier, sem número.
21. **Ploomes — preço de qualquer módulo**, incluindo Workflow (automação), Analytics, Biblioteca com IA e Assistente de IA. Todos "Preço sob Consulta".
22. **Ploomes — limites de leads, contatos, funis, automações e IA.** Nenhum número publicado.
23. **Ploomes — conexões de WhatsApp.** Não publicado.
24. **Ploomes — se o trial de 14 dias exige cartão.** Não declarado.

### Parte 2 — Custo de insumo

25. **Uazapi — política de trial e de reembolso.** O FAQ existe na página mas o conteúdo não é renderizado no DOM inicial. Fontes secundárias (`empresa1p.com.br`, `whazap.cloud`, YouTube) falam em "instâncias gratuitas efêmeras que expiram após uma hora" e "menos de R$ 30 por número" — **nenhuma é do fornecedor**. Descartadas.
26. **Uazapi — nome oficial do plano de entrada.** O card de R$ 38 não tem nome no site (só "até N dispositivos"); os outros dois são "Servidor LITE" e "Servidor PRO".
27. **NotificaMe — custo por conversa ou por mensagem.** **Não publicado.** A página só expõe assinatura por canal (Starter R$ 120/mês com 1 canal) e as taxas únicas de ativação. Não há tarifa por conversa em lugar nenhum do site do fornecedor.
28. **NotificaMe — preço dos planos Revenda e Enterprise.** Ambos "Fale conosco".
29. **NotificaMe — preço do canal adicional dentro do Starter.** Não publicado.
30. **NotificaMe — modelo de subconta / white-label e seu custo.** Não aparece na página pública de planos.
31. **Meta — tarifa de "Service" no Brasil em número.** O rate card traz `n/a` na coluna Service para todos os mercados, coerente com a política de gratuidade desde 01/11/2024. Não há um número a citar — a ausência **é** a informação.
32. **Meta — níveis de volume com desconto para o Brasil.** O CSV de volume tiers traz, para Brazil, apenas a faixa base (`0–250.000` utility, `0–500.000` authentication) com **0% de desconto** e `n/a` nas faixas seguintes. Não há evidência primária de faixa com desconto para o Brasil.
33. **Supabase — preço de compute além dos US$ 10 de crédito** (tabela de instâncias). Não capturado nesta rodada; a página de preços tem uma seção de compute separada não lida.
34. **Gemini — preço de batch e de grounding.** Não capturado.
35. **OpenAI — preço de batch e do tier Flex/Priority** para gpt-4.1-mini. Só o tier Standard foi lido.

---

## 5. Índice de fontes primárias (todas acessadas em 2026-08-26)

| # | Fornecedor | URL |
|---|---|---|
| 1 | DataCrazy | https://datacrazy.io/planos/ |
| 2 | Kommo (BRL) | https://www.kommo.com/br/precos/compare-planos/ |
| 3 | Kommo (USD) | https://www.kommo.com/pricing/ |
| 4 | Pipedrive (preços) | https://www.pipedrive.com/pt/pricing |
| 5 | Pipedrive (limites) | https://support.pipedrive.com/en/article/usage-limits-in-pipedrive |
| 6 | RD Station CRM | https://www.rdstation.com/planos/crm/ |
| 7 | HubSpot Sales (BR) | https://br.hubspot.com/pricing/sales |
| 8 | HubSpot Sales (US) | https://www.hubspot.com/pricing/sales |
| 9 | Agendor | https://www.agendor.com.br/planos-precos |
| 10 | Ploomes | https://www.ploomes.com/precos |
| 11 | Uazapi | https://uazapi.dev/ |
| 12 | NotificaMe Hub | https://notificamehub.com.br/ |
| 13 | Meta / WhatsApp (doc) | https://developers.facebook.com/docs/whatsapp/pricing |
| 14 | Meta / WhatsApp (doc BR) | https://developers.facebook.com/documentation/business-messaging/whatsapp/pricing |
| 15 | Meta / WhatsApp (rate card BRL, CSV) | CSV "Cost per message in BRL … effective July 1, 2026", linkado em (13) |
| 16 | Supabase | https://supabase.com/pricing |
| 17 | Google Gemini | https://ai.google.dev/gemini-api/docs/pricing |
| 18 | OpenAI | https://developers.openai.com/api/docs/pricing |
