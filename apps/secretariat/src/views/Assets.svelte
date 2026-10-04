<!-- Asset management (backlog B4): binary resources by key, e.g. the logo
     (key "logo") shown in the public SPA, images and PDF templates. -->
<script lang="ts">
    import { isAssetKey, type AssetInfo } from '@anmeldung/sharepoint';
    import { errorText, site, uploadDefaultTemplate } from '../services.ts';

    let list: AssetInfo[] = $state([]);
    let previews: Record<string, string> = $state({});
    let message = $state('');
    let busy = $state(false);
    let key = $state('');
    let file: File | undefined = $state();

    const keyValid = $derived(isAssetKey(key));
    const exists = $derived(list.some((a) => a.key === key));

    async function load(): Promise<void> {
        list = (await site.listAssets()).sort((a, b) => a.key.localeCompare(b.key));
        for (const a of list) {
            // extension-less keys like "logo" are stored as octet-stream
            const maybeImage = a.contentType.startsWith('image/') || a.contentType === 'application/octet-stream';
            if (maybeImage && a.size < 2 * 1024 * 1024 && !previews[a.key]) {
                const blob = await site.getAsset(a.key);
                if (blob && (await isImage(blob))) previews[a.key] = URL.createObjectURL(blob);
            }
        }
    }

    /** PNG, JPEG, GIF, WebP or SVG by content. */
    async function isImage(blob: Blob): Promise<boolean> {
        const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
        const text = new TextDecoder().decode(head);
        return (
            (head[0] === 0x89 && text.slice(1, 4) === 'PNG') ||
            (head[0] === 0xff && head[1] === 0xd8) ||
            text.startsWith('GIF8') ||
            (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') ||
            /^\s*<(\?xml|svg)/.test(await blob.slice(0, 200).text())
        );
    }

    function pick(e: Event & { currentTarget: HTMLInputElement }): void {
        file = e.currentTarget.files?.[0];
        if (file && !key) key = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
    }

    async function upload(e: SubmitEvent): Promise<void> {
        e.preventDefault();
        const formElement = e.currentTarget as HTMLFormElement;
        if (!file || !keyValid) return;
        if (exists && !confirm(`„${key}“ ersetzen?`)) return;
        busy = true;
        try {
            await site.putAsset(key, file);
            if (previews[key]) URL.revokeObjectURL(previews[key]);
            delete previews[key];
            message = `„${key}“ gespeichert.`;
            key = '';
            file = undefined;
            formElement.reset();
            await load();
        } catch (err) {
            message = `Fehler: ${errorText(err)}`;
        } finally {
            busy = false;
        }
    }

    async function remove(asset: AssetInfo): Promise<void> {
        if (!confirm(`„${asset.key}“ löschen?`)) return;
        busy = true;
        try {
            await site.deleteAsset(asset.key);
            message = `„${asset.key}“ gelöscht.`;
            await load();
        } catch (err) {
            message = `Fehler: ${errorText(err)}`;
        } finally {
            busy = false;
        }
    }

    async function uploadTemplate(): Promise<void> {
        const exists = list.some((a) => a.key === 'anmeldebogen.pdf');
        if (exists && !confirm('Vorhandene Vorlage „anmeldebogen.pdf“ durch den Standard-Anmeldebogen ersetzen?')) return;
        busy = true;
        try {
            await uploadDefaultTemplate(true);
            message = 'Standard-Anmeldebogen als „anmeldebogen.pdf“ gespeichert.';
            await load();
        } catch (err) {
            message = `Fehler: ${errorText(err)}`;
        } finally {
            busy = false;
        }
    }

    const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} kB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

    load().catch((e) => (message = `Fehler: ${errorText(e)}`));
</script>

<section>
    <h2>Dateien</h2>
    <p class="muted">
        Das Logo der öffentlichen Anmeldung hat den Schlüssel <code>logo</code>. Dateien mit anderen Schlüsseln sind nur
        öffentlich, wenn ein aktives Formular sie als Optionsliste verwendet. Die PDF-Vorlage des Anmeldebogens hat den
        Schlüssel <code>anmeldebogen.pdf</code>; eine eigene Vorlage muss dieselben Feldnamen verwenden.
    </p>
    <p><button class="secondary" onclick={uploadTemplate} disabled={busy}>Standard-Anmeldebogen hochladen</button></p>
    <form class="upload" onsubmit={upload}>
        <label>Datei <input type="file" onchange={pick} /></label>
        <label>
            Schlüssel
            <input bind:value={key} placeholder="z. B. logo" aria-invalid={!!key && !keyValid} />
        </label>
        <button type="button" class="secondary" onclick={() => (key = 'logo')}>Als Logo</button>
        <button type="submit" disabled={busy || !file || !keyValid}>{exists ? 'Ersetzen' : 'Hochladen'}</button>
    </form>
    {#if key && !keyValid}<p class="error">Schlüssel: nur Buchstaben, Ziffern, Punkt, Minus und Unterstrich.</p>{/if}
    {#if message}<p role="status">{message}</p>{/if}

    <table>
        <thead><tr><th>Schlüssel</th><th>Typ</th><th>Größe</th><th>Geändert</th><th></th><th></th></tr></thead>
        <tbody>
            {#each list as a (a.key)}
                <tr>
                    <td><code>{a.key}</code></td>
                    <td>{a.contentType}</td>
                    <td>{size(a.size)}</td>
                    <td>{new Date(a.lastModified).toLocaleString('de-DE')}</td>
                    <td>{#if previews[a.key]}<img src={previews[a.key]} alt={a.key} />{/if}</td>
                    <td><button class="secondary" onclick={() => remove(a)} disabled={busy}>Löschen</button></td>
                </tr>
            {:else}
                <tr><td colspan="6" class="muted">Noch keine Dateien.</td></tr>
            {/each}
        </tbody>
    </table>
</section>

<style>
    .upload {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        align-items: end;
    }
    .upload label {
        display: grid;
        gap: 0.2rem;
    }
    img {
        max-height: 3rem;
        max-width: 8rem;
    }
</style>
