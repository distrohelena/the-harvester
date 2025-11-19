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
  padding: 0 2rem;
  background: #111827;
  color: #fff;
  height: 5vh;
  min-height: 48px;
  max-height: 5vh;
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
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  height: 94.5vh;
  max-height: 94.5vh;
  box-sizing: border-box;
}
</style>
