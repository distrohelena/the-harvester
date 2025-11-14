<script setup lang="ts">
import { computed } from 'vue';
import type { PluginNavigationSchema } from '../../types/plugins';
import type { NavigationPayload } from '../../api/navigation';
import DocsNavigationView from './DocsNavigationView.vue';
import GitNavigationView from './GitNavigationView.vue';
import PlainWebsiteNavigationView from './PlainWebsiteNavigationView.vue';

const props = defineProps<{
  schema?: PluginNavigationSchema;
  payload?: NavigationPayload;
}>();

const componentName = computed(() => {
  switch (props.schema?.type) {
    case 'tree':
      return DocsNavigationView;
    case 'timeline':
      return GitNavigationView;
    case 'list':
    default:
      return PlainWebsiteNavigationView;
  }
});
</script>

<template>
  <component :is="componentName" :payload="props.payload" />
</template>
