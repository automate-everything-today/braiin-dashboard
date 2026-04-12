import { createClient } from "@supabase/supabase-js";
import type { QueryContext, DataScope } from "@/types";

// Runtime-dispatched Supabase client.
// - On the server (typeof window === "undefined"): uses the service role key
//   and bypasses Row Level Security. Safe because this code only runs on
//   Vercel, never in the browser.
// - In the browser: uses the public anon key and is subject to RLS. The
//   service role reference is stripped from the client bundle by Next.js
//   because `process.env.SUPABASE_SERVICE_KEY` is not a NEXT_PUBLIC_ var.
const isServer = typeof window === "undefined";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  isServer
    ? (process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!)
    : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  isServer
    ? { auth: { autoRefreshToken: false, persistSession: false } }
    : undefined
);

export class ServiceError extends Error {
  constructor(
    message: string,
    public cause?: unknown,
    public code?: string
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export type { QueryContext };

/**
 * Fetch all rows from a table with pagination (Supabase returns max 1000).
 */
export async function fetchAllRows<T>(
  table: string,
  select: string,
  filters?: (query: any) => any
): Promise<T[]> {
  let allData: T[] = [];
  let from = 0;
  while (true) {
    let query = supabase.from(table).select(select).range(from, from + 999);
    if (filters) query = filters(query);
    const { data, error } = await query;
    if (error) throw new ServiceError(`Failed to fetch ${table}`, error, `${table.toUpperCase()}_FETCH`);
    if (!data || !data.length) break;
    allData = allData.concat(data as T[]);
    if (data.length < 1000) break;
    from += 1000;
  }
  return allData;
}
