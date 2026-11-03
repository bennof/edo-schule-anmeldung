// SVWS credentials shared by the settings check and the transfer dialog.
// The user name is remembered in this browser once it worked; the password
// stays in memory only and is gone after a reload or sign-out.
import type { SvwsCredentials } from '@anmeldung/svws';

const USER_KEY = 'anmeldung.secretariat.svwsUser';

function storedUser(): string {
    try {
        return localStorage.getItem(USER_KEY) ?? '';
    } catch {
        return '';
    }
}

export const svwsLogin = $state({ user: storedUser(), password: '' });

export function svwsCredentials(): SvwsCredentials {
    return { user: svwsLogin.user.trim(), password: svwsLogin.password };
}

/** Called after SVWS accepted the credentials: keep the user name for next time. */
export function rememberSvwsUser(): void {
    try {
        localStorage.setItem(USER_KEY, svwsLogin.user.trim());
    } catch {
        // storage blocked: the name is entered again next time
    }
}
