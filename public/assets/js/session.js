/* Session persistence for auto-rejoin.
 *
 * Stores enough info in localStorage to re-establish a server-side session
 * via POST /api/games/{code}/teams/{teamId}/join after a browser restart
 * or in a fresh tab.
 */

const SESSION_KEY = 'routeRush.session';

export function saveSession(data) {
    if (!data || typeof data !== 'object') return;
    if (!data.code || !data.team_id || !data.pin || !data.player_name) return;
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            code:        String(data.code),
            team_id:     Number(data.team_id),
            pin:         String(data.pin),
            player_name: String(data.player_name),
        }));
    } catch {
        // Quota or disabled storage — silently ignore.
    }
}

export function loadSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        const ok = typeof parsed.code === 'string'
                && Number.isInteger(parsed.team_id)
                && typeof parsed.pin === 'string'
                && typeof parsed.player_name === 'string';
        return ok ? parsed : null;
    } catch {
        return null;
    }
}

export function clearSession() {
    try {
        localStorage.removeItem(SESSION_KEY);
    } catch {
        // ignore
    }
}
