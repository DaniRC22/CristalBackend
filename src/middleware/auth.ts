import { Request, Response, NextFunction } from 'express';
import { supabasePublic } from '../lib/supabase';

export async function verifyAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const token = authHeader.slice(7);

  const { data: { user }, error } = await supabasePublic.auth.getUser(token);

  if (error || !user) {
    res.status(401).json({ error: 'Token inválido o expirado' });
    return;
  }

  req.user = user;
  next();
}
