<script lang="ts">
    import Preview from './Preview.svelte';

    let route = $state(location.hash);
    window.addEventListener('hashchange', () => (route = location.hash));

    let serverStatus = $state('wird geprüft …');
    $effect(() => {
        if (route === '#vorschau') return;
        fetch('/api/health')
            .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
            .then((h: { status: string }) => (serverStatus = h.status))
            .catch(() => (serverStatus = 'nicht erreichbar'));
    });
</script>

<main>
    {#if route === '#vorschau'}
        <Preview />
    {:else}
        <h1>Anmeldung</h1>
        <p>Öffentliche Anmeldung – im Aufbau.</p>
        <p>Server: {serverStatus}</p>
        <p><a href="#vorschau">Formular-Vorschau (Testformular)</a></p>
    {/if}
</main>

<style>
    main {
        font-family: system-ui, sans-serif;
        max-width: 48rem;
        margin: 2rem auto;
        padding: 0 1rem;
    }
</style>
