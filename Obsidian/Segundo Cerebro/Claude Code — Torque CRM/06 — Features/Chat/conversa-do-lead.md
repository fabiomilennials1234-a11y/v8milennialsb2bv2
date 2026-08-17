---
type: feature
title: Conversa do Lead — de qual numero falamos com este cliente
status: spec
created: 2026-08-17
updated: 2026-08-17
tags: [chat, whatsapp, instancia, lead, feature]
related: ["[[chat-bubble-instance-filter]]", "[[whatsapp-stability-plan]]"]
owner: gabriel
last_updated: 2026-08-17
---

# Conversa do Lead — de qual numero falamos com este cliente

## A regra de negocio

Uma Organization tem varias caixas de entrada. Um Lead pode ter conversa em mais de uma. **Quando ha ambiguidade, o produto pergunta — nunca escolhe sozinho.**

Essa e a regra inteira. O resto e consequencia dela.

## Por que ela existe

O produto escolhia a caixa em silencio: pegava a mensagem mais recente entre as caixas permitidas. Quando errava, o vendedor abria conversa nova num numero qualquer e o historico com o cliente ficava orfao.

A ambiguidade e real e medida: so na org Milennials, 5 telefones tem conversa em 2+ caixas; o pior tem 3 caixas e 642 mensagens.

## O que decorre da regra

**Duas caixas ou mais, sempre pergunta** — mesmo quando so uma tem historico. Previsivel vence economia de clique. Duas regras para a mesma pergunta e como a prop `primaryInstanceId` morreu: existia, era opcional, ninguem passava.

**Caixa com problema aparece, nao some.** Desconectada ou fora da allowlist continua na lista, com o motivo visivel. "Desabilitada" quer dizer *nao pode escrever*, nao *nao pode ver*: a linha abre em modo leitura. Esconder reproduz o "cade a conversa?"; travar sem deixar ler cria beco sem saida quando um numero cai.

**De qual numero sai o primeiro contato e decisao consciente.** Lead sem historico nenhum recebe o grupo "iniciar conversa por". Nao e detalhe: quem manda a primeira mensagem vira dono da conversa dali em diante, e trocar depois e caro.

**O numero pessoal do vendedor deixa de ser caminho no produto.** Os `wa.me` de Lead migram para o chat interno. Mensagem que sai do celular pessoal nao fica no CRM, nao passa por copilot nem por dedup, e nao conta no historico.

## Dois termos que passam a existir

- **Conversa do Lead** — o par Lead↔caixa que tem historico. E o substantivo que faltava; sem ele, cada tela inventou o seu.
- **Resolucao de Instancia** — decidir por qual caixa falar. So o backend tinha nome para isso (responsabilidade do Message Gateway); a UI reimplementava sem nome. O gateway resolve para *enviar*, a UI para *abrir* — e por isso as duas regras podem divergir de proposito, desde que documentado.

## O que nao entra, e por que

**Contador de nao-lidas.** Vem do `localStorage`, e por dispositivo. O mesmo usuario ve numeros diferentes no desktop e no celular. Num seletor que existe para dar confianca, numero que muda conforme o aparelho e pior que numero nenhum.

**Sugestao pelo numero que o responsavel usa.** Impossivel hoje: `whatsapp_messages` nao guarda quem enviou, so se foi humano ou IA. A regra foi escrita antes de alguem conferir se o dado existia — vale como licao.

**Faixa de Instagram.** Aparece por decisao do CTO, mas nasce vazia: `lead_social_identities` tem zero linhas em producao. Falta o produtor do dado, e ele e upstream do chat.

## Onde ver o resto

Spec de implementacao: `.specs/features/conversa-do-lead/SPEC.md`
Mapa e historico das decisoes: issue #1605
