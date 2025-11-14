import { createHash } from 'crypto';

export const computeChecksum = (payload: unknown): string =>
  createHash('sha256').update(JSON.stringify(payload)).digest('hex');
