// Minimal Markdown for the legal texts (imprint, privacy notice): headings,
// paragraphs, bullet lists, **bold** and [text](link). The result is a plain
// data structure that Svelte renders as elements; no HTML from the text is
// ever interpreted.

export type Inline =
    | { t: 'text'; v: string }
    | { t: 'strong'; v: string }
    | { t: 'link'; v: string; href: string }
    | { t: 'br' };

export type Block =
    | { t: 'h'; level: 2 | 3 | 4; inline: Inline[] }
    | { t: 'p'; inline: Inline[] }
    | { t: 'ul'; items: Inline[][] };

const SAFE_LINK = /^(https?:\/\/|mailto:|tel:)/i;
const INLINE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

export function parseInline(text: string): Inline[] {
    const out: Inline[] = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
        if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
        if (m[1] !== undefined) out.push({ t: 'strong', v: m[1] });
        else if (SAFE_LINK.test(m[3])) out.push({ t: 'link', v: m[2], href: m[3] });
        else out.push({ t: 'text', v: m[2] });
        last = m.index + m[0].length;
    }
    if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
    return out;
}

/** Lines of one paragraph; a line break in the text stays a line break. */
function lines(rows: string[]): Inline[] {
    return rows.flatMap((row, i) => (i === 0 ? parseInline(row) : [{ t: 'br' } as const, ...parseInline(row)]));
}

export function parseMarkdown(source: string): Block[] {
    const blocks: Block[] = [];
    let paragraph: string[] = [];
    let list: Inline[][] = [];
    const flush = (): void => {
        if (paragraph.length) blocks.push({ t: 'p', inline: lines(paragraph) });
        if (list.length) blocks.push({ t: 'ul', items: list });
        paragraph = [];
        list = [];
    };
    for (const raw of source.replace(/\r\n?/g, '\n').split('\n')) {
        const line = raw.trimEnd();
        const heading = /^(#{1,4})\s+(.+)$/.exec(line);
        const item = /^\s*[-*]\s+(.+)$/.exec(line);
        if (!line.trim()) flush();
        else if (heading) {
            flush();
            // the page title is the h1; text headings start at h2
            blocks.push({ t: 'h', level: Math.max(2, heading[1].length) as 2 | 3 | 4, inline: parseInline(heading[2]) });
        } else if (item) {
            if (paragraph.length) flush();
            list.push(parseInline(item[1]));
        } else {
            if (list.length) flush();
            paragraph.push(line.trim());
        }
    }
    flush();
    return blocks;
}
