import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn
} from 'typeorm';
import { SourceEntity } from '../sources/source.entity.js';
import { ArtifactVersionEntity } from './artifact-version.entity.js';

@Entity({ name: 'artifacts' })
export class ArtifactEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => SourceEntity, (source) => source.artifacts, { eager: true })
  @JoinColumn({ name: 'source_id' })
  source!: Relation<SourceEntity>;

  @Column({ length: 100 })
  pluginKey!: string;

  @Column({ length: 255 })
  externalId!: string;

  @Column({ length: 255 })
  displayName!: string;

  @ManyToOne(() => ArtifactVersionEntity, { nullable: true, eager: true })
  @JoinColumn({ name: 'last_version_id' })
  lastVersion?: Relation<ArtifactVersionEntity> | null;

  @OneToMany(() => ArtifactVersionEntity, (version) => version.artifact)
  versions?: Relation<ArtifactVersionEntity>[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
