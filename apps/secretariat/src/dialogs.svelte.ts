// Confirmation dialog and short notices, shown by Dialogs.svelte.
// The desktop app's webview shows no window.confirm dialogs, so the app
// asks with its own dialog in the browser and in the desktop app alike.

interface Question {
    text: string;
    confirmLabel: string;
    resolve: (ok: boolean) => void;
}

export const dialogs = $state({ question: undefined as Question | undefined, notice: '' });

/** Asks a yes/no question; resolves to true on "OK". */
export function ask(text: string, confirmLabel = 'OK'): Promise<boolean> {
    dialogs.question?.resolve(false);
    return new Promise((resolve) => {
        dialogs.question = {
            text,
            confirmLabel,
            resolve: (ok) => {
                dialogs.question = undefined;
                resolve(ok);
            },
        };
    });
}

let noticeTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows a short notice at the bottom of the window for a few seconds. */
export function notify(text: string): void {
    dialogs.notice = text;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (dialogs.notice = ''), 6000);
}

// desktop app: the window reports finished downloads (desktop/src/main.rs)
window.addEventListener('desktop-download', (e) => {
    const { path, success } = (e as CustomEvent<{ path: string | null; success: boolean }>).detail;
    if (!success) notify('Die Datei konnte nicht gespeichert werden.');
    else notify(path ? `Gespeichert: ${path}` : 'Im Ordner „Downloads“ gespeichert.');
});
