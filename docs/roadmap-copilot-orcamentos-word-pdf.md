# Roadmap P0 — Orçamentos Word e PDF no Copilot

Data: 23/09/2026. Status: implementação das fases 1–6 iniciada; homologação e produção ainda pendentes.

Objetivo: permitir configurar uma ferramenta de orçamento no Copilot, importar um modelo Word, preencher com dados do lead e da conversa, converter opcionalmente para PDF e devolver o arquivo ao fluxo do Copilot para envio ao cliente. Primeiro lançamento restrito à Hoppe. A autorização de produção já foi dada nesta sessão; execução permanece sujeita a testes, PR e review do projeto.

## Execução em 23/09/2026

Branch `codex/copilot-quote-documents`. Sem deploy e sem alterações de dados em produção.

| Fase | Implementado localmente | Ainda necessário para fechar |
| --- | --- | --- |
| 1 | Contrato de campos, centavos/quantidades, totalizadores determinísticos e confirmação por revisão | Preparar/aprovar visualmente Word Hoppe, validar preços/condições e campos obrigatórios |
| 2 | Importação dentro da tool, switch PDF, teste fictício, persistência/reabertura, API com autorização, bucket privado e migration | Ensaio API/Storage com dois tenants, tipos gerados do schema e ensaio em branch efêmera |
| 3 | Serviço DOCX com runs divididos e linha repetível, validação de ZIP/XML, conversão opcional, imagem Docker e Compose restritivo | Build real, conversão PDF real, inspeção visual e ensaios de recursos/timeout |
| 4 | Tool inline no runtime v1 com status/save/prepare/generate/send e resultado devolvido ao modelo | Conversa ponta a ponta, fonte comercial autorizada, simulador e revisão dos casos concorrentes |
| 5 | Enfileiramento, destinatário/instância resolvidos no servidor, claim atômico, bloqueio de retry ambíguo e auditoria transacional | Envio real controlado, recuperação assistida, retenção/limpeza e confirmação de entrega |
| 6 | Testes unitários Python/TypeScript e migration em Postgres local PGlite | Homologação completa, gates do repo e review obrigatório |

Evidências finais desta execução: 98 testes unitários Vitest distintos em rodadas selecionadas (incluindo 12 do fluxo/entrega e 5 da UI); 8 testes SQL locais de permissões, isolamento, Storage e auditoria; 9 testes Python; 8 testes Deno de catálogo/reconstrução de prompt. Todos passaram. Checagem Deno das novas funções passou. Lint direcionado sem erros, um aviso de regex de controle intencional. `npm run build` passou com avisos existentes de chunks/importação/estilos; `npm run typecheck:ratchet` passou com zero erros novos (dívida já registrada do repo permanece). A checagem Deno ampla do engine ainda reporta erros de tipagem nas áreas existentes e não é gate global aprovado. Não foram executados E2E reais nem conversão PDF real.

Inventário read-only: organização Hoppe `4809b167-1f36-4e1a-af53-5c3317e0050c`, Julia `56548b4f-892f-4eff-ba23-432e26c94be6`, runtime v1. Instância `25b6c1ab-1c25-44f9-95dd-b2aa571f0f26` estava desconectada e sem `copilot_agent_id`; Julia sem `whatsapp_instance_id`. Isso impede o piloto real até conexão/vínculo. Nenhuma branch Supabase efêmera foi criada nesta execução; listagem retornou somente main.

O renderer de documentos do runtime local não encontrou `soffice.exe`, e o Docker daemon estava indisponível. Pela skill `documents`, a ausência de render e inspeção visual impede aprovar/entregar o template. O Word original permanece inalterado.

A consulta da tabela `products` da Hoppe retornou zero produtos e zero preços (`ticket`) cadastrados. Não assumir essa tabela como fonte de preços antes de definir a integração/tabela comercial ou a aprovação do vendedor. A política restritiva do novo bucket também foi testada contra uma policy permissiva ampla artificial, preservando o acesso dos outros buckets; nenhuma policy existente foi alterada.

A migration preliminar não versionada `20260923000000_hoppe_order_request_copilot.sql` foi substituída pela migration gerada via CLI `20260923140413_copilot_quote_documents.sql`, ainda não aplicada. Seu conteúdo funcional (duas flags) está preservado na nova migration. O serviço e limitações estão em `services/quote-documents/README.md`.

Marcadores implementados: escalares como `{{cliente_razao_social}}` (underscore, sem ponto) e produtos `{{items.description}}`, `{{items.quantity}}`, `{{items.unit_price}}`, `{{items.total}}`.

## Estado anterior ao início da implementação

- Existe um esboço local da ferramenta, flags/configuração por agente e mapeamento para `generate_order_request`.
- O executor em `_shared/actions/index.ts` sempre retorna erro para essa ação. Preenchimento, conversão e entrega não estão implementados.
- A UI pede o ID do modelo manualmente e apresenta PDF como select Sim/Não; não entrega a importação dentro da ferramenta nem o toggle solicitado.
- O caminho de reabertura em `playground/tools-mapping.ts` não reconstrói essa ferramenta. Os caminhos de leitura, composição de prompt, edição e preview precisam ser integrados.
- O carregador do runtime usa `SELECT_AGENT = "* ..."`; a hipótese anterior de ausência dos campos no SELECT não está demonstrada. Há cache a considerar na ativação.
- A migration local é preliminar. Conferir ordem e ledger antes de substituí-la por migration gerada com CLI; não aplicar indiscriminadamente a cadeia do repositório.
- Os 158 testes existentes que passaram não testam o novo fluxo. `tsc --noEmit` na raiz, cujo tsconfig tem `files: []` e referências, também não comprova sozinho a checagem da aplicação.
- Não há deploy desta feature comprovado nesta tarefa. Ausência de `supabase` no PATH não prova ausência de acesso: inventariar CLI local, MCP e métodos de deploy existentes.
- Não foi comprovada a disponibilidade de um conversor no ambiente de produção.

## Contrato da primeira versão

Nome na interface: **Gerar orçamento**. Entrada: modelo `.docx`, campos configurados e dados estruturados. Saída: DOCX preenchido quando o toggle estiver desligado; PDF quando ligado. O formato é decisão persistida do operador, não escolha livre do modelo de IA.

A ferramenta terá upload do Word, nome/versão do modelo, lista de campos e obrigatoriedade, instruções de quando usar, toggle **Converter para PDF após preenchimento**, prévia e teste com dados fictícios. Salvar e reabrir deve preservar tudo. A ativação exige modelo válido; PDF exige conversor saudável.

Modelos usarão marcadores explícitos, por exemplo `{{cliente.razao_social}}`, e uma linha repetível para produtos. Importar um Word arbitrário não autoriza substituições por adivinhação. O importador identifica marcadores; quando ausentes, orienta a preparação do template. Para Hoppe, preparar uma versão do Word enviado, preservando o layout e removendo os dados do cliente de exemplo, número do pedido, identificadores, datas e totais antigos. Dados fixos da Hoppe também serão conferidos.

Orçamento não é nota fiscal nem pedido aprovado. Não registrar venda, emitir documento fiscal ou criar pedido no ERP como efeito dessa ferramenta. Valores, impostos, descontos, frete e condições devem vir de fonte comercial autorizada; a IA não pode criar essas regras. A diferença observada no exemplo entre produtos (295,00) e total (314,18) precisa de explicação antes de replicar qualquer cálculo.

## Sequência de construção

| Fase | Entrega verificável | Dependência | Critério de saída |
| --- | --- | --- | --- |
| 0 | Revisão do esboço e inventário de produção | Nenhuma | Escopo, acessos, runtime ativo, migration e rota de entrega identificados |
| 1 | Template Hoppe e contrato de dados | 0 | Modelo sem dados residuais; campos e cálculos definidos |
| 2 | Upload, configuração e persistência | 1 | Importar, salvar, reabrir e testar; isolamento entre organizações comprovado |
| 3 | Preenchimento DOCX e geração PDF opcional | 1–2 | Ambos os formatos gerados e visualmente aprovados |
| 4 | Coleta e execução pelo Copilot | 2–3 | Conversa produz documento correto e recupera resultado/erro |
| 5 | Entrega, retomadas e observabilidade | 4 | Anexo enviado ao destinatário certo sem duplicação nos cenários de retry testados |
| 6 | Homologação e revisão | 0–5 | Fluxo completo, testes negativos e gates do repo aprovados |
| 7 | Deploy progressivo e piloto Hoppe | 6 | Teste controlado em produção e primeiras operações acompanhadas |

### Fase 0 — Tornar o trabalho publicável

- Criar branch de trabalho e preservar alterações alheias. Revisar o diff preliminar antes de reutilizá-lo.
- Identificar organização e agente Hoppe por IDs, instância/canal, runtime que atende o agente e versões das funções em produção.
- Conferir métodos de acesso, ledger de migrations, bucket/policies, fila, worker e capacidade de infraestrutura para conversão. Não imprimir credenciais.
- Definir o contrato canônico da tool e reconciliar os nomes preliminares `GERAR_ORCAMENTO_PDF` e `generate_order_request`, evitando divergência entre UI, prompt, runtime e worker.
- Registrar no PR plano de publicação, rollback e evidências. A classificação P0 não elimina review.

### Fase 1 — Modelo e dados comerciais

- Preparar modelo versionado com destinatário, endereço, contato, produtos múltiplos, condições de pagamento, frete, observações e totalizadores.
- Distinguir campos obrigatórios, opcionais e derivados; definir IDs estáveis, tipos e formatos. Exibir nomes amigáveis ao operador.
- Registrar origem dos valores: cadastro do lead, conversa, catálogo ou configuração comercial. Mostrar conflitos para confirmação.
- Fazer cálculos determinísticos com precisão decimal e arredondamento definido. Validar quantidade, moeda, desconto e total; impedir valores inválidos.
- Resumo confirmado pelo cliente vinculado à revisão dos dados. Alteração posterior invalida confirmação. Um booleano inventado pela IA não é prova suficiente de confirmação.
- Criar fixtures com dados fictícios: um produto, vários produtos, campos longos, acentos, dados opcionais vazios e múltiplas páginas.

### Fase 2 — Configuração e armazenamento

- Importação dentro da ferramenta, sem UUID digitado pelo usuário. Validar tamanho, extensão, MIME e estrutura do DOCX; rejeitar macros e arquivos malformados.
- Selecionar modelo/versionamento e trocar sem afetar documentos já gerados. Extrair marcadores e apontar erros antes da ativação.
- Implementar switch booleano PDF e persistência completa nos caminhos criar, editar, reabrir, reconstruir prompt e preview. Corrigir a lacuna de `tools-mapping.ts`.
- Separar templates e arquivos de clientes da base de conhecimento geral. Orçamentos gerados não podem aparecer na lista de documentos de outros leads ou ser indexados no RAG.
- Modelar templates versionados, rascunhos por conversa/lead, revisões confirmadas e jobs/artefatos. Relacionar organização, agente, lead e conversa com validação server-side.
- Storage privado, URLs assinadas e prazo de retenção explícito. Aplicar RLS e permissões de edição/consulta; testar autorização positiva e negativa.
- Migration aditiva com recurso desativado por padrão. Tipos Supabase gerados conforme o procedimento do projeto, nunca editados manualmente.

### Fase 3 — Motor de documentos

- Preencher marcadores mesmo quando o Word divide o texto em vários runs; preservar tabelas, cabeçalhos, rodapés, logo e formatação. Suportar linhas repetidas de produtos e caracteres especiais.
- Não executar código/expressões arbitrárias do template, macros ou links externos. Impor limites de ZIP descompactado, itens, tamanho e tempo.
- Validar campos obrigatórios e ausência de marcadores não resolvidos antes de disponibilizar o arquivo.
- Com PDF desligado, gerar e devolver DOCX independentemente do conversor.
- Com PDF ligado, converter o DOCX preenchido em serviço dedicado, autenticado e isolado. Proposta: conversor com LibreOffice em container, separado das Edge Functions; confirmar compatibilidade, capacidade e operação antes da implementação final.
- Se a conversão falhar, registrar erro recuperável e não enviar DOCX silenciosamente como substituto. Nenhum serviço externo recebe dados de clientes sem decisão explícita sobre destino e operação.
- Comparar visualmente Word/PDF renderizados: quebras, produtos em múltiplas páginas, fontes, acentos, margens, totais e ausência de dados do exemplo.

### Fase 4 — Integração conversacional

- Expor a tool somente para agente habilitado com template válido. Schema deve representar os campos reais do modelo, inclusive lista de produtos; não deixar produtos como objeto sem contrato.
- Reusar dados do lead, coletar faltantes em turnos sucessivos e persistir rascunho. Retomar após interrupção sem perder informações; não sobrescrever cadastro silenciosamente.
- Usar o fluxo normal de mensagem e tool calling. Não presumir necessidade de novo trigger SQL de intenção: o Copilot decide chamar a ferramenta conforme instruções e dados disponíveis.
- Autorizar novamente no executor e derivar tenant, agente e destinatário do contexto confiável. Recusar lead/conversa/template de outra organização, mesmo com IDs válidos.
- Gerar job com versão dos dados e do template. Retornar job ID/estado e, ao concluir, referência privada do artefato ao fluxo de continuação do Copilot.
- O Copilot só anuncia geração concluída após resultado real. Distinguir documento gerado, envio solicitado, envio aceito e entrega confirmada quando o provedor a informar.
- Atualizar preview e runtime ativo, catálogo de tools, reconstrução de prompt, parsing, dispatch e tratamento de falha. Testar também agente desabilitado e pause humano.

### Fase 5 — Entrega e recuperação

- Integrar a referência do artefato ao caminho de outbound existente; não enviar arquivo pelo serviço de conversão.
- Antes do envio, validar escopo do arquivo, destinatário, instância, revisão, permissão e pausa/cancelamento do Copilot. Gerar URL assinada no momento do envio.
- Chave de idempotência estável por orçamento/revisão/ação, não somente por turno. Usar claim atômico e distinguir retry da geração, da conversão e do envio.
- Timeout depois de envio possivelmente aceito exige reconciliação; não reenviar cegamente. Reenvio explícito e nova revisão têm identidade própria.
- Registrar estados, duração, tentativas, erro e identificador do provedor sem conteúdo sensível nos logs. Histórico restrito ao lead correto.
- Estado proposto: rascunho → aguardando confirmação → gerando → pronto → enviando → enviado; falha/cancelado como estados explícitos. Entregue depende do recibo do canal.
- Disponibilizar consulta de falhas e recuperação operacional. Limpar temporários em sucesso/erro e executar retenção sem apagar arquivos ainda usados por jobs.

### Fase 6 — Critérios de homologação

- Contrato: campos faltantes, revisão desatualizada, produtos múltiplos, cálculo e entrada inválida.
- Segurança: acesso cruzado entre organizações e entre leads da mesma organização; usuário sem permissão; template/URL adulterado; ZIP malicioso e links externos.
- UI: upload, verdadeiro toggle, salvar/reabrir, alteração de modelo e preview; ativação sem configuração recusada.
- Render: DOCX e PDF com fixtures de uma e várias páginas, inspeção visual e verificação dos valores.
- Conversa completa: dados pré-existentes + perguntas + correção + confirmação + geração + envio, nos dois formatos.
- Resiliência: worker concorrente, retry, queda do conversor, URL expirada, pausa humana, desativação entre geração/envio e timeout ambíguo do provedor.
- Regressão: envio atual de documentos e fluxo Copilot existentes continuam funcionando.
- Executar testes específicos, checagem das Edge Functions, `typecheck:ratchet`, `lint:ratchet`, `test:ratchet` e build. Review obrigatório nas áreas Copilot, multi-tenant e WhatsApp.
- Validar banco em branch efêmera conforme runbook vigente: listar antes, preparar cleanup antes da criação, excluir imediatamente ao fim e confirmar exclusão. Não usar o dev aposentado.

### Fase 7 — Publicação e início da operação

1. Conferir IDs de produção, schema/ledger atual, disponibilidade do conversor e configuração anterior da Hoppe para reversão.
2. Disponibilizar conversor autenticado com limites e health check; comprovar conversão com fixture fictícia no ambiente final.
3. Aplicar somente migrations revisadas desta feature, recurso desligado; conferir colunas, policies, índices e permissões no alvo.
4. Publicar gerador/worker, integração Copilot e entrega em ordem compatível. Inventariar todos os consumidores de módulos compartilhados que precisam de redeploy.
5. Integrar frontend via PR e review. Merge em main pode disparar deploy automático; verificar versão efetivamente servida, não apenas sucesso do CI.
6. Importar template Hoppe, configurar fontes/campos, formato e instruções; verificar persistência e atualização do cache/prompt.
7. Habilitar somente agente Hoppe. Testar com contato controlado da equipe: DOCX com toggle desligado e PDF com toggle ligado. Identificar o destinatário de teste antes de qualquer envio real.
8. Conferir arquivo recebido, dados, layout, histórico e ausência de duplicação. Exercitar uma falha controlada e recuperação.
9. Iniciar uso com acompanhamento das primeiras operações e observar falhas/latência por 24 horas como gate de expansão. Definir responsável e monitor antes do início dessa janela.

## Rollback

Desabilitar a capacidade na Hoppe e invalidar cache/prompt. Bloquear novos jobs e cancelar entregas pendentes dessa ferramenta; revisar separadamente envios com resultado desconhecido. Reverter frontend/Edge Functions para versões compatíveis se necessário. Preservar schema aditivo, documentos, revisões e auditoria; não apagar evidência. Desativar conversor apenas após conferir jobs em voo. Arquivo já enviado ao cliente não é desfeito por rollback.

## Definição de pronto para operar

- [ ] Upload do modelo e toggle funcionam e persistem após reabrir.
- [ ] Template Hoppe conferido e sem dados do cliente de exemplo.
- [ ] Dados do lead e da conversa viram documento correto; faltantes impedem geração.
- [ ] DOCX e PDF gerados, inspecionados e recebidos pelo contato de teste.
- [ ] Resultado retorna ao fluxo Copilot; envio e falhas ficam rastreáveis.
- [ ] Isolamento, cancelamento e retries aprovados; nenhum vazamento pelo catálogo/RAG.
- [ ] PR revisada, migrations e versões de produção verificadas.
- [ ] Rollback e recuperação documentados; monitor e responsável definidos.
- [ ] Nenhuma branch efêmera criada nesta execução permanece ativa.

Não declarar a feature concluída por ter apenas UI, migration, testes legados verdes ou deploy aceito. O marco operacional é o ciclo completo comprovado em produção para a Hoppe nos dois formatos.

## Caminho crítico e decisões pendentes

Ordem: template/contrato → geração local comprovada → configuração/persistência → conversa/jobs → entrega → homologação → produção Hoppe. A UI e o motor podem avançar em paralelo após o contrato estar definido.

As decisões comerciais ainda necessárias são a origem de preços/tributos/condições, a interpretação dos totalizadores do exemplo e os campos realmente obrigatórios. Devem ser buscadas primeiro na configuração e nos dados existentes da Hoppe, escalando apenas lacunas reais. A escolha final do conversor depende do inventário de infraestrutura; nenhum custo novo ou disponibilidade foi comprovado nesta tarefa.

Primeiro marco executável: importar o template Hoppe preparado, preencher com fixture fictícia e obter DOCX/PDF visualmente aprovados. Isso valida a parte mais incerta antes de habilitar conversas reais. Este roadmap não publica alterações nem cria recursos de infraestrutura.
## Atualização de escopo — todas as organizações, padrão desligado

Disponibilidade global, sem ativação em massa. A migration define `can_generate_order_request=false` para agentes existentes e novos. O servidor bloqueia enqueue e envio enquanto `COPILOT_QUOTE_LIVE_SEND_ENABLED` não for exatamente `true`; nesta etapa manter ausente. Nenhum atendimento real foi ativado.

Testes adicionados para default em organizações diferentes, bloqueio de envio e privilégios herdados das funções SQL. O preview reconhece a tool, mas não declara geração/entrega fictícias. A geração no botão de teste usa dados fictícios; não equivale a homologação ponta a ponta pela conversa.

Publicação: ramo `codex/copilot-quote-global`, baseado na main sem o commit de chat da branch anterior. Schema deve ser aplicado ANTES do merge (o frontend grava as novas colunas ao salvar agentes). Renderer, download do artefato real sem WhatsApp e homologação ponta a ponta permanecem pendentes; publicar desabilitado não significa geração PDF operacional.

Pré-flight 2026-09-23: prod com 53 agentes, nenhuma coluna/tabela/bucket da feature. Migration ensaiada com baseline em `juecukwajosxgqrjvvhz`; preview excluída e ausência confirmada automaticamente. Ajuste posterior de FK para excluir apenas templates sem orçamento coberto no teste SQL local, preservando os eventos de orçamentos existentes. Revisões independentes de padrões/segurança e spec apontaram esse ciclo de exclusão e a ordem banco/frontend, tratados antes da publicação.
