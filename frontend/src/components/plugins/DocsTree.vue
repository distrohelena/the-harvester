<script setup lang="ts">
import { inject, provide, ref, type Ref, computed } from 'vue';

const EXPANDED_CTX = Symbol('docs-tree-expanded');

export interface DocsTreeNode {
  id: string;
  label: string;
  children?: DocsTreeNode[];
  artifactId?: string;
  anchor?: string;
}

const props = defineProps<{
  nodes: DocsTreeNode[];
  selectedArtifactId?: string;
}>();

const emit = defineEmits<{
  (e: 'select', payload: { artifactId: string; anchor?: string }): void;
}>();

const parentExpanded = inject<Ref<Set<string>> | null>(EXPANDED_CTX, null);
const expanded = parentExpanded ?? ref<Set<string>>(new Set());

if (!parentExpanded) {
  provide(EXPANDED_CTX, expanded);
}

const isExpanded = (node: DocsTreeNode) => expanded.value.has(node.id);

function toggleNode(node: DocsTreeNode) {
  if (!node.children?.length) return;
  const next = new Set(expanded.value);
  if (next.has(node.id)) {
    next.delete(node.id);
  } else {
    next.add(node.id);
  }
  expanded.value = next;
}

function handleSelect(node: DocsTreeNode) {
  if (node.artifactId) {
    emit('select', { artifactId: node.artifactId, anchor: node.anchor });
  }
  if (node.children?.length) {
    const next = new Set(expanded.value);
    if (!next.has(node.id)) {
      next.add(node.id);
      expanded.value = next;
    } else {
      next.delete(node.id);
      expanded.value = next;
    }
  }
}
</script>

<template>
  <ul class="docs-tree">
    <li v-for="node in props.nodes" :key="node.id">
      <div class="tree-row">
        <button
          v-if="node.children?.length"
          type="button"
          class="toggle"
          @click.stop="toggleNode(node)"
        >
          {{ isExpanded(node) ? '▾' : '▸' }}
        </button>
        <span
          class="tree-node"
          :class="{
            selectable: !!node.artifactId,
            selected: node.artifactId === selectedArtifactId && !node.anchor,
            anchor: !!node.anchor
          }"
          @click="handleSelect(node)"
        >
          {{ node.label }}
        </span>
      </div>
      <DocsTree
        v-if="node.children?.length && isExpanded(node)"
        :nodes="node.children"
        :selected-artifact-id="selectedArtifactId"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.docs-tree {
  list-style: none;
  margin: 0;
  padding-left: 1rem;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  width: 1.5rem;
  height: 1.3rem;
  padding: 0;
  color: #6b7280;
  font-size: 1.6rem;
  line-height: 1;
}

.toggle:hover {
  color: #111827;
}

.tree-node {
  padding: 0.35rem 0.5rem;
  border-radius: 0.35rem;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  color: #374151;
  font-weight: 600;
  cursor: pointer;
}

.tree-node.selectable {
  cursor: pointer;
  color: #111827;
  font-weight: 500;
}

.tree-node.selectable:not(.anchor):hover {
  background: #eff6ff;
  color: #0f172a;
  box-shadow: inset 0 0 0 1px #bfdbfe;
}

.tree-node.selected {
  background: #dbeafe;
  font-weight: 600;
  color: #0f172a;
  box-shadow: inset 0 0 0 1px #93c5fd;
}

.tree-node.anchor {
  font-size: 0.9rem;
  padding-left: 1rem;
  color: #1d4ed8;
  cursor: pointer;
  font-weight: 400;
}

.tree-node.anchor:hover {
  text-decoration: underline;
}

.tree-node::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: transparent;
  border: 1px solid transparent;
  flex-shrink: 0;
}

.tree-node.selectable:not(.anchor)::before {
  border-color: #93c5fd;
}

.tree-node.anchor::before {
  border-color: transparent;
  background: #2563eb;
}
</style>
