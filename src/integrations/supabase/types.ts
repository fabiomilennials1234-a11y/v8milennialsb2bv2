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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      _backup_bertin_20260608_pipe_entries: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          deal_id: string | null
          entered_at: string | null
          id: string | null
          lead_id: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string | null
          pipeline_id: string | null
          stage_changed_at: string | null
          stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_merge_agendamentos_milennials: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          deal_id: string | null
          entered_at: string | null
          id: string | null
          lead_id: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string | null
          pipeline_id: string | null
          stage_changed_at: string | null
          stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_stage_faxina_20260727: {
        Row: {
          auto_move_max_days: number | null
          auto_move_min_days: number | null
          backed_up_at: string | null
          checklist_template_id: string | null
          color: string | null
          created_at: string | null
          default_probability: number | null
          id: string | null
          is_active: boolean | null
          is_final_negative: boolean | null
          is_final_positive: boolean | null
          max_days_in_stage: number | null
          name: string | null
          organization_id: string | null
          pipeline_type: string | null
          position: number | null
          sla_action: string | null
          sla_escalate_to: string | null
          sla_hours: number | null
          stage_key: string | null
          stage_role: Database["public"]["Enums"]["stage_role"] | null
          stage_role_reviewed_at: string | null
          stage_role_reviewed_by: string | null
          stage_role_suggested_at: string | null
          stage_role_suggestion_source: string | null
          suggested_stage_role: Database["public"]["Enums"]["stage_role"] | null
          target_pipe_type: string | null
          target_pipeline_id: string | null
          target_stage_id: string | null
          target_stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          auto_move_max_days?: number | null
          auto_move_min_days?: number | null
          backed_up_at?: string | null
          checklist_template_id?: string | null
          color?: string | null
          created_at?: string | null
          default_probability?: number | null
          id?: string | null
          is_active?: boolean | null
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          max_days_in_stage?: number | null
          name?: string | null
          organization_id?: string | null
          pipeline_type?: string | null
          position?: number | null
          sla_action?: string | null
          sla_escalate_to?: string | null
          sla_hours?: number | null
          stage_key?: string | null
          stage_role?: Database["public"]["Enums"]["stage_role"] | null
          stage_role_reviewed_at?: string | null
          stage_role_reviewed_by?: string | null
          stage_role_suggested_at?: string | null
          stage_role_suggestion_source?: string | null
          suggested_stage_role?:
            | Database["public"]["Enums"]["stage_role"]
            | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_move_max_days?: number | null
          auto_move_min_days?: number | null
          backed_up_at?: string | null
          checklist_template_id?: string | null
          color?: string | null
          created_at?: string | null
          default_probability?: number | null
          id?: string | null
          is_active?: boolean | null
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          max_days_in_stage?: number | null
          name?: string | null
          organization_id?: string | null
          pipeline_type?: string | null
          position?: number | null
          sla_action?: string | null
          sla_escalate_to?: string | null
          sla_hours?: number | null
          stage_key?: string | null
          stage_role?: Database["public"]["Enums"]["stage_role"] | null
          stage_role_reviewed_at?: string | null
          stage_role_reviewed_by?: string | null
          stage_role_suggested_at?: string | null
          stage_role_suggestion_source?: string | null
          suggested_stage_role?:
            | Database["public"]["Enums"]["stage_role"]
            | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _backup_wf_executions_faxina_20260727: {
        Row: {
          backed_up_at: string | null
          chain_depth: number | null
          completed_at: string | null
          context: Json | null
          current_node_id: string | null
          error: string | null
          id: string | null
          lead_id: string | null
          loop_counters: Json | null
          next_run_at: string | null
          organization_id: string | null
          retry_of: string | null
          started_at: string | null
          status: string | null
          trigger_dedup_key: string | null
          triggered_by_execution_id: string | null
          updated_at: string | null
          workflow_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          chain_depth?: number | null
          completed_at?: string | null
          context?: Json | null
          current_node_id?: string | null
          error?: string | null
          id?: string | null
          lead_id?: string | null
          loop_counters?: Json | null
          next_run_at?: string | null
          organization_id?: string | null
          retry_of?: string | null
          started_at?: string | null
          status?: string | null
          trigger_dedup_key?: string | null
          triggered_by_execution_id?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          chain_depth?: number | null
          completed_at?: string | null
          context?: Json | null
          current_node_id?: string | null
          error?: string | null
          id?: string | null
          lead_id?: string | null
          loop_counters?: Json | null
          next_run_at?: string | null
          organization_id?: string | null
          retry_of?: string | null
          started_at?: string | null
          status?: string | null
          trigger_dedup_key?: string | null
          triggered_by_execution_id?: string | null
          updated_at?: string | null
          workflow_id?: string | null
        }
        Relationships: []
      }
      _backup_workflows_faxina_20260727: {
        Row: {
          backed_up_at: string | null
          created_at: string | null
          created_by: string | null
          definition: Json | null
          description: string | null
          enrollment_criteria: Json | null
          id: string | null
          is_active: boolean | null
          loop_limit: number | null
          name: string | null
          organization_id: string | null
          re_enrollment_cooldown_days: number | null
          re_enrollment_enabled: boolean | null
          re_enrollment_max_times: number | null
          trigger_config: Json | null
          trigger_type: string | null
          updated_at: string | null
          wrapper_for: string | null
          wrapper_source_id: string | null
        }
        Insert: {
          backed_up_at?: string | null
          created_at?: string | null
          created_by?: string | null
          definition?: Json | null
          description?: string | null
          enrollment_criteria?: Json | null
          id?: string | null
          is_active?: boolean | null
          loop_limit?: number | null
          name?: string | null
          organization_id?: string | null
          re_enrollment_cooldown_days?: number | null
          re_enrollment_enabled?: boolean | null
          re_enrollment_max_times?: number | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string | null
          wrapper_for?: string | null
          wrapper_source_id?: string | null
        }
        Update: {
          backed_up_at?: string | null
          created_at?: string | null
          created_by?: string | null
          definition?: Json | null
          description?: string | null
          enrollment_criteria?: Json | null
          id?: string | null
          is_active?: boolean | null
          loop_limit?: number | null
          name?: string | null
          organization_id?: string | null
          re_enrollment_cooldown_days?: number | null
          re_enrollment_enabled?: boolean | null
          re_enrollment_max_times?: number | null
          trigger_config?: Json | null
          trigger_type?: string | null
          updated_at?: string | null
          wrapper_for?: string | null
          wrapper_source_id?: string | null
        }
        Relationships: []
      }
      _bkp_c7e4ba84_instance: {
        Row: {
          copilot_agent_id: string | null
          created_at: string | null
          daily_blast_cap: number | null
          daily_call_cap: number | null
          id: string | null
          instance_id: string | null
          instance_name: string | null
          last_connection_at: string | null
          metadata: Json | null
          organization_id: string | null
          owner_team_member_id: string | null
          phone_number: string | null
          provider: string | null
          provider_config: Json | null
          qr_code: string | null
          qr_code_expires_at: string | null
          session_dead_reason: string | null
          session_dead_since: string | null
          status: string | null
          updated_at: string | null
          voice_calls_enabled: boolean | null
        }
        Insert: {
          copilot_agent_id?: string | null
          created_at?: string | null
          daily_blast_cap?: number | null
          daily_call_cap?: number | null
          id?: string | null
          instance_id?: string | null
          instance_name?: string | null
          last_connection_at?: string | null
          metadata?: Json | null
          organization_id?: string | null
          owner_team_member_id?: string | null
          phone_number?: string | null
          provider?: string | null
          provider_config?: Json | null
          qr_code?: string | null
          qr_code_expires_at?: string | null
          session_dead_reason?: string | null
          session_dead_since?: string | null
          status?: string | null
          updated_at?: string | null
          voice_calls_enabled?: boolean | null
        }
        Update: {
          copilot_agent_id?: string | null
          created_at?: string | null
          daily_blast_cap?: number | null
          daily_call_cap?: number | null
          id?: string | null
          instance_id?: string | null
          instance_name?: string | null
          last_connection_at?: string | null
          metadata?: Json | null
          organization_id?: string | null
          owner_team_member_id?: string | null
          phone_number?: string | null
          provider?: string | null
          provider_config?: Json | null
          qr_code?: string | null
          qr_code_expires_at?: string | null
          session_dead_reason?: string | null
          session_dead_since?: string | null
          status?: string | null
          updated_at?: string | null
          voice_calls_enabled?: boolean | null
        }
        Relationships: []
      }
      _bkp_c7e4ba84_messages: {
        Row: {
          id: string | null
          instance_id: string | null
          lead_id: string | null
          message_id: string | null
          remote_jid: string | null
          timestamp: string | null
        }
        Insert: {
          id?: string | null
          instance_id?: string | null
          lead_id?: string | null
          message_id?: string | null
          remote_jid?: string | null
          timestamp?: string | null
        }
        Update: {
          id?: string | null
          instance_id?: string | null
          lead_id?: string | null
          message_id?: string | null
          remote_jid?: string | null
          timestamp?: string | null
        }
        Relationships: []
      }
      _bkp_c7e4ba84_secrets: {
        Row: {
          created_at: string | null
          instance_id: string | null
          meta_access_token: string | null
          meta_phone_number_id: string | null
          meta_waba_id: string | null
          organization_id: string | null
          uazapi_instance_id: string | null
          uazapi_token: string | null
          updated_at: string | null
          webhook_secret: string | null
        }
        Insert: {
          created_at?: string | null
          instance_id?: string | null
          meta_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          organization_id?: string | null
          uazapi_instance_id?: string | null
          uazapi_token?: string | null
          updated_at?: string | null
          webhook_secret?: string | null
        }
        Update: {
          created_at?: string | null
          instance_id?: string | null
          meta_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          organization_id?: string | null
          uazapi_instance_id?: string | null
          uazapi_token?: string | null
          updated_at?: string | null
          webhook_secret?: string | null
        }
        Relationships: []
      }
      _bkp_c7e4ba84_summary: {
        Row: {
          instance_id: string | null
          is_group: boolean | null
          last_message: string | null
          last_message_direction: string | null
          last_message_sent_source: string | null
          last_message_time: string | null
          last_push_name: string | null
          lead_id: string | null
          normalized_phone: string | null
          organization_id: string | null
          phone_number: string | null
          updated_at: string | null
        }
        Insert: {
          instance_id?: string | null
          is_group?: boolean | null
          last_message?: string | null
          last_message_direction?: string | null
          last_message_sent_source?: string | null
          last_message_time?: string | null
          last_push_name?: string | null
          lead_id?: string | null
          normalized_phone?: string | null
          organization_id?: string | null
          phone_number?: string | null
          updated_at?: string | null
        }
        Update: {
          instance_id?: string | null
          is_group?: boolean | null
          last_message?: string | null
          last_message_direction?: string | null
          last_message_sent_source?: string | null
          last_message_time?: string | null
          last_push_name?: string | null
          lead_id?: string | null
          normalized_phone?: string | null
          organization_id?: string | null
          phone_number?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      _bkp_c7e4ba84_workflows: {
        Row: {
          definition: Json | null
          id: string | null
          is_active: boolean | null
          name: string | null
        }
        Insert: {
          definition?: Json | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
        }
        Update: {
          definition?: Json | null
          id?: string | null
          is_active?: boolean | null
          name?: string | null
        }
        Relationships: []
      }
      _bkp_lid_principal: {
        Row: {
          id: string | null
          lead_id: string | null
          normalized_phone: string | null
          phone_number: string | null
          remote_jid: string | null
        }
        Insert: {
          id?: string | null
          lead_id?: string | null
          normalized_phone?: string | null
          phone_number?: string | null
          remote_jid?: string | null
        }
        Update: {
          id?: string | null
          lead_id?: string | null
          normalized_phone?: string | null
          phone_number?: string | null
          remote_jid?: string | null
        }
        Relationships: []
      }
      _lead_duplicates_audit: {
        Row: {
          detected_at: string | null
          id: string
          lead_created_dates: string[]
          lead_ids: string[]
          lead_names: string[]
          normalized_phone: string
          organization_id: string | null
          resolution_notes: string | null
          resolved_at: string | null
        }
        Insert: {
          detected_at?: string | null
          id?: string
          lead_created_dates: string[]
          lead_ids: string[]
          lead_names: string[]
          normalized_phone: string
          organization_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
        }
        Update: {
          detected_at?: string | null
          id?: string
          lead_created_dates?: string[]
          lead_ids?: string[]
          lead_names?: string[]
          normalized_phone?: string
          organization_id?: string | null
          resolution_notes?: string | null
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "_lead_duplicates_audit_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      acoes_do_dia: {
        Row: {
          completed_at: string | null
          confirmacao_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          follow_up_id: string | null
          id: string
          is_completed: boolean | null
          lead_id: string | null
          organization_id: string | null
          pipeline_entry_id: string | null
          position: number | null
          proposta_id: string | null
          title: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          confirmacao_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          follow_up_id?: string | null
          id?: string
          is_completed?: boolean | null
          lead_id?: string | null
          organization_id?: string | null
          pipeline_entry_id?: string | null
          position?: number | null
          proposta_id?: string | null
          title: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          confirmacao_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          follow_up_id?: string | null
          id?: string
          is_completed?: boolean | null
          lead_id?: string | null
          organization_id?: string | null
          pipeline_entry_id?: string | null
          position?: number | null
          proposta_id?: string | null
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "acoes_do_dia_confirmacao_id_pipeline_entries_fkey"
            columns: ["confirmacao_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_confirmacao_id_pipeline_entries_fkey"
            columns: ["confirmacao_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_confirmacao_id_pipeline_entries_fkey"
            columns: ["confirmacao_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_confirmacao_id_pipeline_entries_fkey"
            columns: ["confirmacao_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
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
            foreignKeyName: "acoes_do_dia_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_proposta_id_pipeline_entries_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_proposta_id_pipeline_entries_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_proposta_id_pipeline_entries_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acoes_do_dia_proposta_id_pipeline_entries_fkey"
            columns: ["proposta_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      activities: {
        Row: {
          assigned_to: string | null
          company_id: string | null
          completed_at: string | null
          contact_id: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          due_date: string | null
          duration_sec: number | null
          id: string
          is_automated: boolean | null
          lead_id: string | null
          metadata: Json | null
          organization_id: string
          outcome: string | null
          owner_id: string | null
          source: string | null
          subject: string | null
          type: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          duration_sec?: number | null
          id?: string
          is_automated?: boolean | null
          lead_id?: string | null
          metadata?: Json | null
          organization_id: string
          outcome?: string | null
          owner_id?: string | null
          source?: string | null
          subject?: string | null
          type: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          company_id?: string | null
          completed_at?: string | null
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          due_date?: string | null
          duration_sec?: number | null
          id?: string
          is_automated?: boolean | null
          lead_id?: string | null
          metadata?: Json | null
          organization_id?: string
          outcome?: string | null
          owner_id?: string | null
          source?: string | null
          subject?: string | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      agent_decision_logs: {
        Row: {
          action_decided: string
          capabilities_snapshot: Json | null
          conversation_id: string
          created_at: string | null
          error_message: string | null
          id: string
          organization_id: string
          prompt_version: string | null
          reasoning: string | null
          reasoning_chain: string | null
          state_after: string
          state_before: string
          success: boolean | null
        }
        Insert: {
          action_decided: string
          capabilities_snapshot?: Json | null
          conversation_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id: string
          prompt_version?: string | null
          reasoning?: string | null
          reasoning_chain?: string | null
          state_after: string
          state_before: string
          success?: boolean | null
        }
        Update: {
          action_decided?: string
          capabilities_snapshot?: Json | null
          conversation_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          organization_id?: string
          prompt_version?: string | null
          reasoning?: string | null
          reasoning_chain?: string | null
          state_after?: string
          state_before?: string
          success?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_decision_logs_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_decision_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_email_drafts: {
        Row: {
          accepted: boolean | null
          context_snapshot: Json
          created_at: string
          created_by: string | null
          deal_id: string | null
          generated_body: string | null
          generated_subject: string | null
          id: string
          lead_id: string | null
          model_used: string | null
          organization_id: string
          prompt: string | null
          style: string
          tokens_used: number | null
        }
        Insert: {
          accepted?: boolean | null
          context_snapshot?: Json
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          generated_body?: string | null
          generated_subject?: string | null
          id?: string
          lead_id?: string | null
          model_used?: string | null
          organization_id: string
          prompt?: string | null
          style?: string
          tokens_used?: number | null
        }
        Update: {
          accepted?: boolean | null
          context_snapshot?: Json
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          generated_body?: string | null
          generated_subject?: string | null
          id?: string
          lead_id?: string | null
          model_used?: string | null
          organization_id?: string
          prompt?: string | null
          style?: string
          tokens_used?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_email_drafts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_email_drafts_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_email_drafts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_idempotency_keys: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          idempotency_key: string
          organization_id: string
          resource_id: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          idempotency_key: string
          organization_id: string
          resource_id: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          idempotency_key?: string
          organization_id?: string
          resource_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_idempotency_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_key_usage_log: {
        Row: {
          created_at: string
          endpoint: string
          id: number
          ip_address: unknown
          key_id: string
          method: string
          organization_id: string
          response_time_ms: number
          status_code: number
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: never
          ip_address?: unknown
          key_id: string
          method?: string
          organization_id: string
          response_time_ms: number
          status_code: number
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: never
          ip_address?: unknown
          key_id?: string
          method?: string
          organization_id?: string
          response_time_ms?: number
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_key_usage_log_key_id_fkey"
            columns: ["key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_key_usage_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          is_active: boolean
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          organization_id: string
          rate_limit_per_minute: number
          revoked_at: string | null
          scopes: string[]
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          organization_id: string
          rate_limit_per_minute?: number
          revoked_at?: string | null
          scopes?: string[]
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          organization_id?: string
          rate_limit_per_minute?: number
          revoked_at?: string | null
          scopes?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_logs: {
        Row: {
          api_key_id: string
          created_at: string
          id: string
          ip_address: string | null
          method: string
          organization_id: string
          path: string
          response_time_ms: number | null
          status_code: number
        }
        Insert: {
          api_key_id: string
          created_at?: string
          id?: string
          ip_address?: string | null
          method: string
          organization_id: string
          path: string
          response_time_ms?: number | null
          status_code: number
        }
        Update: {
          api_key_id?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          method?: string
          organization_id?: string
          path?: string
          response_time_ms?: number | null
          status_code?: number
        }
        Relationships: [
          {
            foreignKeyName: "api_request_logs_api_key_id_fkey"
            columns: ["api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_request_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      application_logs: {
        Row: {
          action: string | null
          created_at: string | null
          error: Json | null
          id: string
          ip_address: unknown
          level: string
          message: string
          metadata: Json | null
          resource: string | null
          tenant_id: string | null
          timestamp: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          error?: Json | null
          id?: string
          ip_address?: unknown
          level: string
          message: string
          metadata?: Json | null
          resource?: string | null
          tenant_id?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          error?: Json | null
          id?: string
          ip_address?: unknown
          level?: string
          message?: string
          metadata?: Json | null
          resource?: string | null
          tenant_id?: string | null
          timestamp?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          comment: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          entity_id: string
          entity_type: string
          expires_at: string | null
          id: string
          organization_id: string
          requested_by: string
          rule_id: string
          status: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity_id: string
          entity_type: string
          expires_at?: string | null
          id?: string
          organization_id: string
          requested_by: string
          rule_id: string
          status?: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          entity_id?: string
          entity_type?: string
          expires_at?: string | null
          id?: string
          organization_id?: string
          requested_by?: string
          rule_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "approval_requests_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "approval_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_rules: {
        Row: {
          approvers: Json
          auto_reject_hours: number | null
          conditions: Json
          created_at: string
          entity_type: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
        }
        Insert: {
          approvers?: Json
          auto_reject_hours?: number | null
          conditions?: Json
          created_at?: string
          entity_type?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
        }
        Update: {
          approvers?: Json
          auto_reject_hours?: number | null
          conditions?: Json
          created_at?: string
          entity_type?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          actor_function: string | null
          actor_role: string
          changes: Json | null
          id: number
          occurred_at: string
          operation: string
          organization_id: string | null
          row_id: string
          table_name: string
        }
        Insert: {
          actor_function?: string | null
          actor_role: string
          changes?: Json | null
          id?: number
          occurred_at?: string
          operation: string
          organization_id?: string | null
          row_id: string
          table_name: string
        }
        Update: {
          actor_function?: string | null
          actor_role?: string
          changes?: Json | null
          id?: number
          occurred_at?: string
          operation?: string
          organization_id?: string | null
          row_id?: string
          table_name?: string
        }
        Relationships: []
      }
      auth_rate_limits: {
        Row: {
          created_at: string
          endpoint: string
          id: string
          ip: string
          request_count: number
          window_start: string
        }
        Insert: {
          created_at?: string
          endpoint: string
          id?: string
          ip: string
          request_count?: number
          window_start?: string
        }
        Update: {
          created_at?: string
          endpoint?: string
          id?: string
          ip?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      automation_instance_daily_usage: {
        Row: {
          created_at: string
          instance_id: string
          sent: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          instance_id: string
          sent?: number
          updated_at?: string
          usage_date: string
        }
        Update: {
          created_at?: string
          instance_id?: string
          sent?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_instance_daily_usage_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_jobs: {
        Row: {
          action_type: string
          created_at: string
          entity_id: string
          entity_type: string
          error_message: string | null
          finished_at: string | null
          id: string
          max_retries: number
          next_retry_at: string | null
          organization_id: string
          payload_snapshot: Json | null
          retry_count: number
          source_engine: string
          source_id: string | null
          source_table: string | null
          started_at: string
          status: string
        }
        Insert: {
          action_type: string
          created_at?: string
          entity_id: string
          entity_type: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          max_retries?: number
          next_retry_at?: string | null
          organization_id: string
          payload_snapshot?: Json | null
          retry_count?: number
          source_engine: string
          source_id?: string | null
          source_table?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          action_type?: string
          created_at?: string
          entity_id?: string
          entity_type?: string
          error_message?: string | null
          finished_at?: string | null
          id?: string
          max_retries?: number
          next_retry_at?: string | null
          organization_id?: string
          payload_snapshot?: Json | null
          retry_count?: number
          source_engine?: string
          source_id?: string | null
          source_table?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_webhooks: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          organization_id: string
          updated_at: string
          webhook_url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          organization_id: string
          updated_at?: string
          webhook_url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          updated_at?: string
          webhook_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          prize_description?: string | null
          prize_value?: number | null
          threshold?: number
          type?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "awards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_aposenta_funis_carteira: {
        Row: {
          capturado_em: string
          foi_desativada: boolean
          is_final_positive_antes: boolean | null
          organization_id: string | null
          pipeline_type: string | null
          stage_id: string
          stage_key: string | null
          target_pipe_type_antes: string | null
          target_stage_key_antes: string | null
          tinha_ponteiro: boolean
        }
        Insert: {
          capturado_em?: string
          foi_desativada?: boolean
          is_final_positive_antes?: boolean | null
          organization_id?: string | null
          pipeline_type?: string | null
          stage_id: string
          stage_key?: string | null
          target_pipe_type_antes?: string | null
          target_stage_key_antes?: string | null
          tinha_ponteiro?: boolean
        }
        Update: {
          capturado_em?: string
          foi_desativada?: boolean
          is_final_positive_antes?: boolean | null
          organization_id?: string | null
          pipeline_type?: string | null
          stage_id?: string
          stage_key?: string | null
          target_pipe_type_antes?: string | null
          target_stage_key_antes?: string | null
          tinha_ponteiro?: boolean
        }
        Relationships: []
      }
      backup_chique_oportunidades_20260729: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          deal_id: string | null
          entered_at: string | null
          id: string | null
          lead_id: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string | null
          pipeline_id: string | null
          stage_changed_at: string | null
          stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      badges: {
        Row: {
          created_at: string
          criteria_type: string
          criteria_value: number
          description: string | null
          icon: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          criteria_type: string
          criteria_value?: number
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
        }
        Update: {
          created_at?: string
          criteria_type?: string
          criteria_value?: number
          description?: string | null
          icon?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "badges_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blast_daily_usage: {
        Row: {
          created_at: string
          leads_sent: number
          organization_id: string
          updated_at: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          leads_sent?: number
          organization_id: string
          updated_at?: string
          usage_date: string
        }
        Update: {
          created_at?: string
          leads_sent?: number
          organization_id?: string
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "blast_daily_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blast_instance_daily_usage: {
        Row: {
          created_at: string
          instance_id: string
          leads_sent: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          instance_id: string
          leads_sent?: number
          updated_at?: string
          usage_date: string
        }
        Update: {
          created_at?: string
          instance_id?: string
          leads_sent?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "blast_instance_daily_usage_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      blast_plan_recipients: {
        Row: {
          actual_cost: number | null
          claimed_at: string | null
          created_at: string
          delivered_at: string | null
          estimated_cost: number | null
          id: string
          instance_id: string | null
          lead_id: string | null
          lot_index: number
          phone: string | null
          plan_id: string
          provider_message_id: string | null
          reason: string | null
          sent_at: string | null
          status: string
          variable_snapshot: Json
        }
        Insert: {
          actual_cost?: number | null
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          estimated_cost?: number | null
          id?: string
          instance_id?: string | null
          lead_id?: string | null
          lot_index?: number
          phone?: string | null
          plan_id: string
          provider_message_id?: string | null
          reason?: string | null
          sent_at?: string | null
          status?: string
          variable_snapshot?: Json
        }
        Update: {
          actual_cost?: number | null
          claimed_at?: string | null
          created_at?: string
          delivered_at?: string | null
          estimated_cost?: number | null
          id?: string
          instance_id?: string | null
          lead_id?: string | null
          lot_index?: number
          phone?: string | null
          plan_id?: string
          provider_message_id?: string | null
          reason?: string | null
          sent_at?: string | null
          status?: string
          variable_snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "blast_plan_recipients_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_plan_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_plan_recipients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_plan_recipients_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "blast_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      blast_plans: {
        Row: {
          created_at: string
          created_by: string | null
          delay_max_ms: number | null
          delay_min_ms: number | null
          id: string
          image_url: string | null
          instance_id: string
          lots_released: number
          lots_total: number
          message: string
          next_release_date: string | null
          organization_id: string
          post_send_target: Json | null
          refinements: Json
          release_time: string
          source: Json | null
          status: string
          template: Json | null
          total_recipients: number
          updated_at: string
          window_days: number[] | null
          window_from_minutes: number | null
          window_to_minutes: number | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          delay_max_ms?: number | null
          delay_min_ms?: number | null
          id?: string
          image_url?: string | null
          instance_id: string
          lots_released?: number
          lots_total?: number
          message: string
          next_release_date?: string | null
          organization_id: string
          post_send_target?: Json | null
          refinements?: Json
          release_time?: string
          source?: Json | null
          status?: string
          template?: Json | null
          total_recipients?: number
          updated_at?: string
          window_days?: number[] | null
          window_from_minutes?: number | null
          window_to_minutes?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          delay_max_ms?: number | null
          delay_min_ms?: number | null
          id?: string
          image_url?: string | null
          instance_id?: string
          lots_released?: number
          lots_total?: number
          message?: string
          next_release_date?: string | null
          organization_id?: string
          post_send_target?: Json | null
          refinements?: Json
          release_time?: string
          source?: Json | null
          status?: string
          template?: Json | null
          total_recipients?: number
          updated_at?: string
          window_days?: number[] | null
          window_from_minutes?: number | null
          window_to_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "blast_plans_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blast_plans_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      builder_sessions: {
        Row: {
          agent_id: string
          covered_topics: string[]
          created_at: string
          id: string
          messages: Json
          organization_id: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          covered_topics?: string[]
          created_at?: string
          id?: string
          messages?: Json
          organization_id: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          covered_topics?: string[]
          created_at?: string
          id?: string
          messages?: Json
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "builder_sessions_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "builder_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          contact_id: string | null
          created_at: string
          direction: string
          duration_seconds: number | null
          ended_at: string | null
          id: string
          lead_id: string | null
          notes: string | null
          organization_id: string
          outcome: string
          phone_number: string | null
          recording_failure_reason: string | null
          recording_notice_regime: string | null
          recording_status: string | null
          recording_url: string | null
          started_at: string
          user_id: string | null
          voip_call_id: string | null
          voip_provider: string | null
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          direction: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id: string
          outcome: string
          phone_number?: string | null
          recording_failure_reason?: string | null
          recording_notice_regime?: string | null
          recording_status?: string | null
          recording_url?: string | null
          started_at?: string
          user_id?: string | null
          voip_call_id?: string | null
          voip_provider?: string | null
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          direction?: string
          duration_seconds?: number | null
          ended_at?: string | null
          id?: string
          lead_id?: string | null
          notes?: string | null
          organization_id?: string
          outcome?: string
          phone_number?: string | null
          recording_failure_reason?: string | null
          recording_notice_regime?: string | null
          recording_status?: string | null
          recording_url?: string | null
          started_at?: string
          user_id?: string | null
          voip_call_id?: string | null
          voip_provider?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_dispatch_batches: {
        Row: {
          campanha_id: string
          completed_at: string | null
          created_at: string | null
          created_by: string
          failed_count: number | null
          id: string
          lead_filter: Json | null
          organization_id: string
          scheduled_at: string
          sent_count: number | null
          started_at: string | null
          status: string
          template_id: string
          total_leads: number | null
        }
        Insert: {
          campanha_id: string
          completed_at?: string | null
          created_at?: string | null
          created_by: string
          failed_count?: number | null
          id?: string
          lead_filter?: Json | null
          organization_id: string
          scheduled_at: string
          sent_count?: number | null
          started_at?: string | null
          status?: string
          template_id: string
          total_leads?: number | null
        }
        Update: {
          campanha_id?: string
          completed_at?: string | null
          created_at?: string | null
          created_by?: string
          failed_count?: number | null
          id?: string
          lead_filter?: Json | null
          organization_id?: string
          scheduled_at?: string
          sent_count?: number | null
          started_at?: string | null
          status?: string
          template_id?: string
          total_leads?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_dispatch_batches_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_dispatch_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_dispatch_batches_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_templates: {
        Row: {
          audio_url: string | null
          available_variables: string[] | null
          content: string
          created_at: string | null
          id: string
          is_active: boolean | null
          message_type: string
          name: string
          organization_id: string
          times_used: number | null
          updated_at: string | null
        }
        Insert: {
          audio_url?: string | null
          available_variables?: string[] | null
          content: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          message_type?: string
          name: string
          organization_id: string
          times_used?: number | null
          updated_at?: string | null
        }
        Update: {
          audio_url?: string | null
          available_variables?: string[] | null
          content?: string
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          message_type?: string
          name?: string
          organization_id?: string
          times_used?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campaign_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_allowed_viewers: {
        Row: {
          campanha_id: string
          created_at: string
          id: string
          team_member_id: string
        }
        Insert: {
          campanha_id: string
          created_at?: string
          id?: string
          team_member_id: string
        }
        Update: {
          campanha_id?: string
          created_at?: string
          id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanha_allowed_viewers_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_allowed_viewers_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_allowed_viewers_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_dispatch_rule_steps: {
        Row: {
          action_type: string
          delay_minutes: number
          id: string
          position: number
          rule_id: string
          sdr_assignment_mode: string | null
          target_sdr_id: string | null
          target_stage_id: string | null
          template_id: string | null
          timeout_action: string | null
          timeout_target_stage_id: string | null
          timeout_template_id: string | null
          wait_timeout_minutes: number | null
        }
        Insert: {
          action_type?: string
          delay_minutes?: number
          id?: string
          position?: number
          rule_id: string
          sdr_assignment_mode?: string | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_minutes?: number | null
        }
        Update: {
          action_type?: string
          delay_minutes?: number
          id?: string
          position?: number
          rule_id?: string
          sdr_assignment_mode?: string | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_dispatch_rule_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "campanha_dispatch_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_dispatch_rule_steps_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_dispatch_rule_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_dispatch_rule_steps_timeout_target_stage_id_fkey"
            columns: ["timeout_target_stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_dispatch_rule_steps_timeout_template_id_fkey"
            columns: ["timeout_template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_dispatch_rules: {
        Row: {
          campanha_id: string
          campanha_stage_id: string | null
          created_at: string | null
          id: string
          is_active: boolean
          trigger_type: string
          updated_at: string | null
        }
        Insert: {
          campanha_id: string
          campanha_stage_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          trigger_type: string
          updated_at?: string | null
        }
        Update: {
          campanha_id?: string
          campanha_stage_id?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean
          trigger_type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanha_dispatch_rules_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_dispatch_rules_campanha_stage_id_fkey"
            columns: ["campanha_stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      campanha_leads: {
        Row: {
          campanha_id: string
          closer_id: string | null
          created_at: string | null
          id: string
          lead_id: string
          notes: string | null
          pre_sale_responsible_id: string | null
          responsible_id: string | null
          sale_responsible_id: string | null
          sdr_id: string | null
          stage_id: string
          updated_at: string | null
        }
        Insert: {
          campanha_id: string
          closer_id?: string | null
          created_at?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          pre_sale_responsible_id?: string | null
          responsible_id?: string | null
          sale_responsible_id?: string | null
          sdr_id?: string | null
          stage_id: string
          updated_at?: string | null
        }
        Update: {
          campanha_id?: string
          closer_id?: string | null
          created_at?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          pre_sale_responsible_id?: string | null
          responsible_id?: string | null
          sale_responsible_id?: string | null
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
            foreignKeyName: "campanha_leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
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
            foreignKeyName: "campanha_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
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
          role: string
          team_member_id: string
        }
        Insert: {
          bonus_earned?: boolean | null
          campanha_id: string
          created_at?: string | null
          id?: string
          meetings_count?: number | null
          role?: string
          team_member_id: string
        }
        Update: {
          bonus_earned?: boolean | null
          campanha_id?: string
          created_at?: string | null
          id?: string
          meetings_count?: number | null
          role?: string
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
            referencedRelation: "org_visible_members"
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
      campanha_pipe_automations: {
        Row: {
          campanha_id: string
          campanha_stage_id: string
          created_at: string | null
          id: string
          pipe_stage: string
          target_pipe: string
        }
        Insert: {
          campanha_id: string
          campanha_stage_id: string
          created_at?: string | null
          id?: string
          pipe_stage: string
          target_pipe: string
        }
        Update: {
          campanha_id?: string
          campanha_stage_id?: string
          created_at?: string | null
          id?: string
          pipe_stage?: string
          target_pipe?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanha_pipe_automations_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_pipe_automations_campanha_stage_id_fkey"
            columns: ["campanha_stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
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
      campanha_templates: {
        Row: {
          campanha_id: string
          created_at: string | null
          id: string
          position: number | null
          template_id: string
        }
        Insert: {
          campanha_id: string
          created_at?: string | null
          id?: string
          position?: number | null
          template_id: string
        }
        Update: {
          campanha_id?: string
          created_at?: string | null
          id?: string
          position?: number | null
          template_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campanha_templates_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanha_templates_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      campanhas: {
        Row: {
          agent_id: string | null
          auto_config: Json | null
          bonus_value: number | null
          campaign_type: string | null
          closer_assigned_to: string | null
          closer_distribution_mode: string | null
          created_at: string | null
          deadline: string
          description: string | null
          free_target_pipe: string | null
          free_target_stage: string | null
          id: string
          individual_goal: number | null
          investimento_cents: number | null
          investimento_source: string | null
          investimento_updated_at: string | null
          is_active: boolean | null
          lead_assigned_to: string | null
          lead_distribution_mode: string | null
          mkt_ativo: boolean | null
          mkt_cadastro_origins: string[] | null
          mkt_cadastro_tag_ids: string[] | null
          mkt_call_origins: string[] | null
          mkt_call_tag_ids: string[] | null
          mkt_incluir_cadastro: boolean | null
          mkt_incluir_call: boolean | null
          mkt_investimento_cadastro_cents: number | null
          mkt_investimento_call_cents: number | null
          name: string
          objective: string
          organization_id: string | null
          team_goal: number
          updated_at: string | null
          whatsapp_instance_id: string | null
        }
        Insert: {
          agent_id?: string | null
          auto_config?: Json | null
          bonus_value?: number | null
          campaign_type?: string | null
          closer_assigned_to?: string | null
          closer_distribution_mode?: string | null
          created_at?: string | null
          deadline: string
          description?: string | null
          free_target_pipe?: string | null
          free_target_stage?: string | null
          id?: string
          individual_goal?: number | null
          investimento_cents?: number | null
          investimento_source?: string | null
          investimento_updated_at?: string | null
          is_active?: boolean | null
          lead_assigned_to?: string | null
          lead_distribution_mode?: string | null
          mkt_ativo?: boolean | null
          mkt_cadastro_origins?: string[] | null
          mkt_cadastro_tag_ids?: string[] | null
          mkt_call_origins?: string[] | null
          mkt_call_tag_ids?: string[] | null
          mkt_incluir_cadastro?: boolean | null
          mkt_incluir_call?: boolean | null
          mkt_investimento_cadastro_cents?: number | null
          mkt_investimento_call_cents?: number | null
          name: string
          objective?: string
          organization_id?: string | null
          team_goal?: number
          updated_at?: string | null
          whatsapp_instance_id?: string | null
        }
        Update: {
          agent_id?: string | null
          auto_config?: Json | null
          bonus_value?: number | null
          campaign_type?: string | null
          closer_assigned_to?: string | null
          closer_distribution_mode?: string | null
          created_at?: string | null
          deadline?: string
          description?: string | null
          free_target_pipe?: string | null
          free_target_stage?: string | null
          id?: string
          individual_goal?: number | null
          investimento_cents?: number | null
          investimento_source?: string | null
          investimento_updated_at?: string | null
          is_active?: boolean | null
          lead_assigned_to?: string | null
          lead_distribution_mode?: string | null
          mkt_ativo?: boolean | null
          mkt_cadastro_origins?: string[] | null
          mkt_cadastro_tag_ids?: string[] | null
          mkt_call_origins?: string[] | null
          mkt_call_tag_ids?: string[] | null
          mkt_incluir_cadastro?: boolean | null
          mkt_incluir_call?: boolean | null
          mkt_investimento_cadastro_cents?: number | null
          mkt_investimento_call_cents?: number | null
          name?: string
          objective?: string
          organization_id?: string | null
          team_goal?: number
          updated_at?: string | null
          whatsapp_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "campanhas_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_closer_assigned_to_fkey"
            columns: ["closer_assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_closer_assigned_to_fkey"
            columns: ["closer_assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_lead_assigned_to_fkey"
            columns: ["lead_assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_lead_assigned_to_fkey"
            columns: ["lead_assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campanhas_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      channel_messages: {
        Row: {
          channel: Database["public"]["Enums"]["channel_type"]
          contact_external_id: string | null
          contact_handle: string | null
          content: string | null
          created_at: string | null
          direction: string
          external_id: string
          id: string
          instance_id: string | null
          lead_id: string | null
          media_url: string | null
          message_type: string
          messaging_channel_id: string | null
          metadata: Json | null
          organization_id: string
          page_id: string | null
          phone_number: string | null
          provider_message_id: string | null
          raw_payload: Json | null
          remote_jid: string | null
          sender_id: string | null
          sender_name: string | null
          sender_profile_pic: string | null
          sent_by_team_member_id: string | null
          status: string | null
          timestamp: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["channel_type"]
          contact_external_id?: string | null
          contact_handle?: string | null
          content?: string | null
          created_at?: string | null
          direction: string
          external_id: string
          id?: string
          instance_id?: string | null
          lead_id?: string | null
          media_url?: string | null
          message_type?: string
          messaging_channel_id?: string | null
          metadata?: Json | null
          organization_id: string
          page_id?: string | null
          phone_number?: string | null
          provider_message_id?: string | null
          raw_payload?: Json | null
          remote_jid?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_profile_pic?: string | null
          sent_by_team_member_id?: string | null
          status?: string | null
          timestamp?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["channel_type"]
          contact_external_id?: string | null
          contact_handle?: string | null
          content?: string | null
          created_at?: string | null
          direction?: string
          external_id?: string
          id?: string
          instance_id?: string | null
          lead_id?: string | null
          media_url?: string | null
          message_type?: string
          messaging_channel_id?: string | null
          metadata?: Json | null
          organization_id?: string
          page_id?: string | null
          phone_number?: string | null
          provider_message_id?: string | null
          raw_payload?: Json | null
          remote_jid?: string | null
          sender_id?: string | null
          sender_name?: string | null
          sender_profile_pic?: string | null
          sent_by_team_member_id?: string | null
          status?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "channel_messages_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_messaging_channel_id_fkey"
            columns: ["messaging_channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_sent_by_team_member_id_fkey"
            columns: ["sent_by_team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "channel_messages_sent_by_team_member_id_fkey"
            columns: ["sent_by_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      checklist_items: {
        Row: {
          checklist_id: string
          completed_at: string | null
          created_at: string
          id: string
          is_completed: boolean
          position: number
          template_item_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          checklist_id: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          position?: number
          template_item_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          checklist_id?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          position?: number
          template_item_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_checklist_id_fkey"
            columns: ["checklist_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_template_item_id_fkey"
            columns: ["template_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      checklists: {
        Row: {
          created_at: string
          created_by: string | null
          deal_id: string | null
          description: string | null
          id: string
          is_completed: boolean
          lead_id: string | null
          organization_id: string
          pipeline_entry_id: string | null
          source_template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string
          is_completed?: boolean
          lead_id?: string | null
          organization_id: string
          pipeline_entry_id?: string | null
          source_template_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          id?: string
          is_completed?: boolean
          lead_id?: string | null
          organization_id?: string
          pipeline_entry_id?: string | null
          source_template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklists_source_template_id_fkey"
            columns: ["source_template_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
        ]
      }
      client_alerts: {
        Row: {
          alert_type: string
          client_id: string
          created_at: string | null
          description: string | null
          id: string
          is_resolved: boolean | null
          metadata: Json | null
          notified_at: string | null
          organization_id: string
          resolved_at: string | null
          severity: string
          title: string
        }
        Insert: {
          alert_type: string
          client_id: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_resolved?: boolean | null
          metadata?: Json | null
          notified_at?: string | null
          organization_id: string
          resolved_at?: string | null
          severity?: string
          title: string
        }
        Update: {
          alert_type?: string
          client_id?: string
          created_at?: string | null
          description?: string | null
          id?: string
          is_resolved?: boolean | null
          metadata?: Json | null
          notified_at?: string | null
          organization_id?: string
          resolved_at?: string | null
          severity?: string
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_alerts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_health_snapshots: {
        Row: {
          client_id: string
          health_score: number
          health_status: string
          id: string
          organization_id: string
          segment: string
          snapshot_date: string
        }
        Insert: {
          client_id: string
          health_score: number
          health_status: string
          id?: string
          organization_id: string
          segment: string
          snapshot_date?: string
        }
        Update: {
          client_id?: string
          health_score?: number
          health_status?: string
          id?: string
          organization_id?: string
          segment?: string
          snapshot_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_health_snapshots_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_health_snapshots_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      client_purchase_items: {
        Row: {
          created_at: string | null
          id: string
          order_id: string
          product_id: string | null
          product_name: string
          quantity: number
          total_price: number | null
          unit: string | null
          unit_price: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          order_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          total_price?: number | null
          unit?: string | null
          unit_price: number
        }
        Update: {
          created_at?: string | null
          id?: string
          order_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          total_price?: number | null
          unit?: string | null
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "client_purchase_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "upsell_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      client_sidebar_permissions: {
        Row: {
          created_at: string
          id: string
          is_visible: boolean
          organization_id: string
          sidebar_key: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_visible?: boolean
          organization_id: string
          sidebar_key: string
        }
        Update: {
          created_at?: string
          id?: string
          is_visible?: boolean
          organization_id?: string
          sidebar_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_sidebar_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_suggestions: {
        Row: {
          content: string
          context_message_id: string | null
          conversation_id: string
          created_at: string
          dismissed: boolean | null
          id: string
          metadata: Json | null
          organization_id: string
          suggestion_type: string
          user_id: string
          was_used: boolean | null
        }
        Insert: {
          content: string
          context_message_id?: string | null
          conversation_id: string
          created_at?: string
          dismissed?: boolean | null
          id?: string
          metadata?: Json | null
          organization_id: string
          suggestion_type: string
          user_id: string
          was_used?: boolean | null
        }
        Update: {
          content?: string
          context_message_id?: string | null
          conversation_id?: string
          created_at?: string
          dismissed?: boolean | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          suggestion_type?: string
          user_id?: string
          was_used?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "coaching_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          organization_id: string | null
          paid: boolean | null
          pipe_proposta_id: string | null
          rate_percent: number | null
          sale_event_id: string | null
          source: string
          team_member_id: string
          type: Database["public"]["Enums"]["product_type"]
          year: number
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          month: number
          organization_id?: string | null
          paid?: boolean | null
          pipe_proposta_id?: string | null
          rate_percent?: number | null
          sale_event_id?: string | null
          source?: string
          team_member_id: string
          type: Database["public"]["Enums"]["product_type"]
          year: number
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          month?: number
          organization_id?: string | null
          paid?: boolean | null
          pipe_proposta_id?: string | null
          rate_percent?: number | null
          sale_event_id?: string | null
          source?: string
          team_member_id?: string
          type?: Database["public"]["Enums"]["product_type"]
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "commissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_sale_event_id_fkey"
            columns: ["sale_event_id"]
            isOneToOne: true
            referencedRelation: "sale_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "commissions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
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
      companies: {
        Row: {
          address: string | null
          city: string | null
          country: string | null
          created_at: string
          created_by: string | null
          domain: string | null
          email: string | null
          health_score: number | null
          id: string
          industry: string | null
          metadata: Json | null
          name: string
          notes: string | null
          organization_id: string
          parent_id: string | null
          phone: string | null
          revenue_range: string | null
          size_range: string | null
          state: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          domain?: string | null
          email?: string | null
          health_score?: number | null
          id?: string
          industry?: string | null
          metadata?: Json | null
          name: string
          notes?: string | null
          organization_id: string
          parent_id?: string | null
          phone?: string | null
          revenue_range?: string | null
          size_range?: string | null
          state?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          created_by?: string | null
          domain?: string | null
          email?: string | null
          health_score?: number | null
          id?: string
          industry?: string | null
          metadata?: Json | null
          name?: string
          notes?: string | null
          organization_id?: string
          parent_id?: string | null
          phone?: string | null
          revenue_range?: string | null
          size_range?: string | null
          state?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "companies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "companies_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_participants: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          team_member_id: string
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          team_member_id: string
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "competition_participants_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_participants_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competition_participants_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      competition_prizes: {
        Row: {
          competition_id: string
          created_at: string
          id: string
          position: number
          prize_description: string | null
          prize_icon: string | null
          prize_name: string
          prize_value: number | null
        }
        Insert: {
          competition_id: string
          created_at?: string
          id?: string
          position: number
          prize_description?: string | null
          prize_icon?: string | null
          prize_name: string
          prize_value?: number | null
        }
        Update: {
          competition_id?: string
          created_at?: string
          id?: string
          position?: number
          prize_description?: string | null
          prize_icon?: string | null
          prize_name?: string
          prize_value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competition_prizes_competition_id_fkey"
            columns: ["competition_id"]
            isOneToOne: false
            referencedRelation: "competitions"
            referencedColumns: ["id"]
          },
        ]
      }
      competitions: {
        Row: {
          created_at: string
          created_by: string | null
          criteria: string
          description: string | null
          end_date: string
          id: string
          metric_type: string
          month: number
          name: string
          organization_id: string
          start_date: string
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          criteria?: string
          description?: string | null
          end_date: string
          id?: string
          metric_type?: string
          month: number
          name: string
          organization_id: string
          start_date: string
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          criteria?: string
          description?: string | null
          end_date?: string
          id?: string
          metric_type?: string
          month?: number
          name?: string
          organization_id?: string
          start_date?: string
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "competitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitor_mentions: {
        Row: {
          competitor_id: string
          conversation_id: string
          deal_id: string | null
          detected_at: string
          id: string
          lead_id: string | null
          matched_keyword: string
          message_id: string | null
          organization_id: string
          snippet: string | null
        }
        Insert: {
          competitor_id: string
          conversation_id: string
          deal_id?: string | null
          detected_at?: string
          id?: string
          lead_id?: string | null
          matched_keyword: string
          message_id?: string | null
          organization_id: string
          snippet?: string | null
        }
        Update: {
          competitor_id?: string
          conversation_id?: string
          deal_id?: string | null
          detected_at?: string
          id?: string
          lead_id?: string | null
          matched_keyword?: string
          message_id?: string | null
          organization_id?: string
          snippet?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "competitor_mentions_competitor_id_fkey"
            columns: ["competitor_id"]
            isOneToOne: false
            referencedRelation: "competitors"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_mentions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_mentions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "competitor_mentions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      competitors: {
        Row: {
          aliases: Json | null
          battlecard_md: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          strengths: Json | null
          total_encounters: number
          total_wins: number
          updated_at: string
          weaknesses: Json | null
          website: string | null
          win_rate_vs: number | null
        }
        Insert: {
          aliases?: Json | null
          battlecard_md?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          strengths?: Json | null
          total_encounters?: number
          total_wins?: number
          updated_at?: string
          weaknesses?: Json | null
          website?: string | null
          win_rate_vs?: number | null
        }
        Update: {
          aliases?: Json | null
          battlecard_md?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          strengths?: Json | null
          total_encounters?: number
          total_wins?: number
          updated_at?: string
          weaknesses?: Json | null
          website?: string | null
          win_rate_vs?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "competitors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      consent_records: {
        Row: {
          consent_type: string
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          granted: boolean
          granted_at: string
          id: string
          ip_address: string | null
          lead_id: string | null
          metadata: Json | null
          organization_id: string
          revoked_at: string | null
          source: string
          user_agent: string | null
        }
        Insert: {
          consent_type: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          granted: boolean
          granted_at?: string
          id?: string
          ip_address?: string | null
          lead_id?: string | null
          metadata?: Json | null
          organization_id: string
          revoked_at?: string | null
          source?: string
          user_agent?: string | null
        }
        Update: {
          consent_type?: string
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          granted?: boolean
          granted_at?: string
          id?: string
          ip_address?: string | null
          lead_id?: string | null
          metadata?: Json | null
          organization_id?: string
          revoked_at?: string | null
          source?: string
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consent_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consent_records_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          avatar_url: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          id: string
          is_primary: boolean | null
          job_title: string | null
          linkedin_url: string | null
          metadata: Json | null
          name: string
          normalized_phone: string | null
          organization_id: string
          phone: string | null
          source: string | null
          source_lead_id: string | null
          tags: Json | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          job_title?: string | null
          linkedin_url?: string | null
          metadata?: Json | null
          name: string
          normalized_phone?: string | null
          organization_id: string
          phone?: string | null
          source?: string | null
          source_lead_id?: string | null
          tags?: Json | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          id?: string
          is_primary?: boolean | null
          job_title?: string | null
          linkedin_url?: string | null
          metadata?: Json | null
          name?: string
          normalized_phone?: string | null
          organization_id?: string
          phone?: string | null
          source?: string | null
          source_lead_id?: string | null
          tags?: Json | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contacts_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_context_summary: {
        Row: {
          created_at: string
          engagement_score: number | null
          followup_count: number | null
          id: string
          key_points: string[] | null
          last_followup_at: string | null
          last_intent: string | null
          last_message_at: string | null
          last_topic: string | null
          lead_id: string
          lead_temperature: string | null
          message_count: number | null
          next_action: string | null
          objections_raised: string[] | null
          organization_id: string
          qualification_data: Json | null
          questions_asked: string[] | null
          sentiment: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          engagement_score?: number | null
          followup_count?: number | null
          id?: string
          key_points?: string[] | null
          last_followup_at?: string | null
          last_intent?: string | null
          last_message_at?: string | null
          last_topic?: string | null
          lead_id: string
          lead_temperature?: string | null
          message_count?: number | null
          next_action?: string | null
          objections_raised?: string[] | null
          organization_id: string
          qualification_data?: Json | null
          questions_asked?: string[] | null
          sentiment?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          engagement_score?: number | null
          followup_count?: number | null
          id?: string
          key_points?: string[] | null
          last_followup_at?: string | null
          last_intent?: string | null
          last_message_at?: string | null
          last_topic?: string | null
          lead_id?: string
          lead_temperature?: string | null
          message_count?: number | null
          next_action?: string | null
          objections_raised?: string[] | null
          organization_id?: string
          qualification_data?: Json | null
          questions_asked?: string[] | null
          sentiment?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_context_summary_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_context_summary_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_context_summary_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string | null
          id: string
          idempotency_key: string | null
          metadata: Json | null
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string | null
          id?: string
          idempotency_key?: string | null
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_read_state: {
        Row: {
          conversation_key: string
          created_at: string
          id: string
          last_read_at: string
          organization_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          conversation_key: string
          created_at?: string
          id?: string
          last_read_at?: string
          organization_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          conversation_key?: string
          created_at?: string
          id?: string
          last_read_at?: string
          organization_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_read_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_summaries: {
        Row: {
          coaching_tips: Json | null
          conversation_id: string | null
          created_at: string | null
          id: string
          key_points: Json | null
          lead_id: string
          lead_temperature: string | null
          message_count: number | null
          next_action: string | null
          objections: Json | null
          organization_id: string
          questions_asked: Json | null
          sentiment: string | null
          summary: string
          updated_at: string | null
        }
        Insert: {
          coaching_tips?: Json | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          key_points?: Json | null
          lead_id: string
          lead_temperature?: string | null
          message_count?: number | null
          next_action?: string | null
          objections?: Json | null
          organization_id: string
          questions_asked?: Json | null
          sentiment?: string | null
          summary: string
          updated_at?: string | null
        }
        Update: {
          coaching_tips?: Json | null
          conversation_id?: string | null
          created_at?: string | null
          id?: string
          key_points?: Json | null
          lead_id?: string
          lead_temperature?: string | null
          message_count?: number | null
          next_action?: string | null
          objections?: Json | null
          organization_id?: string
          questions_asked?: Json | null
          sentiment?: string | null
          summary?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversation_summaries_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_summaries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          agent_id: string
          ai_state: Database["public"]["Enums"]["ai_takeover_state_enum"]
          ai_state_resume_mode: string | null
          ai_state_updated_at: string | null
          ai_state_updated_by: string | null
          assigned_to: string | null
          context: Json | null
          created_at: string | null
          human_paused_until: string | null
          id: string
          last_message_at: string | null
          lead_id: string
          long_term_memory: Json | null
          organization_id: string
          short_term_memory: Json | null
          state: string
          turn_count: number | null
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          ai_state?: Database["public"]["Enums"]["ai_takeover_state_enum"]
          ai_state_resume_mode?: string | null
          ai_state_updated_at?: string | null
          ai_state_updated_by?: string | null
          assigned_to?: string | null
          context?: Json | null
          created_at?: string | null
          human_paused_until?: string | null
          id?: string
          last_message_at?: string | null
          lead_id: string
          long_term_memory?: Json | null
          organization_id: string
          short_term_memory?: Json | null
          state?: string
          turn_count?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          ai_state?: Database["public"]["Enums"]["ai_takeover_state_enum"]
          ai_state_resume_mode?: string | null
          ai_state_updated_at?: string | null
          ai_state_updated_by?: string | null
          assigned_to?: string | null
          context?: Json | null
          created_at?: string | null
          human_paused_until?: string | null
          id?: string
          last_message_at?: string | null
          lead_id?: string
          long_term_memory?: Json | null
          organization_id?: string
          short_term_memory?: Json | null
          state?: string
          turn_count?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "conversations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_ab_assignments: {
        Row: {
          agent_id: string
          assigned_at: string | null
          conversation_id: string | null
          id: string
          lead_id: string
          variant_id: string
        }
        Insert: {
          agent_id: string
          assigned_at?: string | null
          conversation_id?: string | null
          id?: string
          lead_id: string
          variant_id: string
        }
        Update: {
          agent_id?: string
          assigned_at?: string | null
          conversation_id?: string | null
          id?: string
          lead_id?: string
          variant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_ab_assignments_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_ab_assignments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_ab_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_ab_assignments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_ab_assignments_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "copilot_agent_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_audios: {
        Row: {
          agent_id: string
          created_at: string | null
          file_size: number | null
          id: string
          is_active: boolean | null
          mime_type: string
          name: string
          organization_id: string
          public_url: string
          storage_path: string
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          created_at?: string | null
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          mime_type?: string
          name?: string
          organization_id: string
          public_url: string
          storage_path: string
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          created_at?: string | null
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          mime_type?: string
          name?: string
          organization_id?: string
          public_url?: string
          storage_path?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_audios_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agent_audios_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_document_chunks: {
        Row: {
          agent_id: string
          chunk_index: number
          content: string
          created_at: string | null
          document_id: string
          embedding: string | null
          id: string
          organization_id: string
        }
        Insert: {
          agent_id: string
          chunk_index?: number
          content: string
          created_at?: string | null
          document_id: string
          embedding?: string | null
          id?: string
          organization_id: string
        }
        Update: {
          agent_id?: string
          chunk_index?: number
          content?: string
          created_at?: string | null
          document_id?: string
          embedding?: string | null
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_document_chunks_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agent_document_chunks_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "copilot_agent_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agent_document_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_documents: {
        Row: {
          agent_id: string
          content: string | null
          created_at: string | null
          description: string | null
          error_message: string | null
          file_name: string
          file_path: string
          file_size: number | null
          file_type: string
          id: string
          mime_type: string | null
          organization_id: string
          send_when: string | null
          status: string | null
          summary: string | null
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          content?: string | null
          created_at?: string | null
          description?: string | null
          error_message?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          file_type?: string
          id?: string
          mime_type?: string | null
          organization_id: string
          send_when?: string | null
          status?: string | null
          summary?: string | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          content?: string | null
          created_at?: string | null
          description?: string | null
          error_message?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          file_type?: string
          id?: string
          mime_type?: string | null
          organization_id?: string
          send_when?: string | null
          status?: string | null
          summary?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_documents_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agent_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_faqs: {
        Row: {
          agent_id: string
          answer: string
          created_at: string
          embedding: string | null
          id: string
          position: number | null
          question: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          answer: string
          created_at?: string
          embedding?: string | null
          id?: string
          position?: number | null
          question: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          answer?: string
          created_at?: string
          embedding?: string | null
          id?: string
          position?: number | null
          question?: string
          updated_at?: string
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
      copilot_agent_followup_rules: {
        Row: {
          agent_id: string
          business_hours_end: string | null
          business_hours_start: string | null
          context_lookback_days: number | null
          created_at: string
          description: string | null
          filter_custom_fields: Json | null
          filter_origins: string[] | null
          filter_pipes: string[] | null
          filter_stages: string[] | null
          filter_tags: string[] | null
          filter_tags_exclude: string[] | null
          followup_style: string | null
          id: string
          is_active: boolean | null
          max_followups: number | null
          message_template: string | null
          name: string
          priority: number | null
          send_days: string[] | null
          send_only_business_hours: boolean | null
          sequence_steps: Json | null
          timezone: string | null
          trigger_delay_hours: number | null
          trigger_delay_minutes: number | null
          trigger_type: string
          updated_at: string
          use_last_context: boolean | null
        }
        Insert: {
          agent_id: string
          business_hours_end?: string | null
          business_hours_start?: string | null
          context_lookback_days?: number | null
          created_at?: string
          description?: string | null
          filter_custom_fields?: Json | null
          filter_origins?: string[] | null
          filter_pipes?: string[] | null
          filter_stages?: string[] | null
          filter_tags?: string[] | null
          filter_tags_exclude?: string[] | null
          followup_style?: string | null
          id?: string
          is_active?: boolean | null
          max_followups?: number | null
          message_template?: string | null
          name: string
          priority?: number | null
          send_days?: string[] | null
          send_only_business_hours?: boolean | null
          sequence_steps?: Json | null
          timezone?: string | null
          trigger_delay_hours?: number | null
          trigger_delay_minutes?: number | null
          trigger_type?: string
          updated_at?: string
          use_last_context?: boolean | null
        }
        Update: {
          agent_id?: string
          business_hours_end?: string | null
          business_hours_start?: string | null
          context_lookback_days?: number | null
          created_at?: string
          description?: string | null
          filter_custom_fields?: Json | null
          filter_origins?: string[] | null
          filter_pipes?: string[] | null
          filter_stages?: string[] | null
          filter_tags?: string[] | null
          filter_tags_exclude?: string[] | null
          followup_style?: string | null
          id?: string
          is_active?: boolean | null
          max_followups?: number | null
          message_template?: string | null
          name?: string
          priority?: number | null
          send_days?: string[] | null
          send_only_business_hours?: boolean | null
          sequence_steps?: Json | null
          timezone?: string | null
          trigger_delay_hours?: number | null
          trigger_delay_minutes?: number | null
          trigger_type?: string
          updated_at?: string
          use_last_context?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_followup_rules_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agent_kanban_rules: {
        Row: {
          agent_id: string
          allowed_actions: string[] | null
          behavior: string
          created_at: string
          forbidden_actions: string[] | null
          goal: string
          id: string
          needs_review: boolean | null
          pipe_type: string
          stage_name: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          allowed_actions?: string[] | null
          behavior: string
          created_at?: string
          forbidden_actions?: string[] | null
          goal: string
          id?: string
          needs_review?: boolean | null
          pipe_type: string
          stage_name: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          allowed_actions?: string[] | null
          behavior?: string
          created_at?: string
          forbidden_actions?: string[] | null
          goal?: string
          id?: string
          needs_review?: boolean | null
          pipe_type?: string
          stage_name?: string
          updated_at?: string
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
      copilot_agent_variants: {
        Row: {
          agent_id: string
          avg_score_goal_align: number | null
          avg_score_overall: number | null
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          is_control: boolean | null
          meetings_scheduled: number | null
          name: string
          organization_id: string
          qualification_rate: number | null
          system_prompt_override: string | null
          temperature_override: string | null
          total_conversations: number | null
          total_turns: number | null
          traffic_pct: number | null
          updated_at: string | null
        }
        Insert: {
          agent_id: string
          avg_score_goal_align?: number | null
          avg_score_overall?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_control?: boolean | null
          meetings_scheduled?: number | null
          name: string
          organization_id: string
          qualification_rate?: number | null
          system_prompt_override?: string | null
          temperature_override?: string | null
          total_conversations?: number | null
          total_turns?: number | null
          traffic_pct?: number | null
          updated_at?: string | null
        }
        Update: {
          agent_id?: string
          avg_score_goal_align?: number | null
          avg_score_overall?: number | null
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          is_control?: boolean | null
          meetings_scheduled?: number | null
          name?: string
          organization_id?: string
          qualification_rate?: number | null
          system_prompt_override?: string | null
          temperature_override?: string | null
          total_conversations?: number | null
          total_turns?: number | null
          traffic_pct?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agent_variants_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agent_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_agents: {
        Row: {
          activation_triggers: Json | null
          active_pipes: Json | null
          active_stages: Json | null
          allowed_topics: string[] | null
          anti_patterns: string[] | null
          attend_unknown_contacts: boolean | null
          auto_move_on_objective: boolean | null
          auto_move_on_qualify: boolean | null
          automation_actions: Json | null
          availability: Json | null
          behavior_enforcement: string | null
          behavior_windows: Json | null
          business_context: Json | null
          campaign_id: string | null
          can_answer_faq: boolean | null
          can_create_lead: boolean | null
          can_move_cards: boolean | null
          can_qualify_lead: boolean | null
          can_schedule_meeting: boolean | null
          can_send_document: boolean | null
          can_send_followup: boolean | null
          can_transfer_human: boolean | null
          can_transfer_sz_chat: boolean | null
          can_update_crm: boolean | null
          can_update_lead: boolean | null
          context_config: Json | null
          conversation_style: Json | null
          created_at: string
          created_by: string
          custom_instructions: string | null
          few_shot_examples: Json | null
          finalized_at: string | null
          forbidden_topics: string[] | null
          handoff_notify_instructions: string | null
          handoff_notify_phones: string[] | null
          human_pause_duration_minutes: number | null
          human_pause_enabled: boolean | null
          human_transfer_triggers: string[] | null
          id: string
          intent_detection: Json | null
          is_active: boolean | null
          is_default: boolean | null
          llm_model: string
          llm_temperature_mode: string | null
          main_objective: string
          max_conversation_turns: number | null
          move_rules: Json | null
          name: string
          natural_messaging_config: Json | null
          objective_composite: Json | null
          operation_mode: string | null
          organization_id: string
          outbound_config: Json | null
          personality_energy: Database["public"]["Enums"]["agent_energy"]
          personality_style: Database["public"]["Enums"]["agent_style"]
          personality_tone: Database["public"]["Enums"]["agent_tone"]
          prompt_hash: string | null
          qualification_rules: Json | null
          reasoning_mode: string
          response_delay_ms: number | null
          response_delay_seconds: number | null
          retention_config: Json | null
          retention_enabled: boolean | null
          routing_origins: string[] | null
          routing_segments: string[] | null
          routing_stages: string[] | null
          skills: string[] | null
          system_prompt: string | null
          system_prompt_version: number | null
          template_prompt_override: string | null
          template_type: Database["public"]["Enums"]["agent_template_type"]
          tts_config: Json | null
          updated_at: string
          whatsapp_instance_id: string | null
          wizard_version: number | null
        }
        Insert: {
          activation_triggers?: Json | null
          active_pipes?: Json | null
          active_stages?: Json | null
          allowed_topics?: string[] | null
          anti_patterns?: string[] | null
          attend_unknown_contacts?: boolean | null
          auto_move_on_objective?: boolean | null
          auto_move_on_qualify?: boolean | null
          automation_actions?: Json | null
          availability?: Json | null
          behavior_enforcement?: string | null
          behavior_windows?: Json | null
          business_context?: Json | null
          campaign_id?: string | null
          can_answer_faq?: boolean | null
          can_create_lead?: boolean | null
          can_move_cards?: boolean | null
          can_qualify_lead?: boolean | null
          can_schedule_meeting?: boolean | null
          can_send_document?: boolean | null
          can_send_followup?: boolean | null
          can_transfer_human?: boolean | null
          can_transfer_sz_chat?: boolean | null
          can_update_crm?: boolean | null
          can_update_lead?: boolean | null
          context_config?: Json | null
          conversation_style?: Json | null
          created_at?: string
          created_by: string
          custom_instructions?: string | null
          few_shot_examples?: Json | null
          finalized_at?: string | null
          forbidden_topics?: string[] | null
          handoff_notify_instructions?: string | null
          handoff_notify_phones?: string[] | null
          human_pause_duration_minutes?: number | null
          human_pause_enabled?: boolean | null
          human_transfer_triggers?: string[] | null
          id?: string
          intent_detection?: Json | null
          is_active?: boolean | null
          is_default?: boolean | null
          llm_model?: string
          llm_temperature_mode?: string | null
          main_objective: string
          max_conversation_turns?: number | null
          move_rules?: Json | null
          name: string
          natural_messaging_config?: Json | null
          objective_composite?: Json | null
          operation_mode?: string | null
          organization_id: string
          outbound_config?: Json | null
          personality_energy?: Database["public"]["Enums"]["agent_energy"]
          personality_style?: Database["public"]["Enums"]["agent_style"]
          personality_tone?: Database["public"]["Enums"]["agent_tone"]
          prompt_hash?: string | null
          qualification_rules?: Json | null
          reasoning_mode?: string
          response_delay_ms?: number | null
          response_delay_seconds?: number | null
          retention_config?: Json | null
          retention_enabled?: boolean | null
          routing_origins?: string[] | null
          routing_segments?: string[] | null
          routing_stages?: string[] | null
          skills?: string[] | null
          system_prompt?: string | null
          system_prompt_version?: number | null
          template_prompt_override?: string | null
          template_type?: Database["public"]["Enums"]["agent_template_type"]
          tts_config?: Json | null
          updated_at?: string
          whatsapp_instance_id?: string | null
          wizard_version?: number | null
        }
        Update: {
          activation_triggers?: Json | null
          active_pipes?: Json | null
          active_stages?: Json | null
          allowed_topics?: string[] | null
          anti_patterns?: string[] | null
          attend_unknown_contacts?: boolean | null
          auto_move_on_objective?: boolean | null
          auto_move_on_qualify?: boolean | null
          automation_actions?: Json | null
          availability?: Json | null
          behavior_enforcement?: string | null
          behavior_windows?: Json | null
          business_context?: Json | null
          campaign_id?: string | null
          can_answer_faq?: boolean | null
          can_create_lead?: boolean | null
          can_move_cards?: boolean | null
          can_qualify_lead?: boolean | null
          can_schedule_meeting?: boolean | null
          can_send_document?: boolean | null
          can_send_followup?: boolean | null
          can_transfer_human?: boolean | null
          can_transfer_sz_chat?: boolean | null
          can_update_crm?: boolean | null
          can_update_lead?: boolean | null
          context_config?: Json | null
          conversation_style?: Json | null
          created_at?: string
          created_by?: string
          custom_instructions?: string | null
          few_shot_examples?: Json | null
          finalized_at?: string | null
          forbidden_topics?: string[] | null
          handoff_notify_instructions?: string | null
          handoff_notify_phones?: string[] | null
          human_pause_duration_minutes?: number | null
          human_pause_enabled?: boolean | null
          human_transfer_triggers?: string[] | null
          id?: string
          intent_detection?: Json | null
          is_active?: boolean | null
          is_default?: boolean | null
          llm_model?: string
          llm_temperature_mode?: string | null
          main_objective?: string
          max_conversation_turns?: number | null
          move_rules?: Json | null
          name?: string
          natural_messaging_config?: Json | null
          objective_composite?: Json | null
          operation_mode?: string | null
          organization_id?: string
          outbound_config?: Json | null
          personality_energy?: Database["public"]["Enums"]["agent_energy"]
          personality_style?: Database["public"]["Enums"]["agent_style"]
          personality_tone?: Database["public"]["Enums"]["agent_tone"]
          prompt_hash?: string | null
          qualification_rules?: Json | null
          reasoning_mode?: string
          response_delay_ms?: number | null
          response_delay_seconds?: number | null
          retention_config?: Json | null
          retention_enabled?: boolean | null
          routing_origins?: string[] | null
          routing_segments?: string[] | null
          routing_stages?: string[] | null
          skills?: string[] | null
          system_prompt?: string | null
          system_prompt_version?: number | null
          template_prompt_override?: string | null
          template_type?: Database["public"]["Enums"]["agent_template_type"]
          tts_config?: Json | null
          updated_at?: string
          whatsapp_instance_id?: string | null
          wizard_version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_agents_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_agents_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_conversation_evaluations: {
        Row: {
          agent_id: string | null
          agent_response: string
          conversation_id: string
          evaluated_at: string | null
          id: string
          lead_id: string | null
          model_used: string | null
          organization_id: string
          score_conciseness: number | null
          score_goal_align: number | null
          score_overall: number | null
          score_relevance: number | null
          score_tone: number | null
          strengths: string | null
          suggestion: string | null
          turn_count: number
          user_message: string
          weaknesses: string | null
        }
        Insert: {
          agent_id?: string | null
          agent_response: string
          conversation_id: string
          evaluated_at?: string | null
          id?: string
          lead_id?: string | null
          model_used?: string | null
          organization_id: string
          score_conciseness?: number | null
          score_goal_align?: number | null
          score_overall?: number | null
          score_relevance?: number | null
          score_tone?: number | null
          strengths?: string | null
          suggestion?: string | null
          turn_count?: number
          user_message: string
          weaknesses?: string | null
        }
        Update: {
          agent_id?: string | null
          agent_response?: string
          conversation_id?: string
          evaluated_at?: string | null
          id?: string
          lead_id?: string | null
          model_used?: string | null
          organization_id?: string
          score_conciseness?: number | null
          score_goal_align?: number | null
          score_overall?: number | null
          score_relevance?: number | null
          score_tone?: number | null
          strengths?: string | null
          suggestion?: string | null
          turn_count?: number
          user_message?: string
          weaknesses?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_conversation_evaluations_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_conversation_evaluations_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_conversation_evaluations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_conversation_evaluations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_conversation_evaluations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_followup_execution_log: {
        Row: {
          id: string
          instance_name: string | null
          lead_id: string
          message_content: string | null
          organization_id: string
          rule_id: string
          sent_at: string
        }
        Insert: {
          id?: string
          instance_name?: string | null
          lead_id: string
          message_content?: string | null
          organization_id: string
          rule_id: string
          sent_at?: string
        }
        Update: {
          id?: string
          instance_name?: string | null
          lead_id?: string
          message_content?: string | null
          organization_id?: string
          rule_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_followup_execution_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_execution_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_execution_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_execution_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "copilot_agent_followup_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_followup_situation_config: {
        Row: {
          business_hours_end: string
          business_hours_start: string
          copy_override: Json | null
          created_at: string
          delay_hours: number
          delay_minutes: number
          id: string
          is_active: boolean
          organization_id: string
          send_days: string[]
          send_only_business_hours: boolean
          situation_id: string
          spacing_hours: number | null
          timezone: string
          touch_count: number | null
          trigger_stage_keys: string[]
          updated_at: string | null
        }
        Insert: {
          business_hours_end?: string
          business_hours_start?: string
          copy_override?: Json | null
          created_at?: string
          delay_hours?: number
          delay_minutes?: number
          id?: string
          is_active?: boolean
          organization_id: string
          send_days?: string[]
          send_only_business_hours?: boolean
          situation_id: string
          spacing_hours?: number | null
          timezone?: string
          touch_count?: number | null
          trigger_stage_keys?: string[]
          updated_at?: string | null
        }
        Update: {
          business_hours_end?: string
          business_hours_start?: string
          copy_override?: Json | null
          created_at?: string
          delay_hours?: number
          delay_minutes?: number
          id?: string
          is_active?: boolean
          organization_id?: string
          send_days?: string[]
          send_only_business_hours?: boolean
          situation_id?: string
          spacing_hours?: number | null
          timezone?: string
          touch_count?: number | null
          trigger_stage_keys?: string[]
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_followup_situation_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_followup_step_log: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_reason: string | null
          created_at: string
          current_step: number
          id: string
          last_step_sent_at: string | null
          lead_id: string
          organization_id: string
          rule_id: string | null
          situation_config_id: string | null
          updated_at: string | null
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_reason?: string | null
          created_at?: string
          current_step?: number
          id?: string
          last_step_sent_at?: string | null
          lead_id: string
          organization_id: string
          rule_id?: string | null
          situation_config_id?: string | null
          updated_at?: string | null
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_reason?: string | null
          created_at?: string
          current_step?: number
          id?: string
          last_step_sent_at?: string | null
          lead_id?: string
          organization_id?: string
          rule_id?: string | null
          situation_config_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_followup_step_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_step_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_step_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_step_log_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "copilot_agent_followup_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_followup_step_log_situation_config_id_fkey"
            columns: ["situation_config_id"]
            isOneToOne: false
            referencedRelation: "copilot_followup_situation_config"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_message_queue: {
        Row: {
          attempts: number
          batch_key: string | null
          claimed_at: string | null
          conversation_id: string | null
          created_at: string
          id: string
          last_error: string | null
          message_id: string
          next_attempt_at: string | null
          organization_id: string
          phone: string
          processed_at: string | null
          queued_at: string
          status: string
        }
        Insert: {
          attempts?: number
          batch_key?: string | null
          claimed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          message_id: string
          next_attempt_at?: string | null
          organization_id: string
          phone: string
          processed_at?: string | null
          queued_at?: string
          status?: string
        }
        Update: {
          attempts?: number
          batch_key?: string | null
          claimed_at?: string | null
          conversation_id?: string | null
          created_at?: string
          id?: string
          last_error?: string | null
          message_id?: string
          next_attempt_at?: string | null
          organization_id?: string
          phone?: string
          processed_at?: string | null
          queued_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_message_queue_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_message_queue_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_message_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_processing_locks: {
        Row: {
          locked_at: string
          organization_id: string
          phone: string
        }
        Insert: {
          locked_at?: string
          organization_id: string
          phone: string
        }
        Update: {
          locked_at?: string
          organization_id?: string
          phone?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_processing_locks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_prompt_analyses: {
        Row: {
          accepted_ids: string[]
          agent_id: string
          conversation_count: number
          created_at: string
          created_by: string
          dismissed_ids: string[]
          id: string
          message_count: number
          organization_id: string
          suggestions: Json
        }
        Insert: {
          accepted_ids?: string[]
          agent_id: string
          conversation_count?: number
          created_at?: string
          created_by: string
          dismissed_ids?: string[]
          id?: string
          message_count?: number
          organization_id: string
          suggestions?: Json
        }
        Update: {
          accepted_ids?: string[]
          agent_id?: string
          conversation_count?: number
          created_at?: string
          created_by?: string
          dismissed_ids?: string[]
          id?: string
          message_count?: number
          organization_id?: string
          suggestions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "copilot_prompt_analyses_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_prompt_analyses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_agent_media: {
        Row: {
          agent_id: string
          media_id: string
          organization_id: string
          trigger: string | null
        }
        Insert: {
          agent_id: string
          media_id: string
          organization_id: string
          trigger?: string | null
        }
        Update: {
          agent_id?: string
          media_id?: string
          organization_id?: string
          trigger?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_agent_media_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_v2_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_v2_agent_media_media_id_fkey"
            columns: ["media_id"]
            isOneToOne: false
            referencedRelation: "copilot_v2_send_media"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_agents: {
        Row: {
          archetype: Database["public"]["Enums"]["copilot_v2_archetype"]
          created_at: string
          id: string
          is_active: boolean
          model_id: Database["public"]["Enums"]["copilot_v2_model_id"]
          organization_id: string
          updated_at: string
        }
        Insert: {
          archetype: Database["public"]["Enums"]["copilot_v2_archetype"]
          created_at?: string
          id?: string
          is_active?: boolean
          model_id?: Database["public"]["Enums"]["copilot_v2_model_id"]
          organization_id: string
          updated_at?: string
        }
        Update: {
          archetype?: Database["public"]["Enums"]["copilot_v2_archetype"]
          created_at?: string
          id?: string
          is_active?: boolean
          model_id?: Database["public"]["Enums"]["copilot_v2_model_id"]
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_agents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_config: {
        Row: {
          agent_id: string
          escape_hatch_notes: string | null
          organization_id: string
          slots: Json
          updated_at: string
        }
        Insert: {
          agent_id: string
          escape_hatch_notes?: string | null
          organization_id: string
          slots?: Json
          updated_at?: string
        }
        Update: {
          agent_id?: string
          escape_hatch_notes?: string | null
          organization_id?: string
          slots?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_config_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "copilot_v2_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_v2_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_dedup_locks: {
        Row: {
          created_at: string
          dedup_key: string
          expires_at: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          dedup_key: string
          expires_at: string
          organization_id: string
        }
        Update: {
          created_at?: string
          dedup_key?: string
          expires_at?: string
          organization_id?: string
        }
        Relationships: []
      }
      copilot_v2_dlq: {
        Row: {
          canonical_phone: string | null
          content: string | null
          created_at: string
          id: string
          organization_id: string
          payload: Json | null
          queue_id: string | null
          reason: string
          trace_id: string | null
        }
        Insert: {
          canonical_phone?: string | null
          content?: string | null
          created_at?: string
          id?: string
          organization_id: string
          payload?: Json | null
          queue_id?: string | null
          reason: string
          trace_id?: string | null
        }
        Update: {
          canonical_phone?: string | null
          content?: string | null
          created_at?: string
          id?: string
          organization_id?: string
          payload?: Json | null
          queue_id?: string | null
          reason?: string
          trace_id?: string | null
        }
        Relationships: []
      }
      copilot_v2_knowledge: {
        Row: {
          created_at: string
          extracted_text: string | null
          id: string
          organization_id: string
          source_kind: Database["public"]["Enums"]["copilot_v2_knowledge_kind"]
          status: Database["public"]["Enums"]["copilot_v2_knowledge_status"]
          storage_path: string
        }
        Insert: {
          created_at?: string
          extracted_text?: string | null
          id?: string
          organization_id: string
          source_kind: Database["public"]["Enums"]["copilot_v2_knowledge_kind"]
          status?: Database["public"]["Enums"]["copilot_v2_knowledge_status"]
          storage_path: string
        }
        Update: {
          created_at?: string
          extracted_text?: string | null
          id?: string
          organization_id?: string
          source_kind?: Database["public"]["Enums"]["copilot_v2_knowledge_kind"]
          status?: Database["public"]["Enums"]["copilot_v2_knowledge_status"]
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_knowledge_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_knowledge_chunks: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          id: number
          knowledge_id: string
          organization_id: string
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          id?: never
          knowledge_id: string
          organization_id: string
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          id?: never
          knowledge_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_knowledge_chunks_knowledge_id_fkey"
            columns: ["knowledge_id"]
            isOneToOne: false
            referencedRelation: "copilot_v2_knowledge"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_message_queue: {
        Row: {
          attempts: number
          canonical_phone: string
          content: string
          conversation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          lead_id: string | null
          message_type: string
          next_retry_at: string | null
          organization_id: string
          source: string
          status: Database["public"]["Enums"]["copilot_v2_queue_status"]
          trace_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          canonical_phone: string
          content: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key: string
          last_error?: string | null
          lead_id?: string | null
          message_type?: string
          next_retry_at?: string | null
          organization_id: string
          source?: string
          status?: Database["public"]["Enums"]["copilot_v2_queue_status"]
          trace_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          canonical_phone?: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          id?: string
          idempotency_key?: string
          last_error?: string | null
          lead_id?: string | null
          message_type?: string
          next_retry_at?: string | null
          organization_id?: string
          source?: string
          status?: Database["public"]["Enums"]["copilot_v2_queue_status"]
          trace_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_message_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_pause_state: {
        Row: {
          canonical_phone: string
          organization_id: string
          paused_until: string | null
          reason: string | null
          updated_at: string
        }
        Insert: {
          canonical_phone: string
          organization_id: string
          paused_until?: string | null
          reason?: string | null
          updated_at?: string
        }
        Update: {
          canonical_phone?: string
          organization_id?: string
          paused_until?: string | null
          reason?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      copilot_v2_rubric: {
        Row: {
          agent_id: string
          organization_id: string
          rules: Json
          updated_at: string
        }
        Insert: {
          agent_id: string
          organization_id: string
          rules?: Json
          updated_at?: string
        }
        Update: {
          agent_id?: string
          organization_id?: string
          rules?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_rubric_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: true
            referencedRelation: "copilot_v2_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "copilot_v2_rubric_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_send_media: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          kind: Database["public"]["Enums"]["copilot_v2_media_kind"]
          nuance: string | null
          organization_id: string
          storage_path: string
          trigger: string
          what_it_is: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind: Database["public"]["Enums"]["copilot_v2_media_kind"]
          nuance?: string | null
          organization_id: string
          storage_path: string
          trigger: string
          what_it_is: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          kind?: Database["public"]["Enums"]["copilot_v2_media_kind"]
          nuance?: string | null
          organization_id?: string
          storage_path?: string
          trigger?: string
          what_it_is?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_send_media_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      copilot_v2_trace_steps: {
        Row: {
          created_at: string
          id: number
          meta: Json
          reason: string | null
          step: string
          trace_id: string
        }
        Insert: {
          created_at?: string
          id?: never
          meta?: Json
          reason?: string | null
          step: string
          trace_id: string
        }
        Update: {
          created_at?: string
          id?: never
          meta?: Json
          reason?: string | null
          step?: string
          trace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "copilot_v2_trace_steps_trace_id_fkey"
            columns: ["trace_id"]
            isOneToOne: false
            referencedRelation: "copilot_v2_traces"
            referencedColumns: ["trace_id"]
          },
        ]
      }
      copilot_v2_traces: {
        Row: {
          archetype: Database["public"]["Enums"]["copilot_v2_archetype"] | null
          conversation_id: string | null
          created_at: string
          lead_id: string | null
          organization_id: string
          status: string
          trace_id: string
          turn_number: number | null
        }
        Insert: {
          archetype?: Database["public"]["Enums"]["copilot_v2_archetype"] | null
          conversation_id?: string | null
          created_at?: string
          lead_id?: string | null
          organization_id: string
          status?: string
          trace_id?: string
          turn_number?: number | null
        }
        Update: {
          archetype?: Database["public"]["Enums"]["copilot_v2_archetype"] | null
          conversation_id?: string | null
          created_at?: string
          lead_id?: string | null
          organization_id?: string
          status?: string
          trace_id?: string
          turn_number?: number | null
        }
        Relationships: []
      }
      copilot_v2_turn_counters: {
        Row: {
          conversation_id: string
          organization_id: string
          turn_count: number
          updated_at: string
        }
        Insert: {
          conversation_id: string
          organization_id: string
          turn_count?: number
          updated_at?: string
        }
        Update: {
          conversation_id?: string
          organization_id?: string
          turn_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      coupon_redemptions: {
        Row: {
          coupon_id: string
          discount_applied_cents: number | null
          id: string
          organization_id: string | null
          payment_id: string
          redeemed_at: string
        }
        Insert: {
          coupon_id: string
          discount_applied_cents?: number | null
          id?: string
          organization_id?: string | null
          payment_id: string
          redeemed_at?: string
        }
        Update: {
          coupon_id?: string
          discount_applied_cents?: number | null
          id?: string
          organization_id?: string | null
          payment_id?: string
          redeemed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupon_redemptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coupon_redemptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          applies_to: string[]
          code: string
          created_at: string
          created_by: string | null
          current_uses: number
          discount_pct: number
          id: string
          is_active: boolean
          max_uses: number | null
          valid_from: string | null
          valid_until: string | null
        }
        Insert: {
          applies_to?: string[]
          code: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          discount_pct: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Update: {
          applies_to?: string[]
          code?: string
          created_at?: string
          created_by?: string | null
          current_uses?: number
          discount_pct?: number
          id?: string
          is_active?: boolean
          max_uses?: number | null
          valid_from?: string | null
          valid_until?: string | null
        }
        Relationships: []
      }
      cron_config: {
        Row: {
          key: string
          value: string | null
        }
        Insert: {
          key: string
          value?: string | null
        }
        Update: {
          key?: string
          value?: string | null
        }
        Relationships: []
      }
      custom_pipe_entries: {
        Row: {
          assigned_to: string | null
          created_at: string | null
          deal_id: string | null
          entered_at: string | null
          id: string
          lead_id: string
          notes: string | null
          organization_id: string
          pipeline_id: string
          pre_sale_responsible_id: string | null
          sale_responsible_id: string | null
          stage_changed_at: string | null
          stage_id: string
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string
          lead_id: string
          notes?: string | null
          organization_id: string
          pipeline_id: string
          pre_sale_responsible_id?: string | null
          sale_responsible_id?: string | null
          stage_changed_at?: string | null
          stage_id: string
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string
          lead_id?: string
          notes?: string | null
          organization_id?: string
          pipeline_id?: string
          pre_sale_responsible_id?: string | null
          sale_responsible_id?: string | null
          stage_changed_at?: string | null
          stage_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_pipe_entries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_entries_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "custom_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_pipe_transitions: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean | null
          organization_id: string
          source_pipe_type: string | null
          source_pipeline_id: string | null
          source_stage_id: string | null
          source_stage_key: string | null
          target_pipe_type: string | null
          target_pipeline_id: string | null
          target_stage_id: string | null
          target_stage_key: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id: string
          source_pipe_type?: string | null
          source_pipeline_id?: string | null
          source_stage_id?: string | null
          source_stage_key?: string | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          organization_id?: string
          source_pipe_type?: string | null
          source_pipeline_id?: string | null
          source_stage_id?: string | null
          source_stage_key?: string | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_pipe_transitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_transitions_source_pipeline_id_fkey"
            columns: ["source_pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_transitions_source_stage_id_fkey"
            columns: ["source_stage_id"]
            isOneToOne: false
            referencedRelation: "custom_pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_transitions_target_pipeline_id_fkey"
            columns: ["target_pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipe_transitions_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "custom_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_pipeline_members: {
        Row: {
          achieved_count: number | null
          bonus_earned: boolean | null
          created_at: string | null
          goal_count: number | null
          id: string
          organization_id: string
          pipeline_id: string
          role: string
          team_member_id: string
        }
        Insert: {
          achieved_count?: number | null
          bonus_earned?: boolean | null
          created_at?: string | null
          goal_count?: number | null
          id?: string
          organization_id: string
          pipeline_id: string
          role?: string
          team_member_id: string
        }
        Update: {
          achieved_count?: number | null
          bonus_earned?: boolean | null
          created_at?: string | null
          goal_count?: number | null
          id?: string
          organization_id?: string
          pipeline_id?: string
          role?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "custom_pipeline_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_members_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_pipeline_stages: {
        Row: {
          checklist_template_id: string | null
          color: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          is_final_negative: boolean | null
          is_final_positive: boolean | null
          name: string
          organization_id: string
          pipeline_id: string
          position: number | null
          requires_sale_value: boolean
          stage_key: string
          stage_role: Database["public"]["Enums"]["stage_role"]
          stage_role_reviewed_at: string | null
          stage_role_reviewed_by: string | null
          stage_role_suggested_at: string | null
          stage_role_suggestion_source: string | null
          suggested_stage_role: Database["public"]["Enums"]["stage_role"] | null
          target_pipe_type: string | null
          target_pipeline_id: string | null
          target_stage_id: string | null
          target_stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          checklist_template_id?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          name: string
          organization_id: string
          pipeline_id: string
          position?: number | null
          requires_sale_value?: boolean
          stage_key: string
          stage_role?: Database["public"]["Enums"]["stage_role"]
          stage_role_reviewed_at?: string | null
          stage_role_reviewed_by?: string | null
          stage_role_suggested_at?: string | null
          stage_role_suggestion_source?: string | null
          suggested_stage_role?:
            | Database["public"]["Enums"]["stage_role"]
            | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          checklist_template_id?: string | null
          color?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          name?: string
          organization_id?: string
          pipeline_id?: string
          position?: number | null
          requires_sale_value?: boolean
          stage_key?: string
          stage_role?: Database["public"]["Enums"]["stage_role"]
          stage_role_reviewed_at?: string | null
          stage_role_reviewed_by?: string | null
          stage_role_suggested_at?: string | null
          stage_role_suggestion_source?: string | null
          suggested_stage_role?:
            | Database["public"]["Enums"]["stage_role"]
            | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_pipeline_stages_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_stages_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_stages_target_pipeline_id_fkey"
            columns: ["target_pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipeline_stages_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "custom_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      custom_pipelines: {
        Row: {
          bonus_description: string | null
          bonus_value: number | null
          color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          ends_at: string | null
          icon: string | null
          id: string
          individual_goal: number | null
          is_active: boolean | null
          lead_source_config: Json | null
          lifecycle_type: string
          name: string
          objective_pipe_type: string | null
          objective_stage_key: string | null
          organization_id: string
          position: number | null
          slug: string
          starts_at: string | null
          status: string
          team_goal: number | null
          template_type: string | null
          updated_at: string | null
        }
        Insert: {
          bonus_description?: string | null
          bonus_value?: number | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          icon?: string | null
          id?: string
          individual_goal?: number | null
          is_active?: boolean | null
          lead_source_config?: Json | null
          lifecycle_type?: string
          name: string
          objective_pipe_type?: string | null
          objective_stage_key?: string | null
          organization_id: string
          position?: number | null
          slug: string
          starts_at?: string | null
          status?: string
          team_goal?: number | null
          template_type?: string | null
          updated_at?: string | null
        }
        Update: {
          bonus_description?: string | null
          bonus_value?: number | null
          color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          ends_at?: string | null
          icon?: string | null
          id?: string
          individual_goal?: number | null
          is_active?: boolean | null
          lead_source_config?: Json | null
          lifecycle_type?: string
          name?: string
          objective_pipe_type?: string | null
          objective_stage_key?: string | null
          organization_id?: string
          position?: number | null
          slug?: string
          starts_at?: string | null
          status?: string
          team_goal?: number | null
          template_type?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_pipelines_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_composition_backup: {
        Row: {
          id: string
          organization_id: string
          reason: string
          snapshot: Json
          taken_at: string
        }
        Insert: {
          id?: string
          organization_id: string
          reason: string
          snapshot: Json
          taken_at?: string
        }
        Update: {
          id?: string
          organization_id?: string
          reason?: string
          snapshot?: Json
          taken_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_composition_backup_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_pages: {
        Row: {
          created_at: string
          created_by: string | null
          draft: Json | null
          id: string
          organization_id: string
          position: number
          rotation_seconds: number
          surface: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          draft?: Json | null
          id?: string
          organization_id: string
          position?: number
          rotation_seconds?: number
          surface: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          draft?: Json | null
          id?: string
          organization_id?: string
          position?: number
          rotation_seconds?: number
          surface?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_widgets: {
        Row: {
          accent_hue: string | null
          created_at: string
          den_measure_id: string | null
          eyebrow_override: string | null
          filters: Json
          format_id: string | null
          grid_col: number
          grid_h: number
          grid_row: number
          grid_w: number
          id: string
          measure_id: string | null
          measure_kind: string
          num_measure_id: string | null
          organization_id: string
          page_id: string
          pinned: boolean
          position: number
          recorte_id: string | null
          renderer_id: string | null
          style_variant: string | null
          updated_at: string
          value_format: string | null
          weight: string
          widget_style: string | null
        }
        Insert: {
          accent_hue?: string | null
          created_at?: string
          den_measure_id?: string | null
          eyebrow_override?: string | null
          filters?: Json
          format_id?: string | null
          grid_col?: number
          grid_h?: number
          grid_row?: number
          grid_w?: number
          id?: string
          measure_id?: string | null
          measure_kind?: string
          num_measure_id?: string | null
          organization_id: string
          page_id: string
          pinned?: boolean
          position?: number
          recorte_id?: string | null
          renderer_id?: string | null
          style_variant?: string | null
          updated_at?: string
          value_format?: string | null
          weight?: string
          widget_style?: string | null
        }
        Update: {
          accent_hue?: string | null
          created_at?: string
          den_measure_id?: string | null
          eyebrow_override?: string | null
          filters?: Json
          format_id?: string | null
          grid_col?: number
          grid_h?: number
          grid_row?: number
          grid_w?: number
          id?: string
          measure_id?: string | null
          measure_kind?: string
          num_measure_id?: string | null
          organization_id?: string
          page_id?: string
          pinned?: boolean
          position?: number
          recorte_id?: string | null
          renderer_id?: string | null
          style_variant?: string | null
          updated_at?: string
          value_format?: string | null
          weight?: string
          widget_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_widgets_den_measure_id_fkey"
            columns: ["den_measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_measure_id_fkey"
            columns: ["measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_num_measure_id_fkey"
            columns: ["num_measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_page_id_fkey"
            columns: ["page_id"]
            isOneToOne: false
            referencedRelation: "dashboard_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_recorte_id_fkey"
            columns: ["recorte_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_recortes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_renderer_id_fkey"
            columns: ["renderer_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_renderers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_style_variant_fk"
            columns: ["widget_style", "style_variant"]
            isOneToOne: false
            referencedRelation: "metric_catalog_style_variants"
            referencedColumns: ["style_id", "variant"]
          },
          {
            foreignKeyName: "dashboard_widgets_value_format_fkey"
            columns: ["value_format"]
            isOneToOne: false
            referencedRelation: "metric_catalog_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dashboard_widgets_widget_style_fkey"
            columns: ["widget_style"]
            isOneToOne: false
            referencedRelation: "metric_catalog_widget_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboards: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          is_shared: boolean
          layout: Json
          name: string
          organization_id: string
          owner_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          is_shared?: boolean
          layout?: Json
          name: string
          organization_id: string
          owner_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          is_shared?: boolean
          layout?: Json
          name?: string
          organization_id?: string
          owner_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dashboards_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_export_requests: {
        Row: {
          completed_at: string | null
          contact_email: string | null
          created_at: string
          expires_at: string | null
          export_type: string
          file_url: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          organization_id: string
          requested_by: string
          status: string
        }
        Insert: {
          completed_at?: string | null
          contact_email?: string | null
          created_at?: string
          expires_at?: string | null
          export_type: string
          file_url?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          organization_id: string
          requested_by: string
          status?: string
        }
        Update: {
          completed_at?: string | null
          contact_email?: string | null
          created_at?: string
          expires_at?: string | null
          export_type?: string
          file_url?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          organization_id?: string
          requested_by?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_export_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_export_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_export_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      data_retention_policies: {
        Row: {
          auto_anonymize: boolean
          auto_delete: boolean
          created_at: string
          id: string
          inactive_months: number
          last_enforced_at: string | null
          organization_id: string
          retain_aggregated_stats: boolean
          updated_at: string
        }
        Insert: {
          auto_anonymize?: boolean
          auto_delete?: boolean
          created_at?: string
          id?: string
          inactive_months?: number
          last_enforced_at?: string | null
          organization_id: string
          retain_aggregated_stats?: boolean
          updated_at?: string
        }
        Update: {
          auto_anonymize?: boolean
          auto_delete?: boolean
          created_at?: string
          id?: string
          inactive_months?: number
          last_enforced_at?: string | null
          organization_id?: string
          retain_aggregated_stats?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "data_retention_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_contacts: {
        Row: {
          contact_id: string
          created_at: string
          deal_id: string
          id: string
          is_primary: boolean | null
          role: string
        }
        Insert: {
          contact_id: string
          created_at?: string
          deal_id: string
          id?: string
          is_primary?: boolean | null
          role?: string
        }
        Update: {
          contact_id?: string
          created_at?: string
          deal_id?: string
          id?: string
          is_primary?: boolean | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_contacts_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_insights: {
        Row: {
          computed_at: string
          deal_id: string
          expires_at: string
          health_score: number
          id: string
          model_used: string | null
          negative_factors: Json
          organization_id: string
          positive_factors: Json
          predicted_close_probability: number | null
          risk_level: string
          suggestions: Json
        }
        Insert: {
          computed_at?: string
          deal_id: string
          expires_at?: string
          health_score: number
          id?: string
          model_used?: string | null
          negative_factors?: Json
          organization_id: string
          positive_factors?: Json
          predicted_close_probability?: number | null
          risk_level?: string
          suggestions?: Json
        }
        Update: {
          computed_at?: string
          deal_id?: string
          expires_at?: string
          health_score?: number
          id?: string
          model_used?: string | null
          negative_factors?: Json
          organization_id?: string
          positive_factors?: Json
          predicted_close_probability?: number | null
          risk_level?: string
          suggestions?: Json
        }
        Relationships: [
          {
            foreignKeyName: "deal_insights_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deal_items: {
        Row: {
          created_at: string
          deal_id: string
          discount_percent: number
          id: string
          notes: string | null
          organization_id: string
          product_id: string | null
          product_name: string
          quantity: number
          sort_order: number
          total: number | null
          unit_price: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          deal_id: string
          discount_percent?: number
          id?: string
          notes?: string | null
          organization_id: string
          product_id?: string | null
          product_name: string
          quantity?: number
          sort_order?: number
          total?: number | null
          unit_price?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          deal_id?: string
          discount_percent?: number
          id?: string
          notes?: string | null
          organization_id?: string
          product_id?: string | null
          product_name?: string
          quantity?: number
          sort_order?: number
          total?: number | null
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "deal_items_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deal_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      deals: {
        Row: {
          closed_at: string | null
          company_id: string | null
          created_at: string
          created_by: string | null
          currency: string | null
          deleted_at: string | null
          deleted_by: string | null
          expected_close_date: string | null
          id: string
          last_activity_at: string | null
          loss_reason: string | null
          loss_reason_id: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string
          outcome: string
          outcome_at: string | null
          outcome_source: string | null
          owner_id: string | null
          probability: number | null
          source: string
          source_lead_id: string | null
          title: string
          updated_at: string
          value: number | null
          won: boolean | null
        }
        Insert: {
          closed_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          expected_close_date?: string | null
          id?: string
          last_activity_at?: string | null
          loss_reason?: string | null
          loss_reason_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id: string
          outcome?: string
          outcome_at?: string | null
          outcome_source?: string | null
          owner_id?: string | null
          probability?: number | null
          source: string
          source_lead_id?: string | null
          title: string
          updated_at?: string
          value?: number | null
          won?: boolean | null
        }
        Update: {
          closed_at?: string | null
          company_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          expected_close_date?: string | null
          id?: string
          last_activity_at?: string | null
          loss_reason?: string | null
          loss_reason_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string
          outcome?: string
          outcome_at?: string | null
          outcome_source?: string | null
          owner_id?: string | null
          probability?: number | null
          source?: string
          source_lead_id?: string | null
          title?: string
          updated_at?: string
          value?: number | null
          won?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "deals_source_lead_id_fkey"
            columns: ["source_lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
        ]
      }
      deleted_leads_log: {
        Row: {
          actor_role: string | null
          created_at: string
          delete_type: string
          deleted_at: string
          deleted_by: string | null
          id: string
          lead_email: string | null
          lead_id: string
          lead_name: string | null
          lead_phone: string | null
          organization_id: string
          snapshot: Json
        }
        Insert: {
          actor_role?: string | null
          created_at?: string
          delete_type: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          lead_email?: string | null
          lead_id: string
          lead_name?: string | null
          lead_phone?: string | null
          organization_id: string
          snapshot: Json
        }
        Update: {
          actor_role?: string | null
          created_at?: string
          delete_type?: string
          deleted_at?: string
          deleted_by?: string | null
          id?: string
          lead_email?: string | null
          lead_id?: string
          lead_name?: string | null
          lead_phone?: string | null
          organization_id?: string
          snapshot?: Json
        }
        Relationships: []
      }
      email_accounts: {
        Row: {
          access_token: string | null
          created_at: string
          display_name: string | null
          email_address: string
          id: string
          is_active: boolean
          last_sync_at: string | null
          organization_id: string
          provider: string
          refresh_token: string | null
          sync_cursor: string | null
          sync_error: string | null
          sync_status: string
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          created_at?: string
          display_name?: string | null
          email_address: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          organization_id: string
          provider: string
          refresh_token?: string | null
          sync_cursor?: string | null
          sync_error?: string | null
          sync_status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          created_at?: string
          display_name?: string | null
          email_address?: string
          id?: string
          is_active?: boolean
          last_sync_at?: string | null
          organization_id?: string
          provider?: string
          refresh_token?: string | null
          sync_cursor?: string | null
          sync_error?: string | null
          sync_status?: string
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body_html: string
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          is_shared: boolean
          name: string
          organization_id: string
          subject: string
          updated_at: string
          variables: Json | null
        }
        Insert: {
          body_html: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_shared?: boolean
          name: string
          organization_id: string
          subject: string
          updated_at?: string
          variables?: Json | null
        }
        Update: {
          body_html?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_shared?: boolean
          name?: string
          organization_id?: string
          subject?: string
          updated_at?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "email_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      emails: {
        Row: {
          bcc_addresses: Json | null
          body_html: string | null
          body_text: string | null
          cc_addresses: Json | null
          click_count: number
          contact_id: string | null
          created_at: string
          deal_id: string | null
          email_account_id: string
          first_clicked_at: string | null
          first_opened_at: string | null
          from_address: string
          from_name: string | null
          has_attachments: boolean
          id: string
          in_reply_to: string | null
          is_outbound: boolean
          labels: Json | null
          lead_id: string | null
          message_id: string
          open_count: number
          organization_id: string
          read_at: string | null
          received_at: string | null
          sent_at: string
          snippet: string | null
          subject: string | null
          thread_id: string | null
          to_addresses: Json
        }
        Insert: {
          bcc_addresses?: Json | null
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: Json | null
          click_count?: number
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          email_account_id: string
          first_clicked_at?: string | null
          first_opened_at?: string | null
          from_address: string
          from_name?: string | null
          has_attachments?: boolean
          id?: string
          in_reply_to?: string | null
          is_outbound?: boolean
          labels?: Json | null
          lead_id?: string | null
          message_id: string
          open_count?: number
          organization_id: string
          read_at?: string | null
          received_at?: string | null
          sent_at: string
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          to_addresses?: Json
        }
        Update: {
          bcc_addresses?: Json | null
          body_html?: string | null
          body_text?: string | null
          cc_addresses?: Json | null
          click_count?: number
          contact_id?: string | null
          created_at?: string
          deal_id?: string | null
          email_account_id?: string
          first_clicked_at?: string | null
          first_opened_at?: string | null
          from_address?: string
          from_name?: string | null
          has_attachments?: boolean
          id?: string
          in_reply_to?: string | null
          is_outbound?: boolean
          labels?: Json | null
          lead_id?: string | null
          message_id?: string
          open_count?: number
          organization_id?: string
          read_at?: string | null
          received_at?: string | null
          sent_at?: string
          snippet?: string | null
          subject?: string | null
          thread_id?: string | null
          to_addresses?: Json
        }
        Relationships: [
          {
            foreignKeyName: "emails_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emails_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      enrichment_requests: {
        Row: {
          contact_id: string | null
          created_at: string
          id: string
          lead_id: string | null
          organization_id: string
          provider: string
          result: Json | null
          status: string
          updated_at: string
        }
        Insert: {
          contact_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          organization_id: string
          provider?: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Update: {
          contact_id?: string | null
          created_at?: string
          id?: string
          lead_id?: string | null
          organization_id?: string
          provider?: string
          result?: Json | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "enrichment_requests_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_requests_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "enrichment_requests_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      erp_order_items: {
        Row: {
          created_at: string
          description: string
          external_source: string
          id: string
          line_no: number
          order_id: string
          organization_id: string
          product_external_id: string | null
          quantity: number
          total_value: number
          unit_value: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string
          external_source: string
          id?: string
          line_no: number
          order_id: string
          organization_id: string
          product_external_id?: string | null
          quantity?: number
          total_value?: number
          unit_value?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string
          external_source?: string
          id?: string
          line_no?: number
          order_id?: string
          organization_id?: string
          product_external_id?: string | null
          quantity?: number
          total_value?: number
          unit_value?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "erp_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "upsell_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "erp_order_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      exchange_rates: {
        Row: {
          fetched_at: string
          from_currency: string
          id: string
          rate: number
          to_currency: string
        }
        Insert: {
          fetched_at?: string
          from_currency: string
          id?: string
          rate: number
          to_currency: string
        }
        Update: {
          fetched_at?: string
          from_currency?: string
          id?: string
          rate?: number
          to_currency?: string
        }
        Relationships: []
      }
      feature_catalog: {
        Row: {
          category: string | null
          created_at: string | null
          default_enabled: boolean | null
          description: string | null
          display_name: string | null
          feature_type: string | null
          icon: string | null
          id: string
          is_sellable: boolean
          key: string
          name: string
          position: number | null
          requires_plan: string[] | null
          sidebar_path: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_enabled?: boolean | null
          description?: string | null
          display_name?: string | null
          feature_type?: string | null
          icon?: string | null
          id?: string
          is_sellable?: boolean
          key: string
          name: string
          position?: number | null
          requires_plan?: string[] | null
          sidebar_path?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_enabled?: boolean | null
          description?: string | null
          display_name?: string | null
          feature_type?: string | null
          icon?: string | null
          id?: string
          is_sellable?: boolean
          key?: string
          name?: string
          position?: number | null
          requires_plan?: string[] | null
          sidebar_path?: string | null
        }
        Relationships: []
      }
      feature_permissions: {
        Row: {
          created_at: string
          default_value: boolean
          description: string
          id: string
          is_admin_only: boolean
          key: string
          module: string
          name: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          default_value?: boolean
          description: string
          id?: string
          is_admin_only?: boolean
          key: string
          module: string
          name: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          default_value?: boolean
          description?: string
          id?: string
          is_admin_only?: boolean
          key?: string
          module?: string
          name?: string
          sort_order?: number
        }
        Relationships: []
      }
      field_changes: {
        Row: {
          changed_at: string
          changed_by: string | null
          entity_id: string
          entity_type: string
          field_name: string
          id: string
          new_value: string | null
          old_value: string | null
          organization_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          entity_id: string
          entity_type?: string
          field_name: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          organization_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          entity_id?: string
          entity_type?: string
          field_name?: string
          id?: string
          new_value?: string | null
          old_value?: string | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "field_changes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_up_automations: {
        Row: {
          copilot_can_handle: boolean
          created_at: string
          days_offset: number
          description_template: string | null
          filter_stages: string[] | null
          id: string
          is_active: boolean | null
          max_triggers_per_lead: number
          organization_id: string | null
          pipe_type: string
          priority: string
          stage: string
          title_template: string
          trigger_delay_hours: number
          trigger_delay_minutes: number
          trigger_type: string
          updated_at: string
        }
        Insert: {
          copilot_can_handle?: boolean
          created_at?: string
          days_offset?: number
          description_template?: string | null
          filter_stages?: string[] | null
          id?: string
          is_active?: boolean | null
          max_triggers_per_lead?: number
          organization_id?: string | null
          pipe_type: string
          priority?: string
          stage: string
          title_template: string
          trigger_delay_hours?: number
          trigger_delay_minutes?: number
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          copilot_can_handle?: boolean
          created_at?: string
          days_offset?: number
          description_template?: string | null
          filter_stages?: string[] | null
          id?: string
          is_active?: boolean | null
          max_triggers_per_lead?: number
          organization_id?: string | null
          pipe_type?: string
          priority?: string
          stage?: string
          title_template?: string
          trigger_delay_hours?: number
          trigger_delay_minutes?: number
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_automations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      follow_ups: {
        Row: {
          archived_at: string | null
          assigned_to: string | null
          completed_at: string | null
          completion_notes: string | null
          created_at: string
          deal_id: string | null
          description: string | null
          due_date: string
          id: string
          is_automated: boolean | null
          lead_id: string
          organization_id: string | null
          pipeline_entry_id: string | null
          priority: string
          source_pipe: string | null
          source_pipe_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          due_date: string
          id?: string
          is_automated?: boolean | null
          lead_id: string
          organization_id?: string | null
          pipeline_entry_id?: string | null
          priority?: string
          source_pipe?: string | null
          source_pipe_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          assigned_to?: string | null
          completed_at?: string | null
          completion_notes?: string | null
          created_at?: string
          deal_id?: string | null
          description?: string | null
          due_date?: string
          id?: string
          is_automated?: boolean | null
          lead_id?: string
          organization_id?: string | null
          pipeline_entry_id?: string | null
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
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_ups_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_automation_log: {
        Row: {
          automation_id: string
          created_at: string
          follow_up_id: string | null
          id: string
          lead_id: string
          organization_id: string
        }
        Insert: {
          automation_id: string
          created_at?: string
          follow_up_id?: string | null
          id?: string
          lead_id: string
          organization_id: string
        }
        Update: {
          automation_id?: string
          created_at?: string
          follow_up_id?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_automation_log_automation_id_fkey"
            columns: ["automation_id"]
            isOneToOne: false
            referencedRelation: "follow_up_automations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_automation_log_follow_up_id_fkey"
            columns: ["follow_up_id"]
            isOneToOne: false
            referencedRelation: "follow_ups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_automation_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_automation_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_automation_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_reclassify_queue: {
        Row: {
          organization_id: string
          queued_at: string
        }
        Insert: {
          organization_id: string
          queued_at?: string
        }
        Update: {
          organization_id?: string
          queued_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_reclassify_queue_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gestor_organizations: {
        Row: {
          created_at: string
          gestor_id: string
          id: string
          organization_id: string
        }
        Insert: {
          created_at?: string
          gestor_id: string
          id?: string
          organization_id: string
        }
        Update: {
          created_at?: string
          gestor_id?: string
          id?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gestor_organizations_gestor_id_fkey"
            columns: ["gestor_id"]
            isOneToOne: false
            referencedRelation: "gestores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gestor_organizations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      gestores: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          notes: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          notes?: string | null
          user_id?: string
        }
        Relationships: []
      }
      goals: {
        Row: {
          created_at: string
          current_value: number | null
          id: string
          month: number
          name: string
          organization_id: string | null
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
          organization_id?: string | null
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
          organization_id?: string | null
          product_id?: string | null
          target_value?: number
          team_member_id?: string | null
          type?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "goals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
            referencedRelation: "org_visible_members"
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
      google_calendar_events_cache: {
        Row: {
          all_day: boolean
          attendees: Json | null
          created_at: string
          description: string | null
          end_at: string | null
          google_calendar_id: string
          google_event_status: string
          id: string
          lead_id: string | null
          location: string | null
          meet_link: string | null
          organization_id: string
          origin: string
          start_at: string
          synced_at: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          all_day?: boolean
          attendees?: Json | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          google_calendar_id?: string
          google_event_status?: string
          id: string
          lead_id?: string | null
          location?: string | null
          meet_link?: string | null
          organization_id: string
          origin?: string
          start_at: string
          synced_at?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          all_day?: boolean
          attendees?: Json | null
          created_at?: string
          description?: string | null
          end_at?: string | null
          google_calendar_id?: string
          google_event_status?: string
          id?: string
          lead_id?: string | null
          location?: string | null
          meet_link?: string | null
          organization_id?: string
          origin?: string
          start_at?: string
          synced_at?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_events_cache_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_calendar_events_cache_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "google_calendar_events_cache_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_sharing: {
        Row: {
          can_create_events: boolean
          created_at: string
          id: string
          organization_id: string
          owner_id: string
          viewer_id: string
        }
        Insert: {
          can_create_events?: boolean
          created_at?: string
          id?: string
          organization_id: string
          owner_id: string
          viewer_id: string
        }
        Update: {
          can_create_events?: boolean
          created_at?: string
          id?: string
          organization_id?: string
          owner_id?: string
          viewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_sharing_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_sync_logs: {
        Row: {
          agent_id: string | null
          created_at: string | null
          error_message: string | null
          google_event_id: string | null
          id: string
          initiated_by: string
          local_reference_id: string | null
          local_reference_type: string | null
          operation: string
          request_payload: Json | null
          response_payload: Json | null
          status: string
          user_id: string
        }
        Insert: {
          agent_id?: string | null
          created_at?: string | null
          error_message?: string | null
          google_event_id?: string | null
          id?: string
          initiated_by: string
          local_reference_id?: string | null
          local_reference_type?: string | null
          operation: string
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
          user_id: string
        }
        Update: {
          agent_id?: string | null
          created_at?: string | null
          error_message?: string | null
          google_event_id?: string | null
          id?: string
          initiated_by?: string
          local_reference_id?: string | null
          local_reference_type?: string | null
          operation?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_sync_logs_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token_expires_at: string | null
          connected_at: string | null
          created_at: string | null
          encrypted_refresh_token: string
          encryption_key_id: string
          encryption_nonce: string
          google_account_id: string
          google_email: string
          id: string
          is_active: boolean | null
          last_error: string | null
          last_sync_at: string | null
          organization_id: string | null
          revoked_at: string | null
          scopes_granted: string[]
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token_expires_at?: string | null
          connected_at?: string | null
          created_at?: string | null
          encrypted_refresh_token: string
          encryption_key_id: string
          encryption_nonce: string
          google_account_id: string
          google_email: string
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_sync_at?: string | null
          organization_id?: string | null
          revoked_at?: string | null
          scopes_granted?: string[]
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token_expires_at?: string | null
          connected_at?: string | null
          created_at?: string | null
          encrypted_refresh_token?: string
          encryption_key_id?: string
          encryption_nonce?: string
          google_account_id?: string
          google_email?: string
          id?: string
          is_active?: boolean | null
          last_error?: string | null
          last_sync_at?: string | null
          organization_id?: string | null
          revoked_at?: string | null
          scopes_granted?: string[]
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_tokens_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_watch_channels: {
        Row: {
          calendar_id: string
          channel_id: string
          created_at: string
          expiration: string | null
          id: string
          is_active: boolean
          organization_id: string
          resource_id: string | null
          user_id: string
        }
        Insert: {
          calendar_id?: string
          channel_id: string
          created_at?: string
          expiration?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          resource_id?: string | null
          user_id: string
        }
        Update: {
          calendar_id?: string
          channel_id?: string
          created_at?: string
          expiration?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          resource_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_watch_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      help_article_feedback: {
        Row: {
          article_id: string
          created_at: string
          helpful: boolean
          id: string
          organization_id: string | null
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          article_id: string
          created_at?: string
          helpful: boolean
          id?: string
          organization_id?: string | null
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          article_id?: string
          created_at?: string
          helpful?: boolean
          id?: string
          organization_id?: string | null
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "help_article_feedback_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "help_articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_article_feedback_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      help_articles: {
        Row: {
          category_id: string
          content: string
          created_at: string | null
          id: string
          is_published: boolean | null
          media: Json | null
          organization_id: string | null
          sort_order: number
          summary: string | null
          tags: string[] | null
          title: string
          updated_at: string | null
          video_url: string | null
        }
        Insert: {
          category_id: string
          content?: string
          created_at?: string | null
          id?: string
          is_published?: boolean | null
          media?: Json | null
          organization_id?: string | null
          sort_order?: number
          summary?: string | null
          tags?: string[] | null
          title: string
          updated_at?: string | null
          video_url?: string | null
        }
        Update: {
          category_id?: string
          content?: string
          created_at?: string | null
          id?: string
          is_published?: boolean | null
          media?: Json | null
          organization_id?: string | null
          sort_order?: number
          summary?: string | null
          tags?: string[] | null
          title?: string
          updated_at?: string | null
          video_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "help_articles_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "help_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "help_articles_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      help_categories: {
        Row: {
          created_at: string | null
          description: string | null
          icon: string
          id: string
          name: string
          organization_id: string | null
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          icon?: string
          id?: string
          name: string
          organization_id?: string | null
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          icon?: string
          id?: string
          name?: string
          organization_id?: string | null
          slug?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "help_categories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      history_sync_jobs: {
        Row: {
          chat_errors: Json | null
          chat_jid: string | null
          chats_completed: number | null
          chats_skipped: number | null
          completed_at: string | null
          created_at: string
          current_chat_index: number | null
          cursor: string | null
          error: string | null
          id: string
          instance_id: string
          max_chats: number
          max_days: number
          max_messages_per_chat: number
          organization_id: string
          scope: string
          started_at: string | null
          status: string
          total_chats: number | null
          total_fetched: number
          triggered_by: string | null
          updated_at: string
        }
        Insert: {
          chat_errors?: Json | null
          chat_jid?: string | null
          chats_completed?: number | null
          chats_skipped?: number | null
          completed_at?: string | null
          created_at?: string
          current_chat_index?: number | null
          cursor?: string | null
          error?: string | null
          id?: string
          instance_id: string
          max_chats?: number
          max_days?: number
          max_messages_per_chat?: number
          organization_id: string
          scope?: string
          started_at?: string | null
          status?: string
          total_chats?: number | null
          total_fetched?: number
          triggered_by?: string | null
          updated_at?: string
        }
        Update: {
          chat_errors?: Json | null
          chat_jid?: string | null
          chats_completed?: number | null
          chats_skipped?: number | null
          completed_at?: string | null
          created_at?: string
          current_chat_index?: number | null
          cursor?: string | null
          error?: string | null
          id?: string
          instance_id?: string
          max_chats?: number
          max_days?: number
          max_messages_per_chat?: number
          organization_id?: string
          scope?: string
          started_at?: string | null
          status?: string
          total_chats?: number | null
          total_fetched?: number
          triggered_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "history_sync_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "history_sync_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      history_sync_write_budget: {
        Row: {
          minute_bucket: string
          organization_id: string
          rows_written: number
        }
        Insert: {
          minute_bucket: string
          organization_id: string
          rows_written?: number
        }
        Update: {
          minute_bucket?: string
          organization_id?: string
          rows_written?: number
        }
        Relationships: [
          {
            foreignKeyName: "history_sync_write_budget_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      impersonation_sessions: {
        Row: {
          ended_at: string | null
          id: string
          is_active: boolean | null
          master_user_id: string
          reason: string | null
          started_at: string | null
          target_organization_id: string | null
          target_user_id: string
        }
        Insert: {
          ended_at?: string | null
          id?: string
          is_active?: boolean | null
          master_user_id: string
          reason?: string | null
          started_at?: string | null
          target_organization_id?: string | null
          target_user_id: string
        }
        Update: {
          ended_at?: string | null
          id?: string
          is_active?: boolean | null
          master_user_id?: string
          reason?: string | null
          started_at?: string | null
          target_organization_id?: string | null
          target_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "impersonation_sessions_master_user_id_fkey"
            columns: ["master_user_id"]
            isOneToOne: false
            referencedRelation: "master_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "impersonation_sessions_target_organization_id_fkey"
            columns: ["target_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          created_at: string
          created_by: string | null
          error_count: number
          file_name: string | null
          id: string
          imported_count: number
          organization_id: string
          rolled_back: boolean
          rolled_back_at: string | null
          rolled_back_by: string | null
          skipped_count: number
          total_rows: number
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          organization_id: string
          rolled_back?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          skipped_count?: number
          total_rows?: number
        }
        Update: {
          created_at?: string
          created_by?: string | null
          error_count?: number
          file_name?: string | null
          id?: string
          imported_count?: number
          organization_id?: string
          rolled_back?: boolean
          rolled_back_at?: string | null
          rolled_back_by?: string | null
          skipped_count?: number
          total_rows?: number
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_comments: {
        Row: {
          author_team_member_id: string | null
          author_user_id: string | null
          body: string
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          id: string
          lead_id: string
          mentions: string[]
          organization_id: string
          pipeline_entry_id: string | null
          updated_at: string | null
        }
        Insert: {
          author_team_member_id?: string | null
          author_user_id?: string | null
          body: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          lead_id: string
          mentions?: string[]
          organization_id: string
          pipeline_entry_id?: string | null
          updated_at?: string | null
        }
        Update: {
          author_team_member_id?: string | null
          author_user_id?: string | null
          body?: string
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          lead_id?: string
          mentions?: string[]
          organization_id?: string
          pipeline_entry_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_comments_author_team_member_id_fkey"
            columns: ["author_team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_author_team_member_id_fkey"
            columns: ["author_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_comments_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_custom_field_values: {
        Row: {
          created_at: string | null
          field_id: string
          id: string
          lead_id: string
          updated_at: string | null
          value: string | null
        }
        Insert: {
          created_at?: string | null
          field_id: string
          id?: string
          lead_id: string
          updated_at?: string | null
          value?: string | null
        }
        Update: {
          created_at?: string | null
          field_id?: string
          id?: string
          lead_id?: string
          updated_at?: string | null
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_custom_field_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "lead_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_custom_field_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_custom_field_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_custom_fields: {
        Row: {
          created_at: string | null
          display_order: number | null
          field_name: string
          field_options: Json | null
          field_type: string
          id: string
          is_required: boolean | null
          organization_id: string
        }
        Insert: {
          created_at?: string | null
          display_order?: number | null
          field_name: string
          field_options?: Json | null
          field_type?: string
          id?: string
          is_required?: boolean | null
          organization_id: string
        }
        Update: {
          created_at?: string | null
          display_order?: number | null
          field_name?: string
          field_options?: Json | null
          field_type?: string
          id?: string
          is_required?: boolean | null
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_custom_fields_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          entity_id: string | null
          entity_type: string | null
          id: string
          lead_id: string
          metadata: Json
          organization_id: string | null
          source: string
        }
        Insert: {
          action: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          lead_id: string
          metadata?: Json
          organization_id?: string | null
          source?: string
        }
        Update: {
          action?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          lead_id?: string
          metadata?: Json
          organization_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_history_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_memories: {
        Row: {
          agent_id: string | null
          content: string
          conversation_id: string | null
          created_at: string | null
          embedding: string | null
          id: string
          importance: number | null
          last_accessed: string | null
          lead_id: string
          memory_type: string
          organization_id: string
          turn_count: number | null
        }
        Insert: {
          agent_id?: string | null
          content: string
          conversation_id?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          last_accessed?: string | null
          lead_id: string
          memory_type?: string
          organization_id: string
          turn_count?: number | null
        }
        Update: {
          agent_id?: string | null
          content?: string
          conversation_id?: string | null
          created_at?: string | null
          embedding?: string | null
          id?: string
          importance?: number | null
          last_accessed?: string | null
          lead_id?: string
          memory_type?: string
          organization_id?: string
          turn_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_memories_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_memories_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_memories_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_memories_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_memories_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_origins: {
        Row: {
          color: string
          created_at: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          slug: string
          sort_order: number
          updated_at: string | null
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          slug: string
          sort_order?: number
          updated_at?: string | null
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          slug?: string
          sort_order?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_origins_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_products: {
        Row: {
          avg_cycle_days: number | null
          created_at: string
          first_purchased_at: string | null
          id: string
          last_purchased_at: string | null
          lead_id: string
          organization_id: string
          product_id: string
          purchase_count: number
          quantity_total: number
          revenue_total: number
          source: string
          source_deal_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          avg_cycle_days?: number | null
          created_at?: string
          first_purchased_at?: string | null
          id?: string
          last_purchased_at?: string | null
          lead_id: string
          organization_id: string
          product_id: string
          purchase_count?: number
          quantity_total?: number
          revenue_total?: number
          source?: string
          source_deal_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          avg_cycle_days?: number | null
          created_at?: string
          first_purchased_at?: string | null
          id?: string
          last_purchased_at?: string | null
          lead_id?: string
          organization_id?: string
          product_id?: string
          purchase_count?: number
          quantity_total?: number
          revenue_total?: number
          source?: string
          source_deal_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_products_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_products_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_products_source_deal_id_fkey"
            columns: ["source_deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
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
          {
            foreignKeyName: "lead_scores_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: true
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_social_identities: {
        Row: {
          avatar_url: string | null
          channel_type: string
          created_at: string
          display_name: string | null
          external_user_id: string
          handle: string | null
          id: string
          last_seen_at: string | null
          lead_id: string
          linked_at: string
          linked_by: string | null
          messaging_channel_id: string | null
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          channel_type: string
          created_at?: string
          display_name?: string | null
          external_user_id: string
          handle?: string | null
          id?: string
          last_seen_at?: string | null
          lead_id: string
          linked_at?: string
          linked_by?: string | null
          messaging_channel_id?: string | null
          organization_id: string
          provider?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          channel_type?: string
          created_at?: string
          display_name?: string | null
          external_user_id?: string
          handle?: string | null
          id?: string
          last_seen_at?: string | null
          lead_id?: string
          linked_at?: string
          linked_by?: string | null
          messaging_channel_id?: string | null
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lead_social_identities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_social_identities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_social_identities_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_social_identities_linked_by_fkey"
            columns: ["linked_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_social_identities_messaging_channel_id_fkey"
            columns: ["messaging_channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_social_identities_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
            foreignKeyName: "lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
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
          ai_disabled: boolean | null
          ai_disabled_at: string | null
          ai_disabled_by: string | null
          avatar_url: string | null
          claimed_at: string | null
          claimed_by: string | null
          closer_id: string | null
          company: string | null
          company_entity_id: string | null
          compromisso_date: string | null
          contact_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          excluded_from_metrics: boolean
          faturamento: string | null
          id: string
          import_batch_id: string | null
          interest: string | null
          is_shadow: boolean | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_lead_id: string | null
          metrics_period_at: string | null
          name: string
          normalized_phone: string | null
          notes: string | null
          organization_id: string | null
          origin: string | null
          origin_detail: string | null
          phone: string | null
          phone_digits: string | null
          pipe_whatsapp: string | null
          pre_qualification_tier:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          pre_sale_responsible_id: string | null
          qualification_score: number | null
          qualification_tier:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          rating: number | null
          responsible_id: string | null
          responsible_user_id: string | null
          sale_responsible_id: string | null
          sdr_id: string | null
          segment: string | null
          uf: string | null
          uf_source: string | null
          updated_at: string
          urgency: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Insert: {
          ai_disabled?: boolean | null
          ai_disabled_at?: string | null
          ai_disabled_by?: string | null
          avatar_url?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          closer_id?: string | null
          company?: string | null
          company_entity_id?: string | null
          compromisso_date?: string | null
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          excluded_from_metrics?: boolean
          faturamento?: string | null
          id?: string
          import_batch_id?: string | null
          interest?: string | null
          is_shadow?: boolean | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_lead_id?: string | null
          metrics_period_at?: string | null
          name: string
          normalized_phone?: string | null
          notes?: string | null
          organization_id?: string | null
          origin?: string | null
          origin_detail?: string | null
          phone?: string | null
          phone_digits?: string | null
          pipe_whatsapp?: string | null
          pre_qualification_tier?:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          pre_sale_responsible_id?: string | null
          qualification_score?: number | null
          qualification_tier?:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          rating?: number | null
          responsible_id?: string | null
          responsible_user_id?: string | null
          sale_responsible_id?: string | null
          sdr_id?: string | null
          segment?: string | null
          uf?: string | null
          uf_source?: string | null
          updated_at?: string
          urgency?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
        }
        Update: {
          ai_disabled?: boolean | null
          ai_disabled_at?: string | null
          ai_disabled_by?: string | null
          avatar_url?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          closer_id?: string | null
          company?: string | null
          company_entity_id?: string | null
          compromisso_date?: string | null
          contact_id?: string | null
          created_at?: string
          deleted_at?: string | null
          deleted_by?: string | null
          email?: string | null
          excluded_from_metrics?: boolean
          faturamento?: string | null
          id?: string
          import_batch_id?: string | null
          interest?: string | null
          is_shadow?: boolean | null
          meta_ad_id?: string | null
          meta_adset_id?: string | null
          meta_campaign_id?: string | null
          meta_lead_id?: string | null
          metrics_period_at?: string | null
          name?: string
          normalized_phone?: string | null
          notes?: string | null
          organization_id?: string | null
          origin?: string | null
          origin_detail?: string | null
          phone?: string | null
          phone_digits?: string | null
          pipe_whatsapp?: string | null
          pre_qualification_tier?:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          pre_sale_responsible_id?: string | null
          qualification_score?: number | null
          qualification_tier?:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          rating?: number | null
          responsible_id?: string | null
          responsible_user_id?: string | null
          sale_responsible_id?: string | null
          sdr_id?: string | null
          segment?: string | null
          uf?: string | null
          uf_source?: string | null
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
            foreignKeyName: "leads_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_entity_id_fkey"
            columns: ["company_entity_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsible_user_id_fkey"
            columns: ["responsible_user_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
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
          {
            foreignKeyName: "leads_reativacao_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_reasons: {
        Row: {
          category: string | null
          created_at: string
          display_order: number
          id: string
          is_system: boolean
          name: string
          organization_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_system?: boolean
          name: string
          organization_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "loss_reasons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      master_audit_logs: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: unknown
          master_user_id: string
          target_id: string | null
          target_name: string | null
          target_type: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          master_user_id: string
          target_id?: string | null
          target_name?: string | null
          target_type: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          master_user_id?: string
          target_id?: string | null
          target_name?: string | null
          target_type?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "master_audit_logs_master_user_id_fkey"
            columns: ["master_user_id"]
            isOneToOne: false
            referencedRelation: "master_users"
            referencedColumns: ["id"]
          },
        ]
      }
      master_users: {
        Row: {
          created_at: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          permissions: Json | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          permissions?: Json | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          permissions?: Json | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      media_dedup_plan: {
        Row: {
          created_at: string
          dup_path: string
          keeper_path: string
          msg_id: string | null
          org_id: string | null
          repointed: number | null
          size_bytes: number | null
        }
        Insert: {
          created_at?: string
          dup_path: string
          keeper_path: string
          msg_id?: string | null
          org_id?: string | null
          repointed?: number | null
          size_bytes?: number | null
        }
        Update: {
          created_at?: string
          dup_path?: string
          keeper_path?: string
          msg_id?: string | null
          org_id?: string | null
          repointed?: number | null
          size_bytes?: number | null
        }
        Relationships: []
      }
      media_purge_queue: {
        Row: {
          category: string
          last_error: string | null
          object_name: string
          purged_at: string | null
          queued_at: string
          size_bytes: number | null
        }
        Insert: {
          category: string
          last_error?: string | null
          object_name: string
          purged_at?: string | null
          queued_at?: string
          size_bytes?: number | null
        }
        Update: {
          category?: string
          last_error?: string | null
          object_name?: string
          purged_at?: string | null
          queued_at?: string
          size_bytes?: number | null
        }
        Relationships: []
      }
      meeting_events: {
        Row: {
          booked_event_id: string | null
          created_at: string
          event_type: string
          id: string
          lead_id: string
          meeting_date: string | null
          metadata: Json
          occurred_at: string
          organization_id: string
          pre_sale_responsible_id: string | null
          source: string
          source_entry_id: string | null
        }
        Insert: {
          booked_event_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          lead_id: string
          meeting_date?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id: string
          pre_sale_responsible_id?: string | null
          source?: string
          source_entry_id?: string | null
        }
        Update: {
          booked_event_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          lead_id?: string
          meeting_date?: string | null
          metadata?: Json
          occurred_at?: string
          organization_id?: string
          pre_sale_responsible_id?: string | null
          source?: string
          source_entry_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_events_booked_event_id_fkey"
            columns: ["booked_event_id"]
            isOneToOne: false
            referencedRelation: "meeting_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_participants: {
        Row: {
          created_at: string
          id: string
          meeting_id: string
          status: string
          team_member_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meeting_id: string
          status?: string
          team_member_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meeting_id?: string
          status?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meeting_participants_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meeting_participants_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          all_day: boolean
          color: string | null
          created_at: string
          created_by: string | null
          deal_id: string | null
          description: string | null
          end_at: string
          event_type: string
          external_ref: string | null
          google_event_id: string | null
          id: string
          lead_id: string | null
          location: string | null
          meet_link: string | null
          notes: string | null
          organization_id: string
          pipeline_id: string | null
          recurrence_rule: string | null
          start_at: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          all_day?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          end_at: string
          event_type?: string
          external_ref?: string | null
          google_event_id?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meet_link?: string | null
          notes?: string | null
          organization_id: string
          pipeline_id?: string | null
          recurrence_rule?: string | null
          start_at: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          all_day?: boolean
          color?: string | null
          created_at?: string
          created_by?: string | null
          deal_id?: string | null
          description?: string | null
          end_at?: string
          event_type?: string
          external_ref?: string | null
          google_event_id?: string | null
          id?: string
          lead_id?: string | null
          location?: string | null
          meet_link?: string | null
          notes?: string | null
          organization_id?: string
          pipeline_id?: string | null
          recurrence_rule?: string | null
          start_at?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meetings_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meetings_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      member_feature_permissions: {
        Row: {
          enabled: boolean
          feature_key: string
          id: string
          organization_id: string
          team_member_id: string
          updated_at: string
        }
        Insert: {
          enabled?: boolean
          feature_key: string
          id?: string
          organization_id: string
          team_member_id: string
          updated_at?: string
        }
        Update: {
          enabled?: boolean
          feature_key?: string
          id?: string
          organization_id?: string
          team_member_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_feature_permissions_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "member_feature_permissions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_feature_permissions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_feature_permissions_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      message_templates: {
        Row: {
          body: string
          command: string
          created_at: string
          created_by: string | null
          display_name: string
          id: string
          media_type: string | null
          media_url: string | null
          organization_id: string
          updated_at: string
        }
        Insert: {
          body: string
          command: string
          created_at?: string
          created_by?: string | null
          display_name: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          organization_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          command?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_channels: {
        Row: {
          channel_type: string
          connected_at: string
          created_at: string
          display_name: string
          external_channel_id: string
          handle: string | null
          id: string
          inbound_subscription_attempts: number
          inbound_subscription_last_attempt_at: string | null
          inbound_subscription_last_error: string | null
          inbound_subscription_next_attempt_at: string
          inbound_subscription_registered_at: string | null
          inbound_subscription_status: string
          organization_id: string
          provider: string
          provider_config: Json
          status: string
          subaccount_id: string
          updated_at: string
        }
        Insert: {
          channel_type: string
          connected_at?: string
          created_at?: string
          display_name: string
          external_channel_id: string
          handle?: string | null
          id?: string
          inbound_subscription_attempts?: number
          inbound_subscription_last_attempt_at?: string | null
          inbound_subscription_last_error?: string | null
          inbound_subscription_next_attempt_at?: string
          inbound_subscription_registered_at?: string | null
          inbound_subscription_status?: string
          organization_id: string
          provider?: string
          provider_config?: Json
          status?: string
          subaccount_id: string
          updated_at?: string
        }
        Update: {
          channel_type?: string
          connected_at?: string
          created_at?: string
          display_name?: string
          external_channel_id?: string
          handle?: string | null
          id?: string
          inbound_subscription_attempts?: number
          inbound_subscription_last_attempt_at?: string | null
          inbound_subscription_last_error?: string | null
          inbound_subscription_next_attempt_at?: string
          inbound_subscription_registered_at?: string | null
          inbound_subscription_status?: string
          organization_id?: string
          provider?: string
          provider_config?: Json
          status?: string
          subaccount_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messaging_channels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messaging_channels_subaccount_id_fkey"
            columns: ["subaccount_id"]
            isOneToOne: false
            referencedRelation: "notificame_subaccounts"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_app_config: {
        Row: {
          business_id: string | null
          id: boolean
          system_user_token: string
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          id?: boolean
          system_user_token: string
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          id?: boolean
          system_user_token?: string
          updated_at?: string
        }
        Relationships: []
      }
      meta_asset_bindings: {
        Row: {
          asset_id: string
          asset_name: string | null
          asset_type: string
          created_at: string
          dataset_id: string | null
          id: string
          last_error: string | null
          last_polled_at: string | null
          organization_id: string
          status: string
          updated_at: string | null
        }
        Insert: {
          asset_id: string
          asset_name?: string | null
          asset_type: string
          created_at?: string
          dataset_id?: string | null
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          organization_id: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          asset_id?: string
          asset_name?: string | null
          asset_type?: string
          created_at?: string
          dataset_id?: string | null
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          organization_id?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_asset_bindings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_connections: {
        Row: {
          access_token: string
          connected_at: string | null
          connection_type: string
          facebook_user_id: string
          facebook_user_name: string | null
          id: string
          organization_id: string
          status: string
          token_expires_at: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          access_token: string
          connected_at?: string | null
          connection_type?: string
          facebook_user_id: string
          facebook_user_name?: string | null
          id?: string
          organization_id: string
          status?: string
          token_expires_at: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          access_token?: string
          connected_at?: string | null
          connection_type?: string
          facebook_user_id?: string
          facebook_user_name?: string | null
          id?: string
          organization_id?: string
          status?: string
          token_expires_at?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_conversations: {
        Row: {
          archived_at: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          created_at: string
          external_user_id: string
          external_username: string | null
          id: string
          last_inbound_at: string | null
          last_message_at: string | null
          last_message_preview: string | null
          lead_id: string | null
          meta_page_id: string
          organization_id: string
          profile_pic_expires_at: string | null
          profile_pic_url: string | null
          unread_count: number
          updated_at: string
        }
        Insert: {
          archived_at?: string | null
          channel: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          external_user_id: string
          external_username?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          meta_page_id: string
          organization_id: string
          profile_pic_expires_at?: string | null
          profile_pic_url?: string | null
          unread_count?: number
          updated_at?: string
        }
        Update: {
          archived_at?: string | null
          channel?: Database["public"]["Enums"]["channel_type"]
          created_at?: string
          external_user_id?: string
          external_username?: string | null
          id?: string
          last_inbound_at?: string | null
          last_message_at?: string | null
          last_message_preview?: string | null
          lead_id?: string | null
          meta_page_id?: string
          organization_id?: string
          profile_pic_expires_at?: string | null
          profile_pic_url?: string | null
          unread_count?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_meta_page_id_fkey"
            columns: ["meta_page_id"]
            isOneToOne: false
            referencedRelation: "meta_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_leadgen_configs: {
        Row: {
          assign_to_campaign_id: string | null
          assign_to_pipe: string | null
          assign_to_stage: string | null
          auto_tag: string[] | null
          created_at: string | null
          field_mappings: Json | null
          form_id: string | null
          form_name: string | null
          id: string
          is_active: boolean | null
          meta_page_id: string
          notify_team: boolean | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          assign_to_campaign_id?: string | null
          assign_to_pipe?: string | null
          assign_to_stage?: string | null
          auto_tag?: string[] | null
          created_at?: string | null
          field_mappings?: Json | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          is_active?: boolean | null
          meta_page_id: string
          notify_team?: boolean | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          assign_to_campaign_id?: string | null
          assign_to_pipe?: string | null
          assign_to_stage?: string | null
          auto_tag?: string[] | null
          created_at?: string | null
          field_mappings?: Json | null
          form_id?: string | null
          form_name?: string | null
          id?: string
          is_active?: boolean | null
          meta_page_id?: string
          notify_team?: boolean | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_leadgen_configs_assign_to_campaign_id_fkey"
            columns: ["assign_to_campaign_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_leadgen_configs_meta_page_id_fkey"
            columns: ["meta_page_id"]
            isOneToOne: false
            referencedRelation: "meta_pages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_leadgen_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_pages: {
        Row: {
          created_at: string | null
          id: string
          instagram_account_id: string | null
          instagram_username: string | null
          is_active: boolean | null
          meta_connection_id: string
          organization_id: string
          page_access_token: string
          page_id: string
          page_name: string
          updated_at: string | null
          webhook_subscribed: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          instagram_account_id?: string | null
          instagram_username?: string | null
          is_active?: boolean | null
          meta_connection_id: string
          organization_id: string
          page_access_token: string
          page_id: string
          page_name: string
          updated_at?: string | null
          webhook_subscribed?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          instagram_account_id?: string | null
          instagram_username?: string | null
          is_active?: boolean | null
          meta_connection_id?: string
          organization_id?: string
          page_access_token?: string
          page_id?: string
          page_name?: string
          updated_at?: string | null
          webhook_subscribed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "meta_pages_meta_connection_id_fkey"
            columns: ["meta_connection_id"]
            isOneToOne: false
            referencedRelation: "meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_pages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_signals_sent: {
        Row: {
          event_name: string
          id: string
          lead_id: string
          organization_id: string
          sent_at: string
        }
        Insert: {
          event_name: string
          id?: string
          lead_id: string
          organization_id: string
          sent_at?: string
        }
        Update: {
          event_name?: string
          id?: string
          lead_id?: string
          organization_id?: string
          sent_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meta_signals_sent_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_signals_sent_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meta_signals_sent_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_catalog_formats: {
        Row: {
          id: string
          label: string
          sort: number
        }
        Insert: {
          id: string
          label: string
          sort?: number
        }
        Update: {
          id?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      metric_catalog_measure_formats: {
        Row: {
          format_id: string
          measure_id: string
        }
        Insert: {
          format_id: string
          measure_id: string
        }
        Update: {
          format_id?: string
          measure_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_catalog_measure_formats_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_catalog_measure_formats_measure_id_fkey"
            columns: ["measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_catalog_measure_recortes: {
        Row: {
          measure_id: string
          recorte_id: string
        }
        Insert: {
          measure_id: string
          recorte_id: string
        }
        Update: {
          measure_id?: string
          recorte_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_catalog_measure_recortes_measure_id_fkey"
            columns: ["measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_catalog_measure_recortes_recorte_id_fkey"
            columns: ["recorte_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_recortes"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_catalog_measure_styles: {
        Row: {
          measure_id: string
          style_id: string
        }
        Insert: {
          measure_id: string
          style_id: string
        }
        Update: {
          measure_id?: string
          style_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_catalog_measure_styles_measure_id_fkey"
            columns: ["measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_catalog_measure_styles_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_widget_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_catalog_measures: {
        Row: {
          anchor: string
          description: string | null
          goal_type: string | null
          id: string
          label: string
          sort: number
          unit: string
        }
        Insert: {
          anchor: string
          description?: string | null
          goal_type?: string | null
          id: string
          label: string
          sort?: number
          unit: string
        }
        Update: {
          anchor?: string
          description?: string | null
          goal_type?: string | null
          id?: string
          label?: string
          sort?: number
          unit?: string
        }
        Relationships: []
      }
      metric_catalog_ratios: {
        Row: {
          den_measure_id: string
          format_id: string
          id: string
          label: string
          num_measure_id: string
          sort: number
        }
        Insert: {
          den_measure_id: string
          format_id: string
          id: string
          label: string
          num_measure_id: string
          sort?: number
        }
        Update: {
          den_measure_id?: string
          format_id?: string
          id?: string
          label?: string
          num_measure_id?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "metric_catalog_ratios_den_measure_id_fkey"
            columns: ["den_measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_catalog_ratios_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_catalog_ratios_num_measure_id_fkey"
            columns: ["num_measure_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_measures"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_catalog_recortes: {
        Row: {
          id: string
          label: string
          sort: number
        }
        Insert: {
          id: string
          label: string
          sort?: number
        }
        Update: {
          id?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      metric_catalog_renderers: {
        Row: {
          description: string | null
          id: string
          is_legacy: boolean
          label: string
          sort: number
        }
        Insert: {
          description?: string | null
          id: string
          is_legacy?: boolean
          label: string
          sort?: number
        }
        Update: {
          description?: string | null
          id?: string
          is_legacy?: boolean
          label?: string
          sort?: number
        }
        Relationships: []
      }
      metric_catalog_style_variants: {
        Row: {
          label: string
          sort: number
          style_id: string
          variant: string
        }
        Insert: {
          label: string
          sort?: number
          style_id: string
          variant: string
        }
        Update: {
          label?: string
          sort?: number
          style_id?: string
          variant?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_catalog_style_variants_style_id_fkey"
            columns: ["style_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_widget_styles"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_catalog_widget_styles: {
        Row: {
          description: string | null
          id: string
          label: string
          sort: number
        }
        Insert: {
          description?: string | null
          id: string
          label: string
          sort?: number
        }
        Update: {
          description?: string | null
          id?: string
          label?: string
          sort?: number
        }
        Relationships: []
      }
      metric_custom_definitions: {
        Row: {
          created_at: string
          created_by: string | null
          derived_unit: string
          description: string | null
          format_id: string
          id: string
          name: string
          organization_id: string
          tree: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          derived_unit: string
          description?: string | null
          format_id: string
          id?: string
          name: string
          organization_id: string
          tree: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          derived_unit?: string
          description?: string | null
          format_id?: string
          id?: string
          name?: string
          organization_id?: string
          tree?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metric_custom_definitions_format_id_fkey"
            columns: ["format_id"]
            isOneToOne: false
            referencedRelation: "metric_catalog_formats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metric_custom_definitions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      metrics_studio_panels: {
        Row: {
          created_at: string
          id: string
          layout: Json
          organization_id: string
          team_member_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          layout?: Json
          organization_id: string
          team_member_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          layout?: Json
          organization_id?: string
          team_member_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "metrics_studio_panels_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_studio_panels_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "metrics_studio_panels_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      mkt_origin_config: {
        Row: {
          created_at: string | null
          id: string
          investimento_cents: number
          month: number
          organization_id: string
          origin: string
          show_agendamentos: boolean
          show_comparecimentos: boolean
          show_leads: boolean
          show_propostas: boolean
          show_vendas: boolean
          updated_at: string | null
          year: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          investimento_cents?: number
          month: number
          organization_id: string
          origin: string
          show_agendamentos?: boolean
          show_comparecimentos?: boolean
          show_leads?: boolean
          show_propostas?: boolean
          show_vendas?: boolean
          updated_at?: string | null
          year: number
        }
        Update: {
          created_at?: string | null
          id?: string
          investimento_cents?: number
          month?: number
          organization_id?: string
          origin?: string
          show_agendamentos?: boolean
          show_comparecimentos?: boolean
          show_leads?: boolean
          show_propostas?: boolean
          show_vendas?: boolean
          updated_at?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "mkt_origin_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      next_best_actions: {
        Row: {
          action_type: string
          completed_at: string | null
          created_at: string
          deal_id: string | null
          dismissed_at: string | null
          due_by: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          organization_id: string
          priority: number
          reason: string
          title: string
          user_id: string
        }
        Insert: {
          action_type: string
          completed_at?: string | null
          created_at?: string
          deal_id?: string | null
          dismissed_at?: string | null
          due_by?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          organization_id: string
          priority?: number
          reason: string
          title: string
          user_id: string
        }
        Update: {
          action_type?: string
          completed_at?: string | null
          created_at?: string
          deal_id?: string | null
          dismissed_at?: string | null
          due_by?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          organization_id?: string
          priority?: number
          reason?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "next_best_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "next_best_actions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notas_fiscais: {
        Row: {
          chave_nfe: string | null
          client_id: string | null
          created_at: string
          data_emissao: string | null
          external_id: string
          external_ref: string | null
          external_source: string
          id: string
          numero: string | null
          order_id: string | null
          organization_id: string
          status: string | null
          updated_at: string
          valor: number | null
        }
        Insert: {
          chave_nfe?: string | null
          client_id?: string | null
          created_at?: string
          data_emissao?: string | null
          external_id: string
          external_ref?: string | null
          external_source: string
          id?: string
          numero?: string | null
          order_id?: string | null
          organization_id: string
          status?: string | null
          updated_at?: string
          valor?: number | null
        }
        Update: {
          chave_nfe?: string | null
          client_id?: string | null
          created_at?: string
          data_emissao?: string | null
          external_id?: string
          external_ref?: string | null
          external_source?: string
          id?: string
          numero?: string | null
          order_id?: string | null
          organization_id?: string
          status?: string | null
          updated_at?: string
          valor?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "notas_fiscais_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "upsell_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notas_fiscais_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notificame_connect_sessions: {
        Row: {
          baseline_channel_ids: string[]
          consumed_at: string | null
          created_at: string
          created_by: string
          expires_at: string
          id: string
          organization_id: string
          requested_channel_type: string
          status: string
        }
        Insert: {
          baseline_channel_ids?: string[]
          consumed_at?: string | null
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          organization_id: string
          requested_channel_type?: string
          status?: string
        }
        Update: {
          baseline_channel_ids?: string[]
          consumed_at?: string | null
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          organization_id?: string
          requested_channel_type?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "notificame_connect_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notificame_subaccounts: {
        Row: {
          company_uuid_ciphertext: string | null
          company_uuid_nonce: string | null
          created_at: string
          detached_at: string | null
          detached_organization_id: string | null
          encryption_key_id: string
          id: string
          last_error_code: string | null
          organization_id: string | null
          provisioned_at: string | null
          status: string
          updated_at: string
          vendor_email: string | null
        }
        Insert: {
          company_uuid_ciphertext?: string | null
          company_uuid_nonce?: string | null
          created_at?: string
          detached_at?: string | null
          detached_organization_id?: string | null
          encryption_key_id?: string
          id?: string
          last_error_code?: string | null
          organization_id?: string | null
          provisioned_at?: string | null
          status?: string
          updated_at?: string
          vendor_email?: string | null
        }
        Update: {
          company_uuid_ciphertext?: string | null
          company_uuid_nonce?: string | null
          created_at?: string
          detached_at?: string | null
          detached_organization_id?: string | null
          encryption_key_id?: string
          id?: string
          last_error_code?: string | null
          organization_id?: string | null
          provisioned_at?: string | null
          status?: string
          updated_at?: string
          vendor_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificame_subaccounts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notificame_webhook_events: {
        Row: {
          attempts: number
          created_at: string
          event_type: string | null
          external_id: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          messaging_channel_id: string | null
          organization_id: string | null
          payload: Json
          reason: string
          received_at: string
          resolved_at: string | null
          source_ip: string | null
          status: string
          url_path: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          event_type?: string | null
          external_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          messaging_channel_id?: string | null
          organization_id?: string | null
          payload: Json
          reason: string
          received_at?: string
          resolved_at?: string | null
          source_ip?: string | null
          status?: string
          url_path?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          event_type?: string | null
          external_id?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          messaging_channel_id?: string | null
          organization_id?: string | null
          payload?: Json
          reason?: string
          received_at?: string
          resolved_at?: string | null
          source_ip?: string | null
          status?: string
          url_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notificame_webhook_events_messaging_channel_id_fkey"
            columns: ["messaging_channel_id"]
            isOneToOne: false
            referencedRelation: "messaging_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notificame_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          id: string
          mute_active_conversation: boolean
          organization_id: string
          overrides: Json
          push_enabled: boolean
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          sound_enabled: boolean
          updated_at: string | null
          user_id: string
          volume: number
        }
        Insert: {
          created_at?: string
          id?: string
          mute_active_conversation?: boolean
          organization_id: string
          overrides?: Json
          push_enabled?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sound_enabled?: boolean
          updated_at?: string | null
          user_id: string
          volume?: number
        }
        Update: {
          created_at?: string
          id?: string
          mute_active_conversation?: boolean
          organization_id?: string
          overrides?: Json
          push_enabled?: boolean
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          sound_enabled?: boolean
          updated_at?: string | null
          user_id?: string
          volume?: number
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string | null
          description: string | null
          entity_id: string | null
          event_count: number
          group_key: string | null
          id: string
          last_event_at: string | null
          lead_id: string | null
          link: string | null
          organization_id: string
          pushed_at: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          entity_id?: string | null
          event_count?: number
          group_key?: string | null
          id?: string
          last_event_at?: string | null
          lead_id?: string | null
          link?: string | null
          organization_id: string
          pushed_at?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          entity_id?: string | null
          event_count?: number
          group_key?: string | null
          id?: string
          last_event_at?: string | null
          lead_id?: string | null
          link?: string | null
          organization_id?: string
          pushed_at?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      omie_connection_secrets: {
        Row: {
          app_key_ciphertext: string
          app_key_nonce: string
          app_secret_ciphertext: string
          app_secret_nonce: string
          connection_id: string
          created_at: string
          encryption_key_id: string
          organization_id: string
          updated_at: string
          webhook_secret_hash: string | null
        }
        Insert: {
          app_key_ciphertext: string
          app_key_nonce: string
          app_secret_ciphertext: string
          app_secret_nonce: string
          connection_id: string
          created_at?: string
          encryption_key_id?: string
          organization_id: string
          updated_at?: string
          webhook_secret_hash?: string | null
        }
        Update: {
          app_key_ciphertext?: string
          app_key_nonce?: string
          app_secret_ciphertext?: string
          app_secret_nonce?: string
          connection_id?: string
          created_at?: string
          encryption_key_id?: string
          organization_id?: string
          updated_at?: string
          webhook_secret_hash?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "omie_connection_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "omie_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "omie_connection_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      omie_connections: {
        Row: {
          clientes_cursor: number | null
          connected_at: string | null
          created_at: string
          erp_sync_mode: string
          financeiro_cursor: number | null
          id: string
          last_clientes_sync_at: string | null
          last_error: string | null
          last_financeiro_sync_at: string | null
          last_pedidos_sync_at: string | null
          last_produtos_sync_at: string | null
          omie_account_name: string | null
          organization_id: string
          pedidos_cursor: number | null
          produtos_cursor: number | null
          status: string
          titulos_cursor: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          clientes_cursor?: number | null
          connected_at?: string | null
          created_at?: string
          erp_sync_mode?: string
          financeiro_cursor?: number | null
          id?: string
          last_clientes_sync_at?: string | null
          last_error?: string | null
          last_financeiro_sync_at?: string | null
          last_pedidos_sync_at?: string | null
          last_produtos_sync_at?: string | null
          omie_account_name?: string | null
          organization_id: string
          pedidos_cursor?: number | null
          produtos_cursor?: number | null
          status?: string
          titulos_cursor?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          clientes_cursor?: number | null
          connected_at?: string | null
          created_at?: string
          erp_sync_mode?: string
          financeiro_cursor?: number | null
          id?: string
          last_clientes_sync_at?: string | null
          last_error?: string | null
          last_financeiro_sync_at?: string | null
          last_pedidos_sync_at?: string | null
          last_produtos_sync_at?: string | null
          omie_account_name?: string | null
          organization_id?: string
          pedidos_cursor?: number | null
          produtos_cursor?: number | null
          status?: string
          titulos_cursor?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "omie_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      onboarding_automation_templates: {
        Row: {
          created_at: string
          customizable_fields: Json
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          match_criteria: Json | null
          name: string
          trigger_config: Json
          trigger_type: string
          type: string
          updated_at: string
          workflow_definition: Json
        }
        Insert: {
          created_at?: string
          customizable_fields?: Json
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          match_criteria?: Json | null
          name: string
          trigger_config?: Json
          trigger_type: string
          type: string
          updated_at?: string
          workflow_definition: Json
        }
        Update: {
          created_at?: string
          customizable_fields?: Json
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          match_criteria?: Json | null
          name?: string
          trigger_config?: Json
          trigger_type?: string
          type?: string
          updated_at?: string
          workflow_definition?: Json
        }
        Relationships: []
      }
      onboarding_pipeline_templates: {
        Row: {
          color: string | null
          created_at: string
          custom_pipelines: Json
          default_pipelines_config: Json
          description: string | null
          icon: string | null
          id: string
          is_active: boolean
          match_criteria: Json
          name: string
          priority: number
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          custom_pipelines?: Json
          default_pipelines_config?: Json
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          match_criteria?: Json
          name: string
          priority?: number
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          custom_pipelines?: Json
          default_pipelines_config?: Json
          description?: string | null
          icon?: string | null
          id?: string
          is_active?: boolean
          match_criteria?: Json
          name?: string
          priority?: number
          updated_at?: string
        }
        Relationships: []
      }
      oraculo_conversations: {
        Row: {
          archived_at: string | null
          created_at: string
          id: string
          last_message_at: string | null
          organization_id: string
          summary: string | null
          team_member_id: string | null
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          organization_id: string
          summary?: string | null
          team_member_id?: string | null
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string
          id?: string
          last_message_at?: string | null
          organization_id?: string
          summary?: string | null
          team_member_id?: string | null
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oraculo_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oraculo_conversations_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oraculo_conversations_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      oraculo_turns: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          hit_tool_ceiling: boolean
          id: string
          input_tokens: number | null
          latency_ms: number | null
          model: string | null
          organization_id: string
          output_tokens: number | null
          rejected_tools: string[]
          role: string
          tools_used: string[]
          user_id: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          hit_tool_ceiling?: boolean
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          organization_id: string
          output_tokens?: number | null
          rejected_tools?: string[]
          role: string
          tools_used?: string[]
          user_id: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          hit_tool_ceiling?: boolean
          id?: string
          input_tokens?: number | null
          latency_ms?: number | null
          model?: string | null
          organization_id?: string
          output_tokens?: number | null
          rejected_tools?: string[]
          role?: string
          tools_used?: string[]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oraculo_turns_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "oraculo_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oraculo_turns_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      oraculo_usage: {
        Row: {
          created_at: string
          id: string
          organization_id: string
          question: string
          response: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          organization_id: string
          question: string
          response?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          organization_id?: string
          question?: string
          response?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oraculo_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      order_events: {
        Row: {
          actor_id: string | null
          comment: string | null
          created_at: string
          event_type: string
          id: string
          order_id: string
          organization_id: string
          payload: Json | null
        }
        Insert: {
          actor_id?: string | null
          comment?: string | null
          created_at?: string
          event_type: string
          id?: string
          order_id: string
          organization_id: string
          payload?: Json | null
        }
        Update: {
          actor_id?: string | null
          comment?: string | null
          created_at?: string
          event_type?: string
          id?: string
          order_id?: string
          organization_id?: string
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "order_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "upsell_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_onboarding_progress: {
        Row: {
          created_at: string
          dismissed_at: string | null
          organization_id: string
          step_add_member: boolean
          step_configure_copilot: boolean
          step_connect_whatsapp: boolean
          step_create_workflow: boolean
          step_first_sale: boolean
          step_import_lead: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          dismissed_at?: string | null
          organization_id: string
          step_add_member?: boolean
          step_configure_copilot?: boolean
          step_connect_whatsapp?: boolean
          step_create_workflow?: boolean
          step_first_sale?: boolean
          step_import_lead?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          dismissed_at?: string | null
          organization_id?: string
          step_add_member?: boolean
          step_configure_copilot?: boolean
          step_connect_whatsapp?: boolean
          step_create_workflow?: boolean
          step_first_sale?: boolean
          step_import_lead?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_onboarding_progress_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_quotas: {
        Row: {
          admin_adjustment: number
          created_at: string
          effective_limit: number | null
          id: string
          organization_id: string
          plan_base: number
          purchased_addons: number
          resource_key: string
          updated_at: string
        }
        Insert: {
          admin_adjustment?: number
          created_at?: string
          effective_limit?: number | null
          id?: string
          organization_id: string
          plan_base?: number
          purchased_addons?: number
          resource_key: string
          updated_at?: string
        }
        Update: {
          admin_adjustment?: number
          created_at?: string
          effective_limit?: number | null
          id?: string
          organization_id?: string
          plan_base?: number
          purchased_addons?: number
          resource_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_quotas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_subscriptions: {
        Row: {
          base_amount_cents: number
          billing_cycle: string
          cancelled_at: string | null
          coupon_discount_pct: number
          coupon_id: string | null
          created_at: string
          created_by: string | null
          cycle_discount_pct: number
          discount_amount_cents: number
          features: Json
          final_amount_cents: number
          id: string
          limits: Json
          manual_discount_by: string | null
          manual_discount_cents: number
          manual_discount_reason: string | null
          organization_id: string
          payment_method: string | null
          plan_id: string
          provider: string | null
          provider_payment_id: string | null
          provider_subscription_id: string | null
          renews_at: string | null
          started_at: string
          updated_at: string
          user_count: number
        }
        Insert: {
          base_amount_cents?: number
          billing_cycle: string
          cancelled_at?: string | null
          coupon_discount_pct?: number
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_discount_pct?: number
          discount_amount_cents?: number
          features?: Json
          final_amount_cents?: number
          id?: string
          limits?: Json
          manual_discount_by?: string | null
          manual_discount_cents?: number
          manual_discount_reason?: string | null
          organization_id: string
          payment_method?: string | null
          plan_id: string
          provider?: string | null
          provider_payment_id?: string | null
          provider_subscription_id?: string | null
          renews_at?: string | null
          started_at?: string
          updated_at?: string
          user_count?: number
        }
        Update: {
          base_amount_cents?: number
          billing_cycle?: string
          cancelled_at?: string | null
          coupon_discount_pct?: number
          coupon_id?: string | null
          created_at?: string
          created_by?: string | null
          cycle_discount_pct?: number
          discount_amount_cents?: number
          features?: Json
          final_amount_cents?: number
          id?: string
          limits?: Json
          manual_discount_by?: string | null
          manual_discount_cents?: number
          manual_discount_reason?: string | null
          organization_id?: string
          payment_method?: string | null
          plan_id?: string
          provider?: string | null
          provider_payment_id?: string | null
          provider_subscription_id?: string | null
          renews_at?: string | null
          started_at?: string
          updated_at?: string
          user_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "org_subscriptions_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      org_unit_economics_inputs: {
        Row: {
          admin_pct: number
          anuncios: number
          comissao_pct: number
          created_at: string
          embalagem: number
          frete: number
          imposto_pct: number
          meta_num_vendas: number | null
          meta_ticket_medio: number | null
          organization_id: string
          recompras: number
          scenario: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          admin_pct?: number
          anuncios?: number
          comissao_pct?: number
          created_at?: string
          embalagem?: number
          frete?: number
          imposto_pct?: number
          meta_num_vendas?: number | null
          meta_ticket_medio?: number | null
          organization_id: string
          recompras?: number
          scenario?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          admin_pct?: number
          anuncios?: number
          comissao_pct?: number
          created_at?: string
          embalagem?: number
          frete?: number
          imposto_pct?: number
          meta_num_vendas?: number | null
          meta_ticket_medio?: number | null
          organization_id?: string
          recompras?: number
          scenario?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "org_unit_economics_inputs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_feature_defaults: {
        Row: {
          created_at: string
          enabled: boolean
          feature_key: string
          id: string
          organization_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          enabled: boolean
          feature_key: string
          id?: string
          organization_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          enabled?: boolean
          feature_key?: string
          id?: string
          organization_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_feature_defaults_feature_key_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_permissions"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "organization_feature_defaults_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_features: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          expires_at: string | null
          feature_key: string
          id: string
          is_enabled: boolean | null
          organization_id: string
          overridden_at: string | null
          overridden_by: string | null
          override_reason: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          expires_at?: string | null
          feature_key: string
          id?: string
          is_enabled?: boolean | null
          organization_id: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          expires_at?: string | null
          feature_key?: string
          id?: string
          is_enabled?: boolean | null
          organization_id?: string
          overridden_at?: string | null
          overridden_by?: string | null
          override_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_features_feature_catalog_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_catalog"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "organization_features_feature_catalog_fkey"
            columns: ["feature_key"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "organization_features_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          auto_create_lead_on_inbound: boolean
          billing_override: boolean | null
          billing_override_at: string | null
          billing_override_by: string | null
          billing_override_reason: string | null
          capture_groups: boolean
          carteira_emits_revenue_enabled: boolean
          chat_restrict_to_owner: boolean
          composable_metrics_enabled: boolean
          confirmacao_overdue_days: number
          copilot_engine_version: string
          created_at: string | null
          daily_blast_budget: number
          default_reorder_cycle_days: number | null
          elevenlabs_api_key: string | null
          feature_flags: Json
          id: string
          is_sandbox: boolean
          limit_overrides: Json | null
          metrics_studio_enabled: boolean
          name: string
          onboarding_answers: Json | null
          onboarding_completed_at: string | null
          onboarding_state: string
          oraculo_daily_turn_limit: number | null
          org_type: Database["public"]["Enums"]["org_type"]
          payment_customer_id: string | null
          payment_subscription_id: string | null
          quick_blast_max_leads: number
          require_voice_consent: boolean
          sandbox_created_at: string | null
          sandbox_source_org_id: string | null
          send_governor_cold_gate_enabled: boolean
          send_governor_mode: string
          send_governor_warmup_enabled: boolean
          slug: string
          subscription_expires_at: string | null
          subscription_plan: string | null
          subscription_status: string
          timezone: string
          updated_at: string | null
          user_creation_key: string | null
          voice_sessions_cap: number
          whatsapp_migration_completed_at: string | null
          whatsapp_migration_status: string
          whatsapp_provider_override: string | null
          whatsapp_rate_limit: Json | null
        }
        Insert: {
          auto_create_lead_on_inbound?: boolean
          billing_override?: boolean | null
          billing_override_at?: string | null
          billing_override_by?: string | null
          billing_override_reason?: string | null
          capture_groups?: boolean
          carteira_emits_revenue_enabled?: boolean
          chat_restrict_to_owner?: boolean
          composable_metrics_enabled?: boolean
          confirmacao_overdue_days?: number
          copilot_engine_version?: string
          created_at?: string | null
          daily_blast_budget?: number
          default_reorder_cycle_days?: number | null
          elevenlabs_api_key?: string | null
          feature_flags?: Json
          id?: string
          is_sandbox?: boolean
          limit_overrides?: Json | null
          metrics_studio_enabled?: boolean
          name: string
          onboarding_answers?: Json | null
          onboarding_completed_at?: string | null
          onboarding_state?: string
          oraculo_daily_turn_limit?: number | null
          org_type?: Database["public"]["Enums"]["org_type"]
          payment_customer_id?: string | null
          payment_subscription_id?: string | null
          quick_blast_max_leads?: number
          require_voice_consent?: boolean
          sandbox_created_at?: string | null
          sandbox_source_org_id?: string | null
          send_governor_cold_gate_enabled?: boolean
          send_governor_mode?: string
          send_governor_warmup_enabled?: boolean
          slug: string
          subscription_expires_at?: string | null
          subscription_plan?: string | null
          subscription_status?: string
          timezone?: string
          updated_at?: string | null
          user_creation_key?: string | null
          voice_sessions_cap?: number
          whatsapp_migration_completed_at?: string | null
          whatsapp_migration_status?: string
          whatsapp_provider_override?: string | null
          whatsapp_rate_limit?: Json | null
        }
        Update: {
          auto_create_lead_on_inbound?: boolean
          billing_override?: boolean | null
          billing_override_at?: string | null
          billing_override_by?: string | null
          billing_override_reason?: string | null
          capture_groups?: boolean
          carteira_emits_revenue_enabled?: boolean
          chat_restrict_to_owner?: boolean
          composable_metrics_enabled?: boolean
          confirmacao_overdue_days?: number
          copilot_engine_version?: string
          created_at?: string | null
          daily_blast_budget?: number
          default_reorder_cycle_days?: number | null
          elevenlabs_api_key?: string | null
          feature_flags?: Json
          id?: string
          is_sandbox?: boolean
          limit_overrides?: Json | null
          metrics_studio_enabled?: boolean
          name?: string
          onboarding_answers?: Json | null
          onboarding_completed_at?: string | null
          onboarding_state?: string
          oraculo_daily_turn_limit?: number | null
          org_type?: Database["public"]["Enums"]["org_type"]
          payment_customer_id?: string | null
          payment_subscription_id?: string | null
          quick_blast_max_leads?: number
          require_voice_consent?: boolean
          sandbox_created_at?: string | null
          sandbox_source_org_id?: string | null
          send_governor_cold_gate_enabled?: boolean
          send_governor_mode?: string
          send_governor_warmup_enabled?: boolean
          slug?: string
          subscription_expires_at?: string | null
          subscription_plan?: string | null
          subscription_status?: string
          timezone?: string
          updated_at?: string | null
          user_creation_key?: string | null
          voice_sessions_cap?: number
          whatsapp_migration_completed_at?: string | null
          whatsapp_migration_status?: string
          whatsapp_provider_override?: string | null
          whatsapp_rate_limit?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_sandbox_source_org_id_fkey"
            columns: ["sandbox_source_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizations_subscription_plan_fkey"
            columns: ["subscription_plan"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["name"]
          },
        ]
      }
      outbound_dispatch_log: {
        Row: {
          agent_id: string
          attempts: number
          batch_id: string | null
          campanha_id: string | null
          created_at: string
          error_message: string | null
          id: string
          lead_id: string
          message_content: string | null
          message_id: string | null
          organization_id: string
          scheduled_at: string
          sent_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_id: string
          attempts?: number
          batch_id?: string | null
          campanha_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id: string
          message_content?: string | null
          message_id?: string | null
          organization_id: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_id?: string
          attempts?: number
          batch_id?: string | null
          campanha_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          lead_id?: string
          message_content?: string | null
          message_id?: string | null
          organization_id?: string
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "outbound_dispatch_log_agent_id_fkey"
            columns: ["agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_dispatch_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_dispatch_log_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outbound_dispatch_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      password_reset_tokens: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          token_hash: string
          used_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          token_hash: string
          used_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          token_hash?: string
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      payment_history: {
        Row: {
          amount: number
          asaas_payment_id: string | null
          asaas_subscription_id: string | null
          billing_cycle: string
          billing_type: string | null
          coupon_id: string | null
          created_at: string
          discount_applied: number
          id: string
          invoice_url: string | null
          organization_id: string
          paid_at: string | null
          period_end: string | null
          period_start: string | null
          receipt_url: string | null
          status: string
        }
        Insert: {
          amount: number
          asaas_payment_id?: string | null
          asaas_subscription_id?: string | null
          billing_cycle: string
          billing_type?: string | null
          coupon_id?: string | null
          created_at?: string
          discount_applied?: number
          id?: string
          invoice_url?: string | null
          organization_id: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          receipt_url?: string | null
          status: string
        }
        Update: {
          amount?: number
          asaas_payment_id?: string | null
          asaas_subscription_id?: string | null
          billing_cycle?: string
          billing_type?: string | null
          coupon_id?: string | null
          created_at?: string
          discount_applied?: number
          id?: string
          invoice_url?: string | null
          organization_id?: string
          paid_at?: string | null
          period_end?: string | null
          period_start?: string | null
          receipt_url?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_history_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_link_buyers: {
        Row: {
          created_at: string
          email: string
          legal_name: string
          payment_link_id: string
          provider: string | null
          provider_customer_id: string | null
          tax_id: string
          tax_id_kind: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email: string
          legal_name: string
          payment_link_id: string
          provider?: string | null
          provider_customer_id?: string | null
          tax_id: string
          tax_id_kind: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string
          legal_name?: string
          payment_link_id?: string
          provider?: string | null
          provider_customer_id?: string | null
          tax_id?: string
          tax_id_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_link_buyers_payment_link_id_fkey"
            columns: ["payment_link_id"]
            isOneToOne: true
            referencedRelation: "payment_links"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_link_charges: {
        Row: {
          created_at: string
          id: string
          method: string
          payment_link_id: string
          provider: string
          provider_charge_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          method: string
          payment_link_id: string
          provider: string
          provider_charge_id: string
        }
        Update: {
          created_at?: string
          id?: string
          method?: string
          payment_link_id?: string
          provider?: string
          provider_charge_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_link_charges_payment_link_id_fkey"
            columns: ["payment_link_id"]
            isOneToOne: false
            referencedRelation: "payment_links"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_links: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string
          expires_at: string
          id: string
          manual_discount_by: string | null
          manual_discount_cents: number | null
          manual_discount_reason: string | null
          new_org_name: string | null
          organization_id: string | null
          package_features: Json
          package_limits: Json
          paid_at: string | null
          quote: Json
          revoked_at: string | null
          revoked_by: string | null
          revoked_reason: string | null
          target_kind: string
          token_hash: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by: string
          expires_at: string
          id?: string
          manual_discount_by?: string | null
          manual_discount_cents?: number | null
          manual_discount_reason?: string | null
          new_org_name?: string | null
          organization_id?: string | null
          package_features?: Json
          package_limits?: Json
          paid_at?: string | null
          quote: Json
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          target_kind: string
          token_hash: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string
          expires_at?: string
          id?: string
          manual_discount_by?: string | null
          manual_discount_cents?: number | null
          manual_discount_reason?: string | null
          new_org_name?: string | null
          organization_id?: string | null
          package_features?: Json
          package_limits?: Json
          paid_at?: string | null
          quote?: Json
          revoked_at?: string | null
          revoked_by?: string | null
          revoked_reason?: string | null
          target_kind?: string
          token_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_links_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_webhook_events: {
        Row: {
          error_message: string | null
          event_type: string
          id: string
          organization_id: string | null
          payload: Json
          processed_at: string | null
          provider: string
          provider_event_id: string
          provider_payment_id: string | null
          received_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          event_type: string
          id?: string
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id: string
          provider_payment_id?: string | null
          received_at?: string
          status?: string
        }
        Update: {
          error_message?: string | null
          event_type?: string
          id?: string
          organization_id?: string | null
          payload?: Json
          processed_at?: string | null
          provider?: string
          provider_event_id?: string
          provider_payment_id?: string | null
          received_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_ai_actions: {
        Row: {
          action_type: string
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          lead_id: string | null
          next_retry_at: string | null
          organization_id: string
          payload: Json
          processed_at: string | null
          retry_count: number
          status: string
          updated_at: string
        }
        Insert: {
          action_type: string
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          next_retry_at?: string | null
          organization_id: string
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          action_type?: string
          conversation_id?: string | null
          created_at?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          lead_id?: string | null
          next_retry_at?: string | null
          organization_id?: string
          payload?: Json
          processed_at?: string | null
          retry_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pending_copilot_deliveries: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          id: string
          instance_id: string
          last_error: string | null
          messages: Json
          organization_id: string
          phone_number: string
          status: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          instance_id: string
          last_error?: string | null
          messages: Json
          organization_id: string
          phone_number: string
          status?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          id?: string
          instance_id?: string
          last_error?: string | null
          messages?: Json
          organization_id?: string
          phone_number?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_copilot_deliveries_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_copilot_deliveries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pending_org_invites: {
        Row: {
          created_at: string | null
          created_by: string | null
          email: string
          id: string
          job_title: string | null
          metric_type: string | null
          organization_id: string
          role: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          email: string
          id?: string
          job_title?: string | null
          metric_type?: string | null
          organization_id: string
          role?: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          email?: string
          id?: string
          job_title?: string | null
          metric_type?: string | null
          organization_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_org_invites_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      permission_audit_log: {
        Row: {
          changed_by_role: string
          changed_by_user_id: string | null
          created_at: string
          id: string
          new_enabled: boolean | null
          old_enabled: boolean | null
          organization_id: string
          permission_key: string
          role: string | null
          table_name: string
        }
        Insert: {
          changed_by_role: string
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          new_enabled?: boolean | null
          old_enabled?: boolean | null
          organization_id: string
          permission_key: string
          role?: string | null
          table_name: string
        }
        Update: {
          changed_by_role?: string
          changed_by_user_id?: string | null
          created_at?: string
          id?: string
          new_enabled?: boolean | null
          old_enabled?: boolean | null
          organization_id?: string
          permission_key?: string
          role?: string | null
          table_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "permission_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      phone_ai_preferences: {
        Row: {
          ai_disabled: boolean
          created_at: string
          human_paused_until: string | null
          normalized_phone: string
          organization_id: string
          set_at: string
          set_by: string | null
          updated_at: string
        }
        Insert: {
          ai_disabled?: boolean
          created_at?: string
          human_paused_until?: string | null
          normalized_phone: string
          organization_id: string
          set_at?: string
          set_by?: string | null
          updated_at?: string
        }
        Update: {
          ai_disabled?: boolean
          created_at?: string
          human_paused_until?: string | null
          normalized_phone?: string
          organization_id?: string
          set_at?: string
          set_by?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "phone_ai_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_dispatch_rule_steps: {
        Row: {
          action_type: string
          delay_minutes: number
          id: string
          position: number
          rule_id: string
          sdr_assignment_mode: string | null
          target_sdr_id: string | null
          target_stage_id: string | null
          template_id: string | null
          timeout_action: string | null
          timeout_target_stage_id: string | null
          timeout_template_id: string | null
          wait_timeout_minutes: number | null
        }
        Insert: {
          action_type?: string
          delay_minutes?: number
          id?: string
          position?: number
          rule_id: string
          sdr_assignment_mode?: string | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_minutes?: number | null
        }
        Update: {
          action_type?: string
          delay_minutes?: number
          id?: string
          position?: number
          rule_id?: string
          sdr_assignment_mode?: string | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_minutes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipe_dispatch_rule_steps_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "pipe_dispatch_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_dispatch_rule_steps_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_dispatch_rule_steps_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_dispatch_rule_steps_timeout_target_stage_id_fkey"
            columns: ["timeout_target_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_dispatch_rule_steps_timeout_template_id_fkey"
            columns: ["timeout_template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_dispatch_rules: {
        Row: {
          created_at: string | null
          id: string
          is_active: boolean
          organization_id: string
          pipe_type: string
          pipeline_stage_id: string | null
          trigger_type: string
          updated_at: string | null
          whatsapp_instance_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          pipe_type: string
          pipeline_stage_id?: string | null
          trigger_type: string
          updated_at?: string | null
          whatsapp_instance_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          pipe_type?: string
          pipeline_stage_id?: string | null
          trigger_type?: string
          updated_at?: string | null
          whatsapp_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipe_dispatch_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_dispatch_rules_pipeline_stage_id_fkey"
            columns: ["pipeline_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_dispatch_rules_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_distribution_members: {
        Row: {
          created_at: string | null
          id: string
          role: string
          rule_id: string
          team_member_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          role?: string
          rule_id: string
          team_member_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          role?: string
          rule_id?: string
          team_member_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipe_distribution_members_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "pipe_distribution_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_distribution_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_distribution_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_distribution_rules: {
        Row: {
          closer_assigned_to: string | null
          closer_mode: string | null
          created_at: string | null
          id: string
          organization_id: string
          pipe_type: string
          sdr_assigned_to: string | null
          sdr_mode: string | null
          updated_at: string | null
        }
        Insert: {
          closer_assigned_to?: string | null
          closer_mode?: string | null
          created_at?: string | null
          id?: string
          organization_id: string
          pipe_type: string
          sdr_assigned_to?: string | null
          sdr_mode?: string | null
          updated_at?: string | null
        }
        Update: {
          closer_assigned_to?: string | null
          closer_mode?: string | null
          created_at?: string | null
          id?: string
          organization_id?: string
          pipe_type?: string
          sdr_assigned_to?: string | null
          sdr_mode?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipe_distribution_rules_closer_assigned_to_fkey"
            columns: ["closer_assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_distribution_rules_closer_assigned_to_fkey"
            columns: ["closer_assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_distribution_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_distribution_rules_sdr_assigned_to_fkey"
            columns: ["sdr_assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_distribution_rules_sdr_assigned_to_fkey"
            columns: ["sdr_assigned_to"]
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
          quantity: number
          sale_value: number | null
          unit_price: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          pipe_proposta_id: string
          product_id?: string | null
          quantity?: number
          sale_value?: number | null
          unit_price?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          pipe_proposta_id?: string
          product_id?: string | null
          quantity?: number
          sale_value?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "pipe_proposta_items_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_proposta_items_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_proposta_items_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipe_proposta_items_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
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
      pipeline_display_config: {
        Row: {
          created_at: string
          display_name: string
          id: string
          is_visible: boolean
          organization_id: string
          pipe_type: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          id?: string
          is_visible?: boolean
          organization_id: string
          pipe_type: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          id?: string
          is_visible?: boolean
          organization_id?: string
          pipe_type?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_display_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_entries: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string
          deal_id: string | null
          entered_at: string | null
          id: string
          lead_id: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string
          pipeline_id: string
          stage_changed_at: string | null
          stage_key: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          deal_id?: string | null
          entered_at?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id: string
          pipeline_id: string
          stage_changed_at?: string | null
          stage_key: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string
          deal_id?: string | null
          entered_at?: string | null
          id?: string
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string
          pipeline_id?: string
          stage_changed_at?: string | null
          stage_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_entries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_entries_revert_20260514: {
        Row: {
          assigned_to: string | null
          closed_at: string | null
          created_at: string | null
          deal_id: string | null
          entered_at: string | null
          id: string | null
          lead_id: string | null
          metadata: Json | null
          notes: string | null
          organization_id: string | null
          pipeline_id: string | null
          snapshot_at: string | null
          stage_changed_at: string | null
          stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          snapshot_at?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          assigned_to?: string | null
          closed_at?: string | null
          created_at?: string | null
          deal_id?: string | null
          entered_at?: string | null
          id?: string | null
          lead_id?: string | null
          metadata?: Json | null
          notes?: string | null
          organization_id?: string | null
          pipeline_id?: string | null
          snapshot_at?: string | null
          stage_changed_at?: string | null
          stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_stage_events: {
        Row: {
          actor: string | null
          created_at: string
          entry_id: string | null
          from_stage_key: string | null
          id: string
          lead_id: string
          occurred_at: string
          organization_id: string
          pipeline_id: string
          source: string
          to_stage_key: string
        }
        Insert: {
          actor?: string | null
          created_at?: string
          entry_id?: string | null
          from_stage_key?: string | null
          id?: string
          lead_id: string
          occurred_at?: string
          organization_id: string
          pipeline_id: string
          source?: string
          to_stage_key: string
        }
        Update: {
          actor?: string | null
          created_at?: string
          entry_id?: string | null
          from_stage_key?: string | null
          id?: string
          lead_id?: string
          occurred_at?: string
          organization_id?: string
          pipeline_id?: string
          source?: string
          to_stage_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stage_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stage_events_pipeline_id_fkey"
            columns: ["pipeline_id"]
            isOneToOne: false
            referencedRelation: "pipelines"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_stages: {
        Row: {
          auto_move_max_days: number | null
          auto_move_min_days: number | null
          checklist_template_id: string | null
          color: string | null
          created_at: string | null
          default_probability: number | null
          id: string
          is_active: boolean | null
          is_final_negative: boolean | null
          is_final_positive: boolean | null
          max_days_in_stage: number | null
          name: string
          organization_id: string | null
          pipeline_id: string | null
          pipeline_type: string
          position: number
          requires_sale_value: boolean
          sla_action: string | null
          sla_escalate_to: string | null
          sla_hours: number | null
          stage_key: string
          stage_role: Database["public"]["Enums"]["stage_role"]
          stage_role_reviewed_at: string | null
          stage_role_reviewed_by: string | null
          stage_role_suggested_at: string | null
          stage_role_suggestion_source: string | null
          suggested_stage_role: Database["public"]["Enums"]["stage_role"] | null
          target_pipe_type: string | null
          target_pipeline_id: string | null
          target_stage_id: string | null
          target_stage_key: string | null
          updated_at: string | null
        }
        Insert: {
          auto_move_max_days?: number | null
          auto_move_min_days?: number | null
          checklist_template_id?: string | null
          color?: string | null
          created_at?: string | null
          default_probability?: number | null
          id?: string
          is_active?: boolean | null
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          max_days_in_stage?: number | null
          name: string
          organization_id?: string | null
          pipeline_id?: string | null
          pipeline_type: string
          position?: number
          requires_sale_value?: boolean
          sla_action?: string | null
          sla_escalate_to?: string | null
          sla_hours?: number | null
          stage_key: string
          stage_role?: Database["public"]["Enums"]["stage_role"]
          stage_role_reviewed_at?: string | null
          stage_role_reviewed_by?: string | null
          stage_role_suggested_at?: string | null
          stage_role_suggestion_source?: string | null
          suggested_stage_role?:
            | Database["public"]["Enums"]["stage_role"]
            | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
          updated_at?: string | null
        }
        Update: {
          auto_move_max_days?: number | null
          auto_move_min_days?: number | null
          checklist_template_id?: string | null
          color?: string | null
          created_at?: string | null
          default_probability?: number | null
          id?: string
          is_active?: boolean | null
          is_final_negative?: boolean | null
          is_final_positive?: boolean | null
          max_days_in_stage?: number | null
          name?: string
          organization_id?: string | null
          pipeline_id?: string | null
          pipeline_type?: string
          position?: number
          requires_sale_value?: boolean
          sla_action?: string | null
          sla_escalate_to?: string | null
          sla_hours?: number | null
          stage_key?: string
          stage_role?: Database["public"]["Enums"]["stage_role"]
          stage_role_reviewed_at?: string | null
          stage_role_reviewed_by?: string | null
          stage_role_suggested_at?: string | null
          stage_role_suggestion_source?: string | null
          suggested_stage_role?:
            | Database["public"]["Enums"]["stage_role"]
            | null
          target_pipe_type?: string | null
          target_pipeline_id?: string | null
          target_stage_id?: string | null
          target_stage_key?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_stages_checklist_template_id_fkey"
            columns: ["checklist_template_id"]
            isOneToOne: false
            referencedRelation: "checklists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_target_pipeline_id_fkey"
            columns: ["target_pipeline_id"]
            isOneToOne: false
            referencedRelation: "custom_pipelines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_stages_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "custom_pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      pipelines: {
        Row: {
          color: string | null
          config: Json | null
          created_at: string
          created_by: string | null
          description: string | null
          display_order: number | null
          icon: string | null
          id: string
          is_active: boolean | null
          name: string
          organization_id: string
          slug: string
          type: string
          updated_at: string
        }
        Insert: {
          color?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          organization_id: string
          slug: string
          type?: string
          updated_at?: string
        }
        Update: {
          color?: string | null
          config?: Json | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          display_order?: number | null
          icon?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          organization_id?: string
          slug?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pipelines_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_addons: {
        Row: {
          applicable_plans: string[]
          created_at: string
          display_name: string
          features_unlocked: string[]
          id: string
          is_active: boolean
          price_monthly: number
          slug: string
          unit_label: string
        }
        Insert: {
          applicable_plans?: string[]
          created_at?: string
          display_name: string
          features_unlocked?: string[]
          id?: string
          is_active?: boolean
          price_monthly: number
          slug: string
          unit_label?: string
        }
        Update: {
          applicable_plans?: string[]
          created_at?: string
          display_name?: string
          features_unlocked?: string[]
          id?: string
          is_active?: boolean
          price_monthly?: number
          slug?: string
          unit_label?: string
        }
        Relationships: []
      }
      product_materials: {
        Row: {
          created_at: string | null
          description: string | null
          file_name: string
          file_path: string
          file_size: number | null
          id: string
          is_active: boolean | null
          material_type: string
          mime_type: string
          organization_id: string
          product_id: string
          summary: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          material_type?: string
          mime_type: string
          organization_id: string
          product_id: string
          summary?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number | null
          id?: string
          is_active?: boolean | null
          material_type?: string
          mime_type?: string
          organization_id?: string
          product_id?: string
          summary?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_materials_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_materials_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_variants: {
        Row: {
          color: string | null
          created_at: string
          custom_attributes: Json | null
          dimensions: string | null
          grammage: number | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          product_id: string
          size: string | null
          sku: string | null
          sort_order: number
          ticket: number | null
          ticket_minimo: number | null
          updated_at: string
          weight: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string
          custom_attributes?: Json | null
          dimensions?: string | null
          grammage?: number | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          product_id: string
          size?: string | null
          sku?: string | null
          sort_order?: number
          ticket?: number | null
          ticket_minimo?: number | null
          updated_at?: string
          weight?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string
          custom_attributes?: Json | null
          dimensions?: string | null
          grammage?: number | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          product_id?: string
          size?: string | null
          sku?: string | null
          sort_order?: number
          ticket?: number | null
          ticket_minimo?: number | null
          updated_at?: string
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_variants_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_variants_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          base_unit: string | null
          contrato_minimo_url: string | null
          contrato_padrao_url: string | null
          created_at: string
          description: string | null
          entregaveis: string | null
          external_id: string | null
          external_ref: string | null
          external_source: string | null
          has_variants: boolean
          id: string
          is_active: boolean
          links: string[] | null
          logo_url: string | null
          materiais: string | null
          name: string
          organization_id: string | null
          sku: string | null
          ticket: number | null
          ticket_minimo: number | null
          type: string
          updated_at: string
        }
        Insert: {
          base_unit?: string | null
          contrato_minimo_url?: string | null
          contrato_padrao_url?: string | null
          created_at?: string
          description?: string | null
          entregaveis?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_source?: string | null
          has_variants?: boolean
          id?: string
          is_active?: boolean
          links?: string[] | null
          logo_url?: string | null
          materiais?: string | null
          name: string
          organization_id?: string | null
          sku?: string | null
          ticket?: number | null
          ticket_minimo?: number | null
          type: string
          updated_at?: string
        }
        Update: {
          base_unit?: string | null
          contrato_minimo_url?: string | null
          contrato_padrao_url?: string | null
          created_at?: string
          description?: string | null
          entregaveis?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_source?: string | null
          has_variants?: boolean
          id?: string
          is_active?: boolean
          links?: string[] | null
          logo_url?: string | null
          materiais?: string | null
          name?: string
          organization_id?: string | null
          sku?: string | null
          ticket?: number | null
          ticket_minimo?: number | null
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          organization_id: string
          p256dh: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          organization_id: string
          p256dh: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          organization_id?: string
          p256dh?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quota_audit_log: {
        Row: {
          change_reason: string
          changed_by: string | null
          created_at: string
          field_changed: string
          id: string
          new_value: number
          old_value: number
          organization_id: string
          resource_key: string
        }
        Insert: {
          change_reason: string
          changed_by?: string | null
          created_at?: string
          field_changed: string
          id?: string
          new_value: number
          old_value: number
          organization_id: string
          resource_key: string
        }
        Update: {
          change_reason?: string
          changed_by?: string | null
          created_at?: string
          field_changed?: string
          id?: string
          new_value?: number
          old_value?: number
          organization_id?: string
          resource_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "quota_audit_log_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      quotes: {
        Row: {
          accepted_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          deal_id: string
          discount_percent: number
          id: string
          items: Json
          notes: string | null
          organization_id: string
          pdf_url: string | null
          rejected_at: string | null
          rejection_reason: string | null
          sent_at: string | null
          status: string
          subtotal: number
          tax_percent: number
          template_id: string | null
          terms: string | null
          title: string | null
          total: number
          updated_at: string
          valid_until: string | null
          version: number
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id: string
          discount_percent?: number
          id?: string
          items?: Json
          notes?: string | null
          organization_id: string
          pdf_url?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax_percent?: number
          template_id?: string | null
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          deal_id?: string
          discount_percent?: number
          id?: string
          items?: Json
          notes?: string | null
          organization_id?: string
          pdf_url?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          sent_at?: string | null
          status?: string
          subtotal?: number
          tax_percent?: number
          template_id?: string | null
          terms?: string | null
          title?: string | null
          total?: number
          updated_at?: string
          valid_until?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "quotes_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          id: string
          key: string
          max_requests: number
          request_count: number
          window_seconds: number
          window_start: string
        }
        Insert: {
          id?: string
          key: string
          max_requests?: number
          request_count?: number
          window_seconds?: number
          window_start: string
        }
        Update: {
          id?: string
          key?: string
          max_requests?: number
          request_count?: number
          window_seconds?: number
          window_start?: string
        }
        Relationships: []
      }
      recent_items: {
        Row: {
          entity_id: string
          entity_label: string | null
          entity_type: string
          id: string
          organization_id: string
          user_id: string
          viewed_at: string
        }
        Insert: {
          entity_id: string
          entity_label?: string | null
          entity_type: string
          id?: string
          organization_id: string
          user_id: string
          viewed_at?: string
        }
        Update: {
          entity_id?: string
          entity_label?: string | null
          entity_type?: string
          id?: string
          organization_id?: string
          user_id?: string
          viewed_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "recent_items_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      report_schedules: {
        Row: {
          created_at: string
          day_of_month: number | null
          day_of_week: number | null
          frequency: string
          hour: number
          id: string
          is_active: boolean
          last_sent_at: string | null
          next_run_at: string | null
          organization_id: string
          recipients: Json
          report_id: string
          timezone: string
        }
        Insert: {
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          frequency: string
          hour?: number
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          next_run_at?: string | null
          organization_id: string
          recipients?: Json
          report_id: string
          timezone?: string
        }
        Update: {
          created_at?: string
          day_of_month?: number | null
          day_of_week?: number | null
          frequency?: string
          hour?: number
          id?: string
          is_active?: boolean
          last_sent_at?: string | null
          next_run_at?: string | null
          organization_id?: string
          recipients?: Json
          report_id?: string
          timezone?: string
        }
        Relationships: [
          {
            foreignKeyName: "report_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "report_schedules_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          chart_type: string
          config: Json
          created_at: string
          date_range: Json | null
          description: string | null
          dimensions: Json | null
          entity_type: string
          filters: Json | null
          id: string
          is_favorite: boolean
          is_shared: boolean
          is_system: boolean
          metrics: Json | null
          name: string
          organization_id: string
          owner_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          chart_type?: string
          config?: Json
          created_at?: string
          date_range?: Json | null
          description?: string | null
          dimensions?: Json | null
          entity_type: string
          filters?: Json | null
          id?: string
          is_favorite?: boolean
          is_shared?: boolean
          is_system?: boolean
          metrics?: Json | null
          name: string
          organization_id: string
          owner_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          chart_type?: string
          config?: Json
          created_at?: string
          date_range?: Json | null
          description?: string | null
          dimensions?: Json | null
          entity_type?: string
          filters?: Json | null
          id?: string
          is_favorite?: boolean
          is_shared?: boolean
          is_system?: boolean
          metrics?: Json | null
          name?: string
          organization_id?: string
          owner_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_suggestions: {
        Row: {
          action_type: string
          client_id: string
          expires_at: string
          generated_at: string
          id: string
          message: string
          organization_id: string
          reasoning: string | null
        }
        Insert: {
          action_type: string
          client_id: string
          expires_at?: string
          generated_at?: string
          id?: string
          message: string
          organization_id: string
          reasoning?: string | null
        }
        Update: {
          action_type?: string
          client_id?: string
          expires_at?: string
          generated_at?: string
          id?: string
          message?: string
          organization_id?: string
          reasoning?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "retention_suggestions_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: true
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "retention_suggestions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      runtime_logs: {
        Row: {
          action: string
          actor_type: string | null
          completion_tokens: number | null
          created_at: string
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_message: string | null
          gestor_id: string | null
          id: string
          llm_model: string | null
          module: string
          organization_id: string | null
          payload_snapshot: Json | null
          prompt_tokens: number | null
          reasoning: string | null
          request_id: string | null
          session_id: string | null
          status: string
          triggered_by: string | null
        }
        Insert: {
          action: string
          actor_type?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          gestor_id?: string | null
          id?: string
          llm_model?: string | null
          module: string
          organization_id?: string | null
          payload_snapshot?: Json | null
          prompt_tokens?: number | null
          reasoning?: string | null
          request_id?: string | null
          session_id?: string | null
          status: string
          triggered_by?: string | null
        }
        Update: {
          action?: string
          actor_type?: string | null
          completion_tokens?: number | null
          created_at?: string
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_message?: string | null
          gestor_id?: string | null
          id?: string
          llm_model?: string | null
          module?: string
          organization_id?: string | null
          payload_snapshot?: Json | null
          prompt_tokens?: number | null
          reasoning?: string | null
          request_id?: string | null
          session_id?: string | null
          status?: string
          triggered_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "runtime_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_events: {
        Row: {
          actor: string | null
          created_at: string
          currency: string
          deal_id: string | null
          event_type: string
          id: string
          lead_id: string
          organization_id: string
          origin_record_id: string | null
          pipeline_id: string | null
          pre_sale_responsible_id: string | null
          producer: string
          revenue_stream: string
          reversed_event_id: string | null
          sale_responsible_id: string | null
          sale_value: number | null
          sold_at: string
          source: string
          stage_event_id: string | null
          stage_key: string | null
        }
        Insert: {
          actor?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          event_type: string
          id?: string
          lead_id: string
          organization_id: string
          origin_record_id?: string | null
          pipeline_id?: string | null
          pre_sale_responsible_id?: string | null
          producer?: string
          revenue_stream: string
          reversed_event_id?: string | null
          sale_responsible_id?: string | null
          sale_value?: number | null
          sold_at?: string
          source?: string
          stage_event_id?: string | null
          stage_key?: string | null
        }
        Update: {
          actor?: string | null
          created_at?: string
          currency?: string
          deal_id?: string | null
          event_type?: string
          id?: string
          lead_id?: string
          organization_id?: string
          origin_record_id?: string | null
          pipeline_id?: string | null
          pre_sale_responsible_id?: string | null
          producer?: string
          revenue_stream?: string
          reversed_event_id?: string | null
          sale_responsible_id?: string | null
          sale_value?: number | null
          sold_at?: string
          source?: string
          stage_event_id?: string | null
          stage_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_events_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_events_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_events_reversed_event_id_fkey"
            columns: ["reversed_event_id"]
            isOneToOne: false
            referencedRelation: "sale_events"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_views: {
        Row: {
          created_at: string
          entity_type: string
          filters: Json
          id: string
          is_shared: boolean
          is_system: boolean
          name: string
          organization_id: string
          owner_id: string
          position: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          entity_type: string
          filters?: Json
          id?: string
          is_shared?: boolean
          is_system?: boolean
          name: string
          organization_id: string
          owner_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          entity_type?: string
          filters?: Json
          id?: string
          is_shared?: boolean
          is_system?: boolean
          name?: string
          organization_id?: string
          owner_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_views_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_campaign_messages: {
        Row: {
          action_type: string
          campanha_id: string
          campanha_lead_id: string
          created_at: string | null
          error_message: string | null
          id: string
          lead_id: string
          rule_id: string
          scheduled_at: string
          sdr_assignment_mode: string | null
          sent_at: string | null
          status: string
          step_position: number | null
          target_sdr_id: string | null
          target_stage_id: string | null
          template_id: string | null
          timeout_action: string | null
          timeout_target_stage_id: string | null
          timeout_template_id: string | null
          wait_timeout_at: string | null
          waiting_since: string | null
          whatsapp_instance_id: string | null
        }
        Insert: {
          action_type?: string
          campanha_id: string
          campanha_lead_id: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id: string
          rule_id: string
          scheduled_at: string
          sdr_assignment_mode?: string | null
          sent_at?: string | null
          status?: string
          step_position?: number | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_at?: string | null
          waiting_since?: string | null
          whatsapp_instance_id?: string | null
        }
        Update: {
          action_type?: string
          campanha_id?: string
          campanha_lead_id?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string
          rule_id?: string
          scheduled_at?: string
          sdr_assignment_mode?: string | null
          sent_at?: string | null
          status?: string
          step_position?: number | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_at?: string | null
          waiting_since?: string | null
          whatsapp_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_campaign_messages_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_campanha_lead_id_fkey"
            columns: ["campanha_lead_id"]
            isOneToOne: false
            referencedRelation: "campanha_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "campanha_dispatch_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_timeout_target_stage_id_fkey"
            columns: ["timeout_target_stage_id"]
            isOneToOne: false
            referencedRelation: "campanha_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_timeout_template_id_fkey"
            columns: ["timeout_template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_campaign_messages_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_pipe_messages: {
        Row: {
          action_type: string
          created_at: string | null
          error_message: string | null
          id: string
          lead_id: string
          organization_id: string
          pipe_record_id: string
          pipe_type: string
          rule_id: string
          scheduled_at: string
          sdr_assignment_mode: string | null
          sent_at: string | null
          status: string
          step_position: number | null
          target_sdr_id: string | null
          target_stage_id: string | null
          template_id: string | null
          timeout_action: string | null
          timeout_target_stage_id: string | null
          timeout_template_id: string | null
          wait_timeout_at: string | null
          waiting_since: string | null
          whatsapp_instance_id: string | null
        }
        Insert: {
          action_type?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id: string
          organization_id: string
          pipe_record_id: string
          pipe_type: string
          rule_id: string
          scheduled_at: string
          sdr_assignment_mode?: string | null
          sent_at?: string | null
          status?: string
          step_position?: number | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_at?: string | null
          waiting_since?: string | null
          whatsapp_instance_id?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string
          organization_id?: string
          pipe_record_id?: string
          pipe_type?: string
          rule_id?: string
          scheduled_at?: string
          sdr_assignment_mode?: string | null
          sent_at?: string | null
          status?: string
          step_position?: number | null
          target_sdr_id?: string | null
          target_stage_id?: string | null
          template_id?: string | null
          timeout_action?: string | null
          timeout_target_stage_id?: string | null
          timeout_template_id?: string | null
          wait_timeout_at?: string | null
          waiting_since?: string | null
          whatsapp_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_pipe_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "pipe_dispatch_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_target_stage_id_fkey"
            columns: ["target_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_timeout_target_stage_id_fkey"
            columns: ["timeout_target_stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_timeout_template_id_fkey"
            columns: ["timeout_template_id"]
            isOneToOne: false
            referencedRelation: "campaign_templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_pipe_messages_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_user_messages: {
        Row: {
          assigned_to: string | null
          created_at: string
          created_by: string
          error_message: string | null
          id: string
          lead_id: string
          media_filename: string | null
          media_type: string | null
          media_url: string | null
          message_content: string | null
          organization_id: string
          phone_number: string
          retry_count: number
          scheduled_at: string
          sent_at: string | null
          status: string
          whatsapp_instance_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          created_by: string
          error_message?: string | null
          id?: string
          lead_id: string
          media_filename?: string | null
          media_type?: string | null
          media_url?: string | null
          message_content?: string | null
          organization_id: string
          phone_number: string
          retry_count?: number
          scheduled_at: string
          sent_at?: string | null
          status?: string
          whatsapp_instance_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          created_by?: string
          error_message?: string | null
          id?: string
          lead_id?: string
          media_filename?: string | null
          media_type?: string | null
          media_url?: string | null
          message_content?: string | null
          organization_id?: string
          phone_number?: string
          retry_count?: number
          scheduled_at?: string
          sent_at?: string | null
          status?: string
          whatsapp_instance_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_user_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_user_messages_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      send_dedup_log: {
        Row: {
          content_hash: string
          expires_at: string
          hit_count: number
          id: string
          idempotency_key: string | null
          org_id: string
          phone: string
          reserved_at: string
          source: string
        }
        Insert: {
          content_hash: string
          expires_at: string
          hit_count?: number
          id?: string
          idempotency_key?: string | null
          org_id: string
          phone: string
          reserved_at?: string
          source: string
        }
        Update: {
          content_hash?: string
          expires_at?: string
          hit_count?: number
          id?: string
          idempotency_key?: string | null
          org_id?: string
          phone?: string
          reserved_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "send_dedup_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sla_configs: {
        Row: {
          created_at: string
          escalation_action: string
          escalation_target_user: string | null
          id: string
          is_active: boolean
          max_hours: number
          organization_id: string
          pipeline_type: string
          stage_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          escalation_action?: string
          escalation_target_user?: string | null
          id?: string
          is_active?: boolean
          max_hours: number
          organization_id: string
          pipeline_type: string
          stage_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          escalation_action?: string
          escalation_target_user?: string | null
          id?: string
          is_active?: boolean
          max_hours?: number
          organization_id?: string
          pipeline_type?: string
          stage_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sla_configs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sla_configs_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "pipeline_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_messages: {
        Row: {
          body: string
          contact_id: string | null
          created_at: string
          delivered_at: string | null
          direction: string
          error_message: string | null
          from_number: string
          id: string
          lead_id: string | null
          organization_id: string
          provider_message_id: string | null
          sent_at: string
          sent_by: string | null
          status: string
          template_id: string | null
          to_number: string
        }
        Insert: {
          body: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction: string
          error_message?: string | null
          from_number: string
          id?: string
          lead_id?: string | null
          organization_id: string
          provider_message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          template_id?: string | null
          to_number: string
        }
        Update: {
          body?: string
          contact_id?: string | null
          created_at?: string
          delivered_at?: string | null
          direction?: string
          error_message?: string | null
          from_number?: string
          id?: string
          lead_id?: string | null
          organization_id?: string
          provider_message_id?: string | null
          sent_at?: string
          sent_by?: string | null
          status?: string
          template_id?: string | null
          to_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sms_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_provider_config: {
        Row: {
          account_sid: string | null
          auth_token: string | null
          created_at: string
          from_number: string | null
          id: string
          is_active: boolean
          organization_id: string
          provider: string
          updated_at: string
        }
        Insert: {
          account_sid?: string | null
          auth_token?: string | null
          created_at?: string
          from_number?: string | null
          id?: string
          is_active?: boolean
          organization_id: string
          provider: string
          updated_at?: string
        }
        Update: {
          account_sid?: string | null
          auth_token?: string | null
          created_at?: string
          from_number?: string | null
          id?: string
          is_active?: boolean
          organization_id?: string
          provider?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sms_provider_config_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_templates: {
        Row: {
          body: string
          category: string | null
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean
          name: string
          organization_id: string
          updated_at: string
          variables: Json | null
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          updated_at?: string
          variables?: Json | null
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          updated_at?: string
          variables?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "sms_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          base_price_monthly: number | null
          created_at: string | null
          description: string | null
          discount_annual_pct: number | null
          discount_semester_pct: number | null
          discount_volume_min: number | null
          discount_volume_pct: number | null
          display_name: string
          extra_user_price: number | null
          features: Json
          id: string
          included_copilots: number | null
          included_users: number | null
          is_active: boolean | null
          is_default: boolean | null
          limits: Json
          min_users: number | null
          name: string
          position: number | null
          price_monthly: number | null
          price_per_user_monthly: number | null
          price_yearly: number | null
          updated_at: string | null
        }
        Insert: {
          base_price_monthly?: number | null
          created_at?: string | null
          description?: string | null
          discount_annual_pct?: number | null
          discount_semester_pct?: number | null
          discount_volume_min?: number | null
          discount_volume_pct?: number | null
          display_name: string
          extra_user_price?: number | null
          features?: Json
          id?: string
          included_copilots?: number | null
          included_users?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          limits?: Json
          min_users?: number | null
          name: string
          position?: number | null
          price_monthly?: number | null
          price_per_user_monthly?: number | null
          price_yearly?: number | null
          updated_at?: string | null
        }
        Update: {
          base_price_monthly?: number | null
          created_at?: string | null
          description?: string | null
          discount_annual_pct?: number | null
          discount_semester_pct?: number | null
          discount_volume_min?: number | null
          discount_volume_pct?: number | null
          display_name?: string
          extra_user_price?: number | null
          features?: Json
          id?: string
          included_copilots?: number | null
          included_users?: number | null
          is_active?: boolean | null
          is_default?: boolean | null
          limits?: Json
          min_users?: number | null
          name?: string
          position?: number | null
          price_monthly?: number | null
          price_per_user_monthly?: number | null
          price_yearly?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      subscription_provisionings: {
        Row: {
          activated_until: string | null
          blocked_at: string | null
          blocked_code: string | null
          id: string
          organization_id: string | null
          plan_name: string | null
          provider_payment_id: string
          provisioned_at: string
          status: string
          target_kind: string
        }
        Insert: {
          activated_until?: string | null
          blocked_at?: string | null
          blocked_code?: string | null
          id?: string
          organization_id?: string | null
          plan_name?: string | null
          provider_payment_id: string
          provisioned_at?: string
          status?: string
          target_kind?: string
        }
        Update: {
          activated_until?: string | null
          blocked_at?: string | null
          blocked_code?: string | null
          id?: string
          organization_id?: string | null
          plan_name?: string | null
          provider_payment_id?: string
          provisioned_at?: string
          status?: string
          target_kind?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_provisionings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_attachments: {
        Row: {
          author_user_id: string | null
          comment_id: string | null
          created_at: string
          filename: string
          id: string
          is_internal: boolean
          mime: string
          path: string
          purged_at: string | null
          size_bytes: number
          ticket_id: string
        }
        Insert: {
          author_user_id?: string | null
          comment_id?: string | null
          created_at?: string
          filename: string
          id?: string
          is_internal?: boolean
          mime: string
          path: string
          purged_at?: string | null
          size_bytes: number
          ticket_id: string
        }
        Update: {
          author_user_id?: string | null
          comment_id?: string | null
          created_at?: string
          filename?: string
          id?: string
          is_internal?: boolean
          mime?: string
          path?: string
          purged_at?: string | null
          size_bytes?: number
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_attachments_comment_id_fkey"
            columns: ["comment_id"]
            isOneToOne: false
            referencedRelation: "support_ticket_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_ticket_attachments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_ticket_comments: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          from_staff: boolean
          id: string
          is_internal: boolean
          ticket_id: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          from_staff?: boolean
          id?: string
          is_internal?: boolean
          ticket_id: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          from_staff?: boolean
          id?: string
          is_internal?: boolean
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_ticket_comments_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: false
            referencedRelation: "support_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_master_user_id: string | null
          author_gestor_id: string | null
          author_user_id: string | null
          awaiting_customer_ms: number
          awaiting_since: string | null
          closed_at: string | null
          created_at: string
          defect_url: string | null
          description: string | null
          first_response_at: string | null
          id: string
          impacto: Database["public"]["Enums"]["support_ticket_impacto"]
          organization_id: string
          reopen_count: number
          resolved_at: string | null
          severidade:
            | Database["public"]["Enums"]["support_ticket_severidade"]
            | null
          status: Database["public"]["Enums"]["support_ticket_status"]
          support_context: Json
          tipo: Database["public"]["Enums"]["support_ticket_tipo"]
          title: string
          updated_at: string
        }
        Insert: {
          assigned_master_user_id?: string | null
          author_gestor_id?: string | null
          author_user_id?: string | null
          awaiting_customer_ms?: number
          awaiting_since?: string | null
          closed_at?: string | null
          created_at?: string
          defect_url?: string | null
          description?: string | null
          first_response_at?: string | null
          id?: string
          impacto: Database["public"]["Enums"]["support_ticket_impacto"]
          organization_id: string
          reopen_count?: number
          resolved_at?: string | null
          severidade?:
            | Database["public"]["Enums"]["support_ticket_severidade"]
            | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          support_context?: Json
          tipo: Database["public"]["Enums"]["support_ticket_tipo"]
          title: string
          updated_at?: string
        }
        Update: {
          assigned_master_user_id?: string | null
          author_gestor_id?: string | null
          author_user_id?: string | null
          awaiting_customer_ms?: number
          awaiting_since?: string | null
          closed_at?: string | null
          created_at?: string
          defect_url?: string | null
          description?: string | null
          first_response_at?: string | null
          id?: string
          impacto?: Database["public"]["Enums"]["support_ticket_impacto"]
          organization_id?: string
          reopen_count?: number
          resolved_at?: string | null
          severidade?:
            | Database["public"]["Enums"]["support_ticket_severidade"]
            | null
          status?: Database["public"]["Enums"]["support_ticket_status"]
          support_context?: Json
          tipo?: Database["public"]["Enums"]["support_ticket_tipo"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_master_user_id_fkey"
            columns: ["assigned_master_user_id"]
            isOneToOne: false
            referencedRelation: "master_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_author_gestor_id_fkey"
            columns: ["author_gestor_id"]
            isOneToOne: false
            referencedRelation: "gestores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "support_tickets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      system_alerts: {
        Row: {
          category: string
          created_at: string
          id: string
          message: string
          metadata: Json
          organization_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          source_id: string | null
          source_type: string | null
          title: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json
          organization_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity: string
          source_id?: string | null
          source_type?: string | null
          title: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json
          organization_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          source_id?: string | null
          source_type?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "system_alerts_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          organization_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          organization_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          avatar_url: string | null
          commission_mrr_percent: number | null
          commission_projeto_percent: number | null
          created_at: string
          email: string | null
          id: string
          is_active: boolean
          job_title: string | null
          metric_type: string | null
          name: string
          organization_id: string | null
          ote_base: number | null
          ote_bonus: number | null
          phone: string | null
          preferred_whatsapp_instance_id: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          commission_mrr_percent?: number | null
          commission_projeto_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          metric_type?: string | null
          name: string
          organization_id?: string | null
          ote_base?: number | null
          ote_bonus?: number | null
          phone?: string | null
          preferred_whatsapp_instance_id?: string | null
          role: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          commission_mrr_percent?: number | null
          commission_projeto_percent?: number | null
          created_at?: string
          email?: string | null
          id?: string
          is_active?: boolean
          job_title?: string | null
          metric_type?: string | null
          name?: string
          organization_id?: string | null
          ote_base?: number | null
          ote_bonus?: number | null
          phone?: string | null
          preferred_whatsapp_instance_id?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_preferred_whatsapp_instance_id_fkey"
            columns: ["preferred_whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      tinyerp_connections: {
        Row: {
          auto_push_orders: boolean | null
          auto_sync_products: boolean | null
          connected_at: string | null
          contact_sync_mode: string
          created_at: string | null
          encrypted_api_token: string
          encryption_key_id: string
          encryption_nonce: string
          id: string
          last_contact_sync_at: string | null
          last_error: string | null
          last_order_pull_at: string | null
          last_order_push_at: string | null
          last_product_sync_at: string | null
          order_pull_cursor: number | null
          organization_id: string
          status: string
          sync_contacts: boolean | null
          tiny_account_name: string | null
          tiny_cnpj: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          auto_push_orders?: boolean | null
          auto_sync_products?: boolean | null
          connected_at?: string | null
          contact_sync_mode?: string
          created_at?: string | null
          encrypted_api_token: string
          encryption_key_id?: string
          encryption_nonce: string
          id?: string
          last_contact_sync_at?: string | null
          last_error?: string | null
          last_order_pull_at?: string | null
          last_order_push_at?: string | null
          last_product_sync_at?: string | null
          order_pull_cursor?: number | null
          organization_id: string
          status?: string
          sync_contacts?: boolean | null
          tiny_account_name?: string | null
          tiny_cnpj?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          auto_push_orders?: boolean | null
          auto_sync_products?: boolean | null
          connected_at?: string | null
          contact_sync_mode?: string
          created_at?: string | null
          encrypted_api_token?: string
          encryption_key_id?: string
          encryption_nonce?: string
          id?: string
          last_contact_sync_at?: string | null
          last_error?: string | null
          last_order_pull_at?: string | null
          last_order_push_at?: string | null
          last_product_sync_at?: string | null
          order_pull_cursor?: number | null
          organization_id?: string
          status?: string
          sync_contacts?: boolean | null
          tiny_account_name?: string | null
          tiny_cnpj?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tinyerp_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      tinyerp_order_mappings: {
        Row: {
          id: string
          last_synced_at: string | null
          nfe_chave: string | null
          nfe_link: string | null
          nfe_numero: string | null
          nfe_status: string | null
          nfe_updated_at: string | null
          organization_id: string
          pipe_proposta_id: string | null
          tiny_nfe_id: string | null
          tiny_nfe_status: string | null
          tiny_order_id: string
          tiny_order_number: string | null
          upsell_order_id: string | null
        }
        Insert: {
          id?: string
          last_synced_at?: string | null
          nfe_chave?: string | null
          nfe_link?: string | null
          nfe_numero?: string | null
          nfe_status?: string | null
          nfe_updated_at?: string | null
          organization_id: string
          pipe_proposta_id?: string | null
          tiny_nfe_id?: string | null
          tiny_nfe_status?: string | null
          tiny_order_id: string
          tiny_order_number?: string | null
          upsell_order_id?: string | null
        }
        Update: {
          id?: string
          last_synced_at?: string | null
          nfe_chave?: string | null
          nfe_link?: string | null
          nfe_numero?: string | null
          nfe_status?: string | null
          nfe_updated_at?: string | null
          organization_id?: string
          pipe_proposta_id?: string | null
          tiny_nfe_id?: string | null
          tiny_nfe_status?: string | null
          tiny_order_id?: string
          tiny_order_number?: string | null
          upsell_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tinyerp_order_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tinyerp_order_mappings_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tinyerp_order_mappings_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tinyerp_order_mappings_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tinyerp_order_mappings_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tinyerp_order_mappings_upsell_order_id_fkey"
            columns: ["upsell_order_id"]
            isOneToOne: false
            referencedRelation: "upsell_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      tinyerp_product_mappings: {
        Row: {
          id: string
          last_synced_at: string | null
          organization_id: string
          product_id: string
          sync_direction: string | null
          tiny_product_id: string
          tiny_sku: string | null
        }
        Insert: {
          id?: string
          last_synced_at?: string | null
          organization_id: string
          product_id: string
          sync_direction?: string | null
          tiny_product_id: string
          tiny_sku?: string | null
        }
        Update: {
          id?: string
          last_synced_at?: string | null
          organization_id?: string
          product_id?: string
          sync_direction?: string | null
          tiny_product_id?: string
          tiny_sku?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tinyerp_product_mappings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tinyerp_product_mappings_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      tinyerp_sync_logs: {
        Row: {
          created_at: string | null
          error_message: string | null
          id: string
          initiated_by: string
          items_created: number | null
          items_failed: number | null
          items_processed: number | null
          items_updated: number | null
          local_reference_id: string | null
          local_reference_type: string | null
          operation: string
          organization_id: string
          request_payload: Json | null
          response_payload: Json | null
          status: string
          tiny_reference_id: string | null
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          initiated_by?: string
          items_created?: number | null
          items_failed?: number | null
          items_processed?: number | null
          items_updated?: number | null
          local_reference_id?: string | null
          local_reference_type?: string | null
          operation: string
          organization_id: string
          request_payload?: Json | null
          response_payload?: Json | null
          status: string
          tiny_reference_id?: string | null
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          id?: string
          initiated_by?: string
          items_created?: number | null
          items_failed?: number | null
          items_processed?: number | null
          items_updated?: number | null
          local_reference_id?: string | null
          local_reference_type?: string | null
          operation?: string
          organization_id?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
          tiny_reference_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tinyerp_sync_logs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      titulos_receber: {
        Row: {
          client_id: string | null
          created_at: string
          external_id: string
          external_ref: string | null
          external_source: string
          id: string
          order_id: string | null
          organization_id: string
          pago_em: string | null
          status: string
          updated_at: string
          valor: number | null
          vencimento: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          external_id: string
          external_ref?: string | null
          external_source: string
          id?: string
          order_id?: string | null
          organization_id: string
          pago_em?: string | null
          status?: string
          updated_at?: string
          valor?: number | null
          vencimento?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          external_id?: string
          external_ref?: string | null
          external_source?: string
          id?: string
          order_id?: string | null
          organization_id?: string
          pago_em?: string | null
          status?: string
          updated_at?: string
          valor?: number | null
          vencimento?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "titulos_receber_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_receber_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "upsell_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "titulos_receber_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      toth_connection_secrets: {
        Row: {
          connection_id: string
          created_at: string
          encryption_key_id: string
          flow_client_id_ciphertext: string | null
          flow_client_id_nonce: string | null
          flow_client_secret_ciphertext: string | null
          flow_client_secret_nonce: string | null
          organization_id: string
          password_ciphertext: string
          password_nonce: string
          updated_at: string
          user_ciphertext: string
          user_nonce: string
        }
        Insert: {
          connection_id: string
          created_at?: string
          encryption_key_id?: string
          flow_client_id_ciphertext?: string | null
          flow_client_id_nonce?: string | null
          flow_client_secret_ciphertext?: string | null
          flow_client_secret_nonce?: string | null
          organization_id: string
          password_ciphertext: string
          password_nonce: string
          updated_at?: string
          user_ciphertext: string
          user_nonce: string
        }
        Update: {
          connection_id?: string
          created_at?: string
          encryption_key_id?: string
          flow_client_id_ciphertext?: string | null
          flow_client_id_nonce?: string | null
          flow_client_secret_ciphertext?: string | null
          flow_client_secret_nonce?: string | null
          organization_id?: string
          password_ciphertext?: string
          password_nonce?: string
          updated_at?: string
          user_ciphertext?: string
          user_nonce?: string
        }
        Relationships: [
          {
            foreignKeyName: "toth_connection_secrets_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: true
            referencedRelation: "toth_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "toth_connection_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      toth_connections: {
        Row: {
          allow_insecure_transport: boolean
          base_url: string
          clientes_cursor: number | null
          clientes_dias_compras: number | null
          clientes_empresa: string | null
          clientes_incluir_sem_empresa: boolean
          clientes_marcas: string | null
          clientes_somente_com_compra: boolean
          cobrancas_cursor: string | null
          connected_at: string | null
          created_at: string
          erp_sync_mode: string
          flow_base_url: string | null
          id: string
          last_clientes_sync_at: string | null
          last_cobrancas_sync_at: string | null
          last_error: string | null
          last_pedidos_sync_at: string | null
          organization_id: string
          pedidos_cursor: number | null
          pedidos_data_inicial: string | null
          pedidos_janela_dias: number | null
          status: string
          token_transport: string
          updated_at: string
          user_id: string
        }
        Insert: {
          allow_insecure_transport?: boolean
          base_url: string
          clientes_cursor?: number | null
          clientes_dias_compras?: number | null
          clientes_empresa?: string | null
          clientes_incluir_sem_empresa?: boolean
          clientes_marcas?: string | null
          clientes_somente_com_compra?: boolean
          cobrancas_cursor?: string | null
          connected_at?: string | null
          created_at?: string
          erp_sync_mode?: string
          flow_base_url?: string | null
          id?: string
          last_clientes_sync_at?: string | null
          last_cobrancas_sync_at?: string | null
          last_error?: string | null
          last_pedidos_sync_at?: string | null
          organization_id: string
          pedidos_cursor?: number | null
          pedidos_data_inicial?: string | null
          pedidos_janela_dias?: number | null
          status?: string
          token_transport?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          allow_insecure_transport?: boolean
          base_url?: string
          clientes_cursor?: number | null
          clientes_dias_compras?: number | null
          clientes_empresa?: string | null
          clientes_incluir_sem_empresa?: boolean
          clientes_marcas?: string | null
          clientes_somente_com_compra?: boolean
          cobrancas_cursor?: string | null
          connected_at?: string | null
          created_at?: string
          erp_sync_mode?: string
          flow_base_url?: string | null
          id?: string
          last_clientes_sync_at?: string | null
          last_cobrancas_sync_at?: string | null
          last_error?: string | null
          last_pedidos_sync_at?: string | null
          organization_id?: string
          pedidos_cursor?: number | null
          pedidos_data_inicial?: string | null
          pedidos_janela_dias?: number | null
          status?: string
          token_transport?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "toth_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      uazapi_sender_jobs: {
        Row: {
          campaign_id: string | null
          created_at: string
          failed: number
          id: string
          instance_id: string
          organization_id: string
          payload: Json
          sent: number
          status: string
          total_messages: number
          triggered_by_user_id: string | null
          triggered_via: string
          uazapi_sender_id: string | null
          updated_at: string
        }
        Insert: {
          campaign_id?: string | null
          created_at?: string
          failed?: number
          id?: string
          instance_id: string
          organization_id: string
          payload?: Json
          sent?: number
          status?: string
          total_messages?: number
          triggered_by_user_id?: string | null
          triggered_via?: string
          uazapi_sender_id?: string | null
          updated_at?: string
        }
        Update: {
          campaign_id?: string | null
          created_at?: string
          failed?: number
          id?: string
          instance_id?: string
          organization_id?: string
          payload?: Json
          sent?: number
          status?: string
          total_messages?: number
          triggered_by_user_id?: string | null
          triggered_via?: string
          uazapi_sender_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "uazapi_sender_jobs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uazapi_sender_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uazapi_sender_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "uazapi_sender_jobs_triggered_by_user_id_fkey"
            columns: ["triggered_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_campanhas: {
        Row: {
          client_id: string
          closer_id: string | null
          created_at: string
          data_abordagem: string | null
          data_venda: string | null
          id: string
          mrr_planejado: number | null
          notes: string | null
          organization_id: string
          pre_sale_responsible_id: string | null
          projeto_planejado: number | null
          responsible_id: string | null
          sale_responsible_id: string | null
          status: Database["public"]["Enums"]["upsell_campanha_status"]
          updated_at: string
        }
        Insert: {
          client_id: string
          closer_id?: string | null
          created_at?: string
          data_abordagem?: string | null
          data_venda?: string | null
          id?: string
          mrr_planejado?: number | null
          notes?: string | null
          organization_id: string
          pre_sale_responsible_id?: string | null
          projeto_planejado?: number | null
          responsible_id?: string | null
          sale_responsible_id?: string | null
          status?: Database["public"]["Enums"]["upsell_campanha_status"]
          updated_at?: string
        }
        Update: {
          client_id?: string
          closer_id?: string | null
          created_at?: string
          data_abordagem?: string | null
          data_venda?: string | null
          id?: string
          mrr_planejado?: number | null
          notes?: string | null
          organization_id?: string
          pre_sale_responsible_id?: string | null
          projeto_planejado?: number | null
          responsible_id?: string | null
          sale_responsible_id?: string | null
          status?: Database["public"]["Enums"]["upsell_campanha_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_campanhas_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_campanhas_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_client_products: {
        Row: {
          cancelled_at: string | null
          client_id: string
          contract_duration: number | null
          created_at: string
          id: string
          product_id: string | null
          product_name: string
          product_type: string
          sale_value: number
          started_at: string
          status: string
        }
        Insert: {
          cancelled_at?: string | null
          client_id: string
          contract_duration?: number | null
          created_at?: string
          id?: string
          product_id?: string | null
          product_name: string
          product_type: string
          sale_value: number
          started_at?: string
          status?: string
        }
        Update: {
          cancelled_at?: string | null
          client_id?: string
          contract_duration?: number | null
          created_at?: string
          id?: string
          product_id?: string | null
          product_name?: string
          product_type?: string
          sale_value?: number
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_client_products_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_client_products_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_clients: {
        Row: {
          avg_ticket: number | null
          churn_probability: number | null
          churned_at: string | null
          closer_id: string | null
          cnpj: string | null
          company: string | null
          company_id: string | null
          created_at: string
          days_since_last_order: number | null
          email: string | null
          erp_city: string | null
          erp_company: string | null
          erp_last_order_at: string | null
          erp_metadata: Json | null
          erp_owner_external_id: string | null
          erp_owner_name: string | null
          erp_registered_at: string | null
          erp_segment: string | null
          erp_status: string | null
          erp_uf: string | null
          external_id: string | null
          external_ref: string | null
          external_source: string | null
          first_sale_at: string
          gestao_manual_override: boolean
          gestao_stage: string | null
          health_score: number | null
          health_status: string | null
          health_updated_at: string | null
          id: string
          is_active: boolean
          last_order_at: string | null
          lead_id: string
          lifetime_value: number | null
          name: string
          next_order_expected: string | null
          order_count: number | null
          organization_id: string
          phone: string | null
          potencial: Database["public"]["Enums"]["upsell_potencial"]
          pre_sale_responsible_id: string | null
          reactivated_at: string | null
          reorder_cycle_days: number | null
          responsible_id: string | null
          sale_responsible_id: string | null
          segment: string | null
          tiny_contact_id: string | null
          tiny_synced_at: string | null
          tipo_cliente_tempo: string
          trend: string | null
          updated_at: string
        }
        Insert: {
          avg_ticket?: number | null
          churn_probability?: number | null
          churned_at?: string | null
          closer_id?: string | null
          cnpj?: string | null
          company?: string | null
          company_id?: string | null
          created_at?: string
          days_since_last_order?: number | null
          email?: string | null
          erp_city?: string | null
          erp_company?: string | null
          erp_last_order_at?: string | null
          erp_metadata?: Json | null
          erp_owner_external_id?: string | null
          erp_owner_name?: string | null
          erp_registered_at?: string | null
          erp_segment?: string | null
          erp_status?: string | null
          erp_uf?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_source?: string | null
          first_sale_at?: string
          gestao_manual_override?: boolean
          gestao_stage?: string | null
          health_score?: number | null
          health_status?: string | null
          health_updated_at?: string | null
          id?: string
          is_active?: boolean
          last_order_at?: string | null
          lead_id: string
          lifetime_value?: number | null
          name: string
          next_order_expected?: string | null
          order_count?: number | null
          organization_id: string
          phone?: string | null
          potencial?: Database["public"]["Enums"]["upsell_potencial"]
          pre_sale_responsible_id?: string | null
          reactivated_at?: string | null
          reorder_cycle_days?: number | null
          responsible_id?: string | null
          sale_responsible_id?: string | null
          segment?: string | null
          tiny_contact_id?: string | null
          tiny_synced_at?: string | null
          tipo_cliente_tempo?: string
          trend?: string | null
          updated_at?: string
        }
        Update: {
          avg_ticket?: number | null
          churn_probability?: number | null
          churned_at?: string | null
          closer_id?: string | null
          cnpj?: string | null
          company?: string | null
          company_id?: string | null
          created_at?: string
          days_since_last_order?: number | null
          email?: string | null
          erp_city?: string | null
          erp_company?: string | null
          erp_last_order_at?: string | null
          erp_metadata?: Json | null
          erp_owner_external_id?: string | null
          erp_owner_name?: string | null
          erp_registered_at?: string | null
          erp_segment?: string | null
          erp_status?: string | null
          erp_uf?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_source?: string | null
          first_sale_at?: string
          gestao_manual_override?: boolean
          gestao_stage?: string | null
          health_score?: number | null
          health_status?: string | null
          health_updated_at?: string | null
          id?: string
          is_active?: boolean
          last_order_at?: string | null
          lead_id?: string
          lifetime_value?: number | null
          name?: string
          next_order_expected?: string | null
          order_count?: number | null
          organization_id?: string
          phone?: string | null
          potencial?: Database["public"]["Enums"]["upsell_potencial"]
          pre_sale_responsible_id?: string | null
          reactivated_at?: string | null
          reorder_cycle_days?: number | null
          responsible_id?: string | null
          sale_responsible_id?: string | null
          segment?: string | null
          tiny_contact_id?: string | null
          tiny_synced_at?: string | null
          tipo_cliente_tempo?: string
          trend?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_clients_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_gestao_rules: {
        Row: {
          base_stage_key: string
          created_at: string
          gestao_from_stage: string
          gestao_to_stage: string
          id: string
          is_active: boolean
          organization_id: string
          position: number
          updated_at: string
        }
        Insert: {
          base_stage_key: string
          created_at?: string
          gestao_from_stage: string
          gestao_to_stage: string
          id?: string
          is_active?: boolean
          organization_id: string
          position?: number
          updated_at?: string
        }
        Update: {
          base_stage_key?: string
          created_at?: string
          gestao_from_stage?: string
          gestao_to_stage?: string
          id?: string
          is_active?: boolean
          organization_id?: string
          position?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "upsell_gestao_rules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      upsell_orders: {
        Row: {
          approval_comment: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          campanha_id: string | null
          client_id: string
          closer_id: string | null
          created_at: string
          erp_status: string | null
          external_id: string | null
          external_ref: string | null
          external_source: string | null
          id: string
          notes: string | null
          organization_id: string
          origin: string
          pipe_proposta_id: string | null
          pre_sale_responsible_id: string | null
          product_id: string | null
          product_name: string
          product_type: string
          responsible_id: string | null
          sale_responsible_id: string | null
          sale_value: number
          sold_at: string
          source: string | null
          tiny_order_id: string | null
        }
        Insert: {
          approval_comment?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          campanha_id?: string | null
          client_id: string
          closer_id?: string | null
          created_at?: string
          erp_status?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_source?: string | null
          id?: string
          notes?: string | null
          organization_id: string
          origin?: string
          pipe_proposta_id?: string | null
          pre_sale_responsible_id?: string | null
          product_id?: string | null
          product_name: string
          product_type: string
          responsible_id?: string | null
          sale_responsible_id?: string | null
          sale_value: number
          sold_at?: string
          source?: string | null
          tiny_order_id?: string | null
        }
        Update: {
          approval_comment?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          campanha_id?: string | null
          client_id?: string
          closer_id?: string | null
          created_at?: string
          erp_status?: string | null
          external_id?: string | null
          external_ref?: string | null
          external_source?: string | null
          id?: string
          notes?: string | null
          organization_id?: string
          origin?: string
          pipe_proposta_id?: string | null
          pre_sale_responsible_id?: string | null
          product_id?: string | null
          product_name?: string
          product_type?: string
          responsible_id?: string | null
          sale_responsible_id?: string | null
          sale_value?: number
          sold_at?: string
          source?: string | null
          tiny_order_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "upsell_orders_campanha_id_fkey"
            columns: ["campanha_id"]
            isOneToOne: false
            referencedRelation: "upsell_campanhas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "upsell_clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_pipeline_entry_id_fkey"
            columns: ["pipe_proposta_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_orders_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_events: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          event_type: string
          id: string
          metadata: Json | null
          organization_id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type: string
          id?: string
          metadata?: Json | null
          organization_id: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          event_type?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_badges: {
        Row: {
          badge_id: string
          id: string
          team_member_id: string
          unlocked_at: string
        }
        Insert: {
          badge_id: string
          id?: string
          team_member_id: string
          unlocked_at?: string
        }
        Update: {
          badge_id?: string
          id?: string
          team_member_id?: string
          unlocked_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_badges_badge_id_fkey"
            columns: ["badge_id"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_badges_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          last_seen_at: string
          organization_id: string
          user_id: string
        }
        Insert: {
          last_seen_at?: string
          organization_id: string
          user_id: string
        }
        Update: {
          last_seen_at?: string
          organization_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
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
      voip_call_usage: {
        Row: {
          calls_authorized: number
          calls_connected: number
          last_authorized_at: string | null
          organization_id: string
          updated_at: string
          usage_date: string
          whatsapp_instance_id: string
        }
        Insert: {
          calls_authorized?: number
          calls_connected?: number
          last_authorized_at?: string | null
          organization_id: string
          updated_at?: string
          usage_date: string
          whatsapp_instance_id: string
        }
        Update: {
          calls_authorized?: number
          calls_connected?: number
          last_authorized_at?: string | null
          organization_id?: string
          updated_at?: string
          usage_date?: string
          whatsapp_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voip_call_usage_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voip_call_usage_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      voip_calls: {
        Row: {
          authorized_at: string
          connected_at: string | null
          consent_record_id: string | null
          created_at: string
          direction: string
          end_reason: string | null
          ended_at: string | null
          id: string
          last_seq: number
          last_seq_epoch: number
          lead_id: string | null
          operator_user_id: string | null
          organization_id: string
          peer_phone: string
          recording_bytes: number | null
          recording_duration_ms: number | null
          recording_failure_reason: string | null
          recording_fetch_abandoned_at: string | null
          recording_last_attempt_at: string | null
          recording_notice_regime: string | null
          recording_path: string | null
          recording_purged_at: string | null
          recording_refetch_count: number
          recording_status: string | null
          recording_stored_at: string | null
          ringing_at: string | null
          status: string
          tc_call_id: string | null
          tc_session_id: string
          token_jti: string | null
          updated_at: string
        }
        Insert: {
          authorized_at?: string
          connected_at?: string | null
          consent_record_id?: string | null
          created_at?: string
          direction: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          last_seq?: number
          last_seq_epoch?: number
          lead_id?: string | null
          operator_user_id?: string | null
          organization_id: string
          peer_phone: string
          recording_bytes?: number | null
          recording_duration_ms?: number | null
          recording_failure_reason?: string | null
          recording_fetch_abandoned_at?: string | null
          recording_last_attempt_at?: string | null
          recording_notice_regime?: string | null
          recording_path?: string | null
          recording_purged_at?: string | null
          recording_refetch_count?: number
          recording_status?: string | null
          recording_stored_at?: string | null
          ringing_at?: string | null
          status?: string
          tc_call_id?: string | null
          tc_session_id: string
          token_jti?: string | null
          updated_at?: string
        }
        Update: {
          authorized_at?: string
          connected_at?: string | null
          consent_record_id?: string | null
          created_at?: string
          direction?: string
          end_reason?: string | null
          ended_at?: string | null
          id?: string
          last_seq?: number
          last_seq_epoch?: number
          lead_id?: string | null
          operator_user_id?: string | null
          organization_id?: string
          peer_phone?: string
          recording_bytes?: number | null
          recording_duration_ms?: number | null
          recording_failure_reason?: string | null
          recording_fetch_abandoned_at?: string | null
          recording_last_attempt_at?: string | null
          recording_notice_regime?: string | null
          recording_path?: string | null
          recording_purged_at?: string | null
          recording_refetch_count?: number
          recording_status?: string | null
          recording_stored_at?: string | null
          ringing_at?: string | null
          status?: string
          tc_call_id?: string | null
          tc_session_id?: string
          token_jti?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "voip_calls_consent_record_id_fkey"
            columns: ["consent_record_id"]
            isOneToOne: false
            referencedRelation: "consent_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voip_calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voip_calls_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voip_calls_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voip_calls_tc_session_id_fkey"
            columns: ["tc_session_id"]
            isOneToOne: false
            referencedRelation: "voip_sessions"
            referencedColumns: ["tc_session_id"]
          },
        ]
      }
      voip_sessions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          jid: string | null
          last_seq: number
          last_seq_epoch: number
          name: string | null
          organization_id: string
          status: string
          tc_session_id: string
          updated_at: string
          whatsapp_instance_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          jid?: string | null
          last_seq?: number
          last_seq_epoch?: number
          name?: string | null
          organization_id: string
          status?: string
          tc_session_id: string
          updated_at?: string
          whatsapp_instance_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          jid?: string | null
          last_seq?: number
          last_seq_epoch?: number
          name?: string | null
          organization_id?: string
          status?: string
          tc_session_id?: string
          updated_at?: string
          whatsapp_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voip_sessions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voip_sessions_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      voip_webhook_events: {
        Row: {
          event_jti: string
          expires_at: string
          organization_id: string
          received_at: string
          seq: number
          seq_epoch: number
          signed_at: string
          tc_session_id: string
        }
        Insert: {
          event_jti: string
          expires_at: string
          organization_id: string
          received_at?: string
          seq: number
          seq_epoch: number
          signed_at: string
          tc_session_id: string
        }
        Update: {
          event_jti?: string
          expires_at?: string
          organization_id?: string
          received_at?: string
          seq?: number
          seq_epoch?: number
          signed_at?: string
          tc_session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voip_webhook_events_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_dead_letters: {
        Row: {
          attempts: number
          created_at: string
          event: string
          failed_at: string
          id: string
          last_error: string | null
          last_response_body: string | null
          last_status_code: number | null
          payload: Json
          webhook_id: string
        }
        Insert: {
          attempts: number
          created_at?: string
          event: string
          failed_at?: string
          id?: string
          last_error?: string | null
          last_response_body?: string | null
          last_status_code?: number | null
          payload: Json
          webhook_id: string
        }
        Update: {
          attempts?: number
          created_at?: string
          event?: string
          failed_at?: string
          id?: string
          last_error?: string | null
          last_response_body?: string | null
          last_status_code?: number | null
          payload?: Json
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_dead_letters_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          event: string
          id: string
          max_attempts: number
          next_retry_at: string
          payload: Json
          webhook_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          event: string
          id?: string
          max_attempts?: number
          next_retry_at: string
          payload: Json
          webhook_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          event?: string
          id?: string
          max_attempts?: number
          next_retry_at?: string
          payload?: Json
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_delivery_logs: {
        Row: {
          attempt: number
          delivered_at: string
          error_message: string | null
          event: string
          id: string
          response_body: string | null
          status_code: number | null
          webhook_id: string
        }
        Insert: {
          attempt: number
          delivered_at?: string
          error_message?: string | null
          event: string
          id?: string
          response_body?: string | null
          status_code?: number | null
          webhook_id: string
        }
        Update: {
          attempt?: number
          delivered_at?: string
          error_message?: string | null
          event?: string
          id?: string
          response_body?: string | null
          status_code?: number | null
          webhook_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_delivery_logs_webhook_id_fkey"
            columns: ["webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["id"]
          },
        ]
      }
      webhooks: {
        Row: {
          consecutive_failures: number
          created_at: string
          custom_headers: Json
          disabled_reason: string | null
          events: string[]
          http_method: string
          id: string
          is_active: boolean
          name: string
          organization_id: string
          secret: string | null
          updated_at: string
          url: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          custom_headers?: Json
          disabled_reason?: string | null
          events?: string[]
          http_method?: string
          id?: string
          is_active?: boolean
          name: string
          organization_id: string
          secret?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          custom_headers?: Json
          disabled_reason?: string | null
          events?: string[]
          http_method?: string
          id?: string
          is_active?: boolean
          name?: string
          organization_id?: string
          secret?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversation_summary: {
        Row: {
          instance_id: string
          is_group: boolean
          last_message: string | null
          last_message_direction: string | null
          last_message_sent_source: string | null
          last_message_time: string
          last_push_name: string | null
          lead_id: string | null
          normalized_phone: string
          organization_id: string
          phone_number: string | null
          updated_at: string
        }
        Insert: {
          instance_id: string
          is_group?: boolean
          last_message?: string | null
          last_message_direction?: string | null
          last_message_sent_source?: string | null
          last_message_time: string
          last_push_name?: string | null
          lead_id?: string | null
          normalized_phone: string
          organization_id: string
          phone_number?: string | null
          updated_at?: string
        }
        Update: {
          instance_id?: string
          is_group?: boolean
          last_message?: string | null
          last_message_direction?: string | null
          last_message_sent_source?: string | null
          last_message_time?: string
          last_push_name?: string | null
          lead_id?: string | null
          normalized_phone?: string
          organization_id?: string
          phone_number?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversation_tags: {
        Row: {
          conversation_id: string
          created_at: string | null
          id: string
          tag_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string | null
          id?: string
          tag_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string | null
          id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversation_tags_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversation_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_conversations: {
        Row: {
          archived_at: string | null
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          id: string
          instance_id: string
          normalized_phone: string | null
          organization_id: string
          phone_number: string
        }
        Insert: {
          archived_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          instance_id: string
          normalized_phone?: string | null
          organization_id: string
          phone_number: string
        }
        Update: {
          archived_at?: string | null
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          id?: string
          instance_id?: string
          normalized_phone?: string | null
          organization_id?: string
          phone_number?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_conversations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_health_checks: {
        Row: {
          action_taken: string | null
          checked_at: string
          drift_ratio: number | null
          id: string
          instance_id: string
          notes: string | null
          organization_id: string
          status: string
          uazapi_inbound_1h: number | null
          v8_inbound_1h: number
        }
        Insert: {
          action_taken?: string | null
          checked_at?: string
          drift_ratio?: number | null
          id?: string
          instance_id: string
          notes?: string | null
          organization_id: string
          status: string
          uazapi_inbound_1h?: number | null
          v8_inbound_1h: number
        }
        Update: {
          action_taken?: string | null
          checked_at?: string
          drift_ratio?: number | null
          id?: string
          instance_id?: string
          notes?: string | null
          organization_id?: string
          status?: string
          uazapi_inbound_1h?: number | null
          v8_inbound_1h?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_health_checks_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_allowed_members: {
        Row: {
          created_at: string | null
          id: string
          team_member_id: string
          whatsapp_instance_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          team_member_id: string
          whatsapp_instance_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          team_member_id?: string
          whatsapp_instance_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_allowed_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_allowed_members_team_member_id_fkey"
            columns: ["team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_allowed_members_whatsapp_instance_id_fkey"
            columns: ["whatsapp_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_owner_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          id: string
          instance_id: string
          new_owner_id: string | null
          organization_id: string
          previous_owner_id: string | null
          reason: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          instance_id: string
          new_owner_id?: string | null
          organization_id: string
          previous_owner_id?: string | null
          reason?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          id?: string
          instance_id?: string
          new_owner_id?: string | null
          organization_id?: string
          previous_owner_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_owner_history_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_owner_history_new_owner_id_fkey"
            columns: ["new_owner_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_owner_history_new_owner_id_fkey"
            columns: ["new_owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_owner_history_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_owner_history_previous_owner_id_fkey"
            columns: ["previous_owner_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_owner_history_previous_owner_id_fkey"
            columns: ["previous_owner_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_reap_queue: {
        Row: {
          attempts: number
          confirmed_at: string | null
          created_at: string
          gave_up_at: string | null
          gave_up_reason: string | null
          id: string
          instance_id: string
          instance_name: string | null
          last_error: string | null
          next_attempt_at: string
          organization_id: string | null
          phone_number: string | null
          provider: string | null
          provider_instance_id: string | null
          provider_token: string | null
        }
        Insert: {
          attempts?: number
          confirmed_at?: string | null
          created_at?: string
          gave_up_at?: string | null
          gave_up_reason?: string | null
          id?: string
          instance_id: string
          instance_name?: string | null
          last_error?: string | null
          next_attempt_at?: string
          organization_id?: string | null
          phone_number?: string | null
          provider?: string | null
          provider_instance_id?: string | null
          provider_token?: string | null
        }
        Update: {
          attempts?: number
          confirmed_at?: string | null
          created_at?: string
          gave_up_at?: string | null
          gave_up_reason?: string | null
          id?: string
          instance_id?: string
          instance_name?: string | null
          last_error?: string | null
          next_attempt_at?: string
          organization_id?: string | null
          phone_number?: string | null
          provider?: string | null
          provider_instance_id?: string | null
          provider_token?: string | null
        }
        Relationships: []
      }
      whatsapp_instance_reputation: {
        Row: {
          ban_signal_count_24h: number
          instance_id: string
          last_ban_signal_at: string | null
          organization_id: string
          quarantine_until: string | null
          state: string
          updated_at: string
          warmup_started_at: string | null
        }
        Insert: {
          ban_signal_count_24h?: number
          instance_id: string
          last_ban_signal_at?: string | null
          organization_id: string
          quarantine_until?: string | null
          state?: string
          updated_at?: string
          warmup_started_at?: string | null
        }
        Update: {
          ban_signal_count_24h?: number
          instance_id?: string
          last_ban_signal_at?: string | null
          organization_id?: string
          quarantine_until?: string | null
          state?: string
          updated_at?: string
          warmup_started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_reputation_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_reputation_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instance_secrets: {
        Row: {
          created_at: string
          instance_id: string
          meta_access_token: string | null
          meta_phone_number_id: string | null
          meta_waba_id: string | null
          organization_id: string
          uazapi_instance_id: string | null
          uazapi_token: string | null
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          created_at?: string
          instance_id: string
          meta_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          organization_id: string
          uazapi_instance_id?: string | null
          uazapi_token?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          created_at?: string
          instance_id?: string
          meta_access_token?: string | null
          meta_phone_number_id?: string | null
          meta_waba_id?: string | null
          organization_id?: string
          uazapi_instance_id?: string | null
          uazapi_token?: string | null
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instance_secrets_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: true
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instance_secrets_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_instances: {
        Row: {
          copilot_agent_id: string | null
          created_at: string | null
          daily_blast_cap: number
          daily_call_cap: number | null
          id: string
          inbound_subscription_attempts: number
          inbound_subscription_last_attempt_at: string | null
          inbound_subscription_last_error: string | null
          inbound_subscription_next_attempt_at: string
          inbound_subscription_registered_at: string | null
          inbound_subscription_status: string
          instance_id: string | null
          instance_name: string
          last_connection_at: string | null
          metadata: Json | null
          organization_id: string
          owner_team_member_id: string | null
          phone_number: string | null
          provider: string
          provider_config: Json
          qr_code: string | null
          qr_code_expires_at: string | null
          session_dead_reason: string | null
          session_dead_since: string | null
          status: string
          updated_at: string | null
          voice_calls_enabled: boolean
        }
        Insert: {
          copilot_agent_id?: string | null
          created_at?: string | null
          daily_blast_cap?: number
          daily_call_cap?: number | null
          id?: string
          inbound_subscription_attempts?: number
          inbound_subscription_last_attempt_at?: string | null
          inbound_subscription_last_error?: string | null
          inbound_subscription_next_attempt_at?: string
          inbound_subscription_registered_at?: string | null
          inbound_subscription_status?: string
          instance_id?: string | null
          instance_name: string
          last_connection_at?: string | null
          metadata?: Json | null
          organization_id: string
          owner_team_member_id?: string | null
          phone_number?: string | null
          provider?: string
          provider_config?: Json
          qr_code?: string | null
          qr_code_expires_at?: string | null
          session_dead_reason?: string | null
          session_dead_since?: string | null
          status?: string
          updated_at?: string | null
          voice_calls_enabled?: boolean
        }
        Update: {
          copilot_agent_id?: string | null
          created_at?: string | null
          daily_blast_cap?: number
          daily_call_cap?: number | null
          id?: string
          inbound_subscription_attempts?: number
          inbound_subscription_last_attempt_at?: string | null
          inbound_subscription_last_error?: string | null
          inbound_subscription_next_attempt_at?: string
          inbound_subscription_registered_at?: string | null
          inbound_subscription_status?: string
          instance_id?: string | null
          instance_name?: string
          last_connection_at?: string | null
          metadata?: Json | null
          organization_id?: string
          owner_team_member_id?: string | null
          phone_number?: string | null
          provider?: string
          provider_config?: Json
          qr_code?: string | null
          qr_code_expires_at?: string | null
          session_dead_reason?: string | null
          session_dead_since?: string | null
          status?: string
          updated_at?: string | null
          voice_calls_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_instances_copilot_agent_id_fkey"
            columns: ["copilot_agent_id"]
            isOneToOne: false
            referencedRelation: "copilot_agents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instances_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instances_owner_team_member_id_fkey"
            columns: ["owner_team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_instances_owner_team_member_id_fkey"
            columns: ["owner_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_media_jobs: {
        Row: {
          attempts: number
          created_at: string
          id: string
          instance_id: string
          last_attempt_at: string | null
          last_error: string | null
          message_id: string
          message_type: string | null
          organization_id: string
          resolved_at: string | null
          source_url: string
          storage_path: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          id?: string
          instance_id: string
          last_attempt_at?: string | null
          last_error?: string | null
          message_id: string
          message_type?: string | null
          organization_id: string
          resolved_at?: string | null
          source_url: string
          storage_path?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          id?: string
          instance_id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          message_id?: string
          message_type?: string | null
          organization_id?: string
          resolved_at?: string | null
          source_url?: string
          storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_media_jobs_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_media_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          assigned_to: string | null
          content: string | null
          created_at: string | null
          deleted_at: string | null
          direction: string
          edited: boolean
          id: string
          instance_id: string | null
          is_group: boolean
          lead_id: string | null
          media_expired: boolean
          media_url: string | null
          message_id: string
          message_type: string
          normalized_phone: string | null
          organization_id: string
          phone_number: string
          pinned_at: string | null
          processed_by_agent_at: string | null
          push_name: string | null
          raw_payload: Json | null
          reactions: Json
          received_via: string
          remote_jid: string
          search_tsv: unknown
          sent_by_ai: boolean | null
          sent_by_team_member_id: string | null
          sent_source: string
          status: string | null
          timestamp: string
        }
        Insert: {
          assigned_to?: string | null
          content?: string | null
          created_at?: string | null
          deleted_at?: string | null
          direction: string
          edited?: boolean
          id?: string
          instance_id?: string | null
          is_group?: boolean
          lead_id?: string | null
          media_expired?: boolean
          media_url?: string | null
          message_id: string
          message_type?: string
          normalized_phone?: string | null
          organization_id: string
          phone_number: string
          pinned_at?: string | null
          processed_by_agent_at?: string | null
          push_name?: string | null
          raw_payload?: Json | null
          reactions?: Json
          received_via?: string
          remote_jid: string
          search_tsv?: unknown
          sent_by_ai?: boolean | null
          sent_by_team_member_id?: string | null
          sent_source?: string
          status?: string | null
          timestamp?: string
        }
        Update: {
          assigned_to?: string | null
          content?: string | null
          created_at?: string | null
          deleted_at?: string | null
          direction?: string
          edited?: boolean
          id?: string
          instance_id?: string | null
          is_group?: boolean
          lead_id?: string | null
          media_expired?: boolean
          media_url?: string | null
          message_id?: string
          message_type?: string
          normalized_phone?: string | null
          organization_id?: string
          phone_number?: string
          pinned_at?: string | null
          processed_by_agent_at?: string | null
          push_name?: string | null
          raw_payload?: Json | null
          reactions?: Json
          received_via?: string
          remote_jid?: string
          search_tsv?: unknown
          sent_by_ai?: boolean | null
          sent_by_team_member_id?: string | null
          sent_source?: string
          status?: string | null
          timestamp?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_sent_by_team_member_id_fkey"
            columns: ["sent_by_team_member_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_sent_by_team_member_id_fkey"
            columns: ["sent_by_team_member_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_rate_tracking: {
        Row: {
          created_at: string | null
          day_key: string
          hour_key: string
          id: string
          instance_id: string | null
          last_message_at: string | null
          messages_this_day: number | null
          messages_this_hour: number | null
          organization_id: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          day_key: string
          hour_key: string
          id?: string
          instance_id?: string | null
          last_message_at?: string | null
          messages_this_day?: number | null
          messages_this_hour?: number | null
          organization_id: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          day_key?: string
          hour_key?: string
          id?: string
          instance_id?: string | null
          last_message_at?: string | null
          messages_this_day?: number | null
          messages_this_hour?: number | null
          organization_id?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_rate_tracking_instance_id_fkey"
            columns: ["instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_rate_tracking_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_webhook_dlq: {
        Row: {
          attempts: number
          created_at: string
          event: string | null
          id: string
          last_attempt_at: string | null
          last_error: string | null
          payload: Json
          reason: string
          received_at: string
          resolved_at: string | null
          resolved_instance_id: string | null
          source_ip: string | null
          url_path: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          event?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payload: Json
          reason: string
          received_at?: string
          resolved_at?: string | null
          resolved_instance_id?: string | null
          source_ip?: string | null
          url_path?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          event?: string | null
          id?: string
          last_attempt_at?: string | null
          last_error?: string | null
          payload?: Json
          reason?: string
          received_at?: string
          resolved_at?: string | null
          resolved_instance_id?: string | null
          source_ip?: string | null
          url_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_webhook_dlq_resolved_instance_id_fkey"
            columns: ["resolved_instance_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_instances"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_execution_steps: {
        Row: {
          error: string | null
          executed_at: string
          execution_id: string
          id: string
          input_data: Json | null
          node_id: string
          node_label: string
          node_type: string
          output_data: Json | null
          status: string
        }
        Insert: {
          error?: string | null
          executed_at?: string
          execution_id: string
          id?: string
          input_data?: Json | null
          node_id: string
          node_label?: string
          node_type: string
          output_data?: Json | null
          status?: string
        }
        Update: {
          error?: string | null
          executed_at?: string
          execution_id?: string
          id?: string
          input_data?: Json | null
          node_id?: string
          node_label?: string
          node_type?: string
          output_data?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_execution_steps_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "workflow_executions"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_executions: {
        Row: {
          chain_depth: number
          claimed_at: string | null
          claimed_lag_ms: number | null
          completed_at: string | null
          context: Json
          current_node_id: string | null
          deal_id: string | null
          error: string | null
          id: string
          lead_id: string | null
          loop_counters: Json
          next_run_at: string | null
          organization_id: string
          pipeline_entry_id: string | null
          retry_of: string | null
          started_at: string
          status: string
          trigger_dedup_key: string | null
          triggered_by_execution_id: string | null
          updated_at: string
          workflow_id: string
        }
        Insert: {
          chain_depth?: number
          claimed_at?: string | null
          claimed_lag_ms?: number | null
          completed_at?: string | null
          context?: Json
          current_node_id?: string | null
          deal_id?: string | null
          error?: string | null
          id?: string
          lead_id?: string | null
          loop_counters?: Json
          next_run_at?: string | null
          organization_id: string
          pipeline_entry_id?: string | null
          retry_of?: string | null
          started_at?: string
          status?: string
          trigger_dedup_key?: string | null
          triggered_by_execution_id?: string | null
          updated_at?: string
          workflow_id: string
        }
        Update: {
          chain_depth?: number
          claimed_at?: string | null
          claimed_lag_ms?: number | null
          completed_at?: string | null
          context?: Json
          current_node_id?: string | null
          deal_id?: string | null
          error?: string | null
          id?: string
          lead_id?: string | null
          loop_counters?: Json
          next_run_at?: string | null
          organization_id?: string
          pipeline_entry_id?: string | null
          retry_of?: string | null
          started_at?: string
          status?: string
          trigger_dedup_key?: string | null
          triggered_by_execution_id?: string | null
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_executions_deal_id_fkey"
            columns: ["deal_id"]
            isOneToOne: false
            referencedRelation: "deals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_confirmacao"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_propostas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipe_whatsapp"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_pipeline_entry_id_fkey"
            columns: ["pipeline_entry_id"]
            isOneToOne: false
            referencedRelation: "pipeline_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_retry_of_fkey"
            columns: ["retry_of"]
            isOneToOne: false
            referencedRelation: "workflow_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_triggered_by_execution_id_fkey"
            columns: ["triggered_by_execution_id"]
            isOneToOne: false
            referencedRelation: "workflow_executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_round_robin_state: {
        Row: {
          id: string
          last_member_index: number
          node_id: string
          organization_id: string
          updated_at: string
          workflow_id: string
        }
        Insert: {
          id?: string
          last_member_index?: number
          node_id: string
          organization_id: string
          updated_at?: string
          workflow_id: string
        }
        Update: {
          id?: string
          last_member_index?: number
          node_id?: string
          organization_id?: string
          updated_at?: string
          workflow_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_round_robin_state_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_round_robin_state_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_templates: {
        Row: {
          author_name: string | null
          category: string
          created_at: string
          definition: Json
          description: string | null
          id: string
          is_system: boolean
          name: string
          organization_id: string | null
          popularity: number
          tags: Json | null
          thumbnail_url: string | null
          updated_at: string
        }
        Insert: {
          author_name?: string | null
          category?: string
          created_at?: string
          definition?: Json
          description?: string | null
          id?: string
          is_system?: boolean
          name: string
          organization_id?: string | null
          popularity?: number
          tags?: Json | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Update: {
          author_name?: string | null
          category?: string
          created_at?: string
          definition?: Json
          description?: string | null
          id?: string
          is_system?: boolean
          name?: string
          organization_id?: string | null
          popularity?: number
          tags?: Json | null
          thumbnail_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_templates_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          definition: Json
          description: string | null
          enrollment_criteria: Json | null
          id: string
          is_active: boolean
          loop_limit: number
          name: string
          organization_id: string
          re_enrollment_cooldown_days: number | null
          re_enrollment_enabled: boolean
          re_enrollment_max_times: number | null
          trigger_config: Json
          trigger_type: string
          updated_at: string
          wrapper_for: string | null
          wrapper_source_id: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string | null
          enrollment_criteria?: Json | null
          id?: string
          is_active?: boolean
          loop_limit?: number
          name: string
          organization_id: string
          re_enrollment_cooldown_days?: number | null
          re_enrollment_enabled?: boolean
          re_enrollment_max_times?: number | null
          trigger_config?: Json
          trigger_type: string
          updated_at?: string
          wrapper_for?: string | null
          wrapper_source_id?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          definition?: Json
          description?: string | null
          enrollment_criteria?: Json | null
          id?: string
          is_active?: boolean
          loop_limit?: number
          name?: string
          organization_id?: string
          re_enrollment_cooldown_days?: number | null
          re_enrollment_enabled?: boolean
          re_enrollment_max_times?: number | null
          trigger_config?: Json
          trigger_type?: string
          updated_at?: string
          wrapper_for?: string | null
          wrapper_source_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workflows_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      feature_flags: {
        Row: {
          category: string | null
          created_at: string | null
          default_enabled: boolean | null
          description: string | null
          display_name: string | null
          feature_type: string | null
          icon: string | null
          id: string | null
          key: string | null
          name: string | null
          position: number | null
          requires_plan: string[] | null
          sidebar_path: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          default_enabled?: boolean | null
          description?: string | null
          display_name?: string | null
          feature_type?: string | null
          icon?: string | null
          id?: string | null
          key?: string | null
          name?: string | null
          position?: number | null
          requires_plan?: string[] | null
          sidebar_path?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          default_enabled?: boolean | null
          description?: string | null
          display_name?: string | null
          feature_type?: string | null
          icon?: string | null
          id?: string | null
          key?: string | null
          name?: string | null
          position?: number | null
          requires_plan?: string[] | null
          sidebar_path?: string | null
        }
        Relationships: []
      }
      leads_compat: {
        Row: {
          ai_disabled: boolean | null
          ai_disabled_at: string | null
          ai_disabled_by: string | null
          closer_id: string | null
          company: string | null
          company_domain: string | null
          company_entity_id: string | null
          company_industry: string | null
          company_revenue: string | null
          company_size: string | null
          company_website: string | null
          compromisso_date: string | null
          contact_id: string | null
          contact_job_title: string | null
          contact_linkedin: string | null
          created_at: string | null
          email: string | null
          faturamento: string | null
          id: string | null
          is_shadow: boolean | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          metrics_period_at: string | null
          name: string | null
          normalized_phone: string | null
          notes: string | null
          organization_id: string | null
          origin: string | null
          phone: string | null
          pipe_whatsapp: string | null
          pre_sale_responsible_id: string | null
          qualification_score: number | null
          rating: number | null
          responsible_id: string | null
          sale_responsible_id: string | null
          sdr_id: string | null
          segment: string | null
          updated_at: string | null
          urgency: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_company_entity_id_fkey"
            columns: ["company_entity_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_pre_sale_responsible_id_fkey"
            columns: ["pre_sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sale_responsible_id_fkey"
            columns: ["sale_responsible_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_sdr_id_fkey"
            columns: ["sdr_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
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
      org_visible_members: {
        Row: {
          commission_mrr_percent: number | null
          commission_projeto_percent: number | null
          created_at: string | null
          email: string | null
          id: string | null
          is_active: boolean | null
          job_title: string | null
          metric_type: string | null
          name: string | null
          organization_id: string | null
          ote_base: number | null
          ote_bonus: number | null
          role: Database["public"]["Enums"]["app_role"] | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          commission_mrr_percent?: number | null
          commission_projeto_percent?: number | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_active?: boolean | null
          job_title?: string | null
          metric_type?: string | null
          name?: string | null
          organization_id?: string | null
          ote_base?: number | null
          ote_bonus?: number | null
          role?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          commission_mrr_percent?: number | null
          commission_projeto_percent?: number | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          is_active?: boolean | null
          job_title?: string | null
          metric_type?: string | null
          name?: string | null
          organization_id?: string | null
          ote_base?: number | null
          ote_bonus?: number | null
          role?: Database["public"]["Enums"]["app_role"] | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pg_buffercache: {
        Row: {
          bufferid: number | null
          isdirty: boolean | null
          pinning_backends: number | null
          relblocknumber: number | null
          reldatabase: unknown
          relfilenode: unknown
          relforknumber: number | null
          reltablespace: unknown
          usagecount: number | null
        }
        Relationships: []
      }
      pipe_confirmacao: {
        Row: {
          closer_id: string | null
          created_at: string | null
          id: string | null
          is_confirmed: boolean | null
          lead_id: string | null
          meet_link: string | null
          meeting_date: string | null
          metrics_period_at: string | null
          notes: string | null
          organization_id: string | null
          pre_sale_responsible_id: string | null
          responsible_id: string | null
          sale_responsible_id: string | null
          sdr_id: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          created_at: string | null
          id: string | null
          lead_id: string | null
          loss_reason: string | null
          loss_reason_id: string | null
          metrics_period_at: string | null
          notes: string | null
          organization_id: string | null
          pre_sale_responsible_id: string | null
          product_id: string | null
          product_type: string | null
          responsible_id: string | null
          sale_responsible_id: string | null
          sale_value: number | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      pipe_whatsapp: {
        Row: {
          created_at: string | null
          id: string | null
          lead_id: string | null
          notes: string | null
          organization_id: string | null
          pre_sale_responsible_id: string | null
          responsible_id: string | null
          sale_responsible_id: string | null
          scheduled_date: string | null
          sdr_id: string | null
          status: string | null
          updated_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads_compat"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pipeline_entries_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      portfolio_retention_cohorts: {
        Row: {
          active_clients: number | null
          closer_id: string | null
          cohort_month: string | null
          month_offset: number | null
          organization_id: string | null
          retention_pct: number | null
          segment: string | null
          total_clients: number | null
        }
        Relationships: [
          {
            foreignKeyName: "upsell_clients_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "org_visible_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_closer_id_fkey"
            columns: ["closer_id"]
            isOneToOne: false
            referencedRelation: "team_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upsell_clients_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      unified_inbox_messages: {
        Row: {
          channel: Database["public"]["Enums"]["channel_type"] | null
          content: string | null
          direction: string | null
          email_id: string | null
          external_ref: string | null
          id: string | null
          lead_id: string | null
          media_url: string | null
          message_type: string | null
          organization_id: string | null
          phone_number: string | null
          sender_name: string | null
          sender_profile_pic: string | null
          sent_at: string | null
        }
        Relationships: []
      }
      v_cron_job_status: {
        Row: {
          active: boolean | null
          frequency_label: string | null
          jobname: string | null
          last_duration: string | null
          last_message: string | null
          last_run_at: string | null
          last_status: string | null
          minutes_since_last_run: number | null
          schedule: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _fn_reseed_legacy_to_native_unchecked: {
        Args: { p_org_id: string }
        Returns: Json
      }
      _fn_seed_default_dashboard_unchecked: {
        Args: { p_org_id: string }
        Returns: Json
      }
      _metric_lead_na_coorte: {
        Args: {
          p_deleted_at: string
          p_is_shadow: boolean
          p_lead_id: string
          p_org_id: string
        }
        Returns: boolean
      }
      _metric_leaf: {
        Args: {
          p_end: string
          p_filters: Json
          p_measure_id: string
          p_org_id: string
          p_period: string
          p_recorte: string
          p_ref: string
          p_start: string
        }
        Returns: Json
      }
      _metric_leaf_automacao: {
        Args: {
          p_bounds: unknown
          p_criterio: string
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_clientes_sem_atuacao: {
        Args: { p_filters: Json; p_org_id: string; p_recorte: string }
        Returns: Json
      }
      _metric_leaf_clientes_sem_resposta: {
        Args: { p_filters: Json; p_org_id: string; p_recorte: string }
        Returns: Json
      }
      _metric_leaf_coorte_etapa: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_modo: string
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_curva_abc: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_ganho_perda: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_leads_criados: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_leads_qualidade: {
        Args: {
          p_bounds: unknown
          p_criterio: string
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_leads_sem_dono: {
        Args: { p_filters: Json; p_org_id: string; p_recorte: string }
        Returns: Json
      }
      _metric_leaf_ltv: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_meetings: {
        Args: {
          p_bounds: unknown
          p_event_type: string
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_negocios_abertos: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_no_show: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_sales: {
        Args: {
          p_agg: string
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_so_pre_venda?: boolean
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_sales_lost: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_stage_duration: {
        Args: { p_filters: Json; p_org_id: string; p_recorte: string }
        Returns: Json
      }
      _metric_leaf_stage_snapshot: {
        Args: {
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_unidade: string
        }
        Returns: Json
      }
      _metric_leaf_tempo_resposta: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_leaf_valor_em_aberto: {
        Args: { p_filters: Json; p_org_id: string; p_recorte: string }
        Returns: Json
      }
      _metric_leaf_valor_perdido: {
        Args: {
          p_bounds: unknown
          p_filters: Json
          p_org_id: string
          p_recorte: string
          p_tz: string
        }
        Returns: Json
      }
      _metric_qualidade_casa: {
        Args: {
          p_criterio: string
          p_tier: Database["public"]["Enums"]["qualification_tier"]
        }
        Returns: boolean
      }
      _metric_tree_eval: {
        Args: {
          p_depth: number
          p_end: string
          p_filters: Json
          p_node: Json
          p_org_id: string
          p_period: string
          p_ref: string
          p_start: string
        }
        Returns: number
      }
      _metric_tree_formats_for_unit: {
        Args: { p_unit: string }
        Returns: string[]
      }
      _metric_tree_op_unit: {
        Args: { p_left: string; p_op: string; p_right: string }
        Returns: string
      }
      _metric_tree_unit: {
        Args: { p_depth: number; p_node: Json }
        Returns: string
      }
      _metric_ultimo_toque: {
        Args: { p_last_order_at: string; p_lead_id: string; p_org_id: string }
        Returns: string
      }
      _registrar_desfecho_no_caderno: {
        Args: {
          p_actor: string
          p_de: string
          p_deal_id: string
          p_lead: string
          p_org: string
          p_para: string
          p_pipeline: string
          p_source: string
          p_stage_event_id: string
          p_stage_key: string
        }
        Returns: undefined
      }
      _resolve_plan_base_for_resource: {
        Args: { p_org_id: string; p_resource_key: string }
        Returns: number
      }
      _stage_bucket_label: {
        Args: {
          p_escopado: boolean
          p_org_id: string
          p_pipeline_id: string
          p_stage_key: string
        }
        Returns: string
      }
      _stage_is_final: {
        Args: { p_org_id: string; p_pipeline_id: string; p_stage_key: string }
        Returns: boolean
      }
      _stage_key_label: {
        Args: { p_org_id: string; p_pipeline_id: string; p_stage_key: string }
        Returns: string
      }
      abrir_negocio: {
        Args: {
          p_lead_id: string
          p_meeting_date?: string
          p_notes?: string
          p_owner_id?: string
          p_pipe: string
          p_source?: string
          p_stage: string
          p_title?: string
          p_value?: number
        }
        Returns: string
      }
      acquire_copilot_lock: {
        Args: { p_organization_id: string; p_phone: string }
        Returns: boolean
      }
      admin_get_org_quota_summary: { Args: { p_org_id: string }; Returns: Json }
      admin_set_purchased_addons: {
        Args: {
          p_org_id: string
          p_purchased: number
          p_reason: string
          p_resource_key: string
        }
        Returns: Json
      }
      admin_set_quota_adjustment: {
        Args: {
          p_admin_adjustment: number
          p_org_id: string
          p_reason: string
          p_resource_key: string
        }
        Returns: Json
      }
      advance_onboarding_state: {
        Args: { p_expected_state: string; p_org_id: string; p_payload?: Json }
        Returns: Json
      }
      api_add_lead_tags: {
        Args: { p_lead_id: string; p_org: string; p_tags: string[] }
        Returns: Json
      }
      api_create_custom_field: {
        Args: {
          p_field_name: string
          p_field_options?: Json
          p_field_type?: string
          p_is_required?: boolean
          p_org: string
        }
        Returns: Json
      }
      api_create_deal: {
        Args: {
          p_idempotency_key?: string
          p_lead_id: string
          p_notes?: string
          p_org: string
          p_owner_id?: string
          p_pipe: string
          p_source?: string
          p_stage: string
          p_title?: string
          p_value?: number
        }
        Returns: Json
      }
      api_create_lead: {
        Args: { p_idempotency_key?: string; p_lead: Json; p_org: string }
        Returns: Json
      }
      api_get_deal: {
        Args: { p_deal_id: string; p_org: string }
        Returns: Json
      }
      api_get_lead: {
        Args: { p_lead_id: string; p_org: string }
        Returns: Json
      }
      api_lead_exists: {
        Args: { p_lead_id: string; p_org: string }
        Returns: boolean
      }
      api_lead_timeline: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_lead_id: string
          p_limit?: number
          p_org: string
        }
        Returns: {
          action: string
          created_at: string
          description: string
          entity_id: string
          entity_type: string
          id: string
          metadata: Json
          source: string
        }[]
      }
      api_list_custom_fields: {
        Args: { p_org: string }
        Returns: {
          display_order: number
          field_name: string
          field_options: Json
          field_type: string
          id: string
          is_required: boolean
        }[]
      }
      api_list_deals: {
        Args: {
          p_created_from?: string
          p_created_to?: string
          p_cursor_id?: string
          p_cursor_last_activity?: string
          p_limit?: number
          p_org: string
          p_owner_id?: string
          p_pipeline?: string
          p_stage?: string
          p_status?: string
          p_updated_since?: string
        }
        Returns: {
          closed_at: string
          created_at: string
          id: string
          last_activity_at: string
          loss_reason: string
          owner_id: string
          pipeline_slug: string
          source: string
          source_lead_id: string
          stage_key: string
          title: string
          value: number
          won: boolean
        }[]
      }
      api_list_lead_deals: {
        Args: { p_lead_id: string; p_org: string }
        Returns: {
          closed_at: string
          created_at: string
          id: string
          last_activity_at: string
          loss_reason: string
          owner_id: string
          pipeline_slug: string
          source: string
          source_lead_id: string
          stage_key: string
          title: string
          value: number
          won: boolean
        }[]
      }
      api_list_leads: {
        Args: {
          p_created_from?: string
          p_created_to?: string
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
          p_org: string
          p_origin?: string[]
          p_q?: string
          p_responsible_id?: string
          p_stage?: string[]
          p_tag?: string[]
          p_tier?: string[]
        }
        Returns: {
          closer_id: string
          company: string
          created_at: string
          email: string
          id: string
          name: string
          origin: string
          phone: string
          qualification_score: number
          rating: number
          responsible_id: string
          sale_value: number
          sdr_id: string
          sold: boolean
          tags: Json
          tier_efetivo: string
        }[]
      }
      api_list_pipelines: { Args: { p_org: string }; Returns: Json }
      api_list_tags: {
        Args: { p_org: string }
        Returns: {
          color: string
          id: string
          name: string
        }[]
      }
      api_list_team_members: { Args: { p_org: string }; Returns: Json }
      api_move_deal: {
        Args: {
          p_deal_id: string
          p_org: string
          p_owner_id?: string
          p_pipeline: string
          p_stage: string
        }
        Returns: Json
      }
      api_remove_lead_tag: {
        Args: { p_lead_id: string; p_org: string; p_tag: string }
        Returns: Json
      }
      api_search_leads: {
        Args: {
          p_email?: string
          p_limit?: number
          p_org: string
          p_phone?: string
        }
        Returns: {
          ai_disabled: boolean | null
          ai_disabled_at: string | null
          ai_disabled_by: string | null
          avatar_url: string | null
          claimed_at: string | null
          claimed_by: string | null
          closer_id: string | null
          company: string | null
          company_entity_id: string | null
          compromisso_date: string | null
          contact_id: string | null
          created_at: string
          deleted_at: string | null
          deleted_by: string | null
          email: string | null
          excluded_from_metrics: boolean
          faturamento: string | null
          id: string
          import_batch_id: string | null
          interest: string | null
          is_shadow: boolean | null
          meta_ad_id: string | null
          meta_adset_id: string | null
          meta_campaign_id: string | null
          meta_lead_id: string | null
          metrics_period_at: string | null
          name: string
          normalized_phone: string | null
          notes: string | null
          organization_id: string | null
          origin: string | null
          origin_detail: string | null
          phone: string | null
          phone_digits: string | null
          pipe_whatsapp: string | null
          pre_qualification_tier:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          pre_sale_responsible_id: string | null
          qualification_score: number | null
          qualification_tier:
            | Database["public"]["Enums"]["qualification_tier"]
            | null
          rating: number | null
          responsible_id: string | null
          responsible_user_id: string | null
          sale_responsible_id: string | null
          sdr_id: string | null
          segment: string | null
          uf: string | null
          uf_source: string | null
          updated_at: string
          urgency: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "leads"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      api_set_custom_fields: {
        Args: { p_lead_id: string; p_org: string; p_values: Json }
        Returns: Json
      }
      api_set_custom_fields_creating: {
        Args: { p_lead_id: string; p_org: string; p_values: Json }
        Returns: Json
      }
      api_update_deal: {
        Args: {
          p_deal_id: string
          p_loss_reason?: string
          p_notes?: string
          p_org: string
          p_owner_id?: string
          p_status?: string
          p_title?: string
          p_value?: number
        }
        Returns: Json
      }
      api_update_lead: {
        Args: { p_lead_id: string; p_org: string; p_patch: Json }
        Returns: Json
      }
      assert_org_access: { Args: { p_org_id: string }; Returns: undefined }
      assert_org_member: { Args: { p_org_id: string }; Returns: undefined }
      billing_apply_paid_subscription: {
        Args: {
          p_base_amount_cents?: number
          p_billing_cycle: string
          p_coupon_discount_pct?: number
          p_coupon_id?: string
          p_cycle_discount_pct?: number
          p_discount_amount_cents?: number
          p_final_amount_cents?: number
          p_manual_discount_cents?: number
          p_organization_id: string
          p_payment_method: string
          p_plan_id: string
          p_provider?: string
          p_provider_payment_id: string
          p_seats?: number
        }
        Returns: string
      }
      billing_attach_link_charge: {
        Args: {
          p_link_id: string
          p_method: string
          p_provider: string
          p_provider_charge_id: string
        }
        Returns: Json
      }
      billing_block_provisioning: {
        Args: {
          p_code: string
          p_organization_id?: string
          p_provider_payment_id: string
        }
        Returns: Json
      }
      billing_create_payment_link: {
        Args: {
          p_billing_cycle: string
          p_buyer_email?: string
          p_buyer_legal_name?: string
          p_buyer_tax_id?: string
          p_coupon_code?: string
          p_expires_at: string
          p_manual_discount_reason?: string
          p_manual_final_cents?: number
          p_new_org_name: string
          p_organization_id: string
          p_package_features?: Json
          p_package_limits?: Json
          p_payment_method: string
          p_plan_id: string
          p_target_kind: string
          p_user_count: number
        }
        Returns: Json
      }
      billing_get_link_customer: { Args: { p_link_id: string }; Returns: Json }
      billing_prefill_link_buyer: {
        Args: {
          p_email: string
          p_legal_name: string
          p_link_id: string
          p_tax_id: string
        }
        Returns: Json
      }
      billing_provision_existing_org: {
        Args: { p_provider_payment_id: string }
        Returns: Json
      }
      billing_provision_new_org: {
        Args: { p_buyer_email: string; p_provider_payment_id: string }
        Returns: Json
      }
      billing_quote_price: {
        Args: {
          p_billing_cycle: string
          p_coupon_code?: string
          p_manual_final_cents?: number
          p_payment_method?: string
          p_plan_id: string
          p_user_count: number
        }
        Returns: Json
      }
      billing_resolve_charge_buyer: {
        Args: { p_provider_charge_id: string }
        Returns: Json
      }
      billing_resolve_payment_link: { Args: { p_token: string }; Returns: Json }
      billing_revoke_payment_link: {
        Args: { p_link_id: string; p_reason?: string }
        Returns: Json
      }
      billing_upsert_link_buyer: {
        Args: {
          p_email: string
          p_legal_name: string
          p_link_id: string
          p_provider: string
          p_provider_customer_id: string
          p_tax_id: string
        }
        Returns: Json
      }
      bulk_add_to_custom_pipe: {
        Args: {
          p_lead_ids: string[]
          p_pipeline_id: string
          p_stage_id: string
        }
        Returns: undefined
      }
      bulk_assign_leads: {
        Args: {
          p_closer_id?: string
          p_lead_ids: string[]
          p_responsible_id?: string
          p_sdr_id?: string
        }
        Returns: undefined
      }
      bulk_delete_leads: { Args: { p_lead_ids: string[] }; Returns: number }
      bulk_move_stage: {
        Args: {
          p_lead_ids: string[]
          p_target_pipe: string
          p_target_stage: string
        }
        Returns: undefined
      }
      bulk_tag_leads: {
        Args: {
          p_add_tag_ids?: string[]
          p_lead_ids: string[]
          p_remove_tag_ids?: string[]
        }
        Returns: undefined
      }
      can_delete_lead: { Args: never; Returns: boolean }
      can_link_or_read_lead: {
        Args: { p_lead_id: string; p_org: string }
        Returns: boolean
      }
      can_manage_copilot:
        | { Args: never; Returns: boolean }
        | { Args: { p_org_id: string }; Returns: boolean }
      can_manage_whatsapp_instances:
        | { Args: never; Returns: boolean }
        | { Args: { p_org_id: string }; Returns: boolean }
      can_read_help_article: {
        Args: { p_article_id: string }
        Returns: boolean
      }
      can_read_support_attachment: {
        Args: { object_name: string }
        Returns: boolean
      }
      can_read_support_ticket: {
        Args: { _ticket_id: string }
        Returns: boolean
      }
      can_see_chat: {
        Args: { p_normalized_phone: string; p_org_id: string }
        Returns: boolean
      }
      can_see_chat_lead: {
        Args: { p_lead_id: string; p_org_id: string }
        Returns: boolean
      }
      can_see_chat_scope: {
        Args: {
          p_lead_id: string
          p_normalized_phone: string
          p_org_id: string
        }
        Returns: boolean
      }
      can_see_chat_target: {
        Args: {
          p_instance_id?: string
          p_lead_id?: string
          p_message_id?: string
          p_org_id: string
          p_raw_phone?: string
        }
        Returns: boolean
      }
      can_see_conversation: {
        Args: { p_conversation_id: string }
        Returns: boolean
      }
      can_see_lead_by_permissions: {
        Args: { p_closer_id: string; p_sdr_id: string }
        Returns: boolean
      }
      can_user_write_instance: {
        Args: { p_instance_id: string; p_user_id: string }
        Returns: boolean
      }
      can_view_lead: {
        Args: { p_lead_id: string }
        Returns: {
          metadata: Json
          status: Database["public"]["Enums"]["lead_visibility_status"]
        }[]
      }
      carteira_erp_source: {
        Args: {
          p_external_source: string
          p_order_id: string
          p_org_id: string
          p_tiny_order_id: string
        }
        Returns: string
      }
      carteira_list_orders: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_org_id?: string
          p_search?: string
        }
        Returns: {
          approval_status: string
          approved_at: string
          client_company: string
          client_id: string
          client_name: string
          closer_id: string
          closer_name: string
          created_at: string
          erp_source: string
          id: string
          is_erp_linked: boolean
          items: Json
          notes: string
          origin: string
          product_name: string
          product_type: string
          sale_responsible_id: string
          sale_responsible_name: string
          sale_value: number
          sold_at: string
          source: string
          total_count: number
        }[]
      }
      carteira_update_order: {
        Args: { p_items?: Json; p_order_id: string; p_patch?: Json }
        Returns: Json
      }
      check_auth_rate_limit: {
        Args: {
          p_endpoint: string
          p_ip: string
          p_max: number
          p_window: string
        }
        Returns: boolean
      }
      check_cron_job_health: { Args: never; Returns: Json }
      check_oraculo_limit: { Args: { p_user_id: string }; Returns: Json }
      check_rate_limit: {
        Args: {
          p_key: string
          p_max_requests?: number
          p_window_seconds?: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      check_sla_breaches: {
        Args: never
        Returns: {
          hours_in_stage: number
          lead_id: string
          lead_name: string
          pipeline_type: string
          responsible_id: string
          sla_hours: number
          stage_id: string
          stage_name: string
        }[]
      }
      claim_blast_recipients: {
        Args: { batch_size?: number; per_org_cap?: number }
        Returns: {
          actual_cost: number | null
          claimed_at: string | null
          created_at: string
          delivered_at: string | null
          estimated_cost: number | null
          id: string
          instance_id: string | null
          lead_id: string | null
          lot_index: number
          phone: string | null
          plan_id: string
          provider_message_id: string | null
          reason: string | null
          sent_at: string | null
          status: string
          variable_snapshot: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "blast_plan_recipients"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_campaign_dispatch_batch: {
        Args: { p_campanha_id?: string; p_limit?: number }
        Returns: {
          claimed_id: string
        }[]
      }
      claim_copilot_batch: {
        Args: { p_batch_key: string; p_lease_seconds?: number }
        Returns: {
          attempts: number
          batch_key: string | null
          claimed_at: string | null
          conversation_id: string | null
          created_at: string
          id: string
          last_error: string | null
          message_id: string
          next_attempt_at: string | null
          organization_id: string
          phone: string
          processed_at: string | null
          queued_at: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "copilot_message_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_password_reset_token: {
        Args: { p_token_hash: string }
        Returns: string
      }
      claim_pending_ai_actions: {
        Args: { batch_size?: number; per_org_cap?: number }
        Returns: {
          action_type: string
          conversation_id: string | null
          created_at: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          lead_id: string | null
          next_retry_at: string | null
          organization_id: string
          payload: Json
          processed_at: string | null
          retry_count: number
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "pending_ai_actions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_pipe_dispatch_batch: {
        Args: { p_limit?: number; p_pipe_type?: string }
        Returns: {
          claimed_id: string
        }[]
      }
      claim_purge_batch: {
        Args: { p_category: string; p_limit?: number }
        Returns: {
          object_name: string
          size_bytes: number
        }[]
      }
      claim_workflow_executions: {
        Args: { batch_size?: number; per_org_cap?: number }
        Returns: {
          chain_depth: number
          claimed_at: string | null
          claimed_lag_ms: number | null
          completed_at: string | null
          context: Json
          current_node_id: string | null
          deal_id: string | null
          error: string | null
          id: string
          lead_id: string | null
          loop_counters: Json
          next_run_at: string | null
          organization_id: string
          pipeline_entry_id: string | null
          retry_of: string | null
          started_at: string
          status: string
          trigger_dedup_key: string | null
          triggered_by_execution_id: string | null
          updated_at: string
          workflow_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "workflow_executions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      cleanup_copilot_message_queue: { Args: never; Returns: undefined }
      cleanup_old_logs: { Args: { days_to_keep?: number }; Returns: number }
      clear_human_pause: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      close_resolved_support_tickets: { Args: never; Returns: number }
      convert_campaign_rule_to_workflow: {
        Args: { p_rule_id: string }
        Returns: string
      }
      convert_pipe_rule_to_workflow: {
        Args: { p_rule_id: string }
        Returns: string
      }
      copilot_v2_acquire_dedup_lock: {
        Args: {
          p_dedup_key: string
          p_org_id: string
          p_window_seconds: number
        }
        Returns: boolean
      }
      copilot_v2_check_human_pause: {
        Args: { p_canonical_phone: string; p_org_id: string }
        Returns: string
      }
      copilot_v2_claim_messages: {
        Args: { p_batch_size?: number }
        Returns: {
          attempts: number
          canonical_phone: string
          content: string
          conversation_id: string | null
          created_at: string
          id: string
          idempotency_key: string
          last_error: string | null
          lead_id: string | null
          message_type: string
          next_retry_at: string | null
          organization_id: string
          source: string
          status: Database["public"]["Enums"]["copilot_v2_queue_status"]
          trace_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "copilot_v2_message_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      copilot_v2_complete_message: {
        Args: { p_id: string }
        Returns: undefined
      }
      copilot_v2_enqueue_message: {
        Args: {
          p_canonical_phone: string
          p_content: string
          p_idempotency_key: string
          p_lead_id: string
          p_message_type: string
          p_org_id: string
          p_source: string
          p_trace_id: string
        }
        Returns: string
      }
      copilot_v2_fail_message: {
        Args: { p_error: string; p_id: string }
        Returns: undefined
      }
      copilot_v2_next_turn: {
        Args: { p_conversation_id: string; p_org_id: string }
        Returns: number
      }
      copilot_v2_set_human_pause: {
        Args: {
          p_canonical_phone: string
          p_org_id: string
          p_reason?: string
          p_until: string
        }
        Returns: undefined
      }
      create_default_pipeline_stages: {
        Args: { org_id: string }
        Returns: undefined
      }
      create_default_pipelines: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      create_lead_from_social_conversation: {
        Args: {
          p_campanha_id?: string
          p_channel: string
          p_company?: string
          p_custom_pipeline_id?: string
          p_custom_stage_id?: string
          p_destination?: string
          p_email?: string
          p_external_user_id: string
          p_name: string
          p_org: string
          p_phone?: string
        }
        Returns: string
      }
      create_lead_with_pipe: {
        Args: {
          p_closer_id?: string
          p_company?: string
          p_compromisso_date?: string
          p_email?: string
          p_faturamento?: string
          p_meet_link?: string
          p_meeting_date?: string
          p_name: string
          p_normalized_phone?: string
          p_notes?: string
          p_organization_id?: string
          p_origin?: string
          p_phone?: string
          p_pipe_meeting_date?: string
          p_pipe_responsible_id?: string
          p_pipe_status?: string
          p_pipe_type?: string
          p_rating?: number
          p_responsible_id?: string
          p_sdr_id?: string
          p_segment?: string
          p_urgency?: string
          p_utm_campaign?: string
          p_utm_content?: string
          p_utm_medium?: string
          p_utm_source?: string
          p_utm_term?: string
        }
        Returns: Json
      }
      create_org_sandbox: { Args: { p_source_org_id: string }; Returns: string }
      custom_pipeline_delete_impact: {
        Args: { p_pipeline_id: string }
        Returns: Json
      }
      db_connection_pressure: { Args: never; Returns: Json }
      deal_item_atualizar: {
        Args: {
          p_discount_percent?: number
          p_item_id: string
          p_quantity: number
          p_unit_price: number
        }
        Returns: string
      }
      deal_item_lancar: {
        Args: {
          p_deal_id: string
          p_discount_percent?: number
          p_product_id: string
          p_product_name: string
          p_quantity: number
          p_unit_price: number
        }
        Returns: string
      }
      deal_item_remover: { Args: { p_item_id: string }; Returns: string }
      default_org_feature_flags: { Args: never; Returns: Json }
      definir_desfecho_da_entrada: {
        Args: { p_entry_id: string; p_loss_reason?: string; p_outcome: string }
        Returns: Json
      }
      delete_custom_pipeline: { Args: { p_pipeline_id: string }; Returns: Json }
      delete_system_pipeline: {
        Args: { p_org_id: string; p_pipe_type: string }
        Returns: Json
      }
      distribute_campaign_round_robin: {
        Args: { p_campaign_id: string; p_member_ids: string[] }
        Returns: string
      }
      distribute_pipe_round_robin: {
        Args: {
          p_member_ids: string[]
          p_organization_id: string
          p_pipe_type: string
        }
        Returns: string
      }
      enable_system_pipeline: {
        Args: { p_org_id: string; p_pipe_type: string }
        Returns: Json
      }
      enqueue_webhook_deliveries_for_org: {
        Args: { p_event: string; p_organization_id: string; p_payload: Json }
        Returns: undefined
      }
      ensure_pipeline_display_config: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      export_lead_data: { Args: { p_lead_id: string }; Returns: Json }
      find_duplicate_leads: {
        Args: { p_organization_id: string }
        Returns: {
          lead_a_company: string
          lead_a_email: string
          lead_a_id: string
          lead_a_name: string
          lead_a_phone: string
          lead_b_company: string
          lead_b_email: string
          lead_b_id: string
          lead_b_name: string
          lead_b_phone: string
          match_type: string
          similarity: number
        }[]
      }
      find_leads_no_reply: {
        Args: { p_cutoff: string; p_limit?: number; p_organization_id: string }
        Returns: {
          id: string
        }[]
      }
      fire_workflow_trigger: {
        Args: {
          p_context?: Json
          p_lead_id: string
          p_organization_id: string
          p_trigger_type: string
          p_triggered_by_execution_id?: string
        }
        Returns: number
      }
      fn_avisos_pendentes_de_push: {
        Args: {
          p_idade_maxima?: string
          p_janela_de_presenca?: string
          p_limite?: number
        }
        Returns: {
          aviso_id: string
          description: string
          group_key: string
          link: string
          organization_id: string
          title: string
          type: string
          user_id: string
        }[]
      }
      fn_backfill_carteira_orders: {
        Args: {
          p_dry_run?: boolean
          p_exclude_ids?: string[]
          p_org_id?: string
        }
        Returns: {
          carteira: number
          emitidos: number
          excluidos: number
          ja_existiam: number
          novo_negocio: number
          pedidos_avaliados: number
          sem_lead: number
          valor_emitido: number
        }[]
      }
      fn_backfill_parse_sale_value: { Args: { p_raw: string }; Returns: number }
      fn_backfill_state_sales: { Args: never; Returns: number }
      fn_composable_metrics_enabled: {
        Args: { p_org_id: string }
        Returns: boolean
      }
      fn_dashboard_snapshot: {
        Args: {
          p_end?: string
          p_org_id: string
          p_page_id: string
          p_period?: string
          p_ref?: string
          p_start?: string
        }
        Returns: Json
      }
      fn_dono_do_lead: { Args: { p_lead_id: string }; Returns: string }
      fn_emit_aviso: {
        Args: {
          p_description?: string
          p_entity_id?: string
          p_group_key: string
          p_lead_id?: string
          p_link?: string
          p_occurred_at?: string
          p_organization_id: string
          p_title: string
          p_type: string
          p_user_id: string
        }
        Returns: string
      }
      fn_emit_aviso_admins: {
        Args: {
          p_description?: string
          p_entity_id?: string
          p_group_key: string
          p_link?: string
          p_occurred_at?: string
          p_organization_id: string
          p_title: string
          p_type: string
        }
        Returns: number
      }
      fn_funnel_flow_step: {
        Args: {
          p_cohort_size: number
          p_prev: number
          p_reached: number
          p_role: string
        }
        Returns: Json
      }
      fn_limpar_avisos: {
        Args: {
          p_lote?: number
          p_max_lotes?: number
          p_prazo_lido?: string
          p_prazo_nao_lido?: string
        }
        Returns: number
      }
      fn_marcar_push_enviado: {
        Args: { p_aviso_ids: string[] }
        Returns: number
      }
      fn_medicao_de_ruido: {
        Args: { p_dias?: number }
        Returns: {
          avisos: number
          dia: string
          eventos: number
          lidos: number
          organization_id: string
          type: string
          user_id: string
        }[]
      }
      fn_metric_catalog: { Args: never; Returns: Json }
      fn_metric_measure: {
        Args: {
          p_end?: string
          p_filters?: Json
          p_measure_ref: Json
          p_org_id: string
          p_period?: string
          p_recorte: string
          p_ref?: string
          p_start?: string
        }
        Returns: Json
      }
      fn_metric_tree_validate: { Args: { p_tree: Json }; Returns: string }
      fn_negocio_titulo_padrao: {
        Args: { p_timezone?: string; p_when: string }
        Returns: string
      }
      fn_phone_match_forms: { Args: { p_canonical: string }; Returns: string[] }
      fn_pico_de_avisos_quentes: {
        Args: { p_dias?: number }
        Returns: {
          hora: string
          organization_id: string
          quentes: number
          user_id: string
        }[]
      }
      fn_preferencias_de_aviso: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: Json
      }
      fn_publish_dashboard_page: {
        Args: { p_org_id: string; p_page_id: string }
        Returns: Json
      }
      fn_reetiqueta_funnel_streams: {
        Args: { p_dry_run?: boolean; p_org_id?: string }
        Returns: {
          avaliadas: number
          ja_corrigidas: number
          para_carteira: number
          para_novo: number
          reescritas: number
          valor_movido: number
        }[]
      }
      fn_registrar_presenca: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      fn_reserve_send: {
        Args: {
          p_content_hash: string
          p_idempotency_key: string
          p_org_id: string
          p_phone: string
          p_source: string
          p_ttl_seconds: number
        }
        Returns: number
      }
      fn_rollback_carteira_backfill: {
        Args: { p_org_id?: string }
        Returns: number
      }
      fn_rollback_reetiqueta_funnel: {
        Args: { p_org_id?: string }
        Returns: number
      }
      fn_seed_default_dashboard: { Args: { p_org_id: string }; Returns: Json }
      fn_varredura_avisos_followups: { Args: never; Returns: number }
      fn_varredura_avisos_reuniao_proxima: { Args: never; Returns: number }
      fn_voip_apply_vps_event: {
        Args: {
          p_epoch: number
          p_event_jti: string
          p_payload: Json
          p_seq: number
          p_sid: string
          p_signed_at: string
        }
        Returns: Json
      }
      fn_voip_call_reserve: {
        Args: {
          p_consent_record_id?: string
          p_direction?: string
          p_existing_call_id?: string
          p_lead_id?: string
          p_operator_user_id: string
          p_organization_id: string
          p_peer_phone: string
          p_tc_session_id: string
        }
        Returns: Json
      }
      fn_voip_can_hear_recording: {
        Args: { object_name: string }
        Returns: boolean
      }
      fn_voip_can_use_instance: {
        Args: { p_instance_id: string; p_user_id: string }
        Returns: boolean
      }
      fn_voip_consent_record: {
        Args: {
          p_contact_phone?: string
          p_granted: boolean
          p_ip_address?: string
          p_lead_id: string
          p_metadata?: Json
          p_organization_id: string
          p_source: string
          p_user_agent?: string
        }
        Returns: string
      }
      fn_voip_project_call_log: { Args: { p_call_id: string }; Returns: string }
      fn_voip_recording_announced: {
        Args: { p_bytes: number; p_call_id: string; p_duration_ms: number }
        Returns: string
      }
      fn_voip_recording_failed: {
        Args: { p_call_id: string; p_reason: string }
        Returns: string
      }
      fn_voip_recording_fetch_failed: {
        Args: { p_call_id: string; p_reason: string }
        Returns: string
      }
      fn_voip_recording_purge_candidates: {
        Args: { p_limit?: number }
        Returns: {
          call_id: string
          object_path: string
          organization_id: string
        }[]
      }
      fn_voip_recording_purged: { Args: { p_call_id: string }; Returns: string }
      fn_voip_recording_retry_claim: {
        Args: { p_limit?: number }
        Returns: {
          call_id: string
          organization_id: string
          refetch_count: number
          tc_call_id: string
          tc_session_id: string
        }[]
      }
      fn_voip_recording_retry_delay: {
        Args: { p_refetch_count: number }
        Returns: string
      }
      fn_voip_recording_stored: {
        Args: { p_bytes: number; p_call_id: string; p_path: string }
        Returns: string
      }
      garantir_negocio_da_entrada: {
        Args: { p_entry_id: string }
        Returns: string
      }
      generate_api_key: {
        Args: {
          p_created_by: string
          p_expires_at?: string
          p_name: string
          p_org_id: string
          p_rate_limit_per_minute?: number
          p_scopes?: string[]
        }
        Returns: Json
      }
      generate_product_sku: {
        Args: { p_organization_id: string; p_type: string }
        Returns: string
      }
      generate_variant_sku: {
        Args: { p_organization_id: string; p_parent_sku: string }
        Returns: string
      }
      get_activities: {
        Args: {
          p_company_id?: string
          p_contact_id?: string
          p_deal_id?: string
          p_lead_id?: string
          p_limit?: number
          p_offset?: number
          p_type?: string
        }
        Returns: {
          assigned_name: string
          assigned_to: string
          company_id: string
          completed_at: string
          contact_id: string
          created_at: string
          deal_id: string
          description: string
          due_date: string
          duration_sec: number
          id: string
          is_automated: boolean
          lead_id: string
          metadata: Json
          outcome: string
          owner_email: string
          owner_id: string
          source: string
          subject: string
          type: string
        }[]
      }
      get_agenda_events: {
        Args: { p_end: string; p_organization_id: string; p_start: string }
        Returns: {
          all_day: boolean
          color: string
          created_by: string
          creator_name: string
          description: string
          end_at: string
          event_type: string
          google_event_id: string
          id: string
          lead_company: string
          lead_id: string
          lead_name: string
          location: string
          meet_link: string
          source: string
          start_at: string
          status: string
          title: string
        }[]
      }
      get_all_funnels_lead_ids: {
        Args: {
          p_organization_id?: string
          p_origin?: string[]
          p_pre_qualification_tier?: string[]
          p_qualification_tier?: string[]
          p_tag_ids?: string[]
        }
        Returns: string[]
      }
      get_analytics_commercial_metrics: {
        Args: {
          p_end_date: string
          p_member_id?: string
          p_org_id: string
          p_origin?: string
          p_start_date: string
        }
        Returns: Json
      }
      get_analytics_engagement_metrics: {
        Args: {
          p_end_date: string
          p_member_id?: string
          p_org_id: string
          p_origin?: string
          p_start_date: string
        }
        Returns: Json
      }
      get_analytics_financial_metrics: {
        Args: {
          p_end_date: string
          p_member_id?: string
          p_org_id: string
          p_origin?: string
          p_start_date: string
        }
        Returns: Json
      }
      get_analytics_overview_metrics: {
        Args: {
          p_end_date: string
          p_member_id?: string
          p_org_id: string
          p_origin?: string
          p_start_date: string
        }
        Returns: Json
      }
      get_analytics_pipeline_metrics: {
        Args: {
          p_end_date: string
          p_member_id?: string
          p_org_id: string
          p_pipeline_type?: string
          p_start_date: string
        }
        Returns: Json
      }
      get_analytics_utm_metrics: {
        Args: {
          p_ad?: string
          p_adset?: string
          p_campaign?: string
          p_end_date: string
          p_level?: string
          p_member_id?: string
          p_org_id: string
          p_start_date: string
        }
        Returns: Json
      }
      get_carteira_lead_ids: {
        Args: {
          p_organization_id?: string
          p_origin?: string[]
          p_pre_qualification_tier?: string[]
          p_qualification_tier?: string[]
          p_search?: string
          p_segments?: string[]
          p_tag_ids?: string[]
        }
        Returns: string[]
      }
      get_comando_agenda_events: {
        Args: { p_end: string; p_organization_id: string; p_start: string }
        Returns: {
          all_day: boolean
          color: string
          created_by: string
          creator_name: string
          description: string
          end_at: string
          event_type: string
          google_event_id: string
          id: string
          lead_company: string
          lead_id: string
          lead_name: string
          location: string
          meet_link: string
          owner_team_member_id: string
          source: string
          start_at: string
          status: string
          title: string
        }[]
      }
      get_commission_ledger: {
        Args: {
          p_end?: string
          p_filter_member_id?: string
          p_org_id: string
          p_period: string
          p_ref?: string
          p_start?: string
        }
        Returns: Json
      }
      get_competitor_stats: {
        Args: { p_org_id: string }
        Returns: {
          competitor_id: string
          competitor_name: string
          total_encounters: number
          total_wins: number
          win_rate: number
        }[]
      }
      get_conversas_do_lead: {
        Args: { p_organization_id: string; p_phone: string }
        Returns: {
          instance_id: string
          instance_name: string
          instance_status: string
          last_message_at: string
          last_message_content: string
          last_message_direction: string
        }[]
      }
      get_conversations_awaiting_human_reply: {
        Args: {
          p_instance: string
          p_limit?: number
          p_org: string
          p_window_days?: number
        }
        Returns: {
          ai_replied: boolean
          ai_replied_at: string
          conversation_id: string
          last_client_message: string
          last_client_message_at: string
          lead_id: string
          normalized_phone: string
          owner_name: string
          owner_team_member_id: string
          phone_number: string
          push_name: string
          waiting_total: number
        }[]
      }
      get_custom_filtered_lead_ids: {
        Args: {
          p_organization_id?: string
          p_origin?: string[]
          p_pipeline_id: string
          p_pre_qualification_tier?: string[]
          p_qualification_tier?: string[]
          p_responsible_id?: string
          p_search?: string
          p_stage_id?: string
          p_tag_ids?: string[]
        }
        Returns: string[]
      }
      get_custom_pipeline_stage_counts: {
        Args: { p_org_id: string; p_pipeline_id: string; p_search?: string }
        Returns: {
          cnt: number
          stage_id: string
        }[]
      }
      get_dashboard_metrics: {
        Args: {
          p_end_date: string
          p_filter_member_id?: string
          p_org_id: string
          p_start_date: string
        }
        Returns: Json
      }
      get_dormant_winback_candidates: {
        Args: { p_organization_id: string; p_segments: string[] }
        Returns: {
          carteira_segment: string
          last_inbound_at: string
          last_order_at: string
          last_outbound_at: string
          lead_id: string
        }[]
      }
      get_email_thread: {
        Args: { p_thread_id: string }
        Returns: {
          body_html: string
          body_text: string
          cc_addresses: Json
          click_count: number
          from_address: string
          from_name: string
          has_attachments: boolean
          id: string
          is_outbound: boolean
          message_id: string
          open_count: number
          read_at: string
          sent_at: string
          snippet: string
          subject: string
          to_addresses: Json
        }[]
      }
      get_filtered_lead_ids: {
        Args: {
          p_organization_id?: string
          p_origin?: string[]
          p_pipeline_type: string
          p_pre_qualification_tier?: string[]
          p_qualification_tier?: string[]
          p_responsible_id?: string
          p_search?: string
          p_stage_key?: string
          p_tag_ids?: string[]
        }
        Returns: string[]
      }
      get_followup_eligible_leads: {
        Args: {
          p_organization_id: string
          p_trigger_delay_hours: number
          p_trigger_delay_minutes: number
        }
        Returns: {
          last_outgoing_at: string
          lead_id: string
          phone_number: string
        }[]
      }
      get_funnel_conversion: {
        Args: {
          p_end_date?: string
          p_pipeline_type: string
          p_start_date?: string
        }
        Returns: {
          conversion_rate: number
          stage_id: string
          stage_name: string
          stage_order: number
          total_current: number
          total_entered: number
        }[]
      }
      get_funnel_flow: {
        Args: {
          p_end?: string
          p_org_id: string
          p_period: string
          p_pipeline_id: string
          p_ref?: string
          p_start?: string
        }
        Returns: Json
      }
      get_funnel_health: {
        Args: {
          p_end_date: string
          p_org_id: string
          p_origins?: string[]
          p_start_date: string
        }
        Returns: Json
      }
      get_funnel_health_stage_leads: {
        Args: {
          p_end_date: string
          p_org_id: string
          p_origins?: string[]
          p_stage: string
          p_start_date: string
        }
        Returns: Json
      }
      get_help_article_feedback_summaries: {
        Args: never
        Returns: {
          article_id: string
          helpful_down: number
          helpful_up: number
          reasons: string[]
        }[]
      }
      get_import_batches: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          created_by_name: string
          error_count: number
          file_name: string
          id: string
          imported_count: number
          rolled_back: boolean
          rolled_back_at: string
          skipped_count: number
          total_rows: number
        }[]
      }
      get_jobs_overview: { Args: { interval_param?: string }; Returns: Json }
      get_lead_ai_status: { Args: { p_lead_id: string }; Returns: Json }
      get_lead_field_changes: {
        Args: { p_lead_id: string; p_limit?: number }
        Returns: {
          changed_at: string
          changed_by: string
          entity_id: string
          entity_type: string
          field_name: string
          id: string
          new_value: string
          old_value: string
          user_name: string
        }[]
      }
      get_lead_write_instance: {
        Args: { p_lead_id: string }
        Returns: {
          error_code: string
          instance_id: string
          instance_name: string
          owner_team_member_id: string
          responsible_user_id: string
        }[]
      }
      get_leads_by_uf: {
        Args: { p_limit?: number; p_org_id?: string; p_uf: string }
        Returns: {
          company: string
          created_at: string
          id: string
          is_client: boolean
          name: string
          phone: string
          sold_value: number
          uf_source: string
        }[]
      }
      get_leads_no_response_from_lead: {
        Args: {
          p_delay_hours: number
          p_delay_minutes: number
          p_filter_stages?: string[]
          p_organization_id: string
          p_pipe_type?: string
        }
        Returns: {
          last_outgoing_at: string
          lead_id: string
          phone_number: string
        }[]
      }
      get_leads_not_confirmed: {
        Args: {
          p_filter_stages?: string[]
          p_hours_before_meeting: number
          p_minutes_before_meeting: number
          p_organization_id: string
        }
        Returns: {
          confirmacao_id: string
          current_status: string
          lead_id: string
          meeting_date: string
        }[]
      }
      get_leads_team_no_response: {
        Args: {
          p_delay_hours: number
          p_delay_minutes: number
          p_filter_stages?: string[]
          p_organization_id: string
          p_pipe_type?: string
        }
        Returns: {
          last_incoming_at: string
          lead_id: string
          phone_number: string
        }[]
      }
      get_meeting_reminder_candidates: {
        Args: { p_organization_id: string; p_stage_keys: string[] }
        Returns: {
          last_inbound_at: string
          last_outbound_at: string
          lead_id: string
          meeting_date: string
          whatsapp_stage: string
        }[]
      }
      get_meta_cloud_credentials: {
        Args: { p_instance_id: string }
        Returns: {
          meta_access_token: string
          meta_phone_number_id: string
          meta_waba_id: string
          organization_id: string
        }[]
      }
      get_mkt_origin_metrics: {
        Args: {
          p_end_date: string
          p_member_id?: string
          p_org_id: string
          p_start_date: string
        }
        Returns: Json
      }
      get_movement_metrics: {
        Args: {
          p_end: string
          p_member_id?: string
          p_org_id: string
          p_start: string
        }
        Returns: {
          comparecidas: number
          marcadas: number
          vendido_count: number
          vendido_receita: number
        }[]
      }
      get_my_admin_organization_ids: { Args: never; Returns: string[] }
      get_my_gestor_organization_ids: { Args: never; Returns: string[] }
      get_my_member_organization_ids: { Args: never; Returns: string[] }
      get_my_org_ids: { Args: never; Returns: string[] }
      get_my_organization_ids: { Args: never; Returns: string[] }
      get_my_team_admin_organization_ids: { Args: never; Returns: string[] }
      get_my_team_member_ids: { Args: never; Returns: string[] }
      get_next_best_actions: {
        Args: { p_limit?: number; p_org_id?: string }
        Returns: {
          action_type: string
          deal_id: string
          due_by: string
          id: string
          lead_id: string
          lead_name: string
          metadata: Json
          priority: number
          reason: string
          title: string
        }[]
      }
      get_next_campaign_closer: {
        Args: { p_campaign_id: string }
        Returns: string
      }
      get_next_campaign_sdr: {
        Args: { p_campaign_id: string }
        Returns: string
      }
      get_next_pipe_closer: {
        Args: { p_organization_id: string; p_pipe_type: string }
        Returns: string
      }
      get_next_pipe_sdr: {
        Args: { p_organization_id: string; p_pipe_type: string }
        Returns: string
      }
      get_next_round_robin_member: {
        Args: {
          p_member_ids: string[]
          p_node_id: string
          p_organization_id: string
          p_workflow_id: string
        }
        Returns: string
      }
      get_official_whatsapp_conversation_list: {
        Args: {
          p_before?: string
          p_instance: string
          p_limit?: number
          p_org: string
        }
        Returns: {
          contact_external_id: string
          contact_handle: string
          last_message: string
          last_message_direction: string
          last_message_time: string
          lead_id: string
          lead_name: string
          sender_name: string
          sender_profile_pic: string
          unread_count: number
        }[]
      }
      get_operations_overview: {
        Args: { interval_param?: string }
        Returns: Json
      }
      get_org_team_member_ids: { Args: never; Returns: string[] }
      get_pending_meta_conversion_signals: {
        Args: never
        Returns: {
          ad_account_id: string
          dataset_override: string
          email: string
          event_name: string
          lead_id: string
          meta_lead_id: string
          organization_id: string
          phone: string
        }[]
      }
      get_pending_orders: {
        Args: { p_org_id: string; p_page?: number; p_page_size?: number }
        Returns: Json
      }
      get_phone_ai_status: {
        Args: { p_organization_id?: string; p_phone: string }
        Returns: Json
      }
      get_pipeline_page: {
        Args: {
          p_calor_max?: number
          p_calor_min?: number
          p_closed_status_keys?: string[]
          p_cursor?: string
          p_meeting_after?: string
          p_meeting_before?: string
          p_org_id: string
          p_origins?: string[]
          p_overdue_exclude_status_keys?: string[]
          p_page_size?: number
          p_period_after?: string
          p_period_before?: string
          p_pipeline_slug: string
          p_pre_qualification_tier?: string[]
          p_product_type?: string
          p_qualification_tier?: string[]
          p_rating_max?: number
          p_rating_min?: number
          p_responsible_id?: string
          p_scheduled?: boolean
          p_search?: string
          p_stage_id: string
          p_stalled_max_days?: number
          p_stalled_min_days?: number
          p_status_keys?: string[]
          p_tag_ids?: string[]
          p_updated_before?: string
          p_urgency?: string
        }
        Returns: {
          assigned_to: string
          created_at: string
          entered_at: string
          id: string
          lead: Json
          lead_id: string
          metadata: Json
          notes: string
          pipeline_id: string
          stage_changed_at: string
          stage_key: string
          updated_at: string
        }[]
      }
      get_pipeline_stage_counts: {
        Args: {
          p_calor_max?: number
          p_calor_min?: number
          p_closed_status_keys?: string[]
          p_meeting_after?: string
          p_meeting_before?: string
          p_org_id: string
          p_origins?: string[]
          p_overdue_exclude_status_keys?: string[]
          p_period_after?: string
          p_period_before?: string
          p_pipeline_slug: string
          p_pre_qualification_tier?: string[]
          p_product_type?: string
          p_qualification_tier?: string[]
          p_rating_max?: number
          p_rating_min?: number
          p_responsible_id?: string
          p_scheduled?: boolean
          p_search?: string
          p_stalled_max_days?: number
          p_stalled_min_days?: number
          p_status_keys?: string[]
          p_tag_ids?: string[]
          p_updated_before?: string
          p_urgency?: string
        }
        Returns: {
          cnt: number
          stage_key: string
        }[]
      }
      get_pipeline_velocity: {
        Args: {
          p_end_date?: string
          p_pipeline_type: string
          p_start_date?: string
        }
        Returns: Json
      }
      get_portfolio_clients: {
        Args: {
          p_filter?: string
          p_org_id: string
          p_page?: number
          p_page_size?: number
          p_search?: string
          p_sort_by?: string
          p_sort_dir?: string
        }
        Returns: Json
      }
      get_portfolio_kpis: { Args: { p_org_id: string }; Returns: Json }
      get_portfolio_trends: {
        Args: { p_months?: number; p_org_id: string }
        Returns: Json
      }
      get_product_ranking: {
        Args: { p_end_date: string; p_org_id: string; p_start_date: string }
        Returns: Json
      }
      get_productivity_activity: {
        Args: {
          p_from: string
          p_org_id: string
          p_seller?: string
          p_to: string
        }
        Returns: Json
      }
      get_productivity_activity_by_seller: {
        Args: { p_from: string; p_org_id: string; p_to: string }
        Returns: Json
      }
      get_productivity_activity_leads: {
        Args: {
          p_count_type: string
          p_from: string
          p_org_id: string
          p_seller?: string
          p_to: string
        }
        Returns: Json
      }
      get_proposal_no_reply_candidates: {
        Args: { p_organization_id: string; p_stage_keys: string[] }
        Returns: {
          last_inbound_at: string
          last_outbound_at: string
          lead_id: string
          propostas_stage: string
        }[]
      }
      get_ranking: {
        Args: {
          p_end?: string
          p_org_id: string
          p_period: string
          p_pipeline_id?: string
          p_ref?: string
          p_start?: string
        }
        Returns: Json
      }
      get_ranking_data: {
        Args: { p_month: number; p_organization_id?: string; p_year: number }
        Returns: Json
      }
      get_recent_items: {
        Args: { p_entity_type?: string; p_limit?: number }
        Returns: {
          entity_id: string
          entity_label: string
          entity_type: string
          id: string
          viewed_at: string
        }[]
      }
      get_revenue_at_risk: { Args: { p_org_id: string }; Returns: Json }
      get_revenue_attribution: {
        Args: { p_end_date?: string; p_start_date?: string }
        Returns: {
          avg_deal_value: number
          conversion_rate: number
          lead_count: number
          origin: string
          total_revenue: number
          won_count: number
        }[]
      }
      get_sales_cycle_analysis: {
        Args: {
          p_end_date?: string
          p_org_id?: string
          p_pipeline_type?: string
          p_start_date?: string
        }
        Returns: {
          avg_hours: number
          from_stage: string
          median_hours: number
          to_stage: string
          transition_count: number
        }[]
      }
      get_sales_metrics: {
        Args: {
          p_end?: string
          p_filter_member_id?: string
          p_org_id: string
          p_period: string
          p_pipeline_id?: string
          p_ref?: string
          p_start?: string
        }
        Returns: Json
      }
      get_segment_benchmark: { Args: { p_org_id: string }; Returns: Json }
      get_seller_activity_scores: {
        Args: { p_end_date: string; p_org_id: string; p_start_date: string }
        Returns: Json
      }
      get_social_conversation_list: {
        Args: {
          p_before?: string
          p_channel: string
          p_limit?: number
          p_org: string
        }
        Returns: {
          contact_external_id: string
          last_message: string
          last_message_direction: string
          last_message_time: string
          lead_id: string
          sender_name: string
          sender_profile_pic: string
          unread_count: number
        }[]
      }
      get_stage_lead_ids: {
        Args: {
          p_organization_id?: string
          p_pipeline_type: string
          p_stage_key: string
        }
        Returns: string[]
      }
      get_trash_leads: {
        Args: { p_org_id?: string }
        Returns: {
          company: string
          deleted_at: string
          deleted_by: string
          email: string
          id: string
          name: string
          phone: string
        }[]
      }
      get_uazapi_credentials: {
        Args: { p_instance_id: string }
        Returns: {
          organization_id: string
          uazapi_instance_id: string
          uazapi_token: string
          webhook_secret: string
        }[]
      }
      get_uf_heatmap: {
        Args: { p_org_id?: string }
        Returns: {
          clients_count: number
          leads_count: number
          total_sold: number
          uf: string
          unmapped_count: number
        }[]
      }
      get_unified_conversations: {
        Args: { p_channel?: string; p_limit?: number }
        Returns: {
          channel: string
          last_direction: string
          last_message: string
          last_sender: string
          last_sent_at: string
          lead_email: string
          lead_id: string
          lead_name: string
          lead_phone: string
          unread_count: number
        }[]
      }
      get_unread_counts: {
        Args: { p_instance_ids: string[] }
        Returns: {
          instance_id: string
          normalized_phone: string
          unread: number
        }[]
      }
      get_unread_total: { Args: { p_instance_ids: string[] }; Returns: number }
      get_usage_by_org: {
        Args: { interval_param?: string }
        Returns: {
          cards_movidos: number
          leads_criados: number
          mensagens_enviadas: number
          organization_id: string
          organization_name: string
          total_events: number
          ultima_atividade: string
        }[]
      }
      get_user_org_role: { Args: never; Returns: string }
      get_user_organization_id: { Args: never; Returns: string }
      get_user_write_instance: {
        Args: { p_organization_id: string; p_user_id: string }
        Returns: {
          instance_id: string
          instance_name: string
        }[]
      }
      get_vendedor_ranking: { Args: { p_org_id: string }; Returns: Json }
      get_whatsapp_conversation_list: {
        Args: {
          p_before?: string
          p_funnels?: string[]
          p_instance: string
          p_lead_presence?: string
          p_limit?: number
          p_needs_human?: boolean
          p_org: string
          p_source?: string
          p_stages?: string[]
          p_tags?: string[]
          p_tiers?: string[]
          p_unassigned?: boolean
          p_unread?: boolean
          p_vendor_id?: string
          p_waiting?: boolean
        }
        Returns: {
          archived_at: string
          conversation_id: string
          is_group: boolean
          last_message: string
          last_message_direction: string
          last_message_sent_source: string
          last_message_time: string
          lead_id: string
          normalized_phone: string
          phone_number: string
          push_name: string
          unread_count: number
        }[]
      }
      get_whatsapp_situation_candidates: {
        Args: { p_organization_id: string; p_stage_keys: string[] }
        Returns: {
          last_inbound_at: string
          last_outbound_at: string
          lead_id: string
          stage_changed_at: string
          whatsapp_stage: string
        }[]
      }
      get_win_loss_analysis: {
        Args: { p_end_date?: string; p_org_id?: string; p_start_date?: string }
        Returns: {
          count: number
          loss_reason: string
          pct: number
          total_value: number
        }[]
      }
      get_workflow_node_stats: {
        Args: { p_workflow_id: string }
        Returns: {
          avg_duration_ms: number
          error_count: number
          executions_count: number
          node_id: string
          success_count: number
        }[]
      }
      has_concurrent_ai_action: {
        Args: { p_action_type: string; p_exclude_id: string; p_lead_id: string }
        Returns: boolean
      }
      has_feature: {
        Args: { _feature_key: string; _org_id: string }
        Returns: boolean
      }
      has_feature_permission:
        | { Args: { p_feature_key: string }; Returns: boolean }
        | {
            Args: { p_feature_key: string; p_org_id: string }
            Returns: boolean
          }
      has_no_responsible: {
        Args: { p_assigned_to: string; p_closer_id: string; p_sdr_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      history_sync_consume_budget: {
        Args: { p_organization_id: string; p_rows: number }
        Returns: number
      }
      import_lead_into_custom_pipeline: {
        Args: {
          p_assigned_to?: string
          p_lead: Json
          p_organization_id: string
          p_pipeline_id: string
          p_stage_id: string
        }
        Returns: string
      }
      increment: {
        Args: { column_name: string; row_id: string; table_name: string }
        Returns: undefined
      }
      increment_automation_daily_usage: {
        Args: { p_count: number; p_instance_id: string; p_usage_date: string }
        Returns: number
      }
      increment_blast_daily_usage: {
        Args: { p_count: number; p_org_id: string; p_usage_date: string }
        Returns: number
      }
      increment_conversation_turn: {
        Args: { p_conversation_id: string; p_new_state?: string }
        Returns: undefined
      }
      increment_coupon_uses: { Args: { p_coupon_id: string }; Returns: boolean }
      increment_instance_daily_usage: {
        Args: { p_count: number; p_instance_id: string; p_usage_date: string }
        Returns: number
      }
      inv_public_tables_readable_by_anon: {
        Args: never
        Returns: {
          grantee: string
          schemaname: unknown
          tablename: unknown
        }[]
      }
      inv_scan_public_tables_readable_by_anon: { Args: never; Returns: Json }
      invoke_billing_provision_worker: { Args: never; Returns: undefined }
      invoke_blast_plan_release: { Args: never; Returns: undefined }
      invoke_calculate_portfolio_health: { Args: never; Returns: undefined }
      invoke_campaign_rule_dispatch: { Args: never; Returns: undefined }
      invoke_copilot_v2_worker: { Args: never; Returns: undefined }
      invoke_cron_health_check: { Args: never; Returns: undefined }
      invoke_followup_reclassify: { Args: never; Returns: undefined }
      invoke_history_sync_worker: { Args: never; Returns: undefined }
      invoke_infra_watchdog: { Args: never; Returns: undefined }
      invoke_mass_send_status: { Args: never; Returns: undefined }
      invoke_meta_conversion_dispatch: { Args: never; Returns: undefined }
      invoke_meta_leadgen_poll: { Args: never; Returns: undefined }
      invoke_notificame_subscription_repair: { Args: never; Returns: undefined }
      invoke_omie_sync_dispatch: { Args: never; Returns: undefined }
      invoke_pipe_rule_dispatch: { Args: never; Returns: undefined }
      invoke_process_ai_actions: { Args: never; Returns: undefined }
      invoke_process_blast_recipients: { Args: never; Returns: undefined }
      invoke_process_copilot_followups: { Args: never; Returns: undefined }
      invoke_process_followup_automations: { Args: never; Returns: undefined }
      invoke_process_followup_situations: { Args: never; Returns: undefined }
      invoke_process_outbound_dispatches: { Args: never; Returns: undefined }
      invoke_process_scheduled_user_messages: {
        Args: never
        Returns: undefined
      }
      invoke_process_webhook_deliveries: { Args: never; Returns: undefined }
      invoke_process_workflow_executions: { Args: never; Returns: undefined }
      invoke_refresh_meta_tokens: { Args: never; Returns: undefined }
      invoke_retry_dead_letter_jobs: { Args: never; Returns: undefined }
      invoke_send_push: { Args: never; Returns: undefined }
      invoke_torquecalls_recording_maintenance: {
        Args: never
        Returns: undefined
      }
      invoke_toth_sync: { Args: { p_fn: string }; Returns: undefined }
      invoke_whatsapp_dlq_replay: { Args: never; Returns: undefined }
      invoke_whatsapp_health_monitor: { Args: never; Returns: undefined }
      invoke_whatsapp_instance_reaper: { Args: never; Returns: undefined }
      invoke_whatsapp_media_retention: { Args: never; Returns: undefined }
      invoke_whatsapp_media_retry: { Args: never; Returns: undefined }
      invoke_whatsapp_session_watchdog: { Args: never; Returns: undefined }
      invoke_workflow_cron_triggers: { Args: never; Returns: undefined }
      is_admin_or_closer: { Args: never; Returns: boolean }
      is_campanha_member: { Args: { p_campanha_id: string }; Returns: boolean }
      is_campanha_viewer: { Args: { p_campanha_id: string }; Returns: boolean }
      is_master_user: { Args: { _user_id?: string }; Returns: boolean }
      is_org_admin: { Args: { p_organization_id: string }; Returns: boolean }
      is_responsible_in_same_org: {
        Args: { p_closer_id: string; p_sdr_id: string }
        Returns: boolean
      }
      is_team_member: { Args: { _user_id: string }; Returns: boolean }
      is_user_admin: { Args: never; Returns: boolean }
      is_user_responsible:
        | { Args: { p_pre_sale: string; p_sale: string }; Returns: boolean }
        | { Args: { p_responsible_id: string }; Returns: boolean }
        | {
            Args: {
              p_assigned_to: string
              p_closer_id: string
              p_sdr_id: string
            }
            Returns: boolean
          }
      is_user_responsible_in_any_pipe: {
        Args: { p_lead_id: string }
        Returns: boolean
      }
      is_valid_timezone: { Args: { p_tz: string }; Returns: boolean }
      lead_excluded_from_metrics: {
        Args: { p_lead_id: string; p_org_id: string }
        Returns: boolean
      }
      lead_in_my_org: { Args: { p_lead_id: string }; Returns: boolean }
      link_agent_to_instance: {
        Args: { p_agent_id: string; p_instance_id: string }
        Returns: undefined
      }
      link_meta_conversation_to_lead: {
        Args: { p_conversation_id: string; p_lead_id: string }
        Returns: undefined
      }
      link_social_conversation_to_lead: {
        Args: {
          p_channel: string
          p_external_user_id: string
          p_lead_id: string
          p_org: string
        }
        Returns: string
      }
      list_expired_whatsapp_media: {
        Args: { p_limit?: number; p_older_than_days?: number }
        Returns: Json
      }
      log_activity: {
        Args: {
          p_company_id?: string
          p_contact_id?: string
          p_deal_id?: string
          p_description?: string
          p_lead_id?: string
          p_metadata?: Json
          p_subject?: string
          p_type: string
        }
        Returns: string
      }
      mark_conversation_read: {
        Args: { p_instance_id: string; p_normalized_phone: string }
        Returns: undefined
      }
      mark_meta_conversation_read: {
        Args: { p_conversation_id: string }
        Returns: undefined
      }
      mark_purged: { Args: { p_names: string[] }; Returns: number }
      master_add_user: {
        Args: { _email: string; _notes?: string }
        Returns: string
      }
      master_disable_feature: {
        Args: { _feature_key: string; _org_id: string; _reason: string }
        Returns: undefined
      }
      master_enable_feature: {
        Args: {
          _expires_at?: string
          _feature_key: string
          _org_id: string
          _reason: string
        }
        Returns: undefined
      }
      master_get_org_sales_summary: {
        Args: { p_end: string; p_org_id: string; p_start: string }
        Returns: Json
      }
      master_org_user_activity: {
        Args: { p_window_minutes?: number }
        Returns: {
          is_master: boolean
          is_online: boolean
          last_seen_at: string
          member_email: string
          member_id: string
          member_name: string
          member_role: string
          org_name: string
          org_subscription_status: string
          organization_id: string
          user_id: string
        }[]
      }
      master_override_billing: {
        Args: {
          _expires_at?: string
          _org_id: string
          _plan: string
          _reason: string
        }
        Returns: undefined
      }
      master_remove_user: {
        Args: { _target_user_id: string }
        Returns: undefined
      }
      master_set_copilot_disabled: {
        Args: { p_disabled: boolean; p_lead_id: string }
        Returns: Json
      }
      master_set_org_suspension: {
        Args: { _org_id: string; _reason?: string; _suspend: boolean }
        Returns: Json
      }
      master_workflow_config_scan: {
        Args: never
        Returns: {
          nodes: Json
          organization_id: string
          organization_name: string
          stage_keys: Json
          workflow_id: string
          workflow_name: string
        }[]
      }
      master_workflow_lag_by_org: {
        Args: { p_days?: number }
        Returns: {
          claims: number
          lag_max_ms: number
          lag_p50_ms: number
          lag_p90_ms: number
          organization_id: string
          organization_name: string
        }[]
      }
      master_workflow_lag_by_workflow: {
        Args: { p_days?: number; p_limit?: number }
        Returns: {
          claims: number
          lag_p90_ms: number
          organization_name: string
          workflow_id: string
          workflow_name: string
        }[]
      }
      master_workflow_pool_state: {
        Args: never
        Returns: {
          key: string
          value: string
        }[]
      }
      match_document_chunks: {
        Args: {
          agent_id_filter: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          content: string
          document_id: string
          id: string
          similarity: number
        }[]
      }
      match_faqs: {
        Args: {
          agent_id_filter: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          answer: string
          id: string
          question: string
          similarity: number
        }[]
      }
      match_lead_memories: {
        Args: {
          lead_id_filter: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          content: string
          id: string
          importance: number
          memory_type: string
          similarity: number
        }[]
      }
      match_onboarding_templates: {
        Args: { p_org_id: string; p_type: string }
        Returns: Json
      }
      matches_workflow_trigger_config: {
        Args: { p_config: Json; p_context: Json; p_trigger_type: string }
        Returns: boolean
      }
      mcp_exec_readonly_sql: {
        Args: { p_max_rows?: number; p_sql: string }
        Returns: Json
      }
      merge_leads: {
        Args: { p_keep_lead_id: string; p_merge_lead_id: string }
        Returns: undefined
      }
      metric_period_bounds: {
        Args: {
          p_end?: string
          p_org_id: string
          p_period: string
          p_ref?: string
          p_start?: string
        }
        Returns: unknown
      }
      metric_revenue_stream: {
        Args: {
          p_exclude_sale_event_id?: string
          p_lead_id: string
          p_org_id: string
          p_sold_at: string
        }
        Returns: string
      }
      metric_stage_role: {
        Args: {
          p_organization_id: string
          p_pipeline_id: string
          p_stage_key: string
        }
        Returns: Database["public"]["Enums"]["stage_role"]
      }
      migrate_follow_ups_to_activities: { Args: never; Returns: Json }
      migrate_leads_to_contacts_companies: {
        Args: { p_batch_size?: number }
        Returns: Json
      }
      mover_negocio: {
        Args: {
          p_assigned_to?: string
          p_entry_id: string
          p_stage_origem?: string
          p_target_pipeline_id: string
          p_target_stage_key: string
        }
        Returns: string
      }
      my_team_member_id: {
        Args: { p_organization_id: string }
        Returns: string
      }
      normalize_br_mobile: { Args: { digits: string }; Returns: string }
      normalize_brazilian_phone: { Args: { phone: string }; Returns: string }
      oraculo_metricas: {
        Args: {
          p_organization_id: string
          p_periodo_dias: number
          p_team_member_id: string
        }
        Returns: Json
      }
      org_access_blocked: { Args: { p_org_id: string }; Returns: boolean }
      org_check_limit: {
        Args: { p_limit_key: string; p_org_id: string }
        Returns: number
      }
      org_get_features_and_limits: { Args: { p_org_id: string }; Returns: Json }
      org_get_seat_usage: { Args: { p_org_id: string }; Returns: Json }
      org_get_subscription_status: { Args: { p_org_id: string }; Returns: Json }
      org_has_feature: {
        Args: { p_feature_key: string; p_org_id: string }
        Returns: boolean
      }
      org_resolve_all_quotas: { Args: { p_org_id: string }; Returns: Json }
      org_resolve_quota: {
        Args: { p_org_id: string; p_resource_key: string }
        Returns: Json
      }
      pg_buffercache_pages: { Args: never; Returns: Record<string, unknown>[] }
      pg_buffercache_summary: { Args: never; Returns: Record<string, unknown> }
      pg_buffercache_usage_counts: {
        Args: never
        Returns: Record<string, unknown>[]
      }
      preview_chat_restriction: { Args: { p_org_id: string }; Returns: Json }
      process_overdue_subscriptions: {
        Args: { p_grace_days?: number }
        Returns: {
          days_overdue: number
          new_status: string
          org_name: string
          organization_id: string
        }[]
      }
      purge_copilot_e_midia_logs: { Args: never; Returns: undefined }
      purge_expired_rate_limits: { Args: never; Returns: undefined }
      purge_expired_support_attachments: { Args: never; Returns: number }
      purge_lead: { Args: { p_lead_id: string }; Returns: undefined }
      purge_runtime_logs: { Args: never; Returns: undefined }
      recalc_upsell_client_metrics: {
        Args: { p_client_id: string }
        Returns: undefined
      }
      record_ban_signal: {
        Args: { p_code: number; p_instance_id: string }
        Returns: undefined
      }
      record_oraculo_usage: {
        Args: {
          p_org_id: string
          p_question: string
          p_response?: string
          p_user_id: string
        }
        Returns: Json
      }
      remove_demo_data: { Args: { p_org_id: string }; Returns: Json }
      reset_onboarding_state: {
        Args: { p_org_id: string; p_target_state?: string }
        Returns: undefined
      }
      resolve_org_for_rpc: { Args: { p_org_id?: string }; Returns: string }
      resolve_wait_response: {
        Args: {
          p_channel?: string
          p_lead_id: string
          p_organization_id: string
        }
        Returns: number
      }
      resolve_wait_response_by_phone: {
        Args: { p_channel?: string; p_organization_id: string; p_phone: string }
        Returns: number
      }
      restore_lead: { Args: { p_lead_id: string }; Returns: undefined }
      restore_leads_bulk: { Args: { p_lead_ids: string[] }; Returns: number }
      rollback_import_batch: { Args: { p_batch_id: string }; Returns: Json }
      save_document_content: {
        Args: { p_content: string; p_doc_id: string }
        Returns: undefined
      }
      schedule_pipe_rule_steps_from_position: {
        Args: {
          p_from_position?: number
          p_lead_id: string
          p_organization_id: string
          p_pipe_record_id: string
          p_pipe_type: string
          p_rule_id: string
          p_whatsapp_instance_id: string
        }
        Returns: boolean
      }
      schedule_rule_steps_from_position: {
        Args: {
          p_campanha_id: string
          p_campanha_lead_id: string
          p_from_position?: number
          p_lead_id: string
          p_rule_id: string
          p_whatsapp_instance_id: string
        }
        Returns: boolean
      }
      search_messages: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_org_id: string
          p_query: string
        }
        Returns: {
          content: string
          direction: string
          headline: string
          id: string
          instance_id: string
          lead_id: string
          phone_number: string
          rank: number
          timestamp: string
        }[]
      }
      seed_conversation_read_state: {
        Args: { p_entries: Json }
        Returns: number
      }
      seed_demo_data: { Args: { p_org_id: string }; Returns: Json }
      set_instance_owner: {
        Args: {
          p_instance_id: string
          p_new_owner_team_member_id: string
          p_reason?: string
        }
        Returns: string
      }
      set_instance_reputation: {
        Args: {
          p_instance_id: string
          p_quarantine_until: string
          p_state: string
        }
        Returns: undefined
      }
      set_meta_cloud_credentials: {
        Args: {
          p_instance_id: string
          p_meta_access_token: string
          p_meta_phone_number_id: string
          p_meta_waba_id: string
          p_organization_id: string
        }
        Returns: undefined
      }
      set_org_chat_restriction: {
        Args: { p_enabled: boolean; p_org_id: string }
        Returns: boolean
      }
      set_uazapi_credentials: {
        Args: {
          p_instance_id: string
          p_organization_id: string
          p_uazapi_instance_id?: string
          p_uazapi_token: string
          p_webhook_secret?: string
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      soft_delete_whatsapp_conversation: {
        Args: {
          p_instance_id: string
          p_organization_id: string
          p_phone_number: string
        }
        Returns: string
      }
      support_clock_is_internal: { Args: never; Returns: boolean }
      sweep_copilot_queue: {
        Args: { p_lease_seconds?: number }
        Returns: number
      }
      sync_org_quotas_from_plan: {
        Args: { p_org_id: string }
        Returns: undefined
      }
      system_pipeline_delete_impact: {
        Args: { p_org_id: string; p_pipe_type: string }
        Returns: Json
      }
      system_stage_role: {
        Args: { p_pipeline_type: string; p_stage_key: string }
        Returns: Database["public"]["Enums"]["stage_role"]
      }
      toggle_cron_job: {
        Args: { p_enabled: boolean; p_jobname: string }
        Returns: Json
      }
      toggle_lead_ai: {
        Args: { p_disabled: boolean; p_lead_id: string }
        Returns: Json
      }
      toggle_phone_ai: {
        Args: {
          p_disabled: boolean
          p_organization_id?: string
          p_phone: string
        }
        Returns: Json
      }
      track_recent_view: {
        Args: {
          p_entity_id: string
          p_entity_label?: string
          p_entity_type: string
        }
        Returns: undefined
      }
      transfer_lead_to_human: {
        Args: { p_lead_id: string }
        Returns: undefined
      }
      try_provision_lock: { Args: { p_user_id: string }; Returns: boolean }
      uf_from_ddd: { Args: { p_digits: string }; Returns: string }
      unlink_agent_from_instance: {
        Args: { p_agent_id: string }
        Returns: undefined
      }
      unlink_social_conversation_from_lead: {
        Args: { p_channel: string; p_external_user_id: string; p_org: string }
        Returns: undefined
      }
      upsert_meta_conversation: {
        Args: {
          p_bump_unread?: boolean
          p_channel: Database["public"]["Enums"]["channel_type"]
          p_direction: string
          p_external_user_id: string
          p_lead_id?: string
          p_message_at: string
          p_meta_page_id: string
          p_organization_id: string
          p_preview?: string
        }
        Returns: string
      }
      user_has_org_permission: {
        Args: { p_permission_key: string }
        Returns: boolean
      }
      validate_coupon: {
        Args: { p_code: string; p_plan_slug: string }
        Returns: Json
      }
      voip_can_see_call: { Args: { p_lead_id: string }; Returns: boolean }
      whatsapp_chip_instance_ids: {
        Args: { p_instance: string; p_org: string }
        Returns: string[]
      }
    }
    Enums: {
      agent_energy: "baixa" | "moderada" | "alta" | "muito_alta"
      agent_style:
        | "direto"
        | "detalhado"
        | "consultivo"
        | "persuasivo"
        | "educativo"
      agent_template_type:
        | "qualificador"
        | "sdr"
        | "followup"
        | "agendador"
        | "prospectador"
        | "custom"
      agent_tone:
        | "formal"
        | "casual"
        | "profissional"
        | "amigavel"
        | "energetico"
        | "consultivo"
      ai_takeover_state_enum:
        | "AI_ACTIVE"
        | "AI_PAUSED_MANUAL"
        | "WAITING_HUMAN"
        | "HUMAN_ACTIVE"
        | "HANDOFF_BACK"
      app_role:
        | "admin"
        | "sdr"
        | "closer"
        | "agency"
        | "bdr"
        | "cliente"
        | "member"
      channel_type: "whatsapp" | "instagram" | "messenger" | "email" | "sms"
      copilot_v2_archetype: "qualificador" | "vendedor" | "carteira"
      copilot_v2_knowledge_kind: "image" | "video" | "doc" | "pdf"
      copilot_v2_knowledge_status: "pending" | "ingesting" | "ready" | "failed"
      copilot_v2_media_kind: "image" | "video"
      copilot_v2_model_id:
        | "google/gemini-2.5-flash"
        | "anthropic/claude-haiku-4-5"
        | "openai/gpt-4.1-mini"
      copilot_v2_queue_status:
        | "pending"
        | "processing"
        | "processed"
        | "retry"
        | "dead"
      lead_origin:
        | "whatsapp"
        | "meta_ads"
        | "outro"
        | "site"
        | "remarketing"
        | "google_ads"
        | "cal"
        | "instagram"
        | "messenger"
        | "tiktok"
        | "indicacao"
        | "evento"
        | "prospeccao_ativa"
        | "landing_page"
        | "web"
        | "disparo_planilha"
      lead_visibility_status:
        | "exists"
        | "not_found"
        | "deleted"
        | "permission_denied"
      org_type: "crm" | "outbound"
      product_type:
        | "mrr"
        | "projeto"
        | "physical"
        | "digital"
        | "service"
        | "unitario"
      qualification_tier:
        | "diamante"
        | "ouro"
        | "prata"
        | "bronze"
        | "desqualificado"
      stage_role: "open" | "meeting_booked" | "meeting_held" | "won" | "lost"
      support_ticket_impacto: "parado" | "contorno" | "incomodo"
      support_ticket_severidade: "baixa" | "media" | "alta" | "critica"
      support_ticket_status:
        | "aberto"
        | "em_andamento"
        | "aguardando_cliente"
        | "resolvido"
        | "fechado"
      support_ticket_tipo: "bug" | "duvida" | "solicitacao"
      upsell_campanha_status:
        | "cliente"
        | "planejado"
        | "abordado"
        | "interesse"
        | "proposta"
        | "vendido"
        | "futuro"
        | "perdido"
      upsell_potencial: "baixo" | "medio" | "alto" | "estrategico"
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
      agent_energy: ["baixa", "moderada", "alta", "muito_alta"],
      agent_style: [
        "direto",
        "detalhado",
        "consultivo",
        "persuasivo",
        "educativo",
      ],
      agent_template_type: [
        "qualificador",
        "sdr",
        "followup",
        "agendador",
        "prospectador",
        "custom",
      ],
      agent_tone: [
        "formal",
        "casual",
        "profissional",
        "amigavel",
        "energetico",
        "consultivo",
      ],
      ai_takeover_state_enum: [
        "AI_ACTIVE",
        "AI_PAUSED_MANUAL",
        "WAITING_HUMAN",
        "HUMAN_ACTIVE",
        "HANDOFF_BACK",
      ],
      app_role: [
        "admin",
        "sdr",
        "closer",
        "agency",
        "bdr",
        "cliente",
        "member",
      ],
      channel_type: ["whatsapp", "instagram", "messenger", "email", "sms"],
      copilot_v2_archetype: ["qualificador", "vendedor", "carteira"],
      copilot_v2_knowledge_kind: ["image", "video", "doc", "pdf"],
      copilot_v2_knowledge_status: ["pending", "ingesting", "ready", "failed"],
      copilot_v2_media_kind: ["image", "video"],
      copilot_v2_model_id: [
        "google/gemini-2.5-flash",
        "anthropic/claude-haiku-4-5",
        "openai/gpt-4.1-mini",
      ],
      copilot_v2_queue_status: [
        "pending",
        "processing",
        "processed",
        "retry",
        "dead",
      ],
      lead_origin: [
        "whatsapp",
        "meta_ads",
        "outro",
        "site",
        "remarketing",
        "google_ads",
        "cal",
        "instagram",
        "messenger",
        "tiktok",
        "indicacao",
        "evento",
        "prospeccao_ativa",
        "landing_page",
        "web",
        "disparo_planilha",
      ],
      lead_visibility_status: [
        "exists",
        "not_found",
        "deleted",
        "permission_denied",
      ],
      org_type: ["crm", "outbound"],
      product_type: [
        "mrr",
        "projeto",
        "physical",
        "digital",
        "service",
        "unitario",
      ],
      qualification_tier: [
        "diamante",
        "ouro",
        "prata",
        "bronze",
        "desqualificado",
      ],
      stage_role: ["open", "meeting_booked", "meeting_held", "won", "lost"],
      support_ticket_impacto: ["parado", "contorno", "incomodo"],
      support_ticket_severidade: ["baixa", "media", "alta", "critica"],
      support_ticket_status: [
        "aberto",
        "em_andamento",
        "aguardando_cliente",
        "resolvido",
        "fechado",
      ],
      support_ticket_tipo: ["bug", "duvida", "solicitacao"],
      upsell_campanha_status: [
        "cliente",
        "planejado",
        "abordado",
        "interesse",
        "proposta",
        "vendido",
        "futuro",
        "perdido",
      ],
      upsell_potencial: ["baixo", "medio", "alto", "estrategico"],
    },
  },
} as const
