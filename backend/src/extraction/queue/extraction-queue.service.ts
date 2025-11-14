import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { EXTRACTION_QUEUE } from '../extraction.constants.js';
import { ExtractionJobData } from '../extraction.types.js';

@Injectable()
export class ExtractionQueueService {
  constructor(@InjectQueue(EXTRACTION_QUEUE) private readonly queue: Queue<ExtractionJobData>) {}

  async enqueueSource(sourceId: string) {
    await this.queue.add('extract', { sourceId });
  }
}
