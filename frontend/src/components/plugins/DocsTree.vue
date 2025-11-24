<script setup lang="ts">
import { computed, inject, provide, ref, watch, type Ref } from 'vue';

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
  highlightedNodeIds?: string[];
}>();

const emit = defineEmits<{
  (e: 'select', payload: { artifactId: string; anchor?: string }): void;
}>();

const parentExpanded = inject<Ref<Set<string>> | null>(EXPANDED_CTX, null);
const expanded = parentExpanded ?? ref<Set<string>>(new Set());
const isRoot = parentExpanded === null;
const highlightedSet = computed(() => new Set(props.highlightedNodeIds ?? []));

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

function handleKeydown(event: KeyboardEvent, node: DocsTreeNode) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    handleSelect(node);
  }
}

const folderIconPath =
  'M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5Z' as const;
const fileIconPath =
  'M7 4.5A1.5 1.5 0 0 1 8.5 3h5.379a1.5 1.5 0 0 1 1.06.44l3.621 3.621A1.5 1.5 0 0 1 19 8.121V19.5A1.5 1.5 0 0 1 17.5 21h-9A1.5 1.5 0 0 1 7 19.5Z' as const;

const isFolder = (node: DocsTreeNode) => !node.artifactId;

watch(
  () => props.selectedArtifactId,
  (selected) => {
    if (!selected) {
      return;
    }
    const nextExpanded = new Set(expanded.value);
    props.nodes.forEach((node) => {
      if (node.children?.length && treeContainsArtifact(node, selected)) {
        nextExpanded.add(node.id);
      }
    });
    expanded.value = nextExpanded;
  },
  { immediate: true }
);

function treeContainsArtifact(node: DocsTreeNode, artifactId: string): boolean {
  if (node.artifactId === artifactId) {
    return true;
  }
  return node.children?.some((child) => treeContainsArtifact(child, artifactId)) ?? false;
}
</script>

<template>
  <ul :class="['docs-tree', { 'docs-tree--root': isRoot }]">
    <li v-for="node in props.nodes" :key="node.id">
      <div class="tree-row">
        <button
          v-if="node.children?.length"
          type="button"
          class="toggle"
          :aria-label="`${isExpanded(node) ? 'Collapse' : 'Expand'} ${node.label}`"
          @click.stop="toggleNode(node)"
        >
          {{ isExpanded(node) ? '▾' : '▸' }}
        </button>
        <span v-else class="toggle spacer" aria-hidden="true"></span>
        <div
          class="tree-node"
          :class="{
            folder: isFolder(node),
            file: !isFolder(node),
            selectable: !!node.artifactId,
            selected: node.artifactId === selectedArtifactId && !node.anchor,
            anchor: !!node.anchor,
            highlighted: highlightedSet.has(node.id)
          }"
          role="button"
          tabindex="0"
          @click="handleSelect(node)"
          @keydown="handleKeydown($event, node)"
        >
          <span
            v-if="!node.anchor"
            class="node-icon"
            :class="isFolder(node) ? 'folder-icon' : 'file-icon'"
            aria-hidden="true"
          >
            <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
              <path :d="isFolder(node) ? folderIconPath : fileIconPath" fill="currentColor" />
            </svg>
          </span>
          <span class="node-label">{{ node.label }}</span>
        </div>
      </div>
      <DocsTree
        v-if="node.children?.length && isExpanded(node)"
        :nodes="node.children"
        :selected-artifact-id="selectedArtifactId"
        :highlighted-node-ids="props.highlightedNodeIds"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
ul.docs-tree {
  list-style: none;
  margin: 0;
  padding-left: 1.25rem;
  border-left: 1px solid #e5e7eb;
}

.docs-tree.docs-tree--root {
  border-left: none;
  padding-left: 0.75rem;
}

.tree-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0.05rem 0;
  padding-left: 0.35rem;
}

.toggle {
  border: none;
  background: none;
  cursor: pointer;
  width: 1rem;
  height: 1rem;
  padding: 0;
  color: #94a3b8;
  font-size: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.toggle:hover {
  color: #0f172a;
}

.toggle.spacer {
  cursor: default;
  visibility: hidden;
}

.tree-node {
  border: none;
  background: none;
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.5rem 0.25rem 0.35rem;
  border-radius: 0.35rem;
  flex: 1;
  cursor: pointer;
  text-align: left;
  color: #0f172a;
  font-size: 0.9rem;
  font-weight: 500;
  min-width: 0;
  line-height: 1.3;
}

.tree-node.selectable {
  color: #0f172a;
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

.tree-node.highlighted {
  box-shadow: inset 0 0 0 1px #fcd34d;
  background: #fffbeb;
}

.tree-node:focus-visible {
  outline: 2px solid #2563eb;
  outline-offset: 2px;
}

.tree-node.folder {
  font-weight: 600;
}

.tree-node.anchor {
  font-size: 0.8rem;
  color: #2563eb;
  cursor: pointer;
  font-weight: 400;
  padding-left: 1.25rem;
}

.tree-node.anchor:hover {
  text-decoration: underline;
}

.node-icon {
  width: 0.85rem;
  height: 0.85rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #0f172a;
}

.node-icon svg {
  width: 0.8rem;
  height: 0.8rem;
}

.folder-icon {
  color: #2563eb;
}

.file-icon {
  color: #0f172a;
}

.tree-node.anchor .node-icon {
  display: none;
}

.node-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
