import { describe, expect, it } from 'vitest';
import { canTransitionApplication, canTransitionAppointment, isApplicationState } from './states.ts';

describe('appointment states', () => {
    it('allows the regular flow and cancellation', () => {
        expect(canTransitionAppointment('draft', 'available')).toBe(true);
        expect(canTransitionAppointment('available', 'booked')).toBe(true);
        expect(canTransitionAppointment('booked', 'done')).toBe(true);
        expect(canTransitionAppointment('booked', 'available')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(canTransitionAppointment('draft', 'booked')).toBe(false);
        expect(canTransitionAppointment('done', 'available')).toBe(false);
        expect(canTransitionAppointment('available', 'draft')).toBe(false);
    });
});

describe('application states', () => {
    it('allows the digital flow', () => {
        expect(canTransitionApplication('created', 'form_in_progress')).toBe(true);
        expect(canTransitionApplication('form_in_progress', 'submitted')).toBe(true);
        expect(canTransitionApplication('submitted', 'interview')).toBe(true);
    });

    it('allows skipping form_in_progress', () => {
        expect(canTransitionApplication('created', 'submitted')).toBe(true);
    });

    it('never jumps from checked past the explicit release', () => {
        expect(canTransitionApplication('checked', 'imported')).toBe(false);
        expect(canTransitionApplication('in_review', 'ready_for_svws')).toBe(false);
    });

    it('recognizes states', () => {
        expect(isApplicationState('in_review')).toBe(true);
        expect(isApplicationState('deleted')).toBe(false);
    });
});
