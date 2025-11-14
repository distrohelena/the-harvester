<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ArtifactViewer from '../components/artifacts/ArtifactViewer.vue';
import { fetchArtifact, fetchArtifactVersions, fetchArtifactVersion } from '../api/artifacts';
import type { ArtifactModel, ArtifactVersionModel } from '../types/plugins';

const route = useRoute();
const id = route.params.id as string;
const artifact = ref<ArtifactModel>();
const versions = ref<ArtifactVersionModel[]>([]);
const selectedVersionId = ref<string>();
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const [artifactPayload, versionsPayload] = await Promise.all([
      fetchArtifact(id),
      fetchArtifactVersions(id)
    ]);
    artifact.value = artifactPayload;
    versions.value = versionsPayload;
    selectedVersionId.value = versionsPayload[0]?.id ?? artifactPayload.lastVersion?.id;
  } finally {
    loading.value = false;
  }
}

async function selectVersion(versionId: string) {
  selectedVersionId.value = versionId;
  if (!versions.value.find((version) => version.id === versionId)) {
    const version = await fetchArtifactVersion(versionId);
    versions.value = [version, ...versions.value];
  }
}

onMounted(load);
</script>

<template>
  <div v-if="loading && !artifact">Loading…</div>
  <ArtifactViewer
    v-else-if="artifact && versions.length"
    :artifact="artifact"
    :versions="versions"
    :selected-version-id="selectedVersionId"
    @select-version="selectVersion"
  />
  <p v-else>No versions found.</p>
</template>
