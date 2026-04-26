const createForm = document.getElementById('create-game-form');
const createError = document.getElementById('create-error');
const joinForm = document.getElementById('join-form');
const joinError = document.getElementById('join-error');

createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    createError.textContent = '';
    const submit = createForm.querySelector('button[type="submit"]');
    submit.disabled = true;

    const fd = new FormData(createForm);
    const mapId = parseInt(fd.get('map_id'), 10);
    const minutes = parseInt(fd.get('duration_minutes'), 10);

    if (!Number.isInteger(mapId) || !Number.isInteger(minutes) || minutes <= 0 || minutes % 15 !== 0) {
        createError.textContent = 'Please pick a map and a duration in 15-minute steps.';
        submit.disabled = false;
        return;
    }

    try {
        const res = await fetch('/api/games', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ map_id: mapId, duration_seconds: minutes * 60 }),
        });
        const data = await res.json();
        if (!res.ok) {
            createError.textContent = data.message || 'Could not create the game.';
            submit.disabled = false;
            return;
        }
        window.location.href = `/lobby/${data.room_code}`;
    } catch {
        createError.textContent = 'Network error. Please try again.';
        submit.disabled = false;
    }
});

joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    joinError.textContent = '';
    const code = (new FormData(joinForm).get('code') || '').toString().toUpperCase().trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
        joinError.textContent = 'Room codes are 6 letters/digits.';
        return;
    }
    window.location.href = `/lobby/${code}`;
});
