import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation
} from 'typeorm';
import { ArtifactEntity } from './artifact.entity.js';

@Entity({ name: 'artifact_versions' })
export class ArtifactVersionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => ArtifactEntity, (artifact) => artifact.versions, { onDelete: 'CASCADE' })
  artifact!: Relation<ArtifactEntity>;

  @Column({ length: 255 })
  version!: string;

  @Column({ type: 'jsonb' })
  data!: Record<string, any>;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, any> | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  originalUrl?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  timestamp?: Date | null;

  @Column({ type: 'varchar', length: 128 })
  checksum!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
