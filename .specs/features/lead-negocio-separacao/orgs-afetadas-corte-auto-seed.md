# Corte do auto-seed (#1775) — quem precisa ser avisado, medido em 90 dias

Medido em produção em **2026-08-24**, janela de **90 dias**, por leitura.

O critério de aceite do #1775 exige a lista remedida numa janela maior que 7 dias, e o
`handoff-l4.md` explica por quê: *"org de fluxo lento fica de fora e ninguém percebe até o
cliente reclamar"*. A remedição confirmou o risco — e corrigiu os dois números do handoff
para lados opostos.

## O que muda em relação à medição de 7 dias

| | handoff (7 dias) | remedido (90 dias) |
|---|---|---|
| Organizações a avisar | **2** (Goletric Pinheiros e Perdizes) | **18** acima de 20 cards/semana; 46 com auto-seed em ~100% |
| Volume das duas Goletric | ~2.180 cards/semana | **733**/semana — a janela curta pegou um pico |
| Volume total afetado | — | **1.385**/semana nas 18; 1.609 somando as 28 pequenas |

Ou seja: **menos volume do que se temia, e nove vezes mais clientes do que se sabia.** Cortar
avisando só as duas Goletric deixaria 16 organizações descobrindo pelo sintoma.

## As 18 que passam de 20 cards por semana

| Organização | cards/semana | Leads em 90d | % dos Leads que viravam card |
|---|---|---|---|
| Goletric Pinheiros | 469 | 6.034 | 100% |
| Goletric Perdizes | 264 | 3.413 | 99% |
| Motor 100 | 105 | 1.352 | 100% |
| Bennedita Pan | 61 | 787 | 99% |
| testevideo | 54 | 699 | 100% |
| Castropil | 49 | 633 | 100% |
| Basic4u | 44 | 589 | 96% |
| Milennials | 43 | 585 | 94% |
| Dna de Almas | 40 | 526 | 98% |
| Itatex | 39 | 496 | 100% |
| REALSC | 33 | 414 | ~100% |
| VitrineVET | 33 | 416 | ~100% |
| Promove Consórcios | 29 | 380 | 99% |
| London Cosmeticos | 28 | 363 | 98% |
| SORVFOODS | 26 | 347 | 97% |
| Maycão | 24 | 308 | 99% |
| Coopeafamijf | 23 | 298 | 100% |
| Forever Bella | 21 | 278 | 99% |

As outras **28** organizações com auto-seed em ~100% ficam abaixo de 20 cards/semana e somam
224/semana. Avisá-las é opcional; ignorá-las é uma escolha, não um esquecimento.

**Não afetadas apesar do volume alto:** Café Jurerê (12.621 Leads em 90d, **0,02%** viram card) e
Chique Distribuidora (4.067 Leads, 2,5%). Elas não usam o funil system — o corte não muda nada
ali. É a prova de que "muitos Leads" não é o mesmo que "afetada".

## Como a medida foi feita

Cards contados em `pipeline_entries` com `pipelines.type = 'system' AND slug = 'whatsapp'`
criados nos últimos 90 dias, divididos pelos Leads criados na mesma janela e na mesma
organização. Razão ≥ 0,9 = o auto-seed responde por praticamente todo card daquela org.

Nada aqui mede intenção: uma org pode ter razão alta porque só usa o funil padrão, e continuar
querendo cards. O que a lista diz é **quem sente o corte**, não quem concorda com ele.

## O que dizer, e o que não dizer

O funil **não esvazia** — para de encher. Todo card existente permanece, com etapa, responsável e
histórico. O que muda: Lead novo entra em Leads e **não** aparece no funil até alguém abrir o
Negócio (na tela, pela API ou por um Workflow que a org ativar).

O primeiro sintoma para o vendedor é achar que **sumiu lead**. É por isso que o aviso vai antes:
depois do corte, a mesma frase soa como desculpa.

Texto base para envio: `aviso-operacional-milennials.md` (redigido para a Milennials; adaptar o
nome e o volume por organização a partir da tabela acima).

## Ordem de execução

1. Aviso enviado às 18 (ou às 46, se o CTO preferir cobrir todas)
2. Migration `20270824060000_mata_auto_seed_de_card.sql` aplicada em prod
3. Conferir que a contagem de órfãos parou de crescer — era 11.721 com 259 nascidos nas ~30h
   anteriores a 2026-08-24; depois do corte a série tem que ficar plana

O passo 1 é humano e não tem substituto técnico. A migration está pronta e ensaiada contra o
schema real de prod (transação revertida, com controle positivo provando que o card nasce se o
gatilho voltar), mas **não aplicada**.
