<script lang="ts">
    import { APPOINTMENT_STATES } from '@anmeldung/domain';

    let serverStatus = $state('wird geprüft …');

    fetch('/api/health')
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((h: { status: string }) => (serverStatus = h.status))
        .catch(() => (serverStatus = 'nicht erreichbar'));
</script>

<main>
    <h1>Anmeldung</h1>
    <p>Öffentliche Anmeldung – im Aufbau.</p>
    <p>Server: {serverStatus}</p>
    <p class="muted">Terminstatus: {APPOINTMENT_STATES.join(', ')}</p>
</main>

<style>
    main {
        font-family: system-ui, sans-serif;
        max-width: 40rem;
        margin: 2rem auto;
        padding: 0 1rem;
    }
    .muted {
        color: #666;
    }
</style>
