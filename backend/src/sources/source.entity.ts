import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';
import { ArtifactEntity } from '../artifacts/artifact.entity.js';
import { ExtractionRunEntity } from '../runs/extraction-run.entity.js';

@Entity({ name: 'sources' })
export class SourceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  name!: string;

  @Column({ length: 100 })
  pluginKey!: string;

  @Column({ type: 'jsonb', default: {} })
  options!: Record<string, any>;

  @Column({ type: 'varchar', length: 255, nullable: true })
  scheduleCron?: string | null;

  @Column({ type: 'boolean', default: true })
  isActive!: boolean;

  @OneToMany(() => ArtifactEntity, (artifact) => artifact.source)
  artifacts?: Relation<ArtifactEntity>[];

  @OneToMany(() => ExtractionRunEntity, (run) => run.source)
  runs?: Relation<ExtractionRunEntity>[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
