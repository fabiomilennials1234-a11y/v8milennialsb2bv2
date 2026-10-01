---
name: chamado-diagnosticar
description: Etapa 2–3 do processo de fix por Chamado — lê um Chamado de suporte, diagnostica o sistema até a causa raiz e grava no Chamado o diagnóstico simplificado + o prompt de resolução (modelo/effort, plano, contexto, custo, keystones). Use quando o dev pedir para diagnosticar um Chamado ou rodar /chamado-diagnosticar <ticket_id>.
argument-hint: <ticket_id>
disable-model-invocation: true
model: opus
effort: high
---

# /chamado-diagnosticar

Você faz a etapa 2 (diagnóstico) e a etapa 3 (registro) do processo descrito em
`docs/operations/chamado-fix.md`. **Leia esse arquivo primeiro**: a matriz de
roteamento, a tabela de custo e o template v1 do prompt estão lá, e só lá.

O resultado é para outra pessoa: o dev operacional que vai responder o cliente
e colar o prompt sem investigar nada. Se ele precisar investigar, o diagnóstico
falhou.

Argumento: `$ARGUMENTS` = id do Chamado (UUID). Sem argumento, peça o id e pare.

## Regras desta etapa

- **Só leitura.** Não edite código, não rode migration, não escreva no banco,
  exceto o registro final do diagnóstico.
- Evidência antes de conclusão. Root cause sem `arquivo:linha`, query com
  resultado ou log não é root cause: marque como **hipótese**.
- Contexto enxuto: busca ampla vai para o subagente `chamado-scout`; saída
  grande vai para arquivo no scratchpad.

## Passos

1. **Ler o Chamado.** `mcp__torque-mcp__support_ticket_get` com `ticket_id`.
   Fallback, se a tool não existir (torque-mcp ainda não deployado):
   `mcp__torque-mcp__db_read_sql` em `support_tickets` (+
   `organizations(name)`) e `support_ticket_comments`. Leia `support_context`:
   rota, `app_version` e `client_errors` costumam apontar o arquivo.
   Se já houver `diagnosis`, mostre ao dev e pergunte se é para refazer.

2. **Classificar.** `fix` (defeito), `feature` (comportamento novo), `configuracao`
   (o sistema funciona; a org está mal configurada) ou `duvida` (sem mudança no
   sistema). Configuração e dúvida pulam para o passo 5 com plano curto, sem código.

3. **Localizar e reproduzir.**
   - Busca ampla → `Agent` com `subagent_type: "chamado-scout"`, pedindo
     `arquivo:linha` e uma frase por achado.
   - Dado real → `mcp__torque-mcp__db_read_sql` (read-only), sempre filtrando a
     org do Chamado. Nunca cole PII do cliente no prompt: use ids.
   - Regressão? `git log -S '<trecho>' --oneline -- <arquivo>` acha o commit.

4. **Causa raiz.** Escreva a causa em 2–5 linhas com a evidência. Confiança:
   *confirmada* (reproduzida ou provada por dado/código) ou *hipótese*.

5. **Complexidade e rota.** Use a tabela de sinais e a matriz do doc. Desviou
   da matriz? Escreva o porquê numa linha, na seção *Sessão* do prompt.

6. **Custo.** Calcule pela fórmula e pelas tabelas do doc. Registre com 2 casas.

7. **Keystones.** De 1 a 15, cada um com o comando ou query que o prova
   (`npx vitest run <arquivo>`, `deno test …`, query de verificação, `npx tsc
   --noEmit -p tsconfig.app.json`). Em `fix`, um dos keystones é o teste que
   falhava antes. Keystone sem verificação executável não entra.

8. **Prompt de resolução.** Preencha o template v1 do doc, sem pular seção.
   Escreva para um agente que não viu esta conversa: caminhos completos, nomes
   exatos, nada de "como vimos acima".

9. **Resposta ao cliente.** Em pt-BR, 2–4 frases: o que acontece, o que já
   sabemos e o próximo passo. Sem detalhe interno (arquivo, tabela, nome de
   função), sem prometer data e sem culpar o cliente.

10. **Registrar.** `mcp__torque-mcp__support_record_diagnosis` com todos os
    campos e **sem** `confirm_token`: é um dry-run. Mostre o plano ao dev
    (ação, rota, keystones, custo). Depois chame de novo com o `confirmToken`
    devolvido (vale ~5 min). Se a tool não existir, entregue o payload em JSON
    e diga ao dev para registrar à mão no painel Diagnóstico do Chamado.

11. **Fechar.** Responda ao dev em até 6 linhas: tipo/complexidade, causa em
    uma frase, rota modelo · effort, custo estimado, nº de keystones e onde
    está (Master → Suporte → Chamado).

## Pare e pergunte quando

- O Chamado é de outra natureza (pedido comercial, cobrança): diga isso e não grave nada.
- A causa só se confirma escrevendo em produção.
- Duas causas plausíveis e sem dado para escolher: grave como hipótese, e a
  Fase 1 do plano decide.
