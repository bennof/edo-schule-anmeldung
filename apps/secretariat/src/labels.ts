import type { ApplicationState, AppointmentState } from '@anmeldung/domain';

export const APPLICATION_STATE_LABEL: Record<ApplicationState, string> = {
    created: 'Gebucht, Formular offen',
    form_in_progress: 'Formular begonnen',
    submitted: 'Online abgeschickt',
    interview: 'Gespräch angetreten',
    in_review: 'In Prüfung',
    checked: 'Geprüft',
    ready_for_svws: 'Freigegeben für SVWS',
    imported: 'In SVWS übernommen',
};

export const APPOINTMENT_STATE_LABEL: Record<AppointmentState, string> = {
    draft: 'Entwurf',
    available: 'Frei',
    booked: 'Gebucht',
    done: 'Erledigt',
};

export function formatDateTime(datetime: string): string {
    const d = new Date(`${datetime.slice(0, 10)}T12:00`);
    return `${d.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })}, ${datetime.slice(11, 16)} Uhr`;
}
