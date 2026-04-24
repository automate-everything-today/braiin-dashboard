import { createClient } from "@supabase/supabase-js";
import type { QueryContext } from "@/types";
import type { Database } from "@/types/database-extensions";

// Runtime-dispatched Supabase client.
// - On the server (typeof window === "undefined"): uses the service role key
//   and bypasses Row Level Security. Safe because this code only runs on
//   Vercel, never in the browser.
// - In the browser: uses the public anon key and is subject to RLS. The
//   service role reference is stripped from the client bundle by Next.js
//   because `process.env.SUPABASE_SERVICE_KEY` is not a NEXT_PUBLIC_ var.

const isServer = typeof window === "undefined";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is required. Refusing to initialise Supabase without a URL.");
}

const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!anonKey) {
  throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required. Refusing to initialise Supabase without an anon key.");
}

let supabaseKey: string;
if (isServer) {
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    // Fail loud. Previous behaviour silently fell through to the anon key,
    // which meant server code would unexpectedly run under Row Level Security
    // and break in surprising ways at runtime.
    throw new Error(
      "SUPABASE_SERVICE_KEY is required on the server. Refusing to fall back to the anon key.",
    );
  }
  supabaseKey = serviceKey;
} else {
  supabaseKey = anonKey;
}

export const supabase = createClient<Database>(
  supabaseUrl,
  supabaseKey,
  isServer
    ? { auth: { autoRefreshToken: false, persistSession: false } }
    : undefined,
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
 *
 * Accepts a plain string for the table name rather than constraining to
 * `keyof Database["public"]["Tables"]`, because many callers pass a variable.
 * The escape hatch is confined to this helper.
 */
export async function fetchAllRows<T>(
  table: string,
  select: string,
  filters?: (query: any) => any
): Promise<T[]> {
  let allData: T[] = [];
  let from = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const untyped = supabase as any;
  while (true) {
    let query = untyped.from(table).select(select).range(from, from + 999);
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
