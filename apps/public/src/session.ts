// The family's booking and form draft, kept in localStorage so a reload or a
// later visit on the same device can continue. Cleared after submission.
import type { FormData } from '@anmeldung/forms';

export interface Session {
    applicationId: string;
    token: string;
    procedureId: string;
    datetime: string;
}

const KEY = 'anmeldung.session.v1';
const DRAFT = 'anmeldung.draft.v1';

function read<T>(key: string): T | undefined {
    try {
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as T) : undefined;
    } catch {
        return undefined;
    }
}

function write(key: string, value: unknown): void {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // storage unavailable (private mode): continue without persistence
    }
}

export const session = {
    load: () => read<Session>(KEY),
    save: (s: Session) => write(KEY, s),
    loadDraft: (applicationId: string): FormData | undefined => {
        const draft = read<{ applicationId: string; data: FormData }>(DRAFT);
        return draft?.applicationId === applicationId ? draft.data : undefined;
    },
    saveDraft: (applicationId: string, data: FormData) => write(DRAFT, { applicationId, data }),
    clear: () => {
        try {
            localStorage.removeItem(KEY);
            localStorage.removeItem(DRAFT);
        } catch {
            // ignore
        }
    },
};
