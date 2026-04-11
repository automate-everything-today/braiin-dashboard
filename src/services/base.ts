import { supabase } from "@/lib/supabase";
import type { QueryContext, DataScope } from "@/types";

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

export { supabase };
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
