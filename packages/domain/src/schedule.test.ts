import { describe, expect, it } from 'vitest';
import { checkScheduleParams, generateSchedule, type ScheduleParams } from './schedule.ts';

const base: ScheduleParams = { procedureId: 'p1', date: '2030-03-04', start: '08:00', end: '09:00', intervalMinutes: 20 };
const times = (p: ScheduleParams) => generateSchedule(p).map((s) => s.datetime.slice(11) + (s.verantwortlicherId ? `/${s.verantwortlicherId}` : ''));

describe('schedule generator', () => {
    it('creates slots that fit completely', () => {
        expect(times(base)).toEqual(['08:00', '08:20', '08:40']);
        expect(times({ ...base, end: '08:50' })).toEqual(['08:00', '08:20']);
    });

    it('creates draft appointments for the procedure and date', () => {
        expect(generateSchedule(base)[0]).toEqual({ procedureId: 'p1', datetime: '2030-03-04T08:00', state: 'draft' });
    });

    it('skips slots overlapping breaks', () => {
        const p = { ...base, end: '10:00', intervalMinutes: 10, breaks: [{ start: '08:25', end: '08:45' }] };
        expect(times(p)).toEqual(['08:00', '08:10', '08:45', '08:55', '09:05', '09:15', '09:25', '09:35', '09:45']);
    });

    it('creates parallel slots per responsible person (E5)', () => {
        expect(times({ ...base, end: '08:40', verantwortliche: ['Raum 1', 'Raum 2'] })).toEqual([
            '08:00/Raum 1',
            '08:00/Raum 2',
            '08:20/Raum 1',
            '08:20/Raum 2',
        ]);
    });

    it('is deterministic', () => {
        const p = { ...base, intervalMinutes: 5, verantwortliche: ['A', 'B'], breaks: [{ start: '08:30', end: '08:35' }] };
        expect(generateSchedule(p)).toEqual(generateSchedule(p));
        expect(generateSchedule(p)).toHaveLength(22);
    });

    it('rejects invalid parameters', () => {
        expect(checkScheduleParams({ ...base, start: '09:00', end: '08:00' })).toEqual(['Anfang muss vor dem Ende liegen']);
        expect(checkScheduleParams({ ...base, intervalMinutes: 0 })).toHaveLength(1);
        expect(checkScheduleParams({ ...base, breaks: [{ start: '9:00', end: '09:10' }] })).toHaveLength(1);
        expect(checkScheduleParams({ ...base, verantwortliche: ['A', 'A'] })).toHaveLength(1);
        expect(() => generateSchedule({ ...base, date: '4.3.2030' })).toThrow(/Datum/);
    });
});
