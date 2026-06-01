import { Request, Response, NextFunction } from 'express';

const GENERIC_MSG = 'Error interno del servidor';

interface PgLikeError {
  code: string;
  message: string;
  details?: string | null;
  hint?: string | null;
}

function isPgError(e: unknown): e is PgLikeError {
  return (
    typeof e === 'object' &&
    e !== null &&
    typeof (e as { code?: unknown }).code === 'string' &&
    typeof (e as { message?: unknown }).message === 'string'
  );
}

// Postgres SQLSTATE → HTTP. PostgREST single() devuelve PGRST116 cuando no hay filas.
const PG_CODE_TO_STATUS: Record<string, number> = {
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '23502': 400, // not_null_violation
  '23514': 400, // check_violation
  '22P02': 400, // invalid_text_representation
  PGRST116: 404, // no rows
};

// Mensajes amigables para los casos que pueden disparar los usuarios.
// Para el resto devolvemos el genérico en prod (sin filtrar detalle de DB).
const PG_FRIENDLY_MSG: Record<string, string> = {
  '23505': 'Ya existe un registro con esos datos',
  '23503': 'Referencia inválida (registro relacionado no existe)',
  '23502': 'Faltan campos requeridos',
  '23514': 'Datos inválidos',
  PGRST116: 'No encontrado',
};

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const isDev = process.env.NODE_ENV === 'development';

  // Log siempre con todo el contexto disponible (incluso para objetos no-Error como PostgrestError)
  const errInfo = err instanceof Error
    ? { name: err.name, message: err.message, stack: err.stack }
    : err;
  console.error(`ERROR ${req.method} ${req.originalUrl}:`, errInfo);

  if (res.headersSent) return;

  let status = 500;
  let message = GENERIC_MSG;

  if (isPgError(err)) {
    status = PG_CODE_TO_STATUS[err.code] ?? 500;
    message = PG_FRIENDLY_MSG[err.code] ?? (isDev ? err.message : GENERIC_MSG);
  } else if (err instanceof Error) {
    message = isDev ? (err.message || GENERIC_MSG) : GENERIC_MSG;
  }

  res.status(status).json({ error: message });
}
