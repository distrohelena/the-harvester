import dotenv from 'dotenv';

dotenv.config();

const DEFAULT_DATABASE_URL =
  'postgres://artifact_harvester:artifact_harvester@localhost:5432/artifact_harvester';
const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_RESOURCE_SAMPLE = 20;
const DEFAULT_HTTP_PORT = 3333;

const toPositiveInt = (value: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const toStringList = (value: string | undefined) =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const toBoolean = (value: string | undefined, fallback: boolean) => {
  if (typeof value === 'undefined') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export const config = {
  databaseUrl: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
  maxSearchResults: toPositiveInt(process.env.MCP_MAX_SEARCH_RESULTS, DEFAULT_MAX_RESULTS),
  resourceSampleSize: toPositiveInt(
    process.env.MCP_RESOURCE_SAMPLE_SIZE,
    DEFAULT_RESOURCE_SAMPLE
  ),
  transport: (process.env.MCP_TRANSPORT ?? 'http').toLowerCase() === 'stdio' ? 'stdio' : 'http',
  httpPort: toPositiveInt(process.env.MCP_HTTP_PORT, DEFAULT_HTTP_PORT),
  httpHost: process.env.MCP_HTTP_HOST ?? '0.0.0.0',
  httpPath: process.env.MCP_HTTP_PATH ?? '/mcp',
  httpAllowedOrigins: toStringList(process.env.MCP_HTTP_ALLOWED_ORIGINS),
  httpAllowedHosts: toStringList(process.env.MCP_HTTP_ALLOWED_HOSTS),
  httpEnableDnsProtection: toBoolean(process.env.MCP_HTTP_DNS_PROTECTION, true)
};

export type AppConfig = typeof config;
