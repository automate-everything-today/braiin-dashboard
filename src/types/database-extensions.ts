/**
 * Extensions to the generated Database type for tables that exist in
 * migrations but haven't yet been applied to the live Supabase project.
 *
 * Once the relevant migration is applied AND the types are regenerated
 * (`npx tsx scripts/gen-supabase-types.ts`), the table will appear in
 * `database.ts` and the manual entry here can be removed.
 */

import type { Database as GeneratedDatabase } from "./database";

type PublicSchema = GeneratedDatabase["public"];
type GenTables = PublicSchema["Tables"];

// Add columns to a generated table without rebuilding the whole shape.
// Used when a migration ALTERs an existing table (017 on tasks, 016 on
// user_preferences, 019 on email_classifications).
type Augment<
  T extends { Row: object; Insert: object; Update: object; Relationships: unknown },
  Add extends { Row?: object; Insert?: object; Update?: object },
> = {
  Row: T["Row"] & (Add extends { Row: infer R } ? R : Record<string, never>);
  Insert: T["Insert"] & (Add extends { Insert: infer I } ? I : Record<string, never>);
  Update: T["Update"] & (Add extends { Update: infer U } ? U : Record<string, never>);
  Relationships: T["Relationships"];
};

// Migration: 017_tasks_sync.sql ADDs columns to existing tasks table.
type TasksSyncAdd = {
  Row: {
    outlook_task_id: string | null;
    outlook_list_id: string | null;
    last_synced_at: string | null;
    sync_status: "synced" | "pending" | "error" | "disabled" | null;
    source_type: "manual" | "email" | "deal" | "incident" | "ai" | null;
    source_id: string | null;
    source_url: string | null;
  };
  Insert: {
    outlook_task_id?: string | null;
    outlook_list_id?: string | null;
    last_synced_at?: string | null;
    sync_status?: "synced" | "pending" | "error" | "disabled" | null;
    source_type?: "manual" | "email" | "deal" | "incident" | "ai" | null;
    source_id?: string | null;
    source_url?: string | null;
  };
  Update: {
    outlook_task_id?: string | null;
    outlook_list_id?: string | null;
    last_synced_at?: string | null;
    sync_status?: "synced" | "pending" | "error" | "disabled" | null;
    source_type?: "manual" | "email" | "deal" | "incident" | "ai" | null;
    source_id?: string | null;
    source_url?: string | null;
  };
};

// Migration: 016_ai_learning_share_team.sql ADDs ai_learning_share_team
// to user_preferences.
type UserPrefsShareTeamAdd = {
  Row: { ai_learning_share_team: boolean | null };
  Insert: { ai_learning_share_team?: boolean | null };
  Update: { ai_learning_share_team?: boolean | null };
};

// Combined extension for email_classifications spanning migrations
// 011 (ai_relevant_department / ai_relevant_mode), 012 (ai_tags /
// user_tags / relevance_feedback), 013 (ai/user_conversation_stage),
// and 019 (last_modified_by / last_modified_at).
type EmailClassificationsAuditAdd = {
  Row: {
    ai_relevant_department: string | null;
    ai_relevant_mode: "Air" | "Road" | "Sea" | "Warehousing" | null;
    ai_tags: string[] | null;
    user_tags: string[] | null;
    relevance_feedback: "thumbs_up" | "thumbs_down" | null;
    ai_conversation_stage: string | null;
    user_conversation_stage: string | null;
    last_modified_by: string | null;
    last_modified_at: string | null;
  };
  Insert: {
    ai_relevant_department?: string | null;
    ai_relevant_mode?: "Air" | "Road" | "Sea" | "Warehousing" | null;
    ai_tags?: string[] | null;
    user_tags?: string[] | null;
    relevance_feedback?: "thumbs_up" | "thumbs_down" | null;
    ai_conversation_stage?: string | null;
    user_conversation_stage?: string | null;
    last_modified_by?: string | null;
    last_modified_at?: string | null;
  };
  Update: {
    ai_relevant_department?: string | null;
    ai_relevant_mode?: "Air" | "Road" | "Sea" | "Warehousing" | null;
    ai_tags?: string[] | null;
    user_tags?: string[] | null;
    relevance_feedback?: "thumbs_up" | "thumbs_down" | null;
    ai_conversation_stage?: string | null;
    user_conversation_stage?: string | null;
    last_modified_by?: string | null;
    last_modified_at?: string | null;
  };
};

export type Database = {
  public: {
    Tables: Omit<GenTables, "tasks" | "user_preferences" | "email_classifications"> & {
      tasks: Augment<GenTables["tasks"], TasksSyncAdd>;
      user_preferences: Augment<GenTables["user_preferences"], UserPrefsShareTeamAdd>;
      email_classifications: Augment<GenTables["email_classifications"], EmailClassificationsAuditAdd>;
      // Migration: 008_email_pins.sql
      email_pins: {
        Row: {
          id: number;
          user_email: string;
          email_id: string;
          pinned_at: string;
        };
        Insert: {
          id?: number;
          user_email: string;
          email_id: string;
          pinned_at?: string;
        };
        Update: {
          id?: number;
          user_email?: string;
          email_id?: string;
          pinned_at?: string;
        };
        Relationships: [];
      };
      // Migration: 009_reply_learnings.sql
      reply_learnings: {
        Row: {
          id: number;
          user_email: string;
          sender_domain: string | null;
          sender_email: string | null;
          category: string | null;
          instruction: string;
          reply_options: unknown;
          created_at: string;
          last_used_at: string | null;
          usage_count: number;
        };
        Insert: {
          id?: number;
          user_email: string;
          sender_domain?: string | null;
          sender_email?: string | null;
          category?: string | null;
          instruction: string;
          reply_options: unknown;
          created_at?: string;
          last_used_at?: string | null;
          usage_count?: number;
        };
        Update: {
          id?: number;
          user_email?: string;
          sender_domain?: string | null;
          sender_email?: string | null;
          category?: string | null;
          instruction?: string;
          reply_options?: unknown;
          created_at?: string;
          last_used_at?: string | null;
          usage_count?: number;
        };
        Relationships: [];
      };
      // Migration: 010_reply_rules.sql
      reply_rules: {
        Row: {
          id: number;
          scope_type: "user" | "category" | "mode" | "department" | "branch" | "global";
          scope_value: string;
          instruction: string;
          source: "learned" | "set";
          created_by: string | null;
          active: boolean;
          usage_count: number;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: number;
          scope_type: "user" | "category" | "mode" | "department" | "branch" | "global";
          scope_value: string;
          instruction: string;
          source?: "learned" | "set";
          created_by?: string | null;
          active?: boolean;
          usage_count?: number;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: number;
          scope_type?: "user" | "category" | "mode" | "department" | "branch" | "global";
          scope_value?: string;
          instruction?: string;
          source?: "learned" | "set";
          created_by?: string | null;
          active?: boolean;
          usage_count?: number;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      // Migration: 015_classify_batches.sql
      classify_batches: {
        Row: {
          id: number;
          anthropic_batch_id: string;
          email_ids: string[];
          status: "in_progress" | "completed" | "canceled" | "expired" | "errored";
          submitted_by: string;
          submitted_at: string;
          completed_at: string | null;
          request_count: number;
          succeeded_count: number;
          errored_count: number;
          notes: string | null;
        };
        Insert: {
          id?: number;
          anthropic_batch_id: string;
          email_ids: string[];
          status?: "in_progress" | "completed" | "canceled" | "expired" | "errored";
          submitted_by: string;
          submitted_at?: string;
          completed_at?: string | null;
          request_count: number;
          succeeded_count?: number;
          errored_count?: number;
          notes?: string | null;
        };
        Update: {
          id?: number;
          anthropic_batch_id?: string;
          email_ids?: string[];
          status?: "in_progress" | "completed" | "canceled" | "expired" | "errored";
          submitted_by?: string;
          submitted_at?: string;
          completed_at?: string | null;
          request_count?: number;
          succeeded_count?: number;
          errored_count?: number;
          notes?: string | null;
        };
        Relationships: [];
      };
      // Migration: 014_freight_networks.sql
      freight_networks: {
        Row: {
          id: number;
          name: string;
          primary_domain: string;
          additional_domains: string[];
          relationship: "member" | "non-member" | "prospect" | "declined";
          network_type: "general" | "project_cargo" | "specialised" | "association";
          annual_fee_gbp: number | null;
          events_per_year: number | null;
          website: string | null;
          notes: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          name: string;
          primary_domain: string;
          additional_domains?: string[];
          relationship?: "member" | "non-member" | "prospect" | "declined";
          network_type?: "general" | "project_cargo" | "specialised" | "association";
          annual_fee_gbp?: number | null;
          events_per_year?: number | null;
          website?: string | null;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          name?: string;
          primary_domain?: string;
          additional_domains?: string[];
          relationship?: "member" | "non-member" | "prospect" | "declined";
          network_type?: "general" | "project_cargo" | "specialised" | "association";
          annual_fee_gbp?: number | null;
          events_per_year?: number | null;
          website?: string | null;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: PublicSchema["Views"];
    Functions: PublicSchema["Functions"];
    Enums: PublicSchema["Enums"];
    CompositeTypes: PublicSchema["CompositeTypes"];
  };
};
