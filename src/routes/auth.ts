import { Router } from 'express';
import { supabase } from '../lib/supabase';

const router = Router();

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body as { email: string; password: string };

    if (!email || !password) {
      res.status(400).json({ error: 'Email y contraseña requeridos' });
      return;
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

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
    await supabase.auth.signOut();
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

export default router;
