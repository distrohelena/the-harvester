import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';
import { SourceEntity } from '../sources/source.entity.js';

export type ExtractionRunStatus = 'PENDING' | 'RUNNING' | 'SUCCESS' | 'FAILED';

@Entity({ name: 'extraction_runs' })
export class ExtractionRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => SourceEntity, (source) => source.runs, { eager: true })
  @JoinColumn({ name: 'source_id' })
  source!: Relation<SourceEntity>;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt?: Date | null;

  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: ExtractionRunStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string | null;

  @Column({ type: 'int', default: 0 })
  createdArtifacts!: number;

  @Column({ type: 'int', default: 0 })
  updatedArtifacts!: number;

  @Column({ type: 'int', default: 0 })
  skippedArtifacts!: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
