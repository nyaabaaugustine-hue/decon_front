import { Request, Response, NextFunction } from 'express';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  const { method, originalUrl } = req;

  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'ERROR' : status >= 400 ? 'WARN' : 'INFO';
    const user = (req as any).user?.username || '-';
    console.log(`[${level}] ${method} ${originalUrl} ${status} ${duration}ms user=${user}`);
  });

  next();
}
