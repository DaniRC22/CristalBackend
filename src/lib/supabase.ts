import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el entorno');
}

// El cliente público valida tokens de usuario y NUNCA debe usar el service-role
// key: ese key bypassa RLS. Si falta la anon key, fallamos en vez de degradar
// silenciosamente a permisos totales.
if (!supabaseAnonKey) {
  throw new Error('Falta SUPABASE_ANON_KEY — requerida para el cliente público');
}

// Admin client (con service role key para operaciones administrativas).
// Deshabilitamos auto-refresh y detect-session-in-url para que NADIE pueda
// contaminar este cliente con una sesión de usuario. Si por error alguien
// llama supabase.auth.signInWithPassword(...) sobre este client, no se va a
// programar refresh interno ni a quedar un access_token vencido en memoria
// degradando todas las queries de service_role a rol authenticated/anon.
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

// Public client (con anon key para validar tokens de usuario)
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});
