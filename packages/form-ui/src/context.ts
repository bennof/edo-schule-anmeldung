// Shared state of one rendered form, passed to nested components via context.
import type { FormJson, Option } from '@anmeldung/forms';
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
