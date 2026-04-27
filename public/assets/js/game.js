// In-game scaffold. Wires up just enough to make the header feel alive
// (live countdown). All other panels are static placeholders for now —
// the state polling, draw/trade/claim actions, and SVG map will be
// implemented in follow-up slices.

const code = document.body.dataset.gameCode;
const countdownEl = document.getElementById('countdown');

let endsAtMs = null;

async function bootstrap() {
    try {
        const res = await fetch(`/api/games/${encodeURIComponent(code)}`, {
            headers: { Accept: 'application/json' },
        });
        if (!res.ok) return;
        const state = await res.json();
        if (state.ends_at) {
            endsAtMs = Date.parse(state.ends_at);
            tickCountdown();
            setInterval(tickCountdown, 1000);
        }
    } catch {
        /* placeholder scaffold — silently ignore */
    }
}

function tickCountdown() {
    if (endsAtMs === null) return;
    const remainingMs = Math.max(0, endsAtMs - Date.now());
    const totalSec = Math.floor(remainingMs / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    countdownEl.textContent = h > 0
        ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
        : `${m}:${String(s).padStart(2, '0')}`;
}

bootstrap();
