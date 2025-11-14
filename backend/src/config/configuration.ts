export default () => ({
  port: process.env.PORT ? Number(process.env.PORT) : 3000,
  databaseUrl: process.env.DATABASE_URL ??
    'postgres://artifact_harvester:artifact_harvester@localhost:5432/artifact_harvester',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  extractionQueueName: process.env.EXTRACTION_QUEUE_NAME ?? 'artifact-harvester-extractions'
});
