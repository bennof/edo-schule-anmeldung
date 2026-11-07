import { describe, expect, it } from 'vitest';
import { columnsOf, toOptionList } from './option-lists.ts';

describe('option lists from SVWS rows', () => {
    const rows = [
        { id: 1, iso2: 'TR', bezeichnungSuche: 'Türkei', gueltigBis: null },
        { id: 2, iso2: 'DE', bezeichnungSuche: 'Deutschland', gueltigBis: null, extra: true },
        { id: 3, iso2: 'DD', bezeichnungSuche: 'DDR', gueltigBis: 1990 },
        { id: 4, iso2: null, bezeichnungSuche: 'Ausland ohne Angabe', gueltigBis: null },
        { id: 5, iso2: 'TR', bezeichnungSuche: 'doppelt', gueltigBis: null },
        { id: 6, iso2: 'XX', bezeichnungSuche: 'versteckt', istSichtbar: false },
    ];

    it('collects the columns of all rows', () => {
        expect(columnsOf(rows)).toEqual(['id', 'iso2', 'bezeichnungSuche', 'gueltigBis', 'extra', 'istSichtbar']);
    });

    it('drops expired, hidden, empty and duplicate rows and sorts by value', () => {
        expect(toOptionList(rows, 'iso2', 'bezeichnungSuche', 2026)).toEqual([
            { key: 'DE', value: 'Deutschland' },
            { key: 'TR', value: 'Türkei' },
        ]);
    });

    it('numbers become text keys', () => {
        expect(toOptionList(rows, 'id', 'bezeichnungSuche', 2026).map((o) => o.key)).toEqual(['4', '2', '5', '1']);
    });
});
