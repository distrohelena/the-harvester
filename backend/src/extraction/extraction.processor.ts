import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EXTRACTION_QUEUE } from './extraction.constants.js';
import { ExtractionJobData } from './extraction.types.js';
import { ExtractionService } from './extraction.service.js';

@Processor(EXTRACTION_QUEUE)
export class ExtractionProcessor extends WorkerHost {
  constructor(private readonly extractionService: ExtractionService) {
    super();
  }

  async process(job: Job<ExtractionJobData>) {
    await this.extractionService.runExtraction(job.data.sourceId);
  }
}
