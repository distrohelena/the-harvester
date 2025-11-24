import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EXTRACTION_QUEUE } from '../extraction.constants.js';
import { ExtractionJobData } from '../extraction.types.js';
import { formatRedisEndpoint, resolveRedisUrl } from '../../config/redis.config.js';

@Injectable()
export class ExtractionQueueService implements OnModuleInit {
  private readonly logger = new Logger(ExtractionQueueService.name);

  constructor(
    @InjectQueue(EXTRACTION_QUEUE) private readonly queue: Queue<ExtractionJobData>,
    private readonly config: ConfigService
  ) {}

  async onModuleInit() {
    const redisUrl = resolveRedisUrl(this.config);
    const endpoint = formatRedisEndpoint(redisUrl);
    try {
      await this.queue.waitUntilReady();
      this.logger.log(`Extraction queue connected to Redis (${endpoint})`);
    } catch (error: any) {
      this.logger.error(
        `Failed to connect to Redis for extraction queue (${endpoint})`,
        error?.stack ?? String(error)
      );
      throw error;
    }
  }

  async enqueueSource(sourceId: string) {
    await this.queue.add('extract', { sourceId });
  }
}
