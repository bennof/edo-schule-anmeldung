// Appointment plan generator (backlog E2/E5): deterministic slots for one day.
import type { Appointment } from './models.ts';

export interface ScheduleBreak {
    /** HH:mm */
    start: string;
    /** HH:mm */
    end: string;
}

export interface ScheduleParams {
    procedureId: string;
    /** YYYY-MM-DD */
    date: string;
    /** HH:mm, first slot start */
    start: string;
    /** HH:mm, no slot may end after this */
    end: string;
    intervalMinutes: number;
    breaks?: ScheduleBreak[];
    /** one slot per person/room and time; empty means a single unnamed track */
    verantwortliche?: string[];
}

export type DraftAppointment = Omit<Appointment, 'id'>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function minutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
}

function hhmm(total: number): string {
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Returns problems with the parameters; empty when valid. */
export function checkScheduleParams(p: ScheduleParams): string[] {
    const errors: string[] = [];
    if (!DATE.test(p.date)) errors.push('Datum fehlt oder ist ungültig');
    if (!TIME.test(p.start) || !TIME.test(p.end)) errors.push('Anfang und Ende im Format HH:MM angeben');
    else if (minutes(p.start) >= minutes(p.end)) errors.push('Anfang muss vor dem Ende liegen');
    if (!Number.isInteger(p.intervalMinutes) || p.intervalMinutes < 1) errors.push('Intervall muss eine positive ganze Zahl sein');
    for (const b of p.breaks ?? []) {
        if (!TIME.test(b.start) || !TIME.test(b.end) || minutes(b.start) >= minutes(b.end))
            errors.push(`Ungültige Pause ${b.start}–${b.end}`);
    }
    const names = (p.verantwortliche ?? []).map((v) => v.trim());
    if (names.some((v) => !v)) errors.push('Leerer Name bei Verantwortlichen');
    if (new Set(names).size !== names.length) errors.push('Verantwortliche doppelt angegeben');
    return errors;
}

/**
 * Generates draft appointments. Slots follow each other without gaps, fit
 * completely between start and end, and never overlap a break; after a break
 * the next slot starts at its end. Ordered by time, then by the order of
 * `verantwortliche`.
 */
export function generateSchedule(p: ScheduleParams): DraftAppointment[] {
    const errors = checkScheduleParams(p);
    if (errors.length) throw new Error(errors.join('; '));
    const breaks = (p.breaks ?? []).map((b) => [minutes(b.start), minutes(b.end)] as const);
    const tracks = p.verantwortliche?.length ? p.verantwortliche.map((v) => v.trim()) : [undefined];
    const slots: DraftAppointment[] = [];
    let t = minutes(p.start);
    while (t + p.intervalMinutes <= minutes(p.end)) {
        const slotEnd = t + p.intervalMinutes;
        const blocking = breaks.find(([bs, be]) => t < be && slotEnd > bs);
        if (blocking) {
            // continue right after the break
            t = blocking[1];
            continue;
        }
        for (const v of tracks) {
            slots.push({
                procedureId: p.procedureId,
                datetime: `${p.date}T${hhmm(t)}`,
                state: 'draft',
                ...(v && { verantwortlicherId: v }),
            });
        }
        t = slotEnd;
    }
    return slots;
}
