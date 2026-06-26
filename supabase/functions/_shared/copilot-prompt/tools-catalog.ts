// PORT de src/modules/copilot/components/playground/types.ts PLAYGROUND_TOOLS.
// Só {id,name,defaultInstruction}. Ordem = ordem dos blocos no prompt. Guard: tools-catalog.test.ts.

export interface CatalogTool {
  id: string;
  name: string;
  defaultInstruction: string;
}

export const TOOLS_CATALOG: readonly CatalogTool[] = [
  {
    id: "QUALIFICAR_LEAD",
    name: "Qualificar Lead",
    defaultInstruction:
      "Conforme o lead compartilha informacoes durante a conversa (nome, empresa, cargo, necessidade, orcamento, timeline), registre progressivamente — nao espere coletar tudo. Quando os campos obrigatorios estiverem completos, qualifique o lead automaticamente. Se claramente nao se encaixa no perfil ideal, desqualifique com motivo.",
  },
  {
    id: "AGENDAR_REUNIAO",
    name: "Agendar Reuniao",
    defaultInstruction:
      "Quando o lead demonstrar interesse claro (pedir preco, perguntar sobre implementacao, querer saber proximos passos), sugira proativamente uma reuniao. Apresente opcoes de horario quando disponiveis. Ao confirmar, agende imediatamente.",
  },
  {
    id: "MOVER_CARD",
    name: "Mover Card",
    defaultInstruction:
      "Mova o lead entre etapas do funil automaticamente conforme a conversa progride. Lead respondeu → mover para 'Respondeu'. Lead qualificado → mover para 'Qualificado'. Lead nao responde apos follow-ups → mover para 'Esfriou'. Nao peca permissao — aja conforme o contexto da conversa.",
  },
  {
    id: "TRANSFERIR_HUMANO",
    name: "Transferir para Humano",
    defaultInstruction:
      "Transfira para um humano apenas quando: (1) o lead pedir explicitamente, (2) a duvida for tecnica demais e nao estiver na base de conhecimento, (3) o lead demonstrar frustracao ou a conversa entrar em loop. Antes de transferir, resuma o contexto da conversa para o atendente.",
  },
  {
    id: "CRIAR_LEAD",
    name: "Criar Lead",
    defaultInstruction:
      "Quando um contato desconhecido iniciar conversa e fornecer nome e pelo menos um meio de contato (telefone ou email), crie o lead automaticamente. Extraia todas as informacoes disponiveis da conversa para preencher os campos iniciais.",
  },
  {
    id: "PREENCHER_CAMPOS",
    name: "Preencher Campos do Lead",
    defaultInstruction:
      "Sempre que o lead mencionar informacoes relevantes (empresa, cargo, segmento, numero de funcionarios, orcamento, ferramenta atual, etc.), preencha o campo correspondente imediatamente. Extraia dados naturalmente da conversa — nao pergunte 'posso salvar isso?'. Se nao existir campo dedicado para a informacao, registre em notas.",
  },
  {
    id: "TRANSFERIR_SZ_CHAT",
    name: "Transferir SZ.Chat",
    defaultInstruction:
      "Transfira para SZ.Chat quando o assunto estiver fora do escopo comercial — suporte tecnico, financeiro, logistica ou outro setor configurado. Informe o cliente que sera atendido por outro setor e resuma o contexto antes de transferir.",
  },
  {
    id: "ENVIAR_DOCUMENTO",
    name: "Enviar Documento",
    defaultInstruction:
      "Quando o lead pedir catalogo, tabela de precos, proposta ou qualquer material disponivel na base de conhecimento, envie o documento imediatamente. Se o lead demonstrar interesse em produto/servico e houver material relevante, envie proativamente sem esperar pedido explicito.",
  },
  {
    id: "CRIAR_CAMPO",
    name: "Criar Campo Personalizado",
    defaultInstruction:
      "Quando o lead fornecer informacao relevante para a qual nao existe campo (padrao ou customizado), crie um novo campo personalizado e preencha o valor. Exemplo: se mencionarem 'temos 15 lojas' e nao ha campo para isso, crie 'Numero de Lojas' como numerico e preencha com 15.",
  },
  {
    id: "PAUSAR_ATENDIMENTO_HUMANO",
    name: "Pausar ao atendimento humano",
    defaultInstruction:
      "Quando um agente humano assumir a conversa, pause automaticamente e aguarde o tempo configurado antes de retomar.",
  },
] as const;

export const CATALOG_BY_ID: Record<string, CatalogTool> = Object.fromEntries(
  TOOLS_CATALOG.map((t) => [t.id, t]),
);
