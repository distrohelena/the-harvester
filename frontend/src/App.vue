<template>
  <div class="app-shell">
    <header>
      <h1>Artifact Harvester</h1>
      <nav>
        <RouterLink to="/sources">Sources</RouterLink>
        <RouterLink to="/artifacts">Artifacts</RouterLink>
        <RouterLink to="/plugins/docs">Plugins</RouterLink>
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
  /* Keep title bar consistent: the header never shrinks below 48px, so expose that as a variable other views can subtract. */
  --title-bar-size: max(5vh, 48px);
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
  height: var(--title-bar-size);
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
  /* Reserve explicit space for the global title bar plus ~2rem of breathing room so inner panels can mirror the calculation. */
  height: calc(100vh - var(--title-bar-size) - 2rem);
  max-height: calc(100vh - var(--title-bar-size) - 2rem);
  box-sizing: border-box;
}
</style>
