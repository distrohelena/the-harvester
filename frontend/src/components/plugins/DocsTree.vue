<script setup lang="ts">
export interface DocsTreeNode {
  id: string;
  label: string;
  children?: DocsTreeNode[];
  artifactId?: string;
}

const props = defineProps<{
  nodes: DocsTreeNode[];
  selectedArtifactId?: string;
}>();

const emit = defineEmits<{
  (e: 'select', artifactId: string): void;
}>();

function handleSelect(node: DocsTreeNode) {
  if (node.artifactId) {
    emit('select', node.artifactId);
  }
}
</script>

<template>
  <ul class="docs-tree">
    <li v-for="node in props.nodes" :key="node.id">
      <div
        class="tree-node"
        :class="{ selectable: !!node.artifactId, selected: node.artifactId === selectedArtifactId }"
        @click="handleSelect(node)"
      >
        {{ node.label }}
      </div>
      <DocsTree
        v-if="node.children?.length"
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

.tree-node {
  padding: 0.25rem 0.35rem;
  border-radius: 0.35rem;
}

.tree-node.selectable {
  cursor: pointer;
}

.tree-node.selectable:hover {
  background: #eff6ff;
}

.tree-node.selected {
  background: #dbeafe;
  font-weight: 600;
}
</style>
