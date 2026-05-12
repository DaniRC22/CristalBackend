import { createClient } from '@supabase/supabase-js';
import { supabaseMock } from './supabase-mock';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Use mock if development/dummy keys
const isDummyKey = supabaseServiceKey.includes('dummy') || supabaseServiceKey.length < 10;

// Admin client (con service role key para operaciones administrativas)
export const supabase = isDummyKey
  ? (supabaseMock as any)
  : createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

// Public client (con anon key para validar tokens de usuario)
export const supabasePublic = isDummyKey
  ? (supabaseMock as any)
  : createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey, {
      auth: { persistSession: false },
    });
