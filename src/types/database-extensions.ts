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
    };
    Views: PublicSchema["Views"];
    Functions: PublicSchema["Functions"];
    Enums: PublicSchema["Enums"];
    CompositeTypes: PublicSchema["CompositeTypes"];
  };
};
