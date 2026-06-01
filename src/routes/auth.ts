import { Router } from 'express';
import { supabasePublic } from '../lib/supabase';

const router = Router();

// El login y logout pasan por el cliente público (anon key) — JAMÁS por el
// admin client. signInWithPassword guarda la sesión adentro del client que la
// ejecuta; si se hiciera con el admin client, todas las queries posteriores
// dejarían de correr con service_role y caerían a rol authenticated/anon,
// rompiendo writes (42501) y vaciando reads de tablas RLS-only-service-role.
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Email y contraseña requeridos' });
      return;
    }

    const { data, error } = await supabasePublic.auth.signInWithPassword({ email, password });

    if (error || !data.session) {
      res.status(401).json({ error: 'Credenciales inválidas' });
      return;
    }

    res.json({ access_token: data.session.access_token, user: { email: data.user.email } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (_req, res, next) => {
  try {
    await supabasePublic.auth.signOut();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
