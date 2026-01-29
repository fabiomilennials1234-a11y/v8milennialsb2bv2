export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      acoes_do_dia: {
        Row: {
          completed_at: string | null
          confirmacao_id: string | null
          created_at: string
          description: string | null
          follow_up_id: string | null
          id: string
          is_completed: boolean | null
          lead_id: string | null
          position: number | null
          proposta_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmacao_id?: string | null
          created_at?: string
          description?: string | null
          follow_up_id?: string | null
          id?: string
          is_completed?: boolean | null
          lead_id?: string | null
          position?: number | null
          proposta_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          confirmacao_id?: string | null
          created_at?: string
          description?: string | null
          follow_up_id?: string | null
          id?: string
          is_completed?: boolean | null
          lead_id?: string | null
          position?: number | null
          proposta_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acoes_do_dia_confirmacao_id_fkey"
            columns: ["confirmacao_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_follow_up_id_fkey"
            columns: ["follow_up_id"]
            isOneToOne: false
            referencedRelation: "follow_ups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_proposta_id_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
        ]
      }
      awards: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          month: number | null
          name: string
          prize_description: string | null
          prize_value: number | null
          threshold: number
          type: string
          year: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          month?: number | null
          name: string
          prize_description?: string | null
          prize_value?: number | null
          threshold: number
          type: string
          year?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          month?: number | null
          name?: string
          prize_description?: string | null
          prize_value?: number | null
          threshold?: number
          type?: string
          year?: number | null
        }
        Relationships: []
      }
      campanha_leads: {
        Row: {
          campanha_id: string
          created_at: string | null
          id: string
          lead_id: string
          notes: string | null
          sdr_id: string | null
          stage_id: string
          updated_at: string | null
        }
        Insert: {
          campanha_id: string
          created_at?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          sdr_id?: string | null
          stage_id: string
          updated_at?: string | null
        }
        Update: {
          campanha_id?: string
          created_at?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          sdr_id?: string | null
          stage_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_leads_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_members: {
        Row: {
          bonus_earned: boolean | null
          campanha_id: string
          created_at: string | null
          id: string
          meetings_count: number | null
          team_member_id: string
        }
        Insert: {
          bonus_earned?: boolean | null
          campanha_id: string
          created_at?: string | null
          id?: string
          meetings_count?: number | null
          team_member_id: string
        }
        Update: {
          bonus_earned?: boolean | null
          campanha_id?: string
          created_at?: string | null
          id?: string
          meetings_count?: number | null
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanha_members_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_stages: {
        Row: {
          campanha_id: string
          color: string | null
          created_at: string | null
          id: string
          is_reuniao_marcada: boolean | null
          name: string
          position: number
        }
        Insert: {
          campanha_id: string
          color?: string | null
          created_at?: string | null
          id?: string
          is_reuniao_marcada?: boolean | null
          name: string
          position?: number
        }
        Update: {
          campanha_id?: string
          color?: string | null
          created_at?: string | null
          id?: string
          is_reuniao_marcada?: boolean | null
          name?: string
          position?: number
        }
        Relationships: [
          {
            foreignKeyName: "campanha_stages_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
        ]
      }
      campanhas: {
        Row: {
          bonus_value: number | null
          created_at: string | null
          deadline: string
          description: string | null
          id: string
          individual_goal: number | null
          is_active: boolean | null
          name: string
          team_goal: number
          updated_at: string | null
        }
        Insert: {
          bonus_value?: number | null
          created_at?: string | null
          deadline: string
          description?: string | null
          id?: string
          individual_goal?: number | null
          is_active?: boolean | null
          name: string
          team_goal?: number
          updated_at?: string | null
        }
        Update: {
          bonus_value?: number | null
          created_at?: string | null
          deadline?: string
          description?: string | null
          id?: string
          individual_goal?: number | null
          is_active?: boolean | null
          name?: string
          team_goal?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      copilot_agents: {
        Row: {
          id: string
          organization_id: string
          name: string
          template_type: string
          personality_tone: string
          personality_style: string
          personality_energy: string
          skills: Json | null
          allowed_topics: Json | null
          forbidden_topics: Json | null
          main_objective: string | null
          business_context: Json | null
          conversation_style: Json | null
          qualification_rules: Json | null
          few_shot_examples: Json | null
          availability: Json | null
          response_delay_seconds: number | null
          is_active: boolean
          is_default: boolean
          created_by: string | null
          created_at: string
          updated_at: string
          active_pipes: Json | null
          active_stages: Json | null
          can_move_cards: boolean | null
          auto_move_on_qualify: boolean | null
          auto_move_on_objective: boolean | null
          move_rules: Json | null
          operation_mode: string | null
          activation_triggers: Json | null
          outbound_config: Json | null
          automation_actions: Json | null
          campaign_id: string | null
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          template_type: string
          personality_tone?: string
          personality_style?: string
          personality_energy?: string
          skills?: Json | null
          allowed_topics?: Json | null
          forbidden_topics?: Json | null
          main_objective?: string | null
          business_context?: Json | null
          conversation_style?: Json | null
          qualification_rules?: Json | null
          few_shot_examples?: Json | null
          availability?: Json | null
          response_delay_seconds?: number | null
          is_active?: boolean
          is_default?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          active_pipes?: Json | null
          active_stages?: Json | null
          can_move_cards?: boolean | null
          auto_move_on_qualify?: boolean | null
          auto_move_on_objective?: boolean | null
          move_rules?: Json | null
          operation_mode?: string | null
          activation_triggers?: Json | null
          outbound_config?: Json | null
          automation_actions?: Json | null
          campaign_id?: string | null
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          template_type?: string
          personality_tone?: string
          personality_style?: string
          personality_energy?: string
          skills?: Json | null
          allowed_topics?: Json | null
          forbidden_topics?: Json | null
          main_objective?: string | null
          business_context?: Json | null
          conversation_style?: Json | null
          qualification_rules?: Json | null
          few_shot_examples?: Json | null
          availability?: Json | null
          response_delay_seconds?: number | null
          is_active?: boolean
          is_default?: boolean
          created_by?: string | null
          created_at?: string
          updated_at?: string
          active_pipes?: Json | null
          active_stages?: Json | null
          can_move_cards?: boolean | null
          auto_move_on_qualify?: boolean | null
          auto_move_on_objective?: boolean | null
          move_rules?: Json | null
          operation_mode?: string | null
          activation_triggers?: Json | null
          outbound_config?: Json | null
          automation_actions?: Json | null
          campaign_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_faqs: {
        Row: {
          id: string
          agent_id: string
          question: string
          answer: string
          position: number
          created_at: string
        }
        Insert: {
          id?: string
          agent_id: string
          question: string
          answer: string
          position?: number
          created_at?: string
        }
        Update: {
          id?: string
          agent_id?: string
          question?: string
          answer?: string
          position?: number
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_faqs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_kanban_rules: {
        Row: {
          id: string
          agent_id: string
          pipe_type: string
          stage_name: string
          goal: string | null
          behavior: string | null
          allowed_actions: Json | null
          forbidden_actions: Json | null
          created_at: string
        }
        Insert: {
          id?: string
          agent_id: string
          pipe_type: string
          stage_name: string
          goal?: string | null
          behavior?: string | null
          allowed_actions?: Json | null
          forbidden_actions?: Json | null
          created_at?: string
        }
        Update: {
          id?: string
          agent_id?: string
          pipe_type?: string
          stage_name?: string
          goal?: string | null
          behavior?: string | null
          allowed_actions?: Json | null
          forbidden_actions?: Json | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_kanban_rules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      commissions: {
        Row: {
          amount: number
          created_at: string
          id: string
          month: number
          paid: boolean | null
          pipe_proposta_id: string | null
          team_member_id: string
          type: Database["public"]["Enums"]["product_type"]
          year: number
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          month: number
          paid?: boolean | null
          pipe_proposta_id?: string | null
          team_member_id: string
          type: Database["public"]["Enums"]["product_type"]
          year: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          month?: number
          paid?: boolean | null
          pipe_proposta_id?: string | null
          team_member_id?: string
          type?: Database["public"]["Enums"]["product_type"]
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "commissions_pipe_proposta_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_automations: {
        Row: {
          created_at: string
          days_offset: number
          description_template: string | null
          id: string
          is_active: boolean | null
          pipe_type: string
          priority: string
          stage: string
          title_template: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          days_offset?: number
          description_template?: string | null
          id?: string
          is_active?: boolean | null
          pipe_type: string
          priority?: string
          stage: string
          title_template: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          days_offset?: number
          description_template?: string | null
          id?: string
          is_active?: boolean | null
          pipe_type?: string
          priority?: string
          stage?: string
          title_template?: string
          updated_at?: string
        }
        Relationships: []
      }
      follow_ups: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string
          id: string
          is_automated: boolean | null
          lead_id: string
          priority: string
          source_pipe: string | null
          source_pipe_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date: string
          id?: string
          is_automated?: boolean | null
          lead_id: string
          priority?: string
          source_pipe?: string | null
          source_pipe_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string
          id?: string
          is_automated?: boolean | null
          lead_id?: string
          priority?: string
          source_pipe?: string | null
          source_pipe_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_ups_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      goals: {
        Row: {
          created_at: string
          current_value: number | null
          id: string
          month: number
          name: string
          product_id: string | null
          target_value: number
          team_member_id: string | null
          type: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          current_value?: number | null
          id?: string
          month: number
          name: string
          product_id?: string | null
          target_value: number
          team_member_id?: string | null
          type: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          current_value?: number | null
          id?: string
          month?: number
          name?: string
          product_id?: string | null
          target_value?: number
          team_member_id?: string | null
          type?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "goals_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goals_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_history: {
        Row: {
          action: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          lead_id: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lead_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          lead_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_scores: {
        Row: {
          created_at: string
          factors: Json | null
          id: string
          last_calculated: string
          lead_id: string
          predicted_conversion: number | null
          recommended_action: string | null
          score: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          factors?: Json | null
          id?: string
          last_calculated?: string
          lead_id: string
          predicted_conversion?: number | null
          recommended_action?: string | null
          score?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          factors?: Json | null
          id?: string
          last_calculated?: string
          lead_id?: string
          predicted_conversion?: number | null
          recommended_action?: string | null
          score?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_scores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_tags: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          tag_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          tag_id: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          closer_id: string | null
          company: string | null
          compromisso_date: string | null
          created_at: string
          email: string | null
          faturamento: string | null
          id: string
          name: string
          notes: string | null
          origin: Database["public"]["Enums"]["lead_origin"]
          phone: string | null
          rating: number | null
          sdr_id: string | null
          segment: string | null
          updated_at: string
          urgency: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          closer_id?: string | null
          company?: string | null
          compromisso_date?: string | null
          created_at?: string
          email?: string | null
          faturamento?: string | null
          id?: string
          name: string
          notes?: string | null
          origin?: Database["public"]["Enums"]["lead_origin"]
          phone?: string | null
          rating?: number | null
          sdr_id?: string | null
          segment?: string | null
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          closer_id?: string | null
          company?: string | null
          compromisso_date?: string | null
          created_at?: string
          email?: string | null
          faturamento?: string | null
          id?: string
          name?: string
          notes?: string | null
          origin?: Database["public"]["Enums"]["lead_origin"]
          phone?: string | null
          rating?: number | null
          sdr_id?: string | null
          segment?: string | null
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_reativacao: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          original_pipe: string | null
          reactivation_date: string | null
          reason: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          original_pipe?: string | null
          reactivation_date?: string | null
          reason?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          original_pipe?: string | null
          reactivation_date?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_reativacao_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_confirmacao: {
        Row: {
          closer_id: string | null
          created_at: string
          id: string
          is_confirmed: boolean
          lead_id: string
          meeting_date: string | null
          notes: string | null
          sdr_id: string | null
          status: Database["public"]["Enums"]["pipe_confirmacao_status"]
          updated_at: string
        }
        Insert: {
          closer_id?: string | null
          created_at?: string
          id?: string
          is_confirmed?: boolean
          lead_id: string
          meeting_date?: string | null
          notes?: string | null
          sdr_id?: string | null
          status?: Database["public"]["Enums"]["pipe_confirmacao_status"]
          updated_at?: string
        }
        Update: {
          closer_id?: string | null
          created_at?: string
          id?: string
          is_confirmed?: boolean
          lead_id?: string
          meeting_date?: string | null
          notes?: string | null
          sdr_id?: string | null
          status?: Database["public"]["Enums"]["pipe_confirmacao_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipe_confirmacao_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_confirmacao_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_confirmacao_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_proposta_items: {
        Row: {
          created_at: string
          id: string
          pipe_proposta_id: string
          product_id: string | null
          sale_value: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          pipe_proposta_id: string
          product_id?: string | null
          sale_value?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          pipe_proposta_id?: string
          product_id?: string | null
          sale_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipe_proposta_items_pipe_proposta_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_proposta_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_propostas: {
        Row: {
          calor: number | null
          closed_at: string | null
          closer_id: string | null
          commitment_date: string | null
          contract_duration: number | null
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          product_id: string | null
          product_type: Database["public"]["Enums"]["product_type"] | null
          sale_value: number | null
          status: Database["public"]["Enums"]["pipe_propostas_status"]
          updated_at: string
        }
        Insert: {
          calor?: number | null
          closed_at?: string | null
          closer_id?: string | null
          commitment_date?: string | null
          contract_duration?: number | null
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          product_id?: string | null
          product_type?: Database["public"]["Enums"]["product_type"] | null
          sale_value?: number | null
          status?: Database["public"]["Enums"]["pipe_propostas_status"]
          updated_at?: string
        }
        Update: {
          calor?: number | null
          closed_at?: string | null
          closer_id?: string | null
          commitment_date?: string | null
          contract_duration?: number | null
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          product_id?: string | null
          product_type?: Database["public"]["Enums"]["product_type"] | null
          sale_value?: number | null
          status?: Database["public"]["Enums"]["pipe_propostas_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipe_propostas_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_propostas_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_propostas_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_whatsapp: {
        Row: {
          created_at: string
          id: string
          lead_id: string
          notes: string | null
          scheduled_date: string | null
          sdr_id: string | null
          status: Database["public"]["Enums"]["pipe_whatsapp_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id: string
          notes?: string | null
          scheduled_date?: string | null
          sdr_id?: string | null
          status?: Database["public"]["Enums"]["pipe_whatsapp_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string
          notes?: string | null
          scheduled_date?: string | null
          sdr_id?: string | null
          status?: Database["public"]["Enums"]["pipe_whatsapp_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipe_whatsapp_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_whatsapp_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          contrato_minimo_url: string | null
          contrato_padrao_url: string | null
          created_at: string
          entregaveis: string | null
          id: string
          is_active: boolean
          links: string[] | null
          logo_url: string | null
          materiais: string | null
          name: string
          ticket: number | null
          ticket_minimo: number | null
          type: string
          updated_at: string
        }
        Insert: {
          contrato_minimo_url?: string | null
          contrato_padrao_url?: string | null
          created_at?: string
          entregaveis?: string | null
          id?: string
          is_active?: boolean
          links?: string[] | null
          logo_url?: string | null
          materiais?: string | null
          name: string
          ticket?: number | null
          ticket_minimo?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          contrato_minimo_url?: string | null
          contrato_padrao_url?: string | null
          created_at?: string
          entregaveis?: string | null
          id?: string
          is_active?: boolean
          links?: string[] | null
          logo_url?: string | null
          materiais?: string | null
          name?: string
          ticket?: number | null
          ticket_minimo?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      webhooks: {
        Row: {
          id: string
          organization_id: string
          name: string
          url: string
          secret: string | null
          events: string[]
          http_method: string
          custom_headers: Json
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          name: string
          url: string
          secret?: string | null
          events?: string[]
          http_method?: string
          custom_headers?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          name?: string
          url?: string
          secret?: string | null
          events?: string[]
          http_method?: string
          custom_headers?: Json
          is_active?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_delivery_logs: {
        Row: {
          id: string
          webhook_id: string
          event: string
          attempt: number
          status_code: number | null
          response_body: string | null
          delivered_at: string
          error_message: string | null
        }
        Insert: {
          id?: string
          webhook_id: string
          event: string
          attempt: number
          status_code?: number | null
          response_body?: string | null
          delivered_at?: string
          error_message?: string | null
        }
        Update: {
          id?: string
          webhook_id?: string
          event?: string
          attempt?: number
          status_code?: number | null
          response_body?: string | null
          delivered_at?: string
          error_message?: string | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          commission_mrr_percent: number | null
          commission_projeto_percent: number | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          name: string
          ote_base: number | null
          ote_bonus: number | null
          organization_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          commission_mrr_percent?: number | null
          commission_projeto_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name: string
          ote_base?: number | null
          ote_bonus?: number | null
          organization_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          commission_mrr_percent?: number | null
          commission_projeto_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          name?: string
          ote_base?: number | null
          ote_bonus?: number | null
          organization_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      organization_role_permissions: {
        Row: {
          id: string
          organization_id: string
          role: string
          permission_key: string
          enabled: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          role: string
          permission_key: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          role?: string
          permission_key?: string
          enabled?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      team_member_permissions: {
        Row: {
          id: string
          team_member_id: string
          resource_key: string
          action_key: string
          value: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          team_member_id: string
          resource_key: string
          action_key: string
          value?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          team_member_id?: string
          resource_key?: string
          action_key?: string
          value?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_team_member: { Args: { _user_id: string }; Returns: boolean }
      user_has_org_permission: { Args: { p_permission_key: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "sdr" | "closer"
      lead_origin:
        | "calendly"
        | "whatsapp"
        | "meta_ads"
        | "outro"
        | "remarketing"
        | "base_clientes"
        | "parceiro"
        | "indicacao"
        | "quiz"
        | "site"
        | "organico"
        | "cal"
        | "ambos"
        | "zydon"
      pipe_confirmacao_status:
        | "reuniao_marcada"
        | "confirmar_d5"
        | "confirmar_d3"
        | "confirmar_d2"
        | "confirmar_d1"
        | "pre_confirmada"
        | "confirmacao_no_dia"
        | "confirmada_no_dia"
        | "remarcar"
        | "compareceu"
        | "perdido"
      pipe_propostas_status:
        | "marcar_compromisso"
        | "reativar"
        | "compromisso_marcado"
        | "esfriou"
        | "futuro"
        | "vendido"
        | "perdido"
      pipe_whatsapp_status:
        | "novo"
        | "abordado"
        | "respondeu"
        | "esfriou"
        | "agendado"
      product_type: "mrr" | "projeto" | "unitario"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sdr", "closer"],
      lead_origin: [
        "calendly",
        "whatsapp",
        "meta_ads",
        "outro",
        "remarketing",
        "base_clientes",
        "parceiro",
        "indicacao",
        "quiz",
        "site",
        "organico",
        "cal",
        "ambos",
        "zydon",
      ],
      pipe_confirmacao_status: [
        "reuniao_marcada",
        "confirmar_d5",
        "confirmar_d3",
        "confirmar_d2",
        "confirmar_d1",
        "pre_confirmada",
        "confirmacao_no_dia",
        "confirmada_no_dia",
        "remarcar",
        "compareceu",
        "perdido",
      ],
      pipe_propostas_status: [
        "marcar_compromisso",
        "reativar",
        "compromisso_marcado",
        "esfriou",
        "futuro",
        "vendido",
        "perdido",
      ],
      pipe_whatsapp_status: [
        "novo",
        "abordado",
        "respondeu",
        "esfriou",
        "agendado",
      ],
      product_type: ["mrr", "projeto", "unitario"],
    },
  },
} as const
