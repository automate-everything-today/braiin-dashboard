// Backwards-compatible re-export. New code should import directly from
// "@/services/base" which has the runtime-dispatched (server vs browser)
// client with proper service-role handling.
export { supabase } from "@/services/base";
