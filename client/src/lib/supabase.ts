import { createClient } from '@supabase/supabase-js'

// Use environment variables for configuration
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY environment variables are required');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Note: Profile types are now defined in shared/schema.ts to avoid duplication