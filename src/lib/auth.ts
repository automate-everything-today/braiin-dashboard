import { supabase } from "./supabase";
import { ADMIN_EMAILS, APP_URL } from "@/config/customer";

export async function signIn(email: string) {
  if (!ADMIN_EMAILS.includes(email.toLowerCase())) {
    return { error: "Email not authorised" };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: APP_URL,
    },
  });

  return { error: error?.message || null };
}

export async function signOut() {
  await supabase.auth.signOut();
}

export async function getUser() {
  const { data } = await supabase.auth.getUser();
  return data.user;
}

export function isAllowed(email: string | undefined) {
  return email ? ADMIN_EMAILS.includes(email.toLowerCase()) : false;
}
