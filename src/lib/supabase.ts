/** The one Supabase client. Teachers sign in with it; students never use it. */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * True when .env.local has real-looking values. The app says so plainly
 * instead of failing with a network error nobody can read.
 */
export const supabaseConfigured =
  typeof url === 'string' &&
  typeof anonKey === 'string' &&
  url.startsWith('http') &&
  !url.includes('your-project-ref') &&
  anonKey.length > 20 &&
  !anonKey.includes('your-anon');

export const SUPABASE_SETUP_MESSAGE =
  'This app is not connected to Supabase yet. Put VITE_SUPABASE_URL and ' +
  'VITE_SUPABASE_ANON_KEY in .env.local (see .env.example) and restart the dev server.';

export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anonKey ?? 'public-anon-key-not-set',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

/** Where Supabase sends the teacher back to after Google sign-in. */
export function teacherRedirectUrl(): string {
  return `${window.location.origin}/teacher`;
}
