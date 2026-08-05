# Aviso às organizações — roteamento de instância nas automações

Material para a issue **#1334**. O envio é trabalho humano: este documento traz o texto e a tabela do que foi semeado em cada organização.

Contexto técnico: [ADR-0025](../adr/0025-instance-routing-policy.md) · PRD #1331 · fatias #1332–#1335.

## Quando enviar

**Depois** de semear o recuo (#1333) e **antes** de a regra entrar no ar (#1335). Nessa janela nada mudou de comportamento ainda — o cliente consegue conferir e trocar o número antes do primeiro disparo sob a regra nova.

## O que muda, em uma frase

A automação passa a responder pelo mesmo número em que o lead falou, em vez de sair por qualquer número conectado da conta.

## Quem recebe

Sete organizações têm nós em "Automático". Cinco têm automações **ativas** e são prioridade; as duas últimas podem receber o mesmo aviso sem urgência.

| Organização | Número semeado como recuo | Saídas em 7 dias | Nós | Nós ativos | Automações |
|---|---|---:|---:|---:|---:|
| Goletric Perdizes | WhatsApp 1 | 1.227 | 22 | **22** | 3 |
| Zimermann | whatsappdaniele | 594 | 26 | **17** | 4 |
| Mapila Alimentos | comercial Reinaldo | 699 | 10 | **6** | 4 |
| Cervejaria Insana | Luan Insana - Growler | 259 | 16 | **1** | 3 |
| Milennials | nicoladeli | 1.138 | 11 | **1** | 6 |
| HGE ILUMINAÇÃO | Tania Whatsapp | 574 | 32 | 0 | 3 |
| VitrineVET | Telemarketing 1 | 1.496 | 14 | 0 | 4 |

**A issue #1334 citava a Basic4u; ela saiu da lista.** O recorte original contava números por `status`. Contando de verdade — conectado, sem sessão morta e não-Meta — a Basic4u tem **um** número vivo, e a Carol Distribuidora também. Organizações de um número não mudam de comportamento, então não há o que avisar.

**Atenção na Zimermann.** O número semeado ganhou por 594 contra 568 saídas — empate técnico. Ali a escolha automática não significa nada; vale confirmar com o cliente qual número ele considera o principal antes de a regra subir.

## Texto sugerido

> **Assunto: mudança no número de saída das suas automações**
>
> Olá, [nome].
>
> Hoje, quando uma automação sua dispara uma sequência de mensagens, o sistema escolhe um dos números conectados da sua conta sem levar em conta onde o lead está conversando. Isso faz o cliente receber de um número que ele nunca viu — a conversa se parte em duas e a chance de resposta cai.
>
> A partir de [data], a automação passa a responder **pelo mesmo número em que o lead falou**. Se o lead ainda não trocou nenhuma mensagem — veio de formulário, de importação ou de anúncio — a mensagem sai por um número de recuo, que você declara em cada bloco de mensagem.
>
> Já deixamos o recuo preenchido nos seus blocos com o número **[NÚMERO SEMEADO]**, que é o de maior movimento na sua conta. Se o correto for outro, a troca leva dois cliques:
>
> Automações → abra o funil → clique no bloco de mensagem → campo **"Se não houver conversa"**.
>
> Mais uma coisa: se o número que deveria enviar estiver desconectado na hora do disparo, a automação **não troca de número** — ela para e avisa. Você reconecta e repete a execução em Automações → Execuções. Preferimos parar a mandar do número errado.
>
> Qualquer dúvida é só responder aqui.

## Perguntas que provavelmente virão

**"Por que não continuar como estava?"**
Porque "como estava" era o sistema escolhendo sozinho e mudando de escolha quando outro número reconectava. O cliente final recebia de números diferentes na mesma conversa.

**"E se eu quiser que um funil sempre saia de um número específico?"**
Dá: no bloco de mensagem, em "Enviar por", escolha **Número fixo** e selecione o número. Esse funil ignora a conversa do lead.

**"Minha automação parou. O que houve?"**
Provavelmente o número resolvido está desconectado. Automações → Execuções mostra o motivo escrito e o botão "Repetir a partir da falha".

**"Tenho um número só. Muda alguma coisa para mim?"**
Não. Com um número conectado, tudo continua saindo por ele.
