# Pergunta com botões — revisão de PRD e tickets

Estado: revisão aceita ao autorizar implementação TDD. [PRD #2141](https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/2141) e nove tickets (#2142–#2150) publicados com bloqueios nativos. Implementação em andamento, sem ativação geral do node.

[PRD](./prd.md). Tracker confirmado: GitHub, repositório `fabiomilennials1234-a11y/v8milennialsb2bv2`. Labels existentes verificadas: `prd`, `Feature`, `ready-for-agent`.

## Fronteira de teste proposta

Uma fronteira principal: iniciar execução autorizada, observar envio pelo caminho real da aplicação, receber resposta pelo webhook de produção e retomar o workflow. Verificar saída, mensagem e estado persistido. Reusar executor, gateway, adapter e ingresso, simulando somente o provedor/tempo nos testes repetíveis.

Banco real em branch Supabase de teste é necessário para concorrência, autorização e retomada. O repositório proíbe Docker e Supabase local para isso. Recursos de teste devem ser autorizados/provisionados ao executar as tarefas; nada foi criado nesta preparação.

Complementos indispensáveis: testes do editor via Playwright e experimento de compatibilidade real Uazapi em destinatários controlados. Não confiar apenas em mocks de RPC, helpers copiados ou smokes que pulam elementos ausentes.

## Divisão proposta

| Ticket | Bloqueado por | Entrega verificável |
|---|---|---|
| [01 — Contrato Uazapi](./tickets/01-comprovar-envio-e-resposta-uazapi.md) | Nenhum | Envio real controlado, clique identificado, fixtures e compatibilidade; prefatoramento mínimo compatível. |
| [02 — Pergunta simples](./tickets/02-pergunta-simples-com-escolha-unica.md) | 01 | Configurar, enviar, aguardar e seguir uma opção uma única vez, com versão e isolamento. |
| [03 — Três botões e saídas](./tickets/03-configurar-tres-botoes-e-saidas.md) | 02 | Editor e execução dos caminhos, rascunho e validação de ativação no servidor. |
| [04 — Outra resposta e prazo](./tickets/04-outra-resposta-e-vencimento.md) | 03 | Mídias, silêncio e disputa resposta/timeout seguem saída correta. |
| [05 — Imagem fixa](./tickets/05-imagem-fixa-no-node.md) | 03 | Upload privado, prévia, envio com botões e resposta; ativo preservado por versão. |
| [06 — Falha e envio incerto](./tickets/06-falha-e-envio-incerto.md) | 04 | Falha explícita e reconciliação sem reenvio cego ou prazo inventado. |
| [07 — Fila da conversa](./tickets/07-fila-limitada-ao-node.md) | 06 | Uma pergunta ativa; próxima liberada ao concluir node, sem esperar ramo. |
| [08 — Portabilidade](./tickets/08-portabilidade-e-edicao-segura.md) | 05 | Duplicação e importação preservam saídas e autorizam referências sem alterar execuções antigas. |
| [09 — Jornada completa](./tickets/09-validar-jornada-completa.md) | 07, 08 | Evidências integradas e em clientes reais para ativação controlada, sem deploy automático. |

04 e 05 podem avançar em paralelo após 03. A verificação final depende de 07 e 08; essas dependências cobrem todas as anteriores transitivamente. Não há tickets horizontais separados para banco, frontend, backend ou segurança.

## Observações da divisão

- 01 é uma comprovação técnica verificável usando o caminho existente, porque documentação não garante a compatibilidade efetiva. Não é uma refatoração ampla.
- Cada fatia inclui interface ou interação pertinente, persistência/serviço, autorização e testes. O node permanece sob ativação controlada até a jornada completa estar comprovada.
- Versão e correlação começam em 02; não são proteções adiadas ao final.
- Ordem de chegada na fila é proposta técnica deste pacote, ainda sujeita à revisão. Não inventamos validade comercial, tamanho máximo da fila ou limites do provedor como decisões aprovadas.
- Não há tickets de Copilot, novos controles globais de atendimento ou espera pelo ramo inteiro. Cancelamentos existentes devem ser respeitados; incompatibilidades específicas não autorizam ampliar escopo silenciosamente.
- Todas as pendências de contrato estão ligadas às tarefas que devem resolvê-las. Se um experimento não comprovar um requisito, registrar impedimento, sem declarar sucesso com evidência simulada.

## Publicação após revisão

Confirmar se a fronteira de testes corresponde à expectativa e se granularidade/dependências estão adequadas, incluindo eventuais junções ou divisões. Essa checagem é exigida pelas skills invocadas, não uma reabertura do brainstorming de produto.

Depois da aprovação: publicar o PRD com `prd` e `ready-for-agent`; criar tickets em ordem de dependência com `ready-for-agent`, referência ao PRD no corpo e relações nativas de bloqueio. Preservar o corpo do PRD depois de publicado; a skill de tickets proíbe modificar ou fechar o pai. Não criar uma segunda issue se uma publicação parcial já existir.

O manifesto local registra números, URLs e bloqueadores das issues publicadas. O corpo do PRD permanece preservado após publicação.
