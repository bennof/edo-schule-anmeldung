<!-- Transfer of released applications to SVWS (Future: SVWS adapter).
     Asks for the SVWS credentials (kept in memory only), transfers the
     selected applications including the photo and records the results. -->
<script lang="ts">
    import { fileRefs, type FormJson } from '@anmeldung/forms';
    import type { ApplicationSummary } from '@anmeldung/sharepoint';
    import type { SvwsCredentials, TransferResult } from '@anmeldung/svws';
    import { applicationService, errorText, forms, site, svws } from '../services.ts';

    interface Props {
        selected: ApplicationSummary[];
        /** called after results were recorded */
        ondone: () => void;
    }

    let { selected, ondone }: Props = $props();

    let user = $state('');
    let password = $state('');
    let busy = $state(false);
    let info = $state('');
    let error = $state('');
    let results: (TransferResult & { name: string })[] = $state([]);
    const credentials = (): SvwsCredentials => ({ user: user.trim(), password });

    async function check(): Promise<void> {
        busy = true;
        error = info = '';
        try {
            info = await svws.check(credentials());
        } catch (e) {
            error = errorText(e);
        } finally {
            busy = false;
        }
    }

    async function transfer(): Promise<void> {
        busy = true;
        error = '';
        results = [];
        try {
            const items = await Promise.all(
                selected.map(async (summary) => {
                    const { application } = await applicationService.load(summary.id);
                    const definition = await forms.get(application.formId);
                    const [photoRef] = definition ? fileRefs(definition.formJson as FormJson, (application.data ?? {}) as Record<string, unknown>, 'photo') : [];
                    const photo = photoRef ? await site.getUpload(photoRef.id).then((b) => b?.arrayBuffer()) : undefined;
                    return {
                        applicationId: application.id,
                        formId: application.formId,
                        data: application.data,
                        submittedAt: application.submittedAt,
                        svwsId: application.svwsId,
                        photo: photo ? new Uint8Array(photo) : undefined,
                    };
                }),
            );
            const transferred = await svws.transfer(items, credentials());
            for (const r of transferred) await applicationService.recordTransfer(r.applicationId, r);
            results = transferred.map((r) => ({ ...r, name: selected.find((s) => s.id === r.applicationId)?.childName ?? r.applicationId }));
            ondone();
        } catch (e) {
            error = errorText(e);
        } finally {
            busy = false;
        }
    }
</script>

<div class="transfer" data-testid="svws-dialog">
    <p class="muted">{svws.status()}</p>
    {#if svws.ready}
        <form
            class="login"
            onsubmit={(e) => {
                e.preventDefault();
                transfer();
            }}
        >
            <label>SVWS-Benutzer <input bind:value={user} autocomplete="username" /></label>
            <label>Passwort <input type="password" bind:value={password} autocomplete="current-password" /></label>
            <button type="button" class="secondary" onclick={check} disabled={busy || !user.trim()}>Verbindung prüfen</button>
            <button type="submit" disabled={busy || !user.trim() || !selected.length}>{selected.length} Anmeldung(en) übertragen</button>
        </form>
        <p class="muted">Die Zugangsdaten werden nicht gespeichert.</p>
    {/if}
    {#if busy}<p role="status">Bitte warten …</p>{/if}
    {#if info}<p role="status" class="ok">{info}</p>{/if}
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if results.length}
        <ul class="results">
            {#each results as r (r.applicationId)}
                <li class:ok={r.ok} class:fail={!r.ok}>
                    <strong>{r.name}</strong>: {r.message}
                    {#if r.warnings?.length}
                        <ul class="warnings">{#each r.warnings as w}<li>{w}</li>{/each}</ul>
                    {/if}
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .login {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        align-items: end;
    }
    .login label {
        display: grid;
        gap: 0.15rem;
    }
    .results {
        margin: 0.5rem 0 0;
        padding-left: 1.2rem;
    }
    .ok {
        color: #1b6b30;
    }
    .fail {
        color: #b00020;
    }
    .warnings {
        color: #8a6d00;
        font-size: 0.9rem;
    }
    p {
        margin: 0.3rem 0;
    }
</style>
