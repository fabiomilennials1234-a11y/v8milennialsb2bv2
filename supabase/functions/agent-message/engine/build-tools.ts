/**
 * Constrói a lista de tools disponíveis para o LLM com base nas capabilities.
 *
 * Função pura — recebe supabase + organizationId + capabilities + custom fields
 * + pipeline stages. Mantém comportamento idêntico ao original.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface BuildToolsParams {
  supabase: SupabaseClient;
  organizationId: string;
  capabilities: any;
  orgCustomFields?: Array<{ field_name: string }>;
  pipelineStages?: Array<{ stage_key: string; name: string; pipeline_type: string }>;
}

export async function buildDynamicTools(params: BuildToolsParams): Promise<any[]> {
  const {
    supabase,
    organizationId,
    capabilities,
    orgCustomFields = [],
    pipelineStages = [],
  } = params;

  const tools: any[] = [];

  // search_knowledge — disponível quando o agente tem documentos na KB
  try {
    const { count } = await supabase
      .from("copilot_agent_documents")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", capabilities.id)
      .eq("status", "ready");

    if (count && count > 0) {
      tools.push({
        name: "search_knowledge",
        description:
          "Consulta a base de conhecimento da empresa. Use OBRIGATORIAMENTE antes de responder sobre produtos, servicos, precos, especificacoes, politicas ou catalogo. Retorna informacoes precisas dos documentos da empresa.",
        input_schema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: 'Termo de busca. Ex: "saude bucal", "preco omega", "politica troca"',
            },
          },
          required: ["query"],
        },
      });
    }
  } catch (e) {
    console.warn("[engine/build-tools] Failed to check KB docs:", e);
  }

  if (capabilities.can_schedule_meeting) {
    tools.push({
      name: "schedule_meeting",
      description:
        "Agenda uma reunião para o lead. Se o responsável tiver Google Calendar conectado, cria o evento automaticamente e gera link do Google Meet.",
      input_schema: {
        type: "object",
        properties: {
          preferred_date: { type: "string", description: "Data preferida (YYYY-MM-DD)" },
          preferred_time: { type: "string", description: "Horário preferido (HH:MM, padrão 09:00)" },
        },
        required: ["preferred_date"],
      },
    });
  }

  if (capabilities.can_create_lead) {
    tools.push({
      name: "create_lead",
      description: "Cria um novo lead no CRM",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          company: { type: "string" },
        },
        required: ["name"],
      },
    });
  }

  if (capabilities.can_update_crm) {
    tools.push({
      name: "update_crm",
      description: "Atualiza informações no CRM externo",
      input_schema: {
        type: "object",
        properties: {
          field: { type: "string" },
          value: { type: "string" },
        },
        required: ["field", "value"],
      },
    });
  }

  if (capabilities.can_update_lead) {
    const customNames =
      orgCustomFields.length > 0 ? orgCustomFields.map((f) => f.field_name).join(", ") : "nenhum";
    tools.push({
      name: "update_lead",
      description: `Atualiza informações do lead no CRM v8. Campos padrão: company, segment, urgency, faturamento, rating. Campos personalizados disponíveis: ${customNames}. Qualquer outra informação (ex: preferência, orçamento) vai para notas/observações do lead.`,
      input_schema: {
        type: "object",
        properties: {
          updates: {
            type: "object",
            description:
              'Objeto chave-valor. Ex: {"company": "Acme", "segment": "B2B", "Preferência de horário": "manhã"}',
            additionalProperties: { type: "string" },
          },
        },
        required: ["updates"],
      },
    });
  }

  if (capabilities.can_qualify_lead) {
    tools.push({
      name: "update_qualification_score",
      description:
        "Atualiza o score de qualificação do lead (0-100) conforme coleta informações. Use após cada resposta relevante do lead. Score sugerido: 20 por critério atendido (necessidade, orçamento, urgência, perfil, timing).",
      input_schema: {
        type: "object",
        properties: {
          score: { type: "number", description: "Novo score de qualificação (0-100)" },
          reason: { type: "string", description: "O que o lead revelou que justifica este score" },
        },
        required: ["score"],
      },
    });
    tools.push({
      name: "qualify_lead",
      description:
        "Marca o lead como qualificado quando reuniu os critérios necessários (necessidade, volume, urgência, orçamento etc.)",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Breve justificativa da qualificação (opcional)" },
        },
        required: [],
      },
    });
    tools.push({
      name: "disqualify_lead",
      description:
        "Marca o lead como desqualificado quando não se encaixa (sem necessidade, fora do perfil, sem orçamento etc.)",
      input_schema: {
        type: "object",
        properties: {
          reason: { type: "string", description: "Motivo da desqualificação (opcional)" },
        },
        required: [],
      },
    });
    const pipeLabelsForTool: Record<string, string> = {
      whatsapp: "WhatsApp",
      confirmacao: "Confirmação",
      propostas: "Propostas",
      upsell_base: "Carteira Base",
      upsell_gestao: "Carteira Gestão",
      campanha: "Campanhas",
    };
    let stageDescription = "";
    if (pipelineStages.length > 0) {
      const grouped: Record<string, string[]> = {};
      for (const s of pipelineStages) {
        const key = s.pipeline_type || "whatsapp";
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(s.stage_key);
      }
      const parts = Object.entries(grouped).map(
        ([pipe, stages]) => `${pipeLabelsForTool[pipe] || pipe}: ${stages.join(", ")}`,
      );
      stageDescription = parts.join(" | ");
    } else {
      stageDescription = "WhatsApp: novo, abordado, respondeu, esfriou, agendado";
    }
    tools.push({
      name: "advance_stage",
      description: `Avança o lead para outra etapa do funil. Etapas disponíveis por funil: ${stageDescription}. Use quando o lead progredir na jornada.`,
      input_schema: {
        type: "object",
        properties: {
          target_stage: { type: "string", description: "Etapa de destino" },
          target_pipe: {
            type: "string",
            description: `Funil de destino (whatsapp, confirmacao, propostas, upsell_base, upsell_gestao, campanha). Padrão: whatsapp`,
            enum: ["whatsapp", "confirmacao", "propostas", "upsell_base", "upsell_gestao", "campanha"],
          },
        },
        required: ["target_stage"],
      },
    });
  }

  // Confirmador de reuniões
  if (capabilities.can_schedule_meeting) {
    tools.push({
      name: "confirm_meeting",
      description:
        "Confirma a presença do lead na reunião. Marca como pré-confirmado ou confirmado no pipe de Confirmação. Use quando o lead disser que vai comparecer.",
      input_schema: {
        type: "object",
        properties: {
          confirmation_type: {
            type: "string",
            enum: ["pre_confirmed", "confirmed"],
            description:
              "Tipo de confirmação: pre_confirmed (pré-confirmado, antes do dia) ou confirmed (confirmado no dia)",
          },
        },
        required: ["confirmation_type"],
      },
    });
    tools.push({
      name: "advance_confirmation_stage",
      description:
        "Move o lead para outra etapa do funil de confirmação. Etapas: reuniao_marcada, confirmar_d5, confirmar_d3, confirmar_d1, confirmacao_no_dia, remarcar, compareceu, perdido. Use para avançar ou reagendar no pipe de confirmação.",
      input_schema: {
        type: "object",
        properties: {
          target_stage: {
            type: "string",
            enum: [
              "reuniao_marcada",
              "confirmar_d5",
              "confirmar_d3",
              "confirmar_d1",
              "confirmacao_no_dia",
              "remarcar",
              "compareceu",
              "perdido",
            ],
            description: "Etapa de destino no pipe de confirmação",
          },
        },
        required: ["target_stage"],
      },
    });
  }

  if (capabilities.can_transfer_human) {
    const hasNotifyPhones = Array.isArray(capabilities.handoff_notify_phones) && capabilities.handoff_notify_phones.length > 0;

    const transferProperties: Record<string, unknown> = {
      reason: { type: "string", description: "Motivo da transferência para humano" },
    };
    const transferRequired = ["reason"];

    if (hasNotifyPhones) {
      const phoneList = (capabilities.handoff_notify_phones as string[]).join(", ");
      const instructions = capabilities.handoff_notify_instructions || "";

      transferProperties.summary = {
        type: "string",
        description: "Resumo da conversa em 2-3 frases para o humano que vai atender",
      };
      transferProperties.priority = {
        type: "string",
        enum: ["ALTA", "MÉDIA", "NORMAL"],
        description: "Prioridade do lead baseado no contexto da conversa",
      };
      transferProperties.priority_reason = {
        type: "string",
        description: "Razão da prioridade (ex: pedido alto valor, urgência, produto específico)",
      };
      transferProperties.notify_phones = {
        type: "array",
        items: { type: "string" },
        description: `Números para notificar via WhatsApp. Disponíveis: ${phoneList}. ${instructions ? "Regras de roteamento: " + instructions : "Notificar todos."}`,
      };
      transferRequired.push("summary", "priority", "priority_reason", "notify_phones");
    }

    tools.push({
      name: "transfer_to_human",
      description: hasNotifyPhones
        ? "Transfere conversa para atendimento humano e notifica equipe via WhatsApp"
        : "Transfere conversa para atendimento humano",
      input_schema: {
        type: "object",
        properties: transferProperties,
        required: transferRequired,
      },
    });
  }

  // send_document tool — documentos da KB
  try {
    const { data: agentDocs } = await supabase
      .from("copilot_agent_documents")
      .select("id, file_name, summary, send_when")
      .eq("agent_id", capabilities.id)
      .eq("status", "ready");

    if (agentDocs && agentDocs.length > 0) {
      const docList = agentDocs
        .map(
          (d: { id: string; file_name: string; summary: string | null; send_when: string | null }) => {
            const summaryPart = d.summary ? ` — ${d.summary.substring(0, 80)}...` : "";
            // send_when é o gatilho explícito definido pelo operador (Playground).
            // Para documento (PDF), o summary descreve o conteúdo; send_when diz
            // QUANDO mandar. Surfar separado pra o agente não depender só do summary.
            const trigger = d.send_when ? ` [Enviar quando: ${d.send_when}]` : "";
            return `- "${d.file_name}" (id: ${d.id})${summaryPart}${trigger}`;
          },
        )
        .join("\n");

      tools.push({
        name: "send_document",
        description: `Envia um documento/arquivo da base de conhecimento para o lead via WhatsApp. Use quando o lead pedir um catalogo, proposta, tabela de precos, ou qualquer documento disponivel.\n\nDocumentos disponiveis:\n${docList}`,
        input_schema: {
          type: "object",
          properties: {
            document_id: {
              type: "string",
              description: "ID do documento a enviar (use os IDs listados acima)",
            },
            caption: {
              type: "string",
              description: "Mensagem curta que acompanha o arquivo (opcional, max 200 chars)",
            },
          },
          required: ["document_id"],
        },
      });
    }
  } catch (e) {
    console.warn("[engine/build-tools] Failed to load documents for send_document tool:", e);
  }

  // send_product_material tool — material de produto
  try {
    const { data: productMats } = await supabase
      .from("product_materials")
      .select("id, product_id, file_name, material_type, products!inner(name)")
      .eq("organization_id", organizationId)
      .eq("is_active", true);

    if (productMats && productMats.length > 0) {
      const matList = productMats
        .map(
          (m: any) =>
            `- "${m.file_name}" (id: ${m.id}, produto: ${m.products?.name || "N/A"}, tipo: ${m.material_type})`,
        )
        .join("\n");

      tools.push({
        name: "send_product_material",
        description: `Envia um material de produto (PDF comercial, catalogo, imagem, flyer) para o lead via WhatsApp. Use quando o lead demonstrar interesse em um produto e fizer sentido enviar material de apoio.\n\nMateriais disponiveis:\n${matList}`,
        input_schema: {
          type: "object",
          properties: {
            material_id: {
              type: "string",
              description: "ID do material a enviar (use os IDs listados acima)",
            },
            caption: {
              type: "string",
              description: "Mensagem curta que acompanha o material (opcional, max 200 chars)",
            },
          },
          required: ["material_id"],
        },
      });
    }
  } catch (e) {
    console.warn("[engine/build-tools] Failed to load product materials:", e);
  }

  // transfer_sz_chat tool — setor externo
  let szChatConfig: { team_mappings: Record<string, unknown> } | null = null;
  try {
    const { data } = await supabase
      .from("sz_chat_config")
      .select("team_mappings")
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .maybeSingle();
    szChatConfig = data;
  } catch (e) {
    console.warn("[engine/build-tools] sz_chat_config query failed (non-fatal):", e);
  }

  if (szChatConfig?.team_mappings && Object.keys(szChatConfig.team_mappings).length > 0) {
    const teamNames = Object.keys(szChatConfig.team_mappings);
    tools.push({
      name: "transfer_sz_chat",
      description: `Transferir o atendimento para outro setor da empresa. Setores disponíveis: ${teamNames.join(", ")}. Use quando o cliente solicitar algo fora do escopo comercial.`,
      input_schema: {
        type: "object",
        properties: {
          target_team_name: {
            type: "string",
            description: `Nome do setor para transferir. Opções: ${teamNames.join(", ")}`,
            enum: teamNames,
          },
          message_to_client: {
            type: "string",
            description: "Mensagem para o cliente informando sobre a transferência",
          },
        },
        required: ["target_team_name", "message_to_client"],
      },
    });
  }

  // create_custom_field tool
  if (capabilities.can_create_custom_field) {
    tools.push({
      name: "create_custom_field",
      description:
        "Cria um novo campo personalizado no CRM para armazenar informacoes do lead que nao existem nos campos padrao. Use quando precisar registrar uma informacao que nao tem campo dedicado. Tipos: text (texto livre), number (numerico), date (data), select (opcoes), boolean (sim/nao).",
      input_schema: {
        type: "object",
        properties: {
          field_name: {
            type: "string",
            description: 'Nome do campo (ex: "Orcamento estimado", "Ferramenta atual", "Numero de funcionarios")',
          },
          field_type: {
            type: "string",
            enum: ["text", "number", "date", "select", "boolean"],
            description: "Tipo do campo",
          },
          field_options: {
            type: "array",
            items: { type: "string" },
            description:
              'Opcoes disponiveis (obrigatorio se field_type = select). Ex: ["Pequeno", "Medio", "Grande"]',
          },
          initial_value: {
            type: "string",
            description: "Valor inicial para preencher no lead atual (opcional)",
          },
        },
        required: ["field_name", "field_type"],
      },
    });
  }

  return tools;
}
