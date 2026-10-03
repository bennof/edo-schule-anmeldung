// The family's booking and form draft until submission. By default kept in
// sessionStorage (survives a reload, gone when the tab is closed); only if
// the family ticks "keep on this device" in localStorage (survives closing
// the browser). Cleared after submission.
import type { FormData } from '@anmeldung/forms';

export interface Session {
    applicationId: string;
    token: string;
    procedureId: string;
    datetime: string;
}

const KEY = 'anmeldung.session.v1';
const DRAFT = 'anmeldung.draft.v1';

function store(persistent: boolean): Storage | undefined {
    try {
        return persistent ? localStorage : sessionStorage;
    } catch {
        return undefined; // storage unavailable (e.g. blocked): continue without
    }
}

function read<T>(key: string): T | undefined {
    for (const s of [store(true), store(false)]) {
        try {
            const raw = s?.getItem(key);
            if (raw) return JSON.parse(raw) as T;
        } catch {
            // ignore broken entries
        }
    }
    return undefined;
}

function write(key: string, value: unknown, persistent: boolean): void {
    try {
        store(persistent)?.setItem(key, JSON.stringify(value));
        store(!persistent)?.removeItem(key);
    } catch {
        // quota or blocked storage: continue without persistence
    }
}

function remove(key: string): void {
    for (const s of [store(true), store(false)]) {
        try {
            s?.removeItem(key);
        } catch {
            // ignore
        }
    }
}

export const session = {
    load: () => read<Session>(KEY),
    /** true if the family chose to keep the data on this device */
    isPersistent: (): boolean => {
        try {
            return localStorage.getItem(KEY) !== null;
        } catch {
            return false;
        }
    },
    save: (s: Session, persistent: boolean) => write(KEY, s, persistent),
    loadDraft: (applicationId: string): FormData | undefined => {
        const draft = read<{ applicationId: string; data: FormData }>(DRAFT);
        return draft?.applicationId === applicationId ? draft.data : undefined;
    },
    saveDraft: (applicationId: string, data: FormData, persistent: boolean) =>
        write(DRAFT, { applicationId, data }, persistent),
    /** moves booking and draft between tab storage and device storage */
    setPersistent: (persistent: boolean) => {
        for (const key of [KEY, DRAFT]) {
            const value = read<unknown>(key);
            if (value !== undefined) write(key, value, persistent);
        }
    },
    clear: () => {
        remove(KEY);
        remove(DRAFT);
    },
};
