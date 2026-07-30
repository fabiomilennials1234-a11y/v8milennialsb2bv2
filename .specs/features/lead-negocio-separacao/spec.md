# Separação Lead ↔ Negócio — plano e decisões

**Status:** fatia 1 entregue · fatia 2 em preparação · **nada aplicado em produção**
**Nosso escopo:** tela de Leads · migração dos cards para negócios · a separação em si
**Fora do nosso escopo:** o redesenho da aba de Funis → outro dev, briefing em `.specs/features/funis-redesign/spec.md`

Documento de produto. O detalhe de execução já existe e **não se repete aqui**:

| Onde | O quê |
|---|---|
| `Obsidian/…/08 — Backlog/em-progresso/lead-negocio-separacao-fluxo-e2e.md` | O fluxo ponta a ponta e as decisões D1–D8 já respondidas pelo CTO |
| `Obsidian/…/08 — Backlog/em-progresso/lead-negocio-migrations-db.md` | O plano de banco M1–M6, medido em produção |
| PR #1315 (merged) | A fatia 1, o que ela faz e o que deixou de fora |
| `.specs/project/runbook-validacao-local.md` | Como validar em ambiente descartável |

---

## 1. O problema, em uma frase

**Hoje o lead *é* o card do funil.** Uma pessoa, uma linha, uma etapa, um funil por vez.

Três consequências que custam dinheiro:

1. **Recompra é impossível.** Uma trava no banco proíbe o mesmo cliente ter dois cards
   no mesmo funil. O cliente que comprou em março e volta em setembro não tem onde ser
   registrado — o vendedor reaproveita o card antigo e apaga a história do primeiro
   negócio, ou cria um lead duplicado.
2. **A métrica mistura curioso com proposta de quarenta mil.** Como todo lead vira card
   automaticamente, "negócios no funil" e "gente que chegou" são o mesmo número. Não dá
   para responder quanto vale o pipeline sem contar quem só perguntou o preço.
3. **A pessoa não tem casa.** Nome, telefone e histórico vivem espalhados entre funil,
   chat e a aba de Leads, e divergem entre as três telas.

## 2. O alvo

**O lead *tem* negócios.** A pessoa mora na aba Leads e nunca tem etapa. Cada venda é um
Negócio, e é o Negócio que anda pelo funil.

| Conceito | Nasce por | Quantos | Tem etapa? |
|---|---|---|---|
| **Lead** — a pessoa ou empresa | entrada automática (anúncio, site, planilha, integração) | 1 por pessoa | nunca |
| **Negócio** — a venda | **clique do vendedor**, herdando os dados do lead | vários por pessoa | é a etapa |

A estrutura visual do funil **não muda**: mesmas etapas, mesmo quadro, mesmas regras.
Muda só *o que é o card*.

## 3. Onde estamos

### Já entregue — fatia 1 (interface, banco intocado)

- **O card do funil já é tratado como o negócio.** Clicar nele abre a ficha do negócio,
  não a da pessoa.
- **A ficha da pessoa passou a abrir num lugar só do aplicativo.** Sete telas que antes
  montavam a própria cópia agora levam para a aba Leads.
- **A aba Leads ganhou a coluna Negócios** — valor, etapa e estado de cada negócio da
  pessoa.
- **"Novo negócio" virou a única porta de criação** na interface.
- Um furo de segurança foi encontrado no próprio trabalho e fechado antes de subir: era
  possível abrir negócio no nome de um vendedor de outra empresa.

### Pronto e nunca aceso

A estrutura de dados dos negócios **já existe em produção há meses e está vazia**: zero
negócios, zero cards ligados a negócio. Alguém desenhou o modelo, publicou a estrutura e
nunca acendeu. Não precisamos criar — precisamos corrigir, destravar e povoar.

### O que falta

| | Trabalho | Depende de |
|---|---|---|
| **T1** | Terminar a tela de Leads | nada |
| **T2** | Destravar "vários negócios por cliente" | — |
| **T3** | Corrigir as permissões da tabela de negócios e apagar a duplicidade de posição | decisão sobre `/negocios` |
| **T4** | Ligar o modelo novo só na empresa piloto | auditoria das automações n8n |
| **T5** | **Migrar os ~36,5 mil cards existentes para negócios** | T2, T3, T4 + decisão do corte |
| **T6** | Corrigir responsáveis apontando para outra empresa | inventário primeiro |
| **T7** | Desenhar o "Assumir" | decisão de formato |

## 4. As três travas que já custam hoje

Medidas em produção, não supostas.

**A trava da recompra.** **Três** travas no banco, não uma — duas nos funis padrão e uma
nos funis customizados, essa última fácil de esquecer (detalhe em §6, "Correções"). Enquanto
qualquer uma existir, "vários negócios por cliente" não existe. Removê-las é o ponto de
não-retorno da feature.

**A permissão errada na tabela de negócios.** As regras de acesso usam "a primeira
empresa do usuário" e ignoram o perfil master — exatamente o defeito que já causou um
incidente com os comentários do lead. O efeito é duplo: quem trabalha em mais de uma
empresa só enxerga a primeira, e o master não consegue escrever onde precisa. Precisa ser
corrigido antes de qualquer negócio existir.

**Responsáveis de outra empresa.** 1.091 registros de uma cliente apontam para um vendedor
de outra, todos criados no mesmo dia de maio — tem cara de importação que reusou
identificador, não de invasão. O sintoma hoje é responsável em branco e métrica por
vendedor contando a menos. Precisa ser limpo **antes** de ligar a validação, senão a
validação passa a recusar edição nesses registros e quebra o uso em produção.

## 5. O risco que exige mais cuidado na migração

Quando os cards virarem negócios, é tentador "limpar" o vínculo do card com a pessoa.

**Não pode.** Dois gatilhos que alimentam a métrica de vendas só rodam quando esse vínculo
existe, e o gatilho da métrica de reunião não avisa: ele simplesmente para de encontrar o
que procurar. Apagar o vínculo faria **a métrica de vendas parar e a de reunião parar em
silêncio** — a pior das duas, porque ninguém percebe.

Regra: o card mantém o vínculo com a pessoa **e** ganha o vínculo com o negócio.

## 6. Decisões — TOMADAS em 2026-07-30

Sessão de grilling com o CTO. Cada uma foi medida em produção antes de ser perguntada;
três delas mudaram de resposta por causa do que a medição mostrou.

| | Decisão | Resposta | O que a medição mostrou |
|---|---|---|---|
| **A** | Corte da migração | **Tudo vira negócio**, faxina vira relatório. Operar **só em branch efêmera** | O critério "nunca conversou" pegaria 14.296 cards (39%), mas esvaziaria orgs reais: Dolce Rosa 918→8, HGE −85%. E a base da Distetica são clientes importados de propósito, sem mensagem só porque o disparo foi pausado |
| **B** | Cal.com | **Ingest nunca cria negócio.** A data já tem casa no lead; o que precisa de decisão é o **lembrete** | A data **não** se perde: `leads.compromisso_date` já existe e já é escrita (252 leads em 10 orgs; `webhook-calcom:324,458`, `lead-webhook:592`, `schedule-meeting.ts:61`), e a aba Leads já edita o campo. O que **depende do card nascer** é o lembrete **D-5/D-3/D-1**, que roda em cima do card de `confirmacao`. Sem card: data guardada, lembrete morto. E a Milennials — org piloto — é a maior usuária do Cal.com (76 de 102 leads) |
| **C** | "Assumir" | **Coluna no lead** + entrar na allow-list do trigger de histórico | O botão **não existe** na UI, ao contrário do que o vault dizia. E `lead_history` já registra mudança de campo (33.242 eventos/90d), então a coluna ganha auditoria de graça |
| **D** | Página `/negocios` | **Aposentar** | 0 de 95 orgs têm a flag — ninguém alcança. Construída sobre a "segunda verdade" que vamos apagar |
| **E** | Piloto Milennials | **Atualizar os workflows n8n antes de acender** | Auditado: 2 workflows mandam `place_in_pipe` explicitamente. Com a flag ligada vira no-op **silencioso** — o webhook segue devolvendo 200 |
| **F** | Funil customizado *(nova, não estava em nenhum plano)* | **Adicionar `deal_id` em `custom_pipe_entries`** | 16.176 cards em 24 orgs numa tabela sem `deal_id`. A Milennials tem 913 — o piloto teria duas verdades dentro de si |

### Correções ao plano que a medição produziu

- **São três cadeados, não dois.** Além dos dois em `pipeline_entries`, existe
  `custom_pipe_entries_pipeline_id_lead_id_key`. Sem dropar o terceiro, a decisão F não
  destrava nada.
- **São ~36,5 mil cards distintos** — não 52.588 e não 39.613. `pipeline_entries` tem
  36.497 linhas (20.322 em funis padrão / 64 orgs + 16.176 em customizados / 24 orgs) e
  **já contém os cards customizados**: cada linha de `custom_pipe_entries` é espelhada em
  `pipeline_entries` com a **mesma chave primária** (gatilho `sync_custom_pipe_to_entries`).
  Medido: 16.177 de 16.177 casam por `id`. Somar as duas tabelas conta o mesmo card duas
  vezes. (Base viva: os números oscilam por unidade entre leituras.)
- **Nenhum card está sem lead.** Zero linhas com `lead_id` nulo — o backfill cobre todos.

### Erratas — o que este documento afirmou de errado (corrigido em 2026-07-30)

Registradas, não apagadas: este repo tem histórico de documentação que mente custando
meses, e correção sem marca faz o próximo redescobrir do zero.

| Era | É | Por que o erro aconteceu |
|---|---|---|
| "`leads` tem zero coluna de reunião: sem card a data seria descartada" | `leads.compromisso_date` existe há muito, tem 252 leads em 10 orgs, é escrita por 3 caminhos de ingest e **editável na aba Leads**. O que morre sem card é o **lembrete D-5/D-3/D-1** | A busca pela coluna procurou só `%meeting%`, `%reuniao%`, `%schedul%`. O nome real é português sem "reunião" |
| "52.588 cards" (e "39.613") | ~36,5 mil distintos | Somou `pipeline_entries` + `custom_pipe_entries` sem saber que a segunda é **espelhada** na primeira com a mesma PK |
| "Duas travas no banco" (§4) | Três | O parágrafo ficou órfão quando a medição achou o terceiro cadeado e só a lista de correções foi atualizada |
| "A regra de edição não valida o destino → dá pra empurrar o negócio pra outra empresa" | **Não dá.** Em policy de `UPDATE`, o PostgreSQL usa o `USING` como `WITH CHECK` quando este é omitido. Medido: **50 das 90** policies de `UPDATE` em `public` omitem — incluindo a de `leads` e a de `pipeline_entries`, que ninguém considera furadas | Confundiu "ausência de cláusula" com "ausência de checagem". O defeito real de `deals` é outro e continua valendo: `get_user_organization_id()` devolve só a primeira org e ignora master |
| "T3 tem prazo de validade: a janela fecha quando a migração rodar" (§7) | Não há janela. O backfill **não escreve** as duas colunas de posição, que seguem 100% vazias depois dele. A ordem é dependência de **código** (aposentar `/negocios` primeiro), não relógio | Assumiu que "tabela com linhas" = "colunas com dado". Prazo inventado cria pressa numa migration irreversível |
| "O botão Assumir já está na tela sem fazer nada" (§6b) | Não existe: zero ocorrências de `assumir`/`claim` em `src/modules/leads/**` | Veio do vault e nunca foi conferido no código. Muda o tamanho do trabalho: não é ligar fio, é desenhar a interação |
| "Uma proposta marcada como vendida vira cliente de carteira — isso já está certo na estrutura" (§6c, item 3) | **Não vira.** `handle_proposta_vendida` tem **zero gatilhos** e **zero chamadores** (medido em prod e na branch de QA, 2026-07-30). As 738 linhas de `upsell_clients` (12 orgs) vêm do sync de ERP. Venda no funil → carteira é **feature nova**, fatia 3, com custo próprio | A correção foi escrita no fluxo E2E em 2026-07-30 e **não foi propagada para cá**. Corrigir a mentira num arquivo não a mata nos outros; era preciso varrer os três |

### Achado lateral, fora desta feature

O `x-webhook-key` dos workflows da Milennials é `Milennials123456`. Quem adivinhar injeta
lead na organização. Não tocado; merece tarefa própria.

## 6b. Decisões que precisavam de você (histórico)

### D-A · Qual é o corte da migração?
Você já decidiu transformar os cards atuais em negócios e mover os leads reais para a aba
de Leads. Falta o critério: **o que é "lead real"**. Um card parado na primeira etapa de
qualificação, que nunca respondeu, vira negócio ou volta a ser só uma pessoa na lista?
- **Tudo vira negócio** — nada some da tela de ninguém, migração reversível, mas nasce com
  ~39 mil negócios dos quais muitos nunca foram venda.
- **Só o que passou da qualificação** — métrica nasce limpa, mas alguns clientes veem o
  funil de qualificação esvaziar no dia seguinte.
- **Tudo agora, faxina depois** como relatório, não como migração.

### D-B · O que acontece com reunião agendada pelo Cal.com?
Hoje ela entra direto no funil de confirmação, e os lembretes de 5, 3 e 1 dia antes
dependem desse card existir. Com "negócio nasce só de clique", a reunião marcada não
geraria card nenhum e **os lembretes morrem**.
- Abrir exceção explícita para essa origem · ou aceitar que alguém precise clicar.

### D-C · Qual é o formato do "Assumir"?
~~O botão já está na tela **sem fazer nada**.~~ *(Falso — medido em 2026-07-30: não existe
nenhum "Assumir" em `src/modules/leads/**`. Não é botão de mentira; é botão que não nasceu.
Decidido na decisão C: coluna no lead.)*
- **Marca simples no lead** — rápido, sem histórico de quem assumiu quando.
- **Registro próprio** — auditável, permite fila e devolução do lead.
Comissão hoje segue o negócio, não o lead — então o "Assumir" é sobre atendimento, não
sobre pagamento.

### D-D · O que acontece com a página `/negocios` que já existe?
Existe, está escondida atrás de uma chave que ninguém tem, e **quebra** com a correção da
duplicidade de posição (ela se apoia justamente no dado que vamos apagar).
- Reescrever para a estrutura nova · aposentar · deixar quebrada atrás da chave desligada.

### D-E · Quando acendemos a Milennials?
Antes de acender, as automações n8n da empresa precisam ser auditadas: são mais de vinte
fluxos, um por cliente, e alguns colocam o lead no funil por um caminho que **deixa de
funcionar** na empresa com o modelo novo. Sem auditar, o lead entra e não aparece em funil
nenhum.

## 6c. O que ainda falta ou não está claro

Levantado em 2026-07-30, depois de fechar A–F. Separado pelo tipo de pendência, porque
cada tipo se resolve de um jeito diferente.

### Falta DECIDIR — ninguém respondeu ainda

**1. O negócio tem nome?**
Na fatia 1 o modal de "Novo negócio" saiu **sem campo de título**, de propósito: o campo
existia no banco mas era da fatia 2. Agora é a fatia 2. Então: o vendedor digita um nome
("Reposição trimestral"), ou o sistema deriva sozinho? E na migração, os ~36,5 mil herdariam
o nome do funil — o que produziria dezenas de milhares de negócios todos chamados
"Qualificação". Decidir antes de migrar, porque renomear depois é trabalho manual do
cliente.

**2. Quem pode abrir um negócio?**
Hoje qualquer pessoa que enxerga o funil arrasta card. "Novo negócio" é permissão de
todo mundo, só de administrador, ou depende de ter assumido o lead? A separação cria um
lugar novo onde essa pergunta importa, e ela nunca foi feita.

**3. Como o negócio "fecha", agora que são vários por cliente?**
🔴 **Antes de decidir, saiba: marcar vendido NÃO cria cliente de carteira hoje.**
`handle_proposta_vendida` existe no schema, mas tem **zero gatilhos ligados** e **nenhuma
outra função do schema a chama** — medido em produção *e* na branch de QA em 2026-07-30. As
**738 linhas** de `upsell_clients` (12 organizações) vêm do **sync de ERP**
(`_shared/erp/sync/client-store.ts`, `omie-sync-clientes`, `tinyerp-sync-contacts`,
`erp-order-webhook`). Carteira, hoje, é espelho de ERP — não subproduto do funil.

Não existe, portanto, fluxo a preservar. A pergunta tem duas metades e as duas custam:

- **Se "negócio ganho → cliente de carteira" deve passar a existir, é feature NOVA da
  fatia 3**, com custo próprio de construção. Não é "não mexer que já está certo".
- **Independente disso**, ninguém definiu o que a tela mostra quando um negócio do cliente
  está ganho e outro está em negociação.

*(Corrigido em 2026-07-30: este item afirmava "hoje uma proposta marcada como vendida vira
cliente de carteira […] isso já está certo na estrutura". Era falso. A correção já tinha
sido feita no fluxo E2E e **sobreviveu intacta aqui**, no documento que o CTO lê para
decidir — decisão tomada sobre premissa falsa é pior que documento desatualizado.)*

**4. Até onde vai a nossa fatia na Carteira?**
Ficou decidido que "carteira é um estado do lead, não um módulo à parte" e que um
documento novo substitui o anterior. Mas isso está meio construído há meses (o endereço
antigo continua no ar, o novo nunca existiu). Precisa ficar explícito se terminamos esse
serviço agora ou se ele fica para depois — hoje está no limbo.

O item 3 muda o tamanho desta pergunta. Como a carteira **não** nasce da venda no funil,
são **três** perguntas separadas, e nenhuma delas está orçada:

1. terminar o serviço que o ADR-0005 começou (a rota `/carteira` que nunca existiu);
2. absorver a Carteira como faceta do lead — trabalho de modelo e de tela sobre um dado
   que o ERP já traz;
3. **ligar venda no funil → cliente de carteira**, que hoje não existe (item 3).

Tratar as três como uma só é o caminho para a terceira meia-implementação.

### Falta ESPECIFICAR — decidido no conceito, sem desenho

**5. A tela de Leads não tem projeto visual.**
É a maior peça do nosso escopo e a menos definida. Sabemos o que sai ("Combustível") e o
que entra (negócios da pessoa, reunião marcada, "Assumir"). Não sabemos: quais colunas,
qual a ordenação padrão, o que o vendedor vê que o administrador não vê, e como isso cabe
no celular. Sem isso, cada tela nasce do gosto de quem estiver codando.

**6. O que o usuário vê no dia da virada.**
Quando a empresa piloto for ligada, leads novos param de virar card — mas os cards de
ontem continuam lá. Por um tempo, dois comportamentos convivem no mesmo funil. Ninguém
escreveu o que a tela diz nesse período, nem se diz algo.

### Falta VERIFICAR — sabemos que precisa, não foi feito

**7. Testar com os três tipos de acesso, separadamente.**
Administrador, membro e master. A correção de permissões da tabela de negócios é
exatamente sobre o perfil master enxergar o que não enxergava — e nunca foi exercitada
com gente logada de verdade.

**8. Varrer os 6 fluxos de automação restantes.**
Dos oito da empresa piloto, dois foram auditados e comprovadamente quebram. Os outros seis
não foram abertos.

**9. Combinar a fronteira com o outro desenvolvedor.**
Ele está redesenhando a tela de funis; nós estamos mudando *o que o card é*. Os dois
trabalhos tocam as mesmas quatro páginas. Não há acordo escrito sobre quem mexe em quê.

### Risco conhecido sem plano

**10. Voltar atrás deixa de ser limpo assim que alguém usar.**
Cada mudança de banco tem seu desfazer escrito, e a migração é reversível **enquanto
ninguém criou negócio novo**. Depois que a empresa piloto começar a usar, desfazer passa a
significar perder trabalho de gente. Não existe plano para esse cenário — só para o
anterior.

## 7. Ordem proposta

```
T1 (tela de Leads)  ─── independente, entrega valor sozinha
T2 ──┐
T3 ──┼── T5 (migração dos ~36,5 mil)
T4 ──┘
T6 ── inventário → limpeza → validação
T7 ── decisão de formato → fecha T1
```

**T3 não tem prazo — tem dependência.** Apagar a duplicidade de posição é seguro hoje
porque a tabela está vazia, e **continua seguro depois da migração**: o backfill não
escreve nas duas colunas de posição, então elas seguem 100% vazias mesmo com dezenas de
milhares de negócios criados. O que a ordem precisa respeitar não é relógio, é código —
a página `/negocios`, que se apoia nessas colunas, precisa estar aposentada antes
(decisão D). *(Corrigido em 2026-07-30: a versão anterior dizia "essa janela fecha no
instante em que a migração rodar" — falso, e criava urgência inventada.)*

## 8. Regras que valem para todo o trabalho

- Nada em produção sem ordem sua. Validação é sempre em ambiente descartável.
- O modelo novo entra **por empresa**, com piloto na Milennials. As outras 63 seguem
  idênticas até serem ligadas uma a uma.
- Nunca apagar o vínculo do card com a pessoa (§5).
- Toda alteração de banco passa pela guarda mecânica — escrita nesta sessão, era
  pré-requisito declarado e não existia.
