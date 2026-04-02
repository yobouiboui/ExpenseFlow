import { createClient } from '@supabase/supabase-js';

// localStorage keys for runtime credential override
const LS_KEY_URL = 'expenseFlow_supabase_url';
const LS_KEY_KEY = 'expenseFlow_supabase_key';

// Runtime override takes priority over build-time env vars
const supabaseUrl =
  localStorage.getItem(LS_KEY_URL) ||
  (import.meta.env.VITE_SUPABASE_URL as string | undefined);

const supabaseAnonKey =
  localStorage.getItem(LS_KEY_KEY) ||
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const isSupabaseEnabled = Boolean(supabaseUrl && supabaseAnonKey);

/** Persist new credentials and reload so the module re-initialises. */
export function saveSupabaseConfig(url: string, key: string): void {
  localStorage.setItem(LS_KEY_URL, url.trim());
  localStorage.setItem(LS_KEY_KEY, key.trim());
  window.location.reload();
}

/** Remove runtime overrides (reverts to build-time env vars on next reload). */
export function clearSupabaseConfig(): void {
  localStorage.removeItem(LS_KEY_URL);
  localStorage.removeItem(LS_KEY_KEY);
  window.location.reload();
}
