<template>
  <div class="app-shell">
    <header>
      <h1>Artifact Harvester</h1>
      <nav>
        <RouterLink to="/sources">Sources</RouterLink>
        <RouterLink to="/artifacts">Artifacts</RouterLink>
        <RouterLink to="/plugins">Plugins</RouterLink>
        <RouterLink to="/runs">Runs</RouterLink>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>

<style scoped>
.app-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 2rem;
  background: #111827;
  color: #fff;
}

nav {
  display: flex;
  gap: 1rem;
}

nav a {
  color: #f3f4f6;
  text-decoration: none;
  font-weight: 500;
}

nav a.router-link-active {
  color: #60a5fa;
}

main {
  flex: 1;
  padding: 2rem;
}
</style>
