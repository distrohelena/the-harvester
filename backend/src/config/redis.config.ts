import { ConfigService } from '@nestjs/config';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

/**
 * Resolve the Redis URL used by BullMQ workers/queues.
 * Prefers the explicit REDIS_URL env var but still honors the lower-cased
 * config key so devs can keep using the existing configuration helper.
 */
export function resolveRedisUrl(config: ConfigService): string {
  return config.get<string>('REDIS_URL') ?? config.get<string>('redisUrl') ?? DEFAULT_REDIS_URL;
}

/**
 * Produce a safe Redis endpoint string for logs without leaking credentials.
 */
export function formatRedisEndpoint(redisUrl: string): string {
  try {
    const parsed = new URL(redisUrl);
    const hostPort = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
    const dbPath = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
    return `${parsed.protocol}//${hostPort}${dbPath}`;
  } catch {
    return redisUrl;
  }
}
