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

export type Database = {
  public: {
    Tables: PublicSchema["Tables"] & {
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
