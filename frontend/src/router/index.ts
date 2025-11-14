import { createRouter, createWebHistory } from 'vue-router';

const SourcesView = () => import('../views/SourcesView.vue');
const SourceDetailView = () => import('../views/SourceDetailView.vue');
const ArtifactsView = () => import('../views/ArtifactsView.vue');
const ArtifactDetailView = () => import('../views/ArtifactDetailView.vue');
const RunsView = () => import('../views/RunsView.vue');

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/sources' },
    { path: '/sources', component: SourcesView },
    { path: '/sources/:id', component: SourceDetailView, props: true },
    { path: '/artifacts', component: ArtifactsView },
    { path: '/artifacts/:id', component: ArtifactDetailView, props: true },
    { path: '/runs', component: RunsView }
  ]
});

export default router;
