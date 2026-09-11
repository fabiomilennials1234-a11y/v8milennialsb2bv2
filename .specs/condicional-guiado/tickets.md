# Condicional guiado — divisão proposta

PRD: https://github.com/fabiomilennials1234-a11y/v8milennialsb2bv2/issues/2015

Status: divisão aprovada pelo CTO; tickets publicados conforme issues.json.

## Regras comuns das fatias

- Primeira entrega apenas: tempo corrido; calendários e tempo comercial ficam fora.
- Cada fatia entrega comportamento de ponta a ponta, com contrato persistido quando necessário, autorização no servidor, interface relevante e teste na fronteira pública. Não separar frontend, banco e backend em tickets independentes.
- Evolução aditiva; nenhuma remoção ampla do legado é necessária. O primeiro ticket inclui o prefatoramento mínimo para coexistência. Não fazer refatoração abrangente como pré-condição.
- Caminho novo permanece em desenvolvimento/ativação controlada até a verificação de lançamento. Fatias podem ser demonstradas isoladamente no dev; isso não autoriza expor execução nova parcialmente protegida em produção.
- Cada campo disponibilizado deve entrar com sua autorização, validação, resumo e testes. Não deixar segurança ou teste funcional para o último ticket.
- Quantidades de regras, orçamento de consultas, timeout e retry são parâmetros técnicos a medir e documentar, não números já aprovados. Três níveis de grupos são limite de produto confirmado.
- As relações de produtos, atividades e “último contato” ainda têm lacunas semânticas. Seus tickets devem confrontar modelo atual e decisões aprovadas; se não houver definição inequívoca, registrar impedimento para decisão do CTO antes de implementar a regra afetada. Não inferir silenciosamente outro significado nem tratar essa regra como pronta.
- A publicação posterior deverá usar `ready-for-agent` e vínculos nativos de dependência. O PRD existente não será alterado ou encerrado. Referência ao pai constará no corpo; nenhum ticket dispara implementação por esta preparação.

## 01 — Testar uma condição simples com contrato novo e legado preservado

**Blocked by:** Nenhum.

**What to build:** Selecionar um lead autorizado, configurar uma comparação de nome e testar a condição sem executar ações. Introduzir o mínimo de contrato novo necessário, mantendo fluxos antigos intactos.

**Acceptance criteria:**
- [ ] Entrada pública recebe configuração, contexto e identidade; saída distingue resultado explicado, ausência, erro e acesso negado.
- [ ] Pessoa só seleciona e avalia lead que pode consultar; servidor impede acesso cruzado mesmo com IDs manipulados.
- [ ] Nova comparação aplica ausência explícita e equivalência de maiúsculas/acentos; texto original não muda.
- [ ] Contrato legado permanece separado, com testes de regressão; nenhuma conversão automática no save.
- [ ] Teste não executa ações nem provisiona recursos como efeito colateral; estados são visíveis na interface.

## 02 — Autorizar acesso da organização e revogá-lo sem depender do criador

**Blocked by:** 01.

**What to build:** Administrador concede um escopo explícito para avaliar lead na execução automática; teste pessoal continua restrito ao chamador. Revogação é demonstrável sem depender da permanência do criador.

**Acceptance criteria:**
- [ ] Escopo persistido e explicado na interface; cliente de serviço não substitui autorização de negócio.
- [ ] Mesmo pedido sob teste e sob concessão da organização respeita suas identidades distintas.
- [ ] Administrador aprova ampliação; ajuste dentro de escopo não pede aprovação adicional.
- [ ] Permissão vigente é checada antes de cada acesso; revogação produz erro não recuperável automaticamente.
- [ ] Testes positivos/negativos cobrem organização, recurso, saída do criador e manipulação de escopo.
- [ ] Granularidade de concessão fica explícita para os próximos domínios; não autorizar domínios ainda não concedidos.

## 03 — Editar rascunho e publicar versão válida e autorizada

**Blocked by:** 02.

**What to build:** Editar a condição simples em rascunho sem modificar a versão publicada; publicar substituta somente quando válida e autorizada.

**Acceptance criteria:**
- [ ] Rascunho incompleto é salvo com erros localizados; versão publicada continua intacta.
- [ ] Publicação cria versão imutável identificável e seleciona a versão ativa de forma consistente.
- [ ] Falha de validação ou ampliação não aprovada não modifica versão ativa.
- [ ] API direta obedece às mesmas garantias do editor; concorrência de edição/publicação não mistura definições.
- [ ] Persistência é aditiva e não reclassifica fluxos legados como novo contrato.

## 04 — Executar e retomar pela versão inicial das regras

**Blocked by:** 03.

**What to build:** Fluxo novo com condição simples e espera mantém suas regras após nova publicação, enquanto consulta dados atuais ao retomar.

**Acceptance criteria:**
- [ ] Todos os produtores de execução vinculam versão publicada no marco de início documentado, inclusive caminhos SQL.
- [ ] Execução antiga usa limite anterior; execução nova usa versão nova; dados de lead são atuais nas duas.
- [ ] Saídas Sim/Não têm ligação explícita, sem fallback pela posição das conexões no contrato novo.
- [ ] Revogação impede próximo acesso mesmo na versão antiga; publicação nova não reautoriza execução por acidente.
- [ ] Retomada não repete decisão já concluída nem ações anteriores; histórico identifica versão usada.
- [ ] Teste integrado comprova publicação durante espera e preservação do executor legado.

## 05 — Montar e testar grupos Todas/Qualquer até três níveis

**Blocked by:** 01.

**What to build:** Criar, duplicar, excluir e recolher regras/grupos no painel ampliável, com avaliação explicada de E/OU e resumo fiel no canvas.

**Acceptance criteria:**
- [ ] Até três níveis incluindo principal, com limite no editor, serviço e contrato serializado.
- [ ] Configuração inteira é validada antes da avaliação, inclusive ramo dispensável com referência inválida.
- [ ] Avaliação abreviada marca regras dispensadas como não avaliadas; não inventa falso.
- [ ] Resumos preservam pertencimento, contexto e combinação, com truncamento evidente.
- [ ] Teclado, foco, bordas e recuos tornam estrutura operável sem depender só de cor.
- [ ] Testes exercitam regra simples e grupos mistos pela mesma fronteira de 01.

## 06 — Selecionar dados padrão do lead sem digitar referências

**Blocked by:** 01.

**What to build:** Configurar e testar tags, responsáveis, origem, UTM e campos escalares do lead com catálogo pesquisável e entradas adequadas.

**Acceptance criteria:**
- [ ] Reaproveitar catálogos existentes; nomes amigáveis no seletor e no resumo.
- [ ] Referências são identificadas sem substituição por mesmo nome; tag não atribuída difere de tag excluída.
- [ ] Números, dinheiro e texto têm operadores pertinentes; zero/falso não são vazio.
- [ ] Trocas limpam apenas escolhas incompatíveis com orientação no campo, sem modal.
- [ ] Loading, erro, lista vazia e cadastro removido são distintos; dados respeitam autorização.
- [ ] Incompatibilidade legada tag/tags é tratada no contrato novo, sem corrigir semanticamente fluxos antigos por acidente.

## 07 — Configurar campos personalizados pelo tipo e identidade

**Blocked by:** 06.

**What to build:** Selecionar campo personalizado cadastrado e comparar valor usando seu tipo, inclusive opções cadastradas e campo sem resposta.

**Acceptance criteria:**
- [ ] Nome/renomeação de campo não substituem identidade; campo removido invalida referência.
- [ ] Conversão de texto persistido para tipo é explícita, sem transformar valor inválido ou ausente em zero.
- [ ] Sugestões limitadas não são tratadas como universo completo de valores válidos.
- [ ] Opções removidas e troca de tipo têm erro/limpeza coerentes no teste e no editor.
- [ ] Matriz de tipos reais do catálogo é coberta por testes públicos e isolamento.

## 08 — Avaliar negócio específico, etapa, valor e permanência atual

**Blocked by:** 02, 06.

**What to build:** Selecionar negócio do gatilho e comparar etapa, valor ou tempo desde a última entrada, sem escolher outro negócio silenciosamente.

**Acceptance criteria:**
- [ ] Usar sujeito e projeção comerciais atuais; tratar posição sem registro financeiro sem inventar valor.
- [ ] Funil delimita opções de etapa; valor e etapa pertencem ao mesmo registro.
- [ ] Dados atuais são avaliados; registro removido produz erro explícito sem substituição.
- [ ] Reentrada reinicia tempo; atualização de nota não reinicia; ausência de data confiável não usa atualização genérica.
- [ ] Fonte e invariantes de datas são verificadas no dev e cobertas nos caminhos de movimento pertinentes.
- [ ] Consulta e teste respeitam escopo de negócio; resumos usam nomes legíveis.

## 09 — Consultar existência de negócio com grupo e recorte explícitos

**Blocked by:** 05, 08.

**What to build:** Perguntar se existe negócio do lead que atende a um grupo inteiro, usando Em aberto por padrão ou ganhos, perdidos e todos.

**Acceptance criteria:**
- [ ] Todas as regras do grupo correspondem ao mesmo negócio, inclusive dois negócios no mesmo funil.
- [ ] Filtro de ciclo de vida é visível e aparece no resumo; não confundir com Situação do lead.
- [ ] Consulta concluída sem correspondência retorna Não; erro ou acesso insuficiente não vira ausência.
- [ ] Consulta delimitada no servidor não usa primeira página do kanban como universo.
- [ ] Testes demonstram que atributos distribuídos entre negócios não satisfazem o grupo.

## 10 — Consultar última venda que permanece ganha

**Blocked by:** 08.

**What to build:** Comparar a última venda ganha pela data de fechamento como ganha, ignorando negócios reabertos e sem presumir pagamento.

**Acceptance criteria:**
- [ ] Data e estado de ganho vêm de fonte canônica verificada; não usar criação ou alteração genérica.
- [ ] Reabrir venda mais recente seleciona anterior; sem elegível, campo vazio.
- [ ] Reganho após reabertura tem interpretação explícita e evidenciada; não inventar evento passado ausente.
- [ ] Classificação histórica de cliente e registros de pagamento não são alterados.
- [ ] Interface e testes cobrem seleção, comparação, ausência e acesso ao registro.

## 11 — Fixar conversa e avaliar mensagem do gatilho com fonte textual

**Blocked by:** 02, 06.

**What to build:** Selecionar conversa do gatilho ou caixa explícita, inspecionar mensagem identificada e testar seu texto/legenda/transcrição já disponível com proveniência.

**Acceptance criteria:**
- [ ] Identidade de caixa, participante e provider é explícita; outras caixas não mudam alvo.
- [ ] Contrato de continuidade de conexão/chip é verificado antes de permitir substituição de identidade.
- [ ] Texto/legenda/transcrição persistidos têm proveniência suficiente para explicar correspondência; não chamar gerador de mídia.
- [ ] Mídia sem texto difere de registro removido e de histórico incompleto.
- [ ] Teste e seleção respeitam acesso à caixa/conversa; fonte textual restrita não aparece.
- [ ] Documentar lacuna caso a fonte persistida não exista e entregar persistência necessária sem transcrição sob demanda.

## 12 — Comprovar cobertura do histórico antes de concluir ausência

**Blocked by:** 11.

**What to build:** Testar existência/ausência de mensagens em período e ver resultado confiável ou Histórico insuficiente, sustentado por cobertura real da conversa.

**Acceptance criteria:**
- [ ] Registrar/consultar evidência de cobertura pertinente, não apenas status completed do job.
- [ ] Caps, chats pulados, erros e lacunas não são interpretados como cobertura completa.
- [ ] Ausência comprovada retorna resultado; lacuna que possa alterá-lo impede Sim/Não.
- [ ] UI do teste explica impedimento sem expor dados restritos; erro classifica sincronização ainda em andamento.
- [ ] Validação integrada cobre limites do período e mensagens tardias sem reconstruir decisões concluídas.
- [ ] Buscar evidência necessária sem exigir histórico irrelevante ou carga ilimitada.

## 13 — Buscar palavras e expressões em mensagem ou período

**Blocked by:** 05, 12.

**What to build:** Configurar palavras/expressões com qualquer/todas, palavra inteira ou trecho, em mensagem do gatilho, última recebida ou busca por período.

**Acceptance criteria:**
- [ ] Ignorar maiúsculas/acentos; preço não casa apreço em palavra inteira, mas casa em trecho.
- [ ] Enter adiciona item; expressão composta permanece inteira; remoção e lista inválida são claras.
- [ ] Todas as expressões correspondem à mesma mensagem; definir composição das fontes dessa mensagem sem misturar mensagens.
- [ ] Negação da busca significa nenhuma mensagem correspondente e exige cobertura suficiente.
- [ ] Fonte textual aparece no teste respeitando acesso; ausência de transcrição não inicia geração nem espera.
- [ ] Normalização de pontuação/espaços, fronteiras temporais e orçamento da busca são documentados e testados.

## 14 — Medir quem aguarda resposta e há quanto tempo corrido

**Blocked by:** 12.

**What to build:** Configurar Lead aguardando resposta ou Empresa aguardando resposta do lead, com comparação de tempo desde primeira mensagem ainda sem resposta.

**Acceptance criteria:**
- [ ] Complementos e follow-ups do mesmo lado não reiniciam relógio; resposta do outro lado encerra sequência.
- [ ] Humano, Copilot e automação contam quando enviados; mídias contam mesmo sem texto.
- [ ] Agendamento, falha e recibos não contam; estados por provider são mapeados explicitamente.
- [ ] Nunca houve mensagem significa espera não iniciada, não zero minutos.
- [ ] Tempo corrido somente; histórico insuficiente impede conclusão e mensagem tardia só muda avaliações futuras.
- [ ] Editor, resumo e teste exibem direção e marco temporal sem vazar dados.

## 15 — Recuperar avaliação temporariamente indisponível sem repetir ações

**Blocked by:** 04.

**What to build:** Fluxo aguarda nova tentativa de condição após falha temporária e retoma avaliação inteira com dados atuais, sem reexecutar ações anteriores.

**Acceptance criteria:**
- [ ] Número/intervalos crescentes são limitados, documentados e compatíveis com worker existente.
- [ ] Nenhum resultado parcial sobrevive à tentativa; nenhuma saída é escolhida durante espera.
- [ ] Referência removida, configuração inválida e revogação não entram em retry automático.
- [ ] Esgotamento gera erro visível; sincronização em andamento usa mesma política quando classificada recuperável.
- [ ] Teste integrado comprova ação anterior única, dados alterados entre tentativas e conclusão persistida sem duplicação.

## 16 — Consultar histórico sem herdar privilégios da automação

**Blocked by:** 04.

**What to build:** Consultar versões, resultados e erros de execução com proteção aplicada às permissões atuais do leitor.

**Acceptance criteria:**
- [ ] Servidor limita valores, resultados, caminhos e erros que permitam inferir dados restritos.
- [ ] Editar automações não concede leitura adicional; autorização organizacional da execução não é transferida ao leitor.
- [ ] Mudança de permissão após execução altera visibilidade sem apagar histórico.
- [ ] Dados seguros continuam úteis para diagnosticar falha e identificar versão/momento quando autorizados.
- [ ] Testes de acesso direto à API e UI cobrem leitor permitido, negado e outra organização.

## 17 — Consultar atividades com vínculo e significado explícitos

**Blocked by:** 02, 06.

**What to build:** Selecionar critérios de atividades vinculadas ao lead ou negócio e testar estado/data com nomes de domínio precisos.

**Acceptance criteria:**
- [ ] Verificar fontes e estados reais; não usar página limitada como prova de ausência.
- [ ] Critério identifica a relação lead/negócio e não mistura atividades de negociações distintas.
- [ ] Pendência, conclusão e datas são comparadas conforme seu significado real, sem equivaler criação de atividade a contato.
- [ ] “Último contato” só é disponibilizado após fechar quais eventos contam; se modelo não resolver a ambiguidade, registrar decisão necessária ao CTO antes de implementá-lo.
- [ ] Seletores, resumo, acesso e teste funcionam juntos para os critérios efetivamente definidos.

## 18 — Consultar produto pela relação comercial correta

**Blocked by:** 08.

**What to build:** Selecionar produto e relação consultada, distinguindo item do negócio de produto associado ao lead ou histórico de venda.

**Acceptance criteria:**
- [ ] Inventariar relações reais e conservar suas identidades; não equiparar interesse, item negociado e compra.
- [ ] Produto do negócio específico é avaliado dentro do mesmo negócio, sem misturar itens de outros.
- [ ] Cadastro removido e produto não relacionado são estados distintos.
- [ ] Qualquer critério adicional cuja relação não esteja definida exige decisão de domínio antes de ser exposto; não presumir pagamento.
- [ ] Seleção, resumo, autorização e teste têm cobertura de presença, ausência, remoção e cruzamento de registros.

## 19 — Importar e duplicar condições com referências seguras

**Blocked by:** 05, 07, 09, 10, 13, 14, 17, 18.

**What to build:** Copiar, duplicar, exportar e importar árvores de condições completas preservando significado e exigindo remapeamento explícito de referências no destino.

**Acceptance criteria:**
- [ ] IDs de regras/grupos são tratados sem colisão na cópia; estrutura e contexto permanecem legíveis.
- [ ] Todos os tipos entregues têm tratamento de referências, inclusive aninhadas e de conversa.
- [ ] Organização destino não recebe IDs ou aprovação válidos apenas na origem.
- [ ] Importação nasce como rascunho; referências pendentes são indicadas e impedem publicação.
- [ ] Round-trip na mesma organização e importação entre organizações são testados pela fronteira de portabilidade existente.

## 20 — Migrar legado explicitamente com comparação de significado

**Blocked by:** 04, 15, 16, 19.

**What to build:** Revisar uma automação legada, visualizar diferenças semânticas e criar versão nova explicitamente, preservando execução antiga e horário pausante.

**Acceptance criteria:**
- [ ] Inventariar tags, custom por nome, vazio/zero, etapas antigas, aliases, regex e horário; não prometer conversão automática equivalente.
- [ ] Mapeamento ambíguo exige correção explícita; mesmo nome não prova identidade.
- [ ] Horário pausante permanece legado até transformação revisada; novo condicional não passa a esperar.
- [ ] Não inventar versão histórica de execução antiga; documentar tratamento operacional do legado em andamento.
- [ ] Publicação e autorização da versão nova passam pelos gates normais; fluxo antigo não é alterado por abrir editor.
- [ ] Regressões existentes e exemplos de antes/depois demonstram preservação e mudanças deliberadas.

## 21 — Validar jornada completa e limites antes da liberação

**Blocked by:** 20.

**What to build:** Demonstrar configuração, teste, publicação, execução, falha e diagnóstico da primeira entrega em ambiente dev, com limites medidos e critério verificável de liberação.

**Acceptance criteria:**
- [ ] E2E real cobre jornada principal, teclado, grupos recolhidos, resumo, erros no campo e publicação versionada.
- [ ] Integração real comprova isolamento e revogação, sem tratar mocks como prova de RLS.
- [ ] Medir volume representativo e fixar limites de consultas, período, expressões e timeout no servidor e UI.
- [ ] Históricos grandes não são carregados integralmente; truncamento não vira ausência.
- [ ] Critérios de produtos/atividades com decisão pendente não são declarados entregues; lacunas são resolvidas antes de certificar escopo completo.
- [ ] Tempo comercial permanece segunda entrega; liberação em produção exige autorização específica.
- [ ] Este ticket integra evidências; não substitui testes obrigatórios de cada fatia.

## Fronteira e cobertura

- Primeiro início possível: 01. Após 01: 02, 05 e 06 podem avançar independentemente.
- 19 depende dos tipos finais porque é a verificação de portabilidade de todos os contratos entregues, não um refatoramento antecipado do mecanismo genérico.
- 20 depende da autorização/histórico/recuperação e da portabilidade completa para converter sem perder significado ou segurança.
- 21 depende transitivamente de todas as fatias; o vínculo único com 20 evita arestas redundantes.
- Nenhum ticket de tempo comercial será publicado nesta rodada.
- Produtos e atividades mantêm limites de domínio conhecidos; suas ambiguidades explícitas não devem ser ocultadas pela label ready-for-agent do épico.
