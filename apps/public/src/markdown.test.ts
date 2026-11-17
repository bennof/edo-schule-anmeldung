import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown.ts';

describe('legal text markdown', () => {
    it('parses headings, paragraphs with line breaks and lists', () => {
        const blocks = parseMarkdown('# Impressum\n\nSchule\nMusterstraße 1\n\n- eins\n- zwei\n\n### Klein');
        expect(blocks).toEqual([
            { t: 'h', level: 2, inline: [{ t: 'text', v: 'Impressum' }] },
            { t: 'p', inline: [{ t: 'text', v: 'Schule' }, { t: 'br' }, { t: 'text', v: 'Musterstraße 1' }] },
            { t: 'ul', items: [[{ t: 'text', v: 'eins' }], [{ t: 'text', v: 'zwei' }]] },
            { t: 'h', level: 3, inline: [{ t: 'text', v: 'Klein' }] },
        ]);
    });

    it('allows only safe link targets and never produces HTML', () => {
        expect(parseInline('[a](https://example.org) [b](javascript:alert(1)) <b>x</b>')).toEqual([
            { t: 'link', v: 'a', href: 'https://example.org' },
            { t: 'text', v: ' ' },
            { t: 'text', v: 'b' },
            { t: 'text', v: ') <b>x</b>' },
        ]);
        expect(parseInline('**fett** und [Mail](mailto:a@b.de)')).toEqual([
            { t: 'strong', v: 'fett' },
            { t: 'text', v: ' und ' },
            { t: 'link', v: 'Mail', href: 'mailto:a@b.de' },
        ]);
    });

    it('handles Windows line endings and empty input', () => {
        expect(parseMarkdown('a\r\nb')).toEqual([{ t: 'p', inline: [{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b' }] }]);
        expect(parseMarkdown('')).toEqual([]);
    });
});
