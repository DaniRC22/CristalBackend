import { Request, Response, NextFunction } from 'express';

const GENERIC_MSG = 'Error interno del servidor';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  console.error('ERROR:', err.message);
  if (process.env.NODE_ENV === 'development') console.error(err.stack);

  // En producción nunca devolvemos el mensaje crudo (puede contener detalles de Supabase/DB)
  const message = process.env.NODE_ENV === 'development' ? (err.message || GENERIC_MSG) : GENERIC_MSG;
  res.status(500).json({ error: message });
}
