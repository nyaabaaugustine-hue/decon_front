import type { Request, Response, NextFunction } from 'express';

/**
 * Lightweight request-body validation without adding a new dependency.
 * For each required field, checks that it exists and is not an empty string.
 * Returns a 400 with the list of missing fields if validation fails.
 */
export function requireFields(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing = fields.filter((f) => {
      const value = (req.body ?? {})[f];
      return value === undefined || value === null || value === '';
    });

    if (missing.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        missingFields: missing,
      });
      return;
    }

    next();
  };
}

/** Basic guard so IDs used in path params look sane before hitting the DB. */
export function requireIdParam(paramName = 'id') {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.params[paramName];
    if (!value || typeof value !== 'string' || value.trim() === '') {
      res.status(400).json({ error: `Missing or invalid path parameter: ${paramName}` });
      return;
    }
    next();
  };
}

/** Wraps an async route handler so thrown errors reach Express's error handler
 *  instead of crashing the process or hanging the request. */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
