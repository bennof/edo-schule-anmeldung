// State machines for appointments and applications (backlog section 1).

export const APPOINTMENT_STATES = ['draft', 'available', 'booked', 'done'] as const;
export type AppointmentState = (typeof APPOINTMENT_STATES)[number];

const APPOINTMENT_TRANSITIONS: Record<AppointmentState, readonly AppointmentState[]> = {
    draft: ['available'],
    // booked -> available is the MVP cancellation path
    available: ['booked'],
    booked: ['done', 'available'],
    done: [],
};

export const APPLICATION_STATES = [
    'created',
    'form_in_progress',
    'submitted',
    'interview',
    'in_review',
    'checked',
    'ready_for_svws',
    'imported',
] as const;
export type ApplicationState = (typeof APPLICATION_STATES)[number];

const APPLICATION_TRANSITIONS: Record<ApplicationState, readonly ApplicationState[]> = {
    // form_in_progress is skipped when no digital form was started
    created: ['form_in_progress', 'submitted', 'interview'],
    form_in_progress: ['submitted', 'interview'],
    // interview: the family actually showed up for the registration talk
    submitted: ['interview'],
    interview: ['in_review'],
    in_review: ['checked'],
    // checked -> ready_for_svws is always an explicit user action
    checked: ['ready_for_svws'],
    ready_for_svws: ['imported'],
    imported: [],
};

export function canTransitionAppointment(from: AppointmentState, to: AppointmentState): boolean {
    return APPOINTMENT_TRANSITIONS[from].includes(to);
}

export function canTransitionApplication(from: ApplicationState, to: ApplicationState): boolean {
    return APPLICATION_TRANSITIONS[from].includes(to);
}

export function isAppointmentState(value: unknown): value is AppointmentState {
    return (APPOINTMENT_STATES as readonly unknown[]).includes(value);
}

export function isApplicationState(value: unknown): value is ApplicationState {
    return (APPLICATION_STATES as readonly unknown[]).includes(value);
}
