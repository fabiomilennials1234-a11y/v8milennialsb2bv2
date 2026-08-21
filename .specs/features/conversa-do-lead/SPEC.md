# Conversa do Lead — seletor de caixa ao abrir a conversa

**Mapa**: [#1605](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1605)
**Status**: pronta para implementação — todas as decisões de produto estão travadas
**Data**: 2026-08-17

---

## O problema

Uma Organization tem várias caixas de entrada — hoje 139 instâncias de WhatsApp em produção, 107 conectadas, mais canais sociais. Um Lead pode ter conversa em mais de uma: falou com o comercial num número, com o pós-venda em outro.

Quando alguém clica "WhatsApp" num card de Lead, o produto escolhe a caixa **sozinho e em silêncio** — pega a mensagem mais recente entre as caixas permitidas. Quando erra, o vendedor abre uma conversa nova num número qualquer, e o histórico com o cliente fica órfão.

Não é hipótese. Medido em produção: só na org Milennials, 5 telefones têm conversa em 2+ caixas; o pior tem **3 caixas e 642 mensagens**.

## O que construir

Um componente único de "falar com este Lead" que, quando há mais de uma caixa, **pergunta** em vez de adivinhar.

### Regra de abertura

| situação | comportamento |
|---|---|
| 1 caixa permitida | abre direto, sem seletor |
| 2+ caixas | **sempre abre o seletor**, mesmo que só uma tenha histórico |
| Lead sem histórico em caixa nenhuma | seletor com o grupo "iniciar conversa por" |

"Sempre pergunta" é decisão explícita do CTO: previsível vence economia de clique. Não introduzir atalho para o caso de caixa única com histórico — duas regras para a mesma pergunta é como a prop `primaryInstanceId` morreu.

### O seletor

Conceito escolhido: **lista densa** (protótipo em `proto/1607-seletor-conversa`, variante 1). A caixa domina a linha; a conversa entra como legenda.

Dois grupos, nesta ordem:

1. **Conversa em andamento** — caixas com histórico, ordenadas por recência da última mensagem.
2. **Iniciar conversa por** — caixas sem histórico, ordenadas por preferência do usuário logado (`team_members.preferred_whatsapp_instance_id`), depois por caixa conectada.

Cada linha mostra: ícone do canal · nome da caixa · indicador de status · última mensagem com direção (↓ recebida / ↑ enviada) · recência relativa ("hoje", "há 9 dias").

**Sem badge de não-lidas.** Ver "O que ficou de fora" abaixo.

### Estados de caixa

Uma caixa desconectada, ou fora da allowlist do usuário, **aparece** — nunca é escondida — com o motivo visível.

"Desabilitada" significa **não pode escrever**, não *não pode ver*: a linha continua clicável e abre a thread em modo leitura, com o composer bloqueado. Esconder reproduz a confusão de hoje ("cadê a conversa?"); travar sem deixar ler cria beco sem saída quando uma instância cai.

### Dois requisitos que o protótipo NÃO resolveu

O protótipo validou o conceito, não o acabamento. Estes dois pontos ficaram abertos e **precisam ser resolvidos na implementação**:

1. **Os dois grupos ficaram visualmente idênticos.** "Iniciar conversa por" parece mais conversa. É o oposto do que é: começar um primeiro contato define quem é o dono da conversa dali em diante, e trocar depois é caro. É a decisão mais cara da tela e está com o menor peso visual.
2. **O estado desconectado não comunica.** Virou uma bolinha de 6px e um "só leitura" em corpo 11. Precisa ficar legível sem virar ruído nas linhas saudáveis.

## Contrato do componente

Mora em **`communication`** — módulo dono da conversa, e onde `useLeadByPhone` / `useLeadPhone` já vivem pelo mesmo motivo. Importar o barrel de `leads` a partir do chat fecha ciclo entre módulos e o `dep-cruise` recusa (provado no PR #1614).

### `leadId` é obrigatório

Sem Lead, não compila.

O inventário contra `main` mediu que **todos** os call sites vivos conseguem passar `lead_id` — só não passam. O caso exemplar é `WhatsAppContext`, que usa `pipeData.lead_id` na linha 52 e chama `openWhatsApp(lead.phone)` na 136. O dado estava ali.

Prop opcional é exatamente a porta pela qual `primaryInstanceId` escapou: ninguém era obrigado a passar, e ninguém passou — zero produtores em todo o repo.

**Pré-requisito não-negociável**: `AgentTasksTab` (:49) e `WhatsAppContext` (:28) recebem `lead: any`. Obrigatoriedade não protege onde o compilador é cego. Tipar os dois vem **antes** de migrar os call sites, não depois.

### Texto pré-preenchido

`ClienteCopilotSuggestion` (:83) é o único `?text=` do produto. Entra como parâmetro do componente e vira **draft** no composer via `useConversationDraft` — nunca mensagem pré-enviada. Sugestão de IA que vira mensagem sem o vendedor reler é como sugestão vira erro em cliente real.

### Guarda contra o 20º caminho

Regra de ESLint proibindo `wa.me` e `openWhatsApp` fora do componente. Vermelho no editor e no CI, na mesma prateleira dos ratchets de lint, tsc e dep-cruise que o repo já mantém.

Documentação sozinha não segura: neste repo já houve defeito em produção nascido de doc desatualizada.

## Dados

### A consulta do seletor

RPC **`SECURITY INVOKER`**, sempre recortada por `organization_id`.

- `INVOKER` porque a RLS de `whatsapp_messages` já recorta por org. `DEFINER` com org por parâmetro é vetor que este repo já teve; não há motivo para estreá-lo aqui.
- **Sempre por org**: a agregação cross-org estourou timeout em produção, duas vezes.

Forma: `LATERAL` por caixa, `ORDER BY timestamp DESC LIMIT 1`. Com o índice novo isso é O(caixas) — N buscas de uma linha.

### O índice (já aplicado em produção)

```
idx_whatsapp_msgs_org_phone_instance_ts
  (organization_id, normalized_phone, instance_id, "timestamp" DESC)
  WHERE deleted_at IS NULL AND normalized_phone IS NOT NULL
```

Medido em prod, Lead com 1811 mensagens em 3 caixas:

| | tempo | buffers |
|---|---|---|
| antes, `DISTINCT ON` | 618 ms a frio | 1224 |
| antes, `LATERAL` | 12 ms quente | 4880 |
| **depois, `LATERAL`** | **0,27 ms** | **23** |

Sem `instance_id` no prefixo, o custo é O(mensagens do Lead) — e o Lead falador é exatamente o que se clica. Migration e rollback no PR #1615.

### Prefetch

A consulta dispara no `onMouseEnter` do botão, para o seletor abrir preenchido. Com 23 buffers por chamada isso é viável mesmo em lista de kanban.

## Migração dos call sites

**9 call sites** vão hoje ao chat interno; **6** ainda abrem `wa.me` de Lead. Todos migram.

O número pessoal do vendedor **deixa de ser caminho no produto** — sem ação secundária de escape. Hoje esses cliques abrem o WhatsApp pessoal: a mensagem sai do celular dele, não fica no CRM, não passa por copilot nem por dedup, e não conta no histórico do Lead.

Ficam **fora de escopo** os `wa.me` que apontam para o suporte do Torque (`SubscriptionBlockedPage`, `UpgradeModal`, `FeatureLockedScreen`): é o tenant falando com o Torque, não o vendedor com o Lead. Não têm caixa nem Lead.

## Glossário

Dois termos entram em `CONTEXT.md`:

- **Conversa do Lead** — o par Lead↔caixa que tem histórico. É o substantivo que o seletor lista e que hoje não tem nome, e é por isso que cada card inventou o seu. Distinto de **Conversation** (runtime de Copilot, `conversations` + `conversation_messages`) e de `whatsapp_conversations` (tabela de marcador de arquivamento — 16 linhas em prod, não é registro de conversa).
- **Resolução de Instância** — a operação de decidir por qual caixa falar. Hoje só nomeada no backend, como responsabilidade do **Message Gateway**. A UI reimplementa com regra própria, sem nome. Nomear as duas juntas obriga a documentar onde divergem — e elas divergem: o gateway resolve para *enviar*, a UI resolve para *abrir*.

## O que ficou de fora, e por quê

**O badge de não-lidas.** Sai de `getLastSeenMap()`, que é `localStorage` — por dispositivo. O mesmo usuário vê números diferentes no desktop e no celular, e limpar o navegador zera. Não existe marcador de leitura no banco. Num seletor que existe para dar confiança, número que muda conforme o aparelho é pior que número nenhum.

**O sinal do responsável.** A decisão original mandava derivar de agregação sobre `whatsapp_messages` em 30 dias. **É impossível**: a tabela não guarda quem enviou — só `sent_by_ai` (booleano) e `sent_source`, que em prod só assume `manual`, `copilot` e `workflow`. Nenhum identifica o humano.

O substituto viável (caixas com conversa nos outros Leads daquele responsável) custa 222 ms para uma carteira de 243 Leads e escala com ela — serve só como valor calculado uma vez por dia, nunca em hover. Adiado.

**A causa estrutural do "chat abre vazio".** O inbox é derivado das 8000 mensagens mais recentes da instância; Lead antigo fica fora. A correção local já está em `main` (abre pela conversa mesmo sem o contato na lista), mas a lista lateral continua sem a linha. Esforço próprio.

**A bolha de chat.** A regra deveria valer igual, mas `ChatBubbleContext.open({ phone })` tem um único chamador no produto e ele tem zero referências. Não há porta viva a ancorar.

**A faixa de Instagram nasce vazia.** O seletor lista caixas sociais por decisão do CTO, ciente de que `lead_social_identities` tem **0 linhas** em produção e que nenhuma das 3 mensagens de Instagram carrega `lead_id`. Falta o produtor desse dado, e ele é upstream do chat.

## Trabalho já entregue

- **PR #1614** (em `main`) — `?lead=` passou a ser lido; deep-link fora da janela de 8000 deixou de morrer calado. 10 testes.
- **PR #1615** — migration do índice; índice já aplicado em produção com `CONCURRENTLY`.

## Referências

- Mapa e histórico de decisões: [#1605](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1605)
- Desenho: [#1607](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1607) · Custo: [#1610](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1610) · Contrato: [#1611](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/1611)
- Protótipo: branch `proto/1607-seletor-conversa`, rota `/seletor-conversa-preview`
