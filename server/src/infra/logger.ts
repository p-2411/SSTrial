import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Structured JSON logs in production (one object per line, easy to search in any log service);
 * human-friendly output in development.
 */
export function createLogger(options: { name: string; level: string; pretty: boolean }): Logger {
  return pino({
    name: options.name,
    level: options.level,
    // Belt and braces: never log credentials even if an object containing them slips into a log call.
    redact: ['*.apiKey', '*.authorization', 'headers.authorization', '*.SUPABASE_SECRET_KEY', '*.OPENAI_API_KEY'],
    ...(options.pretty && {
      transport: { target: 'pino-pretty', options: { colorize: true, ignore: 'pid,hostname' } },
    }),
  });
}
