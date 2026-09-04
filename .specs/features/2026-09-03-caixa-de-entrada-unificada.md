# Caixa de Entrada Unificada — multi-seleção de Instances no chat

> Spec. Escrita em 2026-09-03 a partir de grill com o CTO (7 decisões travadas).
> Vocabulário: `CONTEXT.md`. ADRs relevantes: ADR-0025 (Instance Routing Policy).

---

## Problem Statement

O `/chat` mostra **uma Instance por vez**. O seletor "Caixa de entrada" é single-select, e trocar de caixa recarrega a lista inteira.

Para uma Organization com mais de uma Instance, isso quer dizer que a pessoa **não tem uma visão do que está chegando**. Ela precisa lembrar de trocar de caixa para descobrir se alguém escreveu no outro número, e escolher a caixa errada é indistinguível de "ninguém falou comigo".

Medido em produção (2026-09-03):

| Instances por Organization | Organizations |
|---|---|
| 1 | 42 |
| 2 a 4 | 18 |
| 6 | 1 |
| 57 | 1 |

O caso que originou o pedido é a **Chique Distribuidora**: um Chip ("Carol", uazapi) e um Official Channel ("Chiquê", notificame). A pessoa que atende precisa alternar entre os dois o dia inteiro. O Official Channel dela recebeu 119 Messages em 90 dias, distribuídas em 22 Conversas do Lead — volume baixo o bastante para ser esquecido, e alto o bastante para ser dinheiro perdido quando é.

O que a pessoa **não** consegue fazer hoje:

- ver, numa lista só, tudo que chegou em todas as caixas que ela pode ler;
- responder sem antes trocar a caixa selecionada no topo;
- saber que um cliente escreveu em duas caixas diferentes.

## Solution

O seletor "Caixa de entrada" passa a ser **multi-seleção**. A pessoa marca quantas caixas quiser, e a lista mistura as Conversas do Lead de todas elas, ordenadas por recência. Responder usa a caixa da linha aberta, sem troca de contexto.

**Uma Conversa do Lead por caixa.** O mesmo telefone falando com duas Instances gera **duas linhas**, cada uma marcada com sua caixa. Isso não é um efeito colateral: é o modelo. Duas Instances são dois números de telefone, e a Alamaster separou 57 deles por departamento de propósito — o cliente que pede orçamento no comercial e abre chamado na técnica está tendo duas conversas. Quando as duas linhas do mesmo contato aparecem juntas, um fio as liga visualmente, e a linha diz que existe conversa viva em outra caixa.

Isso já é o que o glossário define: **Conversa do Lead** é "o par (Lead ↔ inbox) que de fato carrega histórico", e um Lead pode manter várias ao mesmo tempo. A spec torna a tela consistente com o modelo que já existia.

**A tela lembra.** Cada pessoa tem sua seleção persistida. Na primeira visita após o deploy ninguém acorda com a tela diferente: a seleção nasce com a caixa que a pessoa já usava.

## User Stories

1. Como vendedora da Chique, quero marcar o Chip e o Official Channel ao mesmo tempo, para acompanhar tudo que chega sem trocar de caixa.
2. Como vendedora, quero que a lista misture as caixas por recência, para tratar primeiro o que chegou por último, independente do número.
3. Como vendedora, quero ver em cada linha de qual caixa ela veio, para saber por qual número estou falando antes de escrever.
4. Como vendedora, quero responder direto na linha aberta, para não precisar trocar a caixa selecionada antes de cada resposta.
5. Como vendedora, quero que o mesmo cliente em duas caixas apareça como duas linhas ligadas, para entender que são duas conversas e não uma duplicata da tela.
6. Como vendedora, quero que a linha me avise quando aquele contato tem conversa viva em outra caixa, para não responder por um número enquanto o cliente conversa por outro.
7. Como vendedora, quero saber por qual número uma automação responderia àquele contato, para não falar por cima do robô.
8. Como vendedora, quero que minha seleção de caixas seja lembrada, para não remarcar tudo a cada visita.
9. Como vendedora que só tinha uma caixa selecionada antes do deploy, quero encontrar a tela como a deixei, para não ser surpreendida por uma lista que triplicou.
10. Como vendedora, quero desmarcar uma caixa para focar, sem que isso apague do meu contador as mensagens que chegam nela.
11. Como vendedora, quero que o seletor destaque a caixa desmarcada que tem mensagem nova, para saber onde está o que não estou vendo.
12. Como vendedora, quero que os filtros de funil, etapa, responsável, tag e qualificação continuem funcionando sobre a lista misturada.
13. Como vendedora, quero buscar por nome ou telefone e encontrar a conversa em qualquer caixa marcada.
14. Como vendedora, quero marcar como lida a conversa que abri, e que isso zere a não-lida daquela caixa apenas.
15. Como vendedora da Alamaster, quero marcar só as caixas do meu departamento, para não afogar minha lista com os outros 50 números.
16. Como vendedora da Alamaster, quero que o orçamento do comercial e o chamado da técnica continuem separados, para não perder o assunto de cada um.
17. Como membro com acesso restrito a algumas Instances, quero que a caixa unificada me mostre exatamente as caixas que tenho direito de ler, nem uma a mais.
18. Como admin de uma Organization que restringe o chat ao dono do Lead, quero que essa restrição continue valendo dentro da caixa unificada.
19. Como master, quero enxergar todas as caixas da Organization, como já enxergo hoje.
20. Como vendedora, quero abrir uma conversa a partir do card do Lead, da Carteira, do follow-up do dia ou do dashboard, e continuar sendo perguntada por qual caixa falar.
21. Como vendedora, quero que uma mensagem que chega em qualquer caixa marcada apareça na lista em tempo real, sem recarregar.
22. Como vendedora, quero que a mensagem que chega numa caixa marcada atualize a linha certa, e não a linha de outra caixa.
23. Como vendedora, quero rolar a lista misturada e continuar vendo conversas mais antigas de todas as caixas, sem que uma caixa suma da paginação.
24. Como vendedora usando a bolha de chat sobre o funil, quero a mesma lista e as mesmas regras do `/chat`, para não aprender duas telas.
25. Como vendedora na bolha, quero os mesmos filtros que a lista principal tem, que hoje ela não oferece.
26. Como pessoa de uma Organization com uma Instance só, quero que nada mude na minha tela.
27. Como vendedora, quero que grupos continuem fora da lista por padrão, como hoje.
28. Como vendedora, quero que a aba de arquivadas continue funcionando sobre as caixas marcadas.
29. Como CTO, quero que a caixa unificada não vire uma porta lateral para ler conversa de Instance que a pessoa não pode acessar.
30. Como CTO, quero que o modo unificado da bolha e o do `/chat` usem a mesma fonte de verdade, para não termos duas respostas para a mesma pergunta.

## Implementation Decisions

### D1 — A Conversa do Lead passa a ser identificada por (caixa, telefone)

Hoje a conversa aberta é identificada só pelo telefone. Com duas caixas visíveis ao mesmo tempo, dois registros distintos colidiriam nessa chave: mesma identidade, históricos diferentes, cache compartilhado.

A identidade passa a ser o par. Isso alcança a chave de seleção da conversa aberta, a chave de cache da thread e a chave de cache da lista.

### D2 — Funções de lista novas, ao lado das existentes

As duas funções de lista (`get_whatsapp_conversation_list` e `get_official_whatsapp_conversation_list`) hoje **exigem** uma Instance não nula, recusando com `22023`, e **não devolvem** de qual Instance a linha veio.

Nascem **funções irmãs** que aceitam um conjunto de Instances e devolvem a Instance de origem em cada linha. As atuais ficam intactas.

Motivo de não alterar as existentes: a de WhatsApp tem 16 parâmetros e já sofreu `PGRST203` por sobrecarga, então mudar a assinatura exigiria `DROP` + `CREATE`. Neste projeto isso já apagou grants silenciosamente, devolvendo `EXECUTE` para `PUBLIC`. Função nova evita os dois riscos e mantém retrocompatibilidade para a bolha e para qualquer chamador não mapeado.

### D3 — O limite passa a ser global, não por caixa

Hoje `p_limit` recorta por Instance. Se o modo unificado pedir N caixas com limite por caixa e ordenar no cliente, a paginação mente: conversas reais somem da lista sem sinal.

A função nova ordena por recência **sobre o conjunto** e aplica o limite depois. A paginação continua por cursor, mas o cursor passa a ser **composto**: `(last_message_time, instance_id, normalized_phone)`, com ordenação total nas mesmas três colunas.

Um cursor de coluna única não serve aqui, e isso foi medido em produção (2026-09-03, Alamaster): 9.389 de 9.390 conversas não-grupo têm `last_message_time` de segundo inteiro, porque o fornecedor manda unix em segundos. Dentro de uma caixa, o empate raramente encosta na borda da página; sobre o conjunto das 57, encosta o tempo todo. Simulando a rolagem inteira de 50 em 50 com `p_before` estrito: no conjunto, 22 conversas somem de todas as páginas; na mesma simulação sobre uma caixa só (1.700 conversas), zero. É a unificação que liga o defeito — hoje nenhum call-site manda `p_before`.

Chamador que mandar só `p_before` repete o empate na página seguinte em vez de perdê-lo. Duplicar é visível e recuperável; sumir não é nenhum dos dois.

### D4 — A interseção de acesso é feita no servidor

O conjunto de Instances que o cliente pede é cruzado, dentro da função, com as Instances que aquele usuário pode ler: a lista de membros permitidos por Instance, com a regra vigente de que Instance sem lista é aberta à Organization inteira, e o bypass de admin e master.

O cliente nunca é a autoridade sobre o conjunto. Sem isso, a multi-seleção seria a porta lateral do recorte por Instance que a Alamaster e a Café Jurerê usam.

**A escrita da allowlist fecha junto, na mesma migration.** Medido em produção: `whatsapp_instance_allowed_members` era gravável pelo próprio membro que ela exclui — as policies de INSERT/UPDATE/DELETE pediam só ser team_member da org da Instance mais `can_manage_whatsapp_instances()`, que cai em `whatsapp.manage_instances` (`is_admin_only = false`, `default_value = true`, zero defaults de org desligando). Um `POST` me punha na lista da caixa proibida; um `DELETE` esvaziava a lista e fazia a caixa cair no ramo "sem lista = aberta à org inteira". As três policies passam a exigir `is_org_admin` da org da Instance.

Isso é novo, não um furo antigo: nenhuma das funções de lista vivas consulta a allowlist — hoje ela é recorte de front, e qualquer membro já lê qualquer caixa da própria org passando o uuid na RPC antiga. Esta fatia é a primeira vez que a allowlist decide acesso no servidor, e por isso a escrita tinha que fechar no mesmo commit. Efeito de tela: o botão "Vendedores" em Configurações → WhatsApp passa a exigir admin.

Fora do escopo, reportado: as policies de escrita de `whatsapp_instances` têm a mesma forma e a mesma fraqueza — membro comum apaga a Instance da org.

O recorte por responsável do Lead (`can_see_chat_scope`, política `chat_restrict_to_owner`) continua sendo aplicado **por conversa**, como as funções atuais já fazem.

### D5 — O tempo real roteia pela Instance da mensagem

Hoje o patch de cache do chat aplica toda mensagem recebida no cache da Instance **selecionada**. Com uma caixa só isso funciona por acidente. Com várias, erra o alvo.

Passa a rotear pela Instance que a mensagem carrega, validada contra o conjunto permitido. Esse padrão já existe implementado no realtime da bolha de chat e é reusado, não reinventado.

### D6 — O envio sai da Conversa do Lead aberta, não do estado global

O composer hoje envia pela Instance marcada no topo da tela, que é justamente o conceito que deixa de existir. Passa a usar a Instance da linha aberta.

Isso vale para os dois regimes de envio, o Chip e o Official Channel, cada um pelo seu caminho atual — a escolha do enviador continua sendo por objeto, decidida pelo tipo da caixa.

### D7 — A divergência com a Instance Routing Policy é exibida, não corrigida

A **Conversation Thread** do backend é lida por Organization mais telefone, **atravessando Instances**: a live Instance é a da Message mais recente, venha do Chip ou do Official Channel. A Instance Routing Policy `conversation` (ADR-0025) resolve por ali.

Ou seja: para a automação, o contato tem **uma** thread; para a caixa unificada, ele tem uma Conversa do Lead **por caixa**. As duas coisas são verdadeiras em camadas diferentes, e o glossário já autoriza a divergência ao definir **Resolução de Instância** como duas implementações que podem diferir de propósito — automática para *enviar*, assistida para *abrir*.

Na Chique isso é concreto: 6 Workflows ativos de WhatsApp, e 10 contatos com Conversa do Lead nas duas caixas.

Decisão: **não tocar no motor**. A tela passa a **mostrar** a divergência — a linha indica que há conversa viva em outra caixa e qual Instance a automação usaria. O motor de roteamento fica inalterado; reabri-lo reintroduziria o defeito que o ADR-0025 existe para corrigir.

### D8 — O contador de não-lidas segue o acesso, não a seleção

Hoje o badge agregado já soma as não-lidas de **todas** as Instances permitidas, enquanto a lista mostra só a selecionada — a discrepância já existe e ninguém notou.

Ela é mantida de propósito, porque a alternativa perde trabalho: desmarcar uma caixa não pode apagar do radar a mensagem que chega nela. Para fechar a lacuna de entendimento, o **seletor** marca a caixa desmarcada que tem mensagem nova.

### D9 — Abrir conversa a partir de fora do chat não muda

O fluxo de abrir conversa a partir do card do Lead, da Carteira, dos follow-ups e do dashboard continua **sempre perguntando** por qual caixa falar quando há mais de uma.

A razão está registrada no próprio código e continua de pé: criar um atalho para o caso óbvio significa ter duas regras para a mesma pergunta, e o caminho opcional apodrece sem ninguém ver. Marcar caixas na lista é dizer o que se quer **ver**; abrir conversa é dizer por onde se quer **falar**.

### D10 — A bolha de chat migra para o mesmo motor

O modo "todas as conversas" da bolha hoje **não** usa a função do banco: é uma réplica manual da consulta, lendo a tabela direto, e grava na **mesma chave de cache** da lista principal. Com o motor novo, os dois formatos disputam o mesmo espaço.

A bolha passa a consumir a função nova. Ganha o filtro no servidor, que hoje não tem, e a marcação de caixa por linha. A réplica manual é removida.

Nota de segurança verificada em produção: a leitura direta da bolha **não** é um furo — a tabela de mensagens tem política de RLS que já aplica `can_see_chat`. O problema dela é duplicação e ausência de filtro, não vazamento.

### D11 — Escopo de canal: WhatsApp primeiro

A multi-seleção cobre **Chip** e **Official Channel**. Os canais de Instagram continuam sendo selecionados sozinhos, como hoje, com aviso no seletor.

Motivo de não incluir Instagram agora: a função de lista social **não aplica** `can_see_chat_scope` — verificado contra a definição viva em produção. Das duas Organizations que ligaram `chat_restrict_to_owner`, a Goletric Pinheiros é a de maior volume de Instagram (10.175 Messages em 90 dias) e está exposta hoje. Puxar Instagram para dentro da caixa unificada sem consertar isso amplia a superfície do furo.

O conserto vira **issue própria**, na mesma leva, e é pré-requisito da fatia de Instagram.

## Testing Decisions

Bom teste aqui é o que exercita **comportamento externo**: dado um conjunto de caixas e um conjunto de conversas, o que a lista mostra, em que ordem, com qual marcação, e por onde o envio sai. Nada de asserção sobre estrutura interna de hook ou forma de cache.

### Seams propostos

Preferência por seams existentes, no ponto mais alto possível. Três, e nenhum novo na camada de UI:

**Seam 1 — o motor puro de lista unificada (novo, e o único novo).**
Uma função pura que recebe as listas por caixa e devolve a lista unificada: ordenação por recência, identidade por (caixa, telefone), marcação de contato presente em mais de uma caixa. Sem rede, sem React. É o mesmo formato do engine de filtro do inbox que já existe e tem 21 testes — prior art direta.

**Seam 2 — as funções novas do banco (existente, via pgTAP).**
Testadas na fronteira do SQL: interseção de acesso, limite global, ordenação, coluna de Instance de origem, recorte por responsável. Prior art: os testes de isolamento de chat que já existem.

**Seam 3 — o roteamento de envio e de realtime (existente).**
Já há testes de envio por objeto e de patch de realtime da bolha. As asserções novas entram nesses arquivos: enviar pela caixa da linha, e patchear a linha da caixa da mensagem.

### O teste que não pode faltar

No isolamento, **controle positivo dos dois lados**: o responsável vê e o não-responsável não vê. Uma lista vazia passaria por segura sendo bug — foi assim que o furo da lista social sobreviveu.

### Restrição de ambiente

Docker e Supabase local são proibidos neste projeto. Os testes que exigem banco (pgTAP do Seam 2, integração do recorte) **param e pedem uma branch do Supabase**, declarando o que roda lá e por quê. Sem banco: o motor puro, o roteamento, o typecheck, o lint e o build.

## Out of Scope

- **Instagram na caixa unificada.** Fatia seguinte, bloqueada pelo conserto do recorte por responsável da lista social.
- **Fundir históricos de caixas diferentes.** Decidido contra: são conversas distintas.
- **Mexer na Instance Routing Policy ou no resolvedor de Conversation Thread.** A divergência é exibida, não corrigida.
- **Mudar o fluxo de abrir conversa** a partir do card do Lead e demais superfícies.
- **Aposentar a bolha de chat.** Ela atende um caso de uso diferente: responder sem sair do funil ou da Carteira.
- **Filtro server-side da aba ativas/arquivadas.** Segue fora, pelo motivo já registrado: os dois contadores saem da mesma lista.
- **Header próprio do mobile.** Mantém o comportamento atual.
- **Teto artificial de caixas por seleção.** O teto é o acesso da pessoa. O pior caso medido é 16 caixas para um membro e 57 para um admin da Alamaster; o custo é controlado por limite global e índice, não por número mágico.

## Further Notes

**Sobreposição medida (90 dias), entre Instances vivas e distintas por número:**

| Organization | Contatos em 2+ caixas | Total | % |
|---|---|---|---|
| Alamaster | 877 | 4.209 | 20,8 |
| VitrineVET | 144 | 959 | 15,0 |
| Zimermann | 59 | 341 | 17,3 |
| Café Jurerê | 26 | 849 | 3,1 |
| Chique (chip ↔ oficial) | 10 | 664 | 1,5 |

A duplicação de linha que a decisão D1 aceita é rara na Chique e comum na Alamaster. Nas duas, é fiel ao que está acontecendo.

**Caixas visíveis por membro não-admin**, medido: Alamaster de 8 a 16; HGE de 2 a 3; todas as demais 1 ou 2. O modo unificado é barato no caso comum.

**Fósseis conhecidos que a implementação não deve tropeçar:**

- `channel_messages.phone_number` é **cru**, não canônico. A comparação com telefone normalizado é por variantes.
- O Official Channel tem `phone_number` nulo na Instance, por isso o selo textual em vez do número no seletor.
- O mapa Chip → uuids históricos vive numa função própria e a resolução dela **degrada em silêncio** por desenho, porque o front sobe antes da migration. A função nova precisa manter essa tolerância.
- `leads.qualification_tier` é ENUM: comparação com texto exige cast explícito, ou quebra só em runtime.
- Ao adicionar argumento de filtro, ele entra na chave de cache — todo escritor de cache de contatos tem que operar por prefixo, ou as listas filtradas param de receber patch de realtime.
