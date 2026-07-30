# Redesenho da aba de Funis — plano e decisões

**Status:** em andamento · **Início:** 2026-07-29 · **Origem:** protótipo `.specs/mockups/funis-redesign/`
**Referências:** PR #1313 (protótipo, merged) · PR #1316 (primeira fatia, merged em `develop`)

Documento de produto. Fala do que o vendedor vê e do que o negócio ganha. O detalhe de
implementação vive no PR #1316, no `LEIA-ME.md` do protótipo e nos comentários do código.

---

## 1. O problema

O Torque tem quatro funis: Qualificação, Confirmação, Propostas e os funis customizados
que cada cliente cria. Eles nasceram em momentos diferentes e cresceram separados.

Na prática, isso virou **quatro produtos dentro do mesmo produto**. Cada funil tinha o
cabeçalho num arranjo diferente, os filtros em lugares diferentes, e capacidades
diferentes — coisas que existem num funil simplesmente não existem no outro. Um vendedor
que trabalha em dois funis reaprende a tela toda vez que troca.

O custo não é estético. É que o operador não confia no que vê: quando o mesmo conceito
aparece de duas formas, ele para de acreditar nos números.

## 2. Quem sente

- **Vendedor** — trabalha o dia inteiro numa dessas telas. Perde tempo procurando o
  filtro que no outro funil estava em outro canto.
- **Gestor** — quer olhar "quem está encalhado" e "quanto tem em aberto" sem exportar
  planilha. Hoje só consegue no funil de Propostas, e mesmo lá o número erra.
- **Cliente novo** — monta um funil customizado e descobre que ele é um funil de segunda
  classe: não tem as visões, não guarda valor, não aparece em relatório.

## 3. O que já é verdade hoje

Entregue e mergeado em `develop`:

- **A faixa de controles é a mesma nos quatro funis.** Busca, filtros, ações e o botão
  principal ficam sempre no mesmo lugar.
- **O alternador de visão saiu da faixa e foi para dentro do menu de Visualizações.**
  Cabeçalho numa linha só, e a visão Lista — a única que o celular usa — deixou de ficar
  inalcançável no desktop.
- **"Criados no período" virou um filtro de verdade**, ao lado dos outros, em vez de ficar
  escondido num menu de três pontinhos.
- **"Parado há" existe** — faixas de dias na etapa (até 2, 3–7, 8–14, 15–30, mais de 30).
  Já funciona no funil customizado. Nos outros três está pronto e **desligado**, esperando
  uma janela para mexer no banco.
- **A coluna do Kanban ordena** por valor, calor, tempo parado ou nome — e **avisa** quando
  a coluna tem mais gente do que a página carregada, em vez de ordenar 20 de 100 calada.

## 4. O que a tela ainda não faz

| Lacuna | O que o operador sente |
|---|---|
| **Lista** existe num funil só, e não ordena nem soma | Trocar de funil tira uma visão inteira do vendedor. E a lista que existe não responde "quem é o maior negócio aqui" |
| **Analytics** responde outra pergunta | Hoje mostra "quem entrou e progrediu". O gestor quer "o que está parado agora, quanto vale, e quem está sem dono" |
| **Funil customizado** não tem alternador, nem Lista, nem Analytics | O funil que o cliente cria é visivelmente inferior ao que vem de fábrica |
| **Funil customizado para de mostrar registros acima de mil** | Silenciosamente. O cliente grande não vê a carteira inteira e não é avisado disso |
| **Celular e desktop mostram listas diferentes** | Duas telas, dois comportamentos, mesmo nome |
| **Capacidades ainda são por funil** | Valor, orçamento, reunião e motivo de perda só existem em alguns funis. É o pedido original do protótipo e continua aberto |

## 5. Decisões já tomadas

Fechadas. Não reabrir sem motivo novo.

| # | Decisão | Por quê |
|---|---|---|
| 1 | **Paridade nos quatro funis**, não só em Qualificação | Meia paridade mantém o problema: o vendedor continua reaprendendo ao trocar |
| 2 | **Somar no servidor, não na tela** | A soma de hoje conta só a página carregada e erra acima de 20 registros. Repetir isso em quatro funis multiplicaria o erro |
| 3 | **Analytics novo entra ao lado do atual, não no lugar** | São perguntas diferentes. Trocar uma pela outra apagaria número que gestor já usa |
| 4 | **Nivelar capacidade entre funis exige decisão escrita antes de código** | O precedente interno levou sete semanas para juntar dois funis e deixou onze pontas soltas. Aqui são seis |
| 5 | **Nada em produção nesta rodada** | Restrição do CTO. Vale para banco e para publicação de front |

## 6. Decisões ainda em aberto

Cada uma muda o que será construído. Nenhuma é técnica.

### D1 · "Mover a coluna inteira" — construir, e com qual trava?
O protótipo tem o botão. Ele foi deixado de fora de propósito: mover todo mundo de uma
etapa dispara mensagem em massa, e a empresa já teve número de WhatsApp banido três vezes
por isso. Além disso, hoje ele só alcançaria os registros já carregados na tela — o
operador acharia que moveu a coluna e teria movido um pedaço.
**Opções:** não construir · construir com confirmação e teto · construir sem disparo nenhum.

### D2 · O botão de Disparo continua no cabeçalho?
Ele existe em dois lugares: no cabeçalho do funil e na barra que aparece quando você
seleciona registros. O segundo é onde "disparar para estes" faz sentido. O primeiro é
herança.
**Opções:** manter os dois · tirar do cabeçalho.

### D3 · A soma por coluna volta ao Kanban?
Ela existe hoje só em Propostas e está errada acima de 20 registros. O protótipo tirou ela
do quadro e botou onde dá para acertar: rodapé da Lista, Analytics e barra de seleção.
**Opções:** consertar e levar aos quatro · consertar só onde já existe · tirar de vez.

### D4 · Funil customizado passa a carregar por página?
Hoje ele carrega tudo de uma vez e por isso perde o que passa de mil. Paginar conserta o
buraco e alinha com os outros funis, mas muda o comportamento para quem já usa: a rolagem
passa a carregar aos poucos.
**Opções:** paginar · manter e só avisar quando truncar.

### D5 · Quais são os cinco números do Analytics?
O protótipo propõe: negócios, valor em aberto, ticket médio, parados há 8+ dias, sem
responsável. "Valor em aberto" precisa de definição de negócio — hoje valor só existe em
alguns funis, então o número pode nascer zerado onde o cliente não usa valor.
**Precisa de:** confirmação dos cinco, e o que mostrar quando o funil não tem valor.

### D6 · Celular e desktop passam a ter a mesma lista?
Convergir dá coerência e uma manutenção só. Custa mexer numa tela que hoje funciona.
**Opções:** convergir · manter as duas.

### D7 · Quando abre a janela de produção?
"Parado há" está pronto e testado, desligado, esperando. Enquanto não abrir, o gestor
continua sem conseguir perguntar "quem está encalhado" nos três funis principais.

### D8 · A grande decisão — nivelar capacidade entre funis
É o pedido original do protótipo: que valor, orçamento, reunião, motivo de perda e
compromisso deixem de ser privilégio de alguns funis. Cinco travas reais de banco
impedem isso hoje, e uma delas tem efeito comercial direto: **receita lançada fora do
funil de Propostas não aparece em nenhum relatório**. Ligar valor em outros funis sem
resolver isso produz "vendi quarenta mil e o painel mostra zero".
**Decisão pedida:** escrever o documento de decisão antes de qualquer código — já
acordado — e nele escolher entre remendar a estrutura atual (barato, dobra a manutenção)
ou unificá-la (caro, resolve de vez).

## 7. As fatias

Ordem por valor entregue, não por conveniência técnica.

| | Fatia | O que o operador ganha | Depende de |
|---|---|---|---|
| **F1** | "Parado há" nos funis principais | Consegue perguntar "quem está encalhado" em qualquer funil | Janela de produção (D7) |
| **F2** | Lista completa nos quatro funis | Ordena por qualquer coluna, soma no rodapé, seleciona em massa | D3 |
| **F3** | Analytics do que está parado agora | Cinco números e quebra por origem e por responsável, respeitando os filtros | D5 |
| **F4** | Funil customizado entra na paridade | Deixa de ser funil de segunda classe, e para de esconder registro | D4 |
| **F5** | Coerência no celular e limpeza | Mesma tela no celular e no desktop | D6 |
| **Fase 2** | Nivelar capacidade entre funis | O pedido original do protótipo | D8 |

F2 a F5 não dependem de janela de produção para serem construídos e revisados. F1 já está
construído e validado; falta só a janela.

## 8. Riscos

| Risco | Efeito | Como está tratado |
|---|---|---|
| Número que mente | Operador lê "ninguém parado" como fato sobre a carteira dele | Funcionalidade fica **escondida** enquanto não puder dar resposta certa. Já implementado assim |
| Soma parcial | Gestor decide com base em soma de 20 de 100 | Decisão 2: somar no servidor. Onde não dá, avisar na tela |
| Disparo em massa | Número de WhatsApp banido — já aconteceu três vezes | "Mover coluna inteira" fora do escopo até D1 |
| Registro escondido | Cliente grande não vê a carteira inteira | F4 |
| Feature grande sem decisão escrita | Sete semanas e onze pontas soltas, como no precedente | Decisão 4: documento antes de código |

## 9. Fora de escopo

- Mover a coluna inteira (até D1)
- Propagar a soma por coluna como está hoje aos demais funis
- Reescrever a ficha do lead — ela já é a do sistema, e continua sendo
- Qualquer publicação em produção nesta rodada
