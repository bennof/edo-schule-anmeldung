// Client for the public Rust server (/api, proxied by Vite in development).
import type { FormJson, Option } from '@anmeldung/forms';

export interface PublicProcedure {
    id: string;
    title: string;
    description?: string | null;
    startDate: string;
    endDate: string;
}

export interface PublicConfig {
    config: Record<string, string>;
    procedures: PublicProcedure[];
    hasLogo: boolean;
}

export interface Slot {
    id: string;
    /** YYYY-MM-DDTHH:mm, local school time */
    datetime: string;
}

export interface Booking {
    id: string;
    procedureId: string;
    datetime: string;
    /** null if the application could not be created (rare; secretariat helps) */
    applicationId: string | null;
    token: string | null;
}

export interface ApplicationStatus {
    id: string;
    procedureId: string;
    state: string;
    appointment: { id: string; datetime: string } | null;
}

export class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
        super(message);
        this.status = status;
        this.code = code;
    }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`/api${path}`, init);
    } catch {
        throw new ApiError(0, 'network', 'Keine Verbindung zum Server. Bitte später erneut versuchen.');
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, body.error ?? 'unknown', body.message ?? 'Unbekannter Fehler');
    return body as T;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export const api = {
    config: () => call<PublicConfig>('/config'),
    form: (procedureId: string) => call<{ id: string; form: FormJson }>(`/procedures/${procedureId}/form`),
    slots: (procedureId: string) => call<Slot[]>(`/procedures/${procedureId}/appointments`),
    book: (slotId: string, name: string, email: string) =>
        call<Booking>(`/appointments/${slotId}/booking`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email }),
        }),
    application: (id: string, token: string) => call<ApplicationStatus>(`/applications/${id}`, { headers: bearer(token) }),
    applicationForm: (id: string, token: string) =>
        call<{ id: string; form: FormJson }>(`/applications/${id}/form`, { headers: bearer(token) }),
    start: (id: string, token: string) => call<{ state: string }>(`/applications/${id}/start`, { method: 'POST', headers: bearer(token) }),
    submit: (id: string, token: string, data: unknown) =>
        call<{ state: string }>(`/applications/${id}/submit`, {
            method: 'POST',
            headers: { ...bearer(token), 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
        }),
};

/** Option lists (optionsSource) are public assets of active forms. */
export async function loadOptions(source: string): Promise<Option[]> {
    const res = await fetch(`/api/assets/${encodeURIComponent(source)}`);
    return res.ok ? res.json() : [];
}

export const LOGO_URL = '/api/assets/logo';

export function formatDay(date: string): string {
    return new Date(`${date}T12:00`).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}
