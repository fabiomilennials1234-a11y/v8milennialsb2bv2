# O nó de mensagem declara de qual Instance envia, em vez de "primeira disponível"

**Status:** accepted (2026-08-01)

## Context

Uma Organization com mais de uma Instance conectada não consegue prever de qual número a automação fala com o Lead.

O WhatsApp Message Node (ADR-0012) oferece "Automático (primeira disponível)". Quem monta o funil lê isso como "o número que faz sentido para este Lead". No backend, a resolução consulta as Instances da Organization com status `open`/`connected` e pega **uma linha sem ordenação definida** — o Postgres devolve qualquer uma, e pode devolver outra na execução seguinte.

O efeito para o cliente final: o Lead escreve para o Número 1, entra no funil, e recebe a sequência pelo Número 2 — um número que ele nunca viu. A conversa se parte em duas threads e o número que disparou frio esquenta sozinho, vetor conhecido de bloqueio do WhatsApp.

Medição em produção (2026-08-01):

- **10 Organizations** com mais de uma Instance conectada
- **155** WhatsApp Message Nodes em "Automático" nessas orgs, **49 em Workflows ativos**
- Mais expostas: **Goletric Perdizes** (2 números, 22 nós ativos) e **Zimermann** (3 números, 17 nós ativos)
- **975** nós em "Automático" no total, **291 ativos**, em 66 Organizations — as demais têm um número só

Já existia um mecanismo vizinho: `instance-write-guard` + RPC `get_lead_write_instance`, atrás da flag `user_write_instance_strict`. Ele resolve pelo **vínculo do responsável** (vendedor→Instance), eixo diferente do problema. E nasce inerte: a flag está ON em **uma** Organization, que não é multi-instância, e `owner_team_member_id` está preenchido em **3 Instances no banco inteiro**.

## Decisões

1. **A escolha vive no nó, não na Organization.** O defeito é uma política invisível decidindo escondido; colocar a decisão numa tela distante recria o mesmo problema. O nó passa a declarar uma **Instance Routing Policy** com nome, na mesma tela em que a mensagem é escrita. Avaliada e descartada a configuração global (dois lugares para olhar quando algo dispara do número errado) e o par org-default + override-no-nó.

2. **Três políticas nomeadas**, substituindo "Automático (primeira disponível)": `conversation` (Seguir a conversa do lead, padrão), `responsible` (Instância do responsável), `fixed` (Número fixo).

3. **`conversation` lê a mensagem mais recente**, em **qualquer direção**. Mensagem de saída conta — o primeiro nó abre a thread e os nós seguintes a herdam, inclusive para Lead que nunca escreveu. Descartada a leitura pela primeira mensagem de todas (envelhece mal: arrasta o Lead de volta a um número que ele não vê há meses) e pela última mensagem de entrada (quebra o Lead de formulário, que nunca tem entrada).

4. **A thread é lida por telefone normalizado + Organization, descartando grupo — nunca por `lead_id`.** Medição em produção, últimas 12h, mensagens 1:1: **3.477 mensagens, 1.797 sem `lead_id`** (52%), enquanto `normalized_phone` e `instance_id` estão em 100% delas. Ler por `lead_id` erraria metade das threads.

5. **O nó carrega um recuo explícito** — "Se não houver conversa, usar: [Instance]". Fecha o contrato dentro do próprio nó: as duas pernas da regra na mesma tela. Descartado depender do vínculo responsável→Instance (praticamente vazio em produção; a feature subiria inerte) e descartado derivar o vínculo por estatística (adivinhação decidindo, a cada envio e invisível, de qual número o cliente recebe — mesma família do defeito original).

6. **Organization com exatamente uma Instance conectada usa essa Instance, sempre, antes de qualquer falha.** O defeito é escolher errado *entre várias* opções; com uma só não existe escolha errada. Sem isso, 242 nós ativos em 66 Organizations de um número regridiriam para consertar 49. A regra se auto-resolve: ao conectar o segundo número, a política estrita passa a valer sozinha, sem migração.

7. **Instance resolvida fora de `open`/`connected` falha na hora**, com código próprio, **sem retentativa e sem trocar de número**. Trocar por causa de uma queda de dez minutos reintroduz o defeito. Avaliado segurar até 24h e recusado — recuperação é manual, pela tela Automações → Execuções, que já mostra o erro e oferece "Repetir a partir da falha".

8. **Escopo: apenas os nós de mensagem do Workflow.** Campanhas, regras de pipe, follow-ups, disparo em massa, mensagens agendadas e Copilot seguem resolvendo Instance como hoje. A fronteira já é física no código: os handlers do Workflow passam por uma função de resolução própria, os demais caminhos por `resolveDispatchContext`.

9. **Semeadura única do recuo** nas 10 Organizations multi-instância, com a Instance de maior volume de saída de cada uma, e **aviso às 6 com nós ativos**. Palpite escrito uma vez, visível no nó e editável, é categoria distinta de palpite escondido e recorrente.

## Consequências

- **`whatsappInstanceId` muda de sentido sem migrar dado.** Sempre significou "manda por esta Instance", então vira a Instance da política `fixed`; vazio, que era o "Automático" aleatório, vira `conversation`. Nós já configurados com número fixo não mudam de comportamento.

- **A política é auto-reforçante — e isso corta nos dois sentidos.** Ela lê a mensagem mais recente, então uma mensagem torta vira a nova âncora e as automações seguintes herdam o erro. Como os outros caminhos de envio ficaram fora do escopo, eles podem contaminar a leitura. Vetor declarado e aceito; fecha em #1337 se `sent_source` for confiável (#1336, ainda não medido — as agregações sobre `whatsapp_messages` estouram o tempo em produção).

- **Automação para durante queda de sessão.** Consequência direta da decisão 7. Torna obrigatório que a falha seja legível na tela de Execuções, distinguindo "a Instance caiu" de "nenhum número resolvido".

- **A flag `user_write_instance_strict` continua governando os caminhos fora deste escopo.** A política `responsible` é a expressão explícita e opcional do mesmo vínculo, dentro do nó.

- **`CONTEXT.md` ganha os termos Instance Routing Policy e Conversation Thread.**

## Refs

- PRD: #1331 · fatias #1332–#1337
- Types: `src/types/workflow.ts` (`InstanceRoutingPolicy`, `ActionNodeData`)
- Regra pura + transições: `src/modules/workflows/lib/instance-routing.ts`
- UI: `src/modules/workflows/components/sidebar-panels/InstanceRoutingSelector.tsx`
- Nó unificado e auto-upgrade lazy: ADR-0012, `src/modules/workflows/lib/upgradeLegacyMessageNode.ts`
- Mecanismo vizinho: `supabase/functions/_shared/instance-write-guard.ts`
- Glossário: `CONTEXT.md` — Instance Routing Policy, Conversation Thread, WhatsApp Message Node, Instance (WhatsApp)
