import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { PluginDescriptor } from '../types/plugins';
import { fetchPlugins } from '../api/plugins';

export const usePluginsStore = defineStore('plugins', () => {
  const plugins = ref<PluginDescriptor[]>([]);
  const loading = ref(false);

  async function loadPlugins() {
    if (plugins.value.length > 0 || loading.value) {
      return;
    }
    loading.value = true;
    try {
      plugins.value = await fetchPlugins();
    } finally {
      loading.value = false;
    }
  }

  function findPlugin(key?: string) {
    if (!key) return undefined;
    return plugins.value.find((plugin) => plugin.key === key);
  }

  return { plugins, loading, loadPlugins, findPlugin };
});
