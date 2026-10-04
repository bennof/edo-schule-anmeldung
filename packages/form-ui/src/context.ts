// Shared state of one rendered form, passed to nested components via context.
import type { FieldItem, FileRef, FormJson, Option } from '@anmeldung/forms';

/** Storage of file fields, provided by the app (public: via the server, secretariat: Graph). */
export interface FileHandler {
    upload(file: Blob, name: string, field: FieldItem): Promise<FileRef>;
    open(ref: FileRef): Promise<Blob | undefined>;
    /** omitted when files cannot be removed (e.g. after submission) */
    remove?(ref: FileRef): Promise<void>;
}
import { getContext, setContext } from 'svelte';

export type RenderMode = 'public' | 'secretariat';

export interface FormContext {
    readonly form: FormJson;
    readonly mode: RenderMode;
    /** validation messages by data path */
    readonly errors: Map<string, string>;
    readonly showAllErrors: boolean;
    touched: Set<string>;
    loadOptions?: (source: string) => Promise<Option[]>;
    files?: FileHandler;
}

const KEY = Symbol('form');

export function setFormContext(ctx: FormContext): void {
    setContext(KEY, ctx);
}

export function getFormContext(): FormContext {
    return getContext<FormContext>(KEY);
}

/** Error message to display for a path: after the field was left, or once all errors are shown. */
export function visibleError(ctx: FormContext, path: string): string | undefined {
    return ctx.showAllErrors || ctx.touched.has(path) ? ctx.errors.get(path) : undefined;
}
