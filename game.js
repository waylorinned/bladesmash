let audioStarted = false;
let toastTimer = null;
let statusTimer = null;

function isX2Active() { return Date.now() < gameData.x2CoinsUntil; }
function isInstantSpinActive() { return Date.now() < gameData.instantSpinUntil; }
function isCombatState() { return gameState === 'playing' || gameState === 'test'; }

function showToast(text) {
    const el = document.getElementById('toastMsg');
    el.innerText = text;
    el.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

function showStatus(text, color = '#ff4444', ms = 1500) {
    const el = document.getElementById('statusBanner');
    el.innerText = text;
    el.style.borderColor = color;
    el.style.display = 'block';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.style.display = 'none'; }, ms);
}

function hideStatus() {
    clearTimeout(statusTimer);
    document.getElementById('statusBanner').style.display = 'none';
}

function hideBlockCdOverlay() {
    const el = document.getElementById('blockCdOverlay');
    if (el) el.style.display = 'none';
}

// Test arena state
const testState = {
    ability: gameData.equippedAbility,
    sword: gameData.equippedSword,
    noCd: false,
    botMode: 'parry',
    kills: 0,
    respawnTimers: []
};
let eventCornerJumps = 0;
let lastEventJumpTime = 0;

function saveGame() {
    localStorage.setItem('bladeBallV1', JSON.stringify(gameData));
    document.getElementById('coinCount').innerText = gameData.coins.toLocaleString('en-US');
    document.getElementById('spinCount').innerText = gameData.spins;
    document.getElementById('freeSpinsModal').innerText = gameData.spins;
    document.getElementById('dailyLeftTxt').innerText = Math.max(0, 3 - gameData.dailyCoinSpinsUsed);
    updateAbilityHudIcon();
    updateLeaderboards3D();
    updateSaveStatsInfo();
}

function updateSaveStatsInfo() {
    const el = document.getElementById('saveStatsInfo');
    if (el) {
        el.innerText = `Киллов: ${gameData.kills} | Побед: ${gameData.wins} | Абилок: ${gameData.unlockedAbilities.length}/${ABILITIES.length}`;
    }
}

function updateAbilityHudIcon() {
    const abId = gameState === 'test' ? testState.ability : gameData.equippedAbility;
    const ab = ABILITIES.find(a => a.id === abId) || ABILITIES[0];
    const abImg = document.getElementById('abImgDisplay');
    abImg.onerror = () => { abImg.style.display = 'none'; };
    abImg.style.display = 'block';
    abImg.src = ab.img;
    document.getElementById('abTextDisplay').innerText = ab.passive ? 'ПАССИВ' : ab.name.toUpperCase();
    const badge = document.getElementById('abChargeBadge');
    if (ab.id === 'blink' && mainPlayer) {
        badge.style.display = 'block';
        badge.innerText = mainPlayer.blinkCharges;
    } else if (ab.id === 'gales_edge' && mainPlayer) {
        badge.style.display = 'block';
        badge.innerText = mainPlayer.galeCharges;
    } else if (ab.id === 'reaper' && mainPlayer && isCombatState()) {
        badge.style.display = 'block';
        badge.innerText = `x${mainPlayer.reaperStacks}`;
    } else {
        badge.style.display = 'none';
    }
}

// ==========================================
// AUDIO
// ==========================================
let audioCtx = null;
let audioCtxUnlocked = false;
let musicPlaying = false;
let audioUnlockInFlight = false;
const soundBuffers = { smash: null, kill: null };

function getSfxVol() { return typeof gfxSettings.sfxVol === 'number' ? gfxSettings.sfxVol : 0.95; }
function getMusicVol() { return typeof gfxSettings.musicVol === 'number' ? gfxSettings.musicVol : 0.4; }

function createAudioPool(src, size = 6) {
    const list = [];
    for (let i = 0; i < size; i++) {
        const a = new Audio(src);
        a.preload = 'auto';
        list.push(a);
    }
    let idx = 0;
    return {
        play(volume = 1, rate = 1) {
            const v = Math.max(0, Math.min(1, volume));
            if (v <= 0.005) return;
            const a = list[idx];
            idx = (idx + 1) % list.length;
            try {
                a.pause(); a.currentTime = 0;
                a.volume = v; a.playbackRate = rate;
                a.play().catch(() => {});
            } catch (e) {}
        }
    };
}
const smashPool = createAudioPool('smash.mp4', 8);
const killPool = createAudioPool('kill.mp4', 4);

async function initFastAudio() {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') await audioCtx.resume();
        const loadBuf = async (url, key) => {
            try {
                const res = await fetch(url);
                if (!res.ok) return;
                const arr = await res.arrayBuffer();
                soundBuffers[key] = await audioCtx.decodeAudioData(arr);
            } catch (e) {}
        };
        loadBuf('smash.mp4', 'smash');
        loadBuf('kill.mp4', 'kill');
    } catch (e) {}
}

function playBuffer(key, volume = 1.0, rate = 1.0, fallbackPool = null) {
    const finalVol = Math.max(0, Math.min(1, volume * getSfxVol()));
    if (finalVol <= 0.005) return;
    if (audioCtx && soundBuffers[key]) {
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const src = audioCtx.createBufferSource();
            const gain = audioCtx.createGain();
            src.buffer = soundBuffers[key];
            src.playbackRate.value = rate;
            gain.gain.value = finalVol;
            src.connect(gain); gain.connect(audioCtx.destination);
            src.start(0);
            return;
        } catch (e) {}
    }
    if (fallbackPool) fallbackPool.play(finalVol, rate);
}

function playClashSound(speed) {
    const rate = Math.min(1.9, Math.max(0.95, 1.0 + ((speed - 0.85) / 8.5)));
    playBuffer('smash', 1.0, rate, smashPool);
}
function playKillSound() { playBuffer('kill', 1.0, 1.0, killPool); }

function playSynth(freq1, freq2, dur, type = 'sine', vol = 0.28) {
    const finalVol = vol * getSfxVol();
    if (finalVol <= 0.005) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq1, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), audioCtx.currentTime + dur);
        gain.gain.setValueAtTime(finalVol, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + dur);
        osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch (e) {}
}

const musicTracks = [
    document.getElementById('bgm-classic'),
    document.getElementById('bgm-mystic'),
    document.getElementById('bgm-verygood')
];
let currentTrackIndex = -1;
let unplayedIndices = [0, 1, 2];

function applyMusicVolume() {
    const v = getMusicVol();
    musicTracks.forEach(t => { if (t) t.volume = v; });
}

function playRandomMusic() {
    if (unplayedIndices.length === 0) {
        unplayedIndices = [0, 1, 2].filter(i => i !== currentTrackIndex);
    }
    const pickPos = Math.floor(Math.random() * unplayedIndices.length);
    currentTrackIndex = unplayedIndices.splice(pickPos, 1)[0];
    const track = musicTracks[currentTrackIndex];
    if (!track) return Promise.reject();
    track.currentTime = 0;
    track.volume = getMusicVol();
    const p = track.play();
    if (p && typeof p.then === 'function') {
        return p.then(() => { musicPlaying = true; });
    }
    musicPlaying = true;
    return Promise.resolve();
}

musicTracks.forEach(t => {
    if (!t) return;
    t.addEventListener('ended', () => {
        playRandomMusic().catch(() => { musicPlaying = false; });
    });
    t.addEventListener('error', () => {
        musicPlaying = false;
    });
});

function tryUnlockAudio() {
    if (!audioCtxUnlocked) {
        audioCtxUnlocked = true;
        initFastAudio();
    } else if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(() => {});
    }
    if (musicPlaying || audioUnlockInFlight) return;
    audioUnlockInFlight = true;
    playRandomMusic()
        .then(() => {
            audioStarted = true;
            audioUnlockInFlight = false;
            window.removeEventListener('touchend', tryUnlockAudio, true);
            window.removeEventListener('click', tryUnlockAudio, true);
            window.removeEventListener('keydown', tryUnlockAudio, true);
        })
        .catch(() => {
            audioUnlockInFlight = false;
            musicPlaying = false;
        });
}
window.addEventListener('touchend', tryUnlockAudio, { capture: true, passive: true });
window.addEventListener('click', tryUnlockAudio, { capture: true });
window.addEventListener('keydown', tryUnlockAudio, { capture: true });

// Kill feed
let killFeedTimeout = null;
function getStreakLabel(kills) {
    if (kills === 1) return '1x First Blood';
    if (kills === 2) return '2x Double Kill';
    if (kills === 3) return '3x Triple Kill';
    if (kills === 4) return '4x Massacre';
    if (kills === 5) return '5x Rampage';
    return `${kills}x Monster`;
}

function showKillFeed(botName, kills) {
    const box = document.getElementById('killFeed');
    document.getElementById('killLine1').innerText = `Вы устранили ${botName}`;
    document.getElementById('killLine2').innerText = getStreakLabel(kills);
    box.style.display = 'none';
    void box.offsetWidth;
    box.style.display = 'block';
    clearTimeout(killFeedTimeout);
    killFeedTimeout = setTimeout(() => { box.style.display = 'none'; }, 2800);
}

// ==========================================
// SCENE & RENDERER
// ==========================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030510);
scene.fog = new THREE.FogExp2(0x05081a, 0.0014);

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1300);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.getElementById('gameCanvas').appendChild(renderer.domElement);

let composer = null;
let bloomPass = null;
function initBloom() {
    if (typeof THREE.EffectComposer === 'undefined' || typeof THREE.UnrealBloomPass === 'undefined') return;
    composer = new THREE.EffectComposer(renderer);
    composer.addPass(new THREE.RenderPass(scene, camera));
    bloomPass = new THREE.UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.5,
        0.35,
        0.68
    );
    composer.addPass(bloomPass);
}
initBloom();

scene.add(new THREE.AmbientLight(0x7c90c4, 0.7));
const dirLight = new THREE.DirectionalLight(0xdceaff, 0.8);
dirLight.position.set(60, 140, 80);
scene.add(dirLight);
const rimLight = new THREE.DirectionalLight(0x6622ff, 0.45);
rimLight.position.set(-80, 60, -100);
scene.add(rimLight);

function createGlowTexture() {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0.0, 'rgba(255, 255, 255, 1.0)');
    g.addColorStop(0.25, 'rgba(255, 255, 255, 0.75)');
    g.addColorStop(0.55, 'rgba(255, 255, 255, 0.22)');
    g.addColorStop(1.0, 'rgba(255, 255, 255, 0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
}
const GLOW_TEX = createGlowTexture();

function createNightSkyDome() {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#02030c');
    grad.addColorStop(0.45, '#080d28');
    grad.addColorStop(0.76, '#14153c');
    grad.addColorStop(1.0, '#050714');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1024, 512);

    const neb1 = ctx.createRadialGradient(260, 185, 10, 260, 185, 240);
    neb1.addColorStop(0, 'rgba(130, 40, 255, 0.34)');
    neb1.addColorStop(0.5, 'rgba(55, 20, 145, 0.14)');
    neb1.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb1; ctx.fillRect(0, 0, 1024, 512);

    const neb2 = ctx.createRadialGradient(760, 205, 10, 760, 205, 260);
    neb2.addColorStop(0, 'rgba(0, 175, 255, 0.28)');
    neb2.addColorStop(0.5, 'rgba(20, 60, 165, 0.10)');
    neb2.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = neb2; ctx.fillRect(0, 0, 1024, 512);

    for (let i = 0; i < 700; i++) {
        const x = Math.random() * 1024, y = Math.random() * 425;
        const r = Math.random() < 0.12 ? 1.8 : 0.9;
        ctx.fillStyle = Math.random() < 0.22 ? '#88ddff' : (Math.random() < 0.22 ? '#ffbbff' : '#ffffff');
        ctx.globalAlpha = 0.35 + Math.random() * 0.65;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const moonGrad = ctx.createRadialGradient(620, 118, 12, 620, 118, 75);
    moonGrad.addColorStop(0, 'rgba(220, 235, 255, 0.9)');
    moonGrad.addColorStop(0.25, 'rgba(145, 190, 255, 0.4)');
    moonGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = moonGrad; ctx.fillRect(540, 40, 160, 160);

    const tex = new THREE.CanvasTexture(c);
    return new THREE.Mesh(
        new THREE.SphereGeometry(760, 24, 16),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false })
    );
}
const skyDome = createNightSkyDome();
scene.add(skyDome);

function createStarField() {
    const geo = new THREE.BufferGeometry();
    const count = 900;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const r = 240 + Math.random() * 380;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI * 0.55;
        pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        pos[i * 3 + 1] = 25 + r * Math.cos(phi);
        pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xbbccff, size: 2.0, transparent: true, opacity: 0.8, fog: false }));
}
const starField = createStarField();
scene.add(starField);

function createNeonTileTexture(baseHex, lineHex, repeat) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseHex; ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = lineHex; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 252);
    ctx.strokeStyle = 'rgba(120,180,255,0.05)'; ctx.lineWidth = 2;
    ctx.strokeRect(18, 18, 220, 220);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeat);
    return tex;
}

function createTextPlane(w, h, bgColor, borderColor, lines, textColor = '#9abce0') {
    const c = document.createElement('canvas');
    c.width = 512; c.height = Math.round(512 * (h / w));
    const ctx = c.getContext('2d');
    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, c.width, c.height);
    if (borderColor) {
        ctx.strokeStyle = borderColor; ctx.lineWidth = 10;
        ctx.strokeRect(5, 5, c.width - 10, c.height - 10);
    }
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const step = c.height / (lines.length + 1);
    lines.forEach((line, idx) => {
        ctx.font = `bold ${idx === 0 ? 44 : 30}px sans-serif`;
        ctx.fillText(line, c.width / 2, step * (idx + 1));
    });
    const tex = new THREE.CanvasTexture(c);
    return new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
}

function createNameSprite(name, subText, color = '#cad8ee') {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 84;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(4,8,20,0.72)';
    ctx.fillRect(8, 8, 284, 68);
    ctx.font = 'bold 26px sans-serif';
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, 150, 30);
    ctx.font = 'bold 18px sans-serif';
    ctx.fillStyle = '#8aa4c2';
    ctx.fillText(subText, 150, 58);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }));
    sp.scale.set(12.5, 3.5, 1);
    return sp;
}

// Arena (Z = 0)
const arenaFloor = new THREE.Mesh(
    new THREE.BoxGeometry(220, 2, 220),
    new THREE.MeshPhongMaterial({ map: createNeonTileTexture('#090f20', '#18427a', 22), shininess: 35, specular: 0x1b3662 })
);
arenaFloor.position.set(0, -1, 0);
scene.add(arenaFloor);

const centerRing = new THREE.Mesh(
    new THREE.RingGeometry(6.2, 7.6, 40),
    new THREE.MeshBasicMaterial({ color: 0xff2244, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85 })
);
centerRing.rotation.x = -Math.PI / 2; centerRing.position.set(0, 0.14, 0);
scene.add(centerRing);

const wallMat = new THREE.MeshLambertMaterial({ color: 0x102242, transparent: true, opacity: 0.78 });
const wallEdgeMat = new THREE.MeshBasicMaterial({ color: 0x0099cc });
[[0, 4, -110, 220, 8, 2], [0, 4, 110, 220, 8, 2], [-110, 4, 0, 2, 8, 220], [110, 4, 0, 2, 8, 220]].forEach(w => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w[3], w[4], w[5]), wallMat);
    m.position.set(w[0], w[1], w[2]); scene.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w[3], 0.5, w[5]), wallEdgeMat);
    trim.position.set(w[0], 8.1, w[2]); scene.add(trim);
});

// Secret Test Arena (Z = -340)
const TEST_Z = -340;
const testFloor = new THREE.Mesh(
    new THREE.BoxGeometry(180, 2, 180),
    new THREE.MeshPhongMaterial({ map: createNeonTileTexture('#0b071d', '#3e1e8a', 18), shininess: 40, specular: 0x331b6e })
);
testFloor.position.set(0, -1, TEST_Z);
scene.add(testFloor);

const testCenterRing = new THREE.Mesh(
    new THREE.RingGeometry(5.5, 7.0, 36),
    new THREE.MeshBasicMaterial({ color: 0x00ccff, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85 })
);
testCenterRing.rotation.x = -Math.PI / 2; testCenterRing.position.set(0, 0.14, TEST_Z);
scene.add(testCenterRing);

const testWallMat = new THREE.MeshLambertMaterial({ color: 0x190f38, transparent: true, opacity: 0.78 });
const testEdgeMat = new THREE.MeshBasicMaterial({ color: 0x8833cc });
[[0, 4, TEST_Z - 90, 180, 8, 2], [0, 4, TEST_Z + 90, 180, 8, 2], [-90, 4, TEST_Z, 2, 8, 180], [90, 4, TEST_Z, 2, 8, 180]].forEach(w => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w[3], w[4], w[5]), testWallMat);
    m.position.set(w[0], w[1], w[2]); scene.add(m);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(w[3], 0.5, w[5]), testEdgeMat);
    trim.position.set(w[0], 8.1, w[2]); scene.add(trim);
});

const testSign = createTextPlane(36, 7, '#120828', '#8833cc', ['ТЕСТ-АРЕНА', 'ПРОВЕРКА АБИЛОК И VFX']);
testSign.position.set(0, 13, TEST_Z - 87);
scene.add(testSign);

// Lobby (Z = 320)
const LOBBY_Z = 320;
const lobbyFloor = new THREE.Mesh(
    new THREE.BoxGeometry(160, 2, 160),
    new THREE.MeshPhongMaterial({ map: createNeonTileTexture('#0c1124', '#1d325c', 16), shininess: 25, specular: 0x16294d })
);
lobbyFloor.position.set(0, -1, LOBBY_Z);
scene.add(lobbyFloor);

const lWallMat = new THREE.MeshLambertMaterial({ color: 0x182748, transparent: true, opacity: 0.7 });
[[0, 5, LOBBY_Z - 80, 160, 10, 2], [0, 5, LOBBY_Z + 80, 160, 10, 2],
 [-80, 5, LOBBY_Z, 2, 10, 160], [80, 5, LOBBY_Z, 2, 10, 160]].forEach(w => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w[3], w[4], w[5]), lWallMat);
    m.position.set(w[0], w[1], w[2]); scene.add(m);
});

const spawnPad = new THREE.Mesh(new THREE.CylinderGeometry(11, 11.5, 0.4, 32), new THREE.MeshLambertMaterial({ color: 0x004c99 }));
spawnPad.position.set(0, 0.2, LOBBY_Z - 4); scene.add(spawnPad);
const spawnSign = createTextPlane(16, 4.5, '#061a3a', '#0088bb', ['СПАВН']);
spawnSign.position.set(0, 0.45, LOBBY_Z - 4); spawnSign.rotation.x = -Math.PI / 2; scene.add(spawnSign);

const WHEEL_PAD_POS = new THREE.Vector3(0, 0, LOBBY_Z + 28);
const wheelPad = new THREE.Mesh(new THREE.CylinderGeometry(14, 14.5, 0.5, 32), new THREE.MeshLambertMaterial({ color: 0x6a1499 }));
wheelPad.position.set(WHEEL_PAD_POS.x, 0.25, WHEEL_PAD_POS.z); scene.add(wheelPad);
const wheelFloorText = createTextPlane(20, 6, '#240538', '#aa33bb', ['КОЛЕСО', 'ФОРТУНЫ']);
wheelFloorText.position.set(0, 0.55, LOBBY_Z + 28); wheelFloorText.rotation.x = -Math.PI / 2; scene.add(wheelFloorText);
const wheelBanner = createTextPlane(32, 7, '#1d002e', '#aa2890', ['РУЛЕТКА', 'RAPTURE & NEBULA']);
wheelBanner.position.set(0, 6, LOBBY_Z + 48); wheelBanner.rotation.y = Math.PI; scene.add(wheelBanner);

const mapTitle = createTextPlane(36, 6, '#0d182e', '#2672aa', ['ВЫБОР КАРТЫ', '(СКОРО)']);
mapTitle.position.set(0, 11, LOBBY_Z - 76); scene.add(mapTitle);
[-22, 0, 22].forEach((mx, i) => {
    const pad = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 16), new THREE.MeshLambertMaterial({ color: 0x1a3050 }));
    pad.position.set(mx, 0.25, LOBBY_Z - 64); scene.add(pad);
    const numPlane = createTextPlane(14, 10, '#0a1626', '#3377aa', [`MAP ${i + 1}`]);
    numPlane.position.set(mx, 0.55, LOBBY_Z - 64); numPlane.rotation.x = -Math.PI / 2; scene.add(numPlane);
});

const eventPad = new THREE.Mesh(new THREE.CylinderGeometry(13, 13.5, 0.5, 32), new THREE.MeshLambertMaterial({ color: 0xaa5500 }));
eventPad.position.set(56, 0.25, LOBBY_Z - 58); scene.add(eventPad);
const eventSign = createTextPlane(24, 7, '#2a1500', '#aa6e00', ['ИВЕНТЫ', 'СКОРО']);
eventSign.position.set(56, 9, LOBBY_Z - 72); scene.add(eventSign);

// 3D Leaderboards
const lbKillsCanvas = document.createElement('canvas'); lbKillsCanvas.width = 512; lbKillsCanvas.height = 512;
const lbKillsTex = new THREE.CanvasTexture(lbKillsCanvas);
const lbKillsMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: lbKillsTex, side: THREE.DoubleSide }));
lbKillsMesh.position.set(76, 13, LOBBY_Z - 14); lbKillsMesh.rotation.y = -Math.PI / 2; scene.add(lbKillsMesh);

const lbWinsCanvas = document.createElement('canvas'); lbWinsCanvas.width = 512; lbWinsCanvas.height = 512;
const lbWinsTex = new THREE.CanvasTexture(lbWinsCanvas);
const lbWinsMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ map: lbWinsTex, side: THREE.DoubleSide }));
lbWinsMesh.position.set(76, 13, LOBBY_Z + 18); lbWinsMesh.rotation.y = -Math.PI / 2; scene.add(lbWinsMesh);

function drawLeaderboard(canvas, tex, title, accent, playerVal, prop) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#060c1c'; ctx.fillRect(0, 0, 512, 512);
    ctx.strokeStyle = accent; ctx.lineWidth = 10; ctx.strokeRect(5, 5, 502, 502);
    ctx.fillStyle = accent; ctx.font = 'bold 40px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(title, 256, 60);

    const all = serverRoster.map(b => ({ name: b.name, val: b[prop], tier: b.tier, isMe: false }))
        .concat([{ name: 'Player', val: playerVal, tier: 'me', isMe: true }])
        .sort((a, b) => b.val - a.val).slice(0, 7);

    all.forEach((row, i) => {
        const y = 130 + i * 53;
        ctx.textAlign = 'left';
        ctx.fillStyle = row.isMe ? '#00aa55' : (row.tier === 'sweat' ? '#cc4455' : (row.tier === 'pro' ? '#bb9900' : '#95a8c4'));
        ctx.font = (row.isMe || row.tier === 'sweat') ? 'bold 27px sans-serif' : '25px sans-serif';
        ctx.fillText(`#${i + 1} ${row.name}`, 28, y);
        ctx.textAlign = 'right';
        ctx.fillText(row.val.toLocaleString('en-US'), 484, y);
    });
    tex.needsUpdate = true;
}

function updateLeaderboards3D() {
    drawLeaderboard(lbKillsCanvas, lbKillsTex, 'SERVER: KILLS', '#aa3344', gameData.kills, 'kills');
    drawLeaderboard(lbWinsCanvas, lbWinsTex, 'SERVER: WINS', '#aa8800', gameData.wins, 'wins');
}

// Training area
const TRAIN_X_MIN = -78, TRAIN_X_MAX = -38;
const TRAIN_Z_MIN = LOBBY_Z - 75, TRAIN_Z_MAX = LOBBY_Z + 75;
const trainFloor = new THREE.Mesh(new THREE.PlaneGeometry(40, 150), new THREE.MeshLambertMaterial({ color: 0x07201a, side: THREE.DoubleSide }));
trainFloor.rotation.x = -Math.PI / 2; trainFloor.position.set(-58, 0.12, LOBBY_Z); scene.add(trainFloor);

const trainLine = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 150), new THREE.MeshLambertMaterial({ color: 0x00aa66 }));
trainLine.position.set(TRAIN_X_MAX, 0.2, LOBBY_Z); scene.add(trainLine);

const trainSign = createTextPlane(30, 7, '#042219', '#009955', ['ТРЕНИРОВКА', 'ЗОНА ОТБИВАНИЯ']);
trainSign.position.set(-58, 12, LOBBY_Z - 73); scene.add(trainSign);

const TRAIN_TARGET_POS = new THREE.Vector3(-58, 6, LOBBY_Z - 64);
const targetGroup = new THREE.Group();
targetGroup.position.copy(TRAIN_TARGET_POS);
[[5.5, 1.0, 0xcc2233], [3.6, 1.1, 0x99aabb], [1.6, 1.2, 0xcc2233]].forEach(([r, d, col]) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d, 24), new THREE.MeshLambertMaterial({ color: col }));
    m.rotation.x = Math.PI / 2; targetGroup.add(m);
});
scene.add(targetGroup);

// ==========================================
// VFX ENGINE & WORLD ABILITY OBJECTS
// ==========================================
const vfxList = [];
const windWalls = [];
const arenaTraps = [];
const arenaTotems = [];

const GEO_SPARK = new THREE.BoxGeometry(0.32, 0.32, 2.8);
const GEO_RING = new THREE.RingGeometry(0.76, 1.0, 28);
const GEO_SLASH = new THREE.RingGeometry(4.2, 8.6, 22, 1, -1.25, 2.5);
const GEO_BEAM = new THREE.CylinderGeometry(2.2, 4.4, 130, 14, 1, true);
const GEO_ROCK = new THREE.DodecahedronGeometry(1.7, 0);
const GEO_GHOST = new THREE.BoxGeometry(3.8, 7.6, 2.2);
const GEO_ICE = new THREE.OctahedronGeometry(1.4, 0);

let camShake = 0;
let targetFov = 62;

function addShake(amount) {
    camShake = Math.min(3.5, camShake + amount);
}

function clearWorldAbilityObjects() {
    windWalls.forEach(w => scene.remove(w.mesh));
    windWalls.length = 0;
    arenaTraps.forEach(t => scene.remove(t.mesh));
    arenaTraps.length = 0;
    arenaTotems.forEach(t => scene.remove(t.mesh));
    arenaTotems.length = 0;
}

function spawnShockwave(pos, hexColor, startScale, endScale, decay = 0.055, horizontal = true, rotY = 0) {
    if (!gfxSettings.particles) return;
    const mat = new THREE.MeshBasicMaterial({
        color: hexColor, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const mesh = new THREE.Mesh(GEO_RING, mat);
    mesh.position.copy(pos);
    if (horizontal) mesh.rotation.x = -Math.PI / 2;
    else mesh.rotation.y = rotY;
    mesh.scale.setScalar(startScale);
    scene.add(mesh);
    vfxList.push({ type: 'ring', mesh, mat, life: 1.0, decay, startScale, endScale });
}

function spawnSlashArc(entity, hexColor, scale = 1.0) {
    if (!gfxSettings.particles) return;
    const mat = new THREE.MeshBasicMaterial({
        color: hexColor, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const mesh = new THREE.Mesh(GEO_SLASH, mat);
    mesh.position.copy(entity.mesh.position);
    mesh.position.y += 1.2;
    mesh.rotation.order = 'YXZ';
    mesh.rotation.y = entity.mesh.rotation.y - 0.9;
    mesh.rotation.x = Math.PI / 2 + 0.25;
    mesh.rotation.z = -0.35;
    mesh.scale.setScalar(scale);
    scene.add(mesh);
    vfxList.push({ type: 'slash', mesh, mat, life: 1.0, decay: 0.085, spinY: 0.28, owner: entity });
}

function spawnSparks(pos, hexColor, count = 18, speedMul = 1.0) {
    if (!gfxSettings.particles) return;
    const actual = gfxSettings.preset === 'fps' ? Math.max(4, Math.ceil(count * 0.4)) : count;
    for (let i = 0; i < actual; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: i % 3 === 0 ? 0xffffff : hexColor,
            transparent: true, opacity: 1.0,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const mesh = new THREE.Mesh(GEO_SPARK, mat);
        mesh.position.copy(pos);
        const theta = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.25) * 2.2;
        const spd = (1.4 + Math.random() * 2.6) * speedMul;
        const vel = new THREE.Vector3(Math.cos(theta) * spd, elev * spd * 0.7 + 0.6, Math.sin(theta) * spd);
        mesh.lookAt(pos.clone().add(vel));
        scene.add(mesh);
        vfxList.push({ type: 'spark', mesh, mat, vel, life: 1.0, decay: 0.036 + Math.random() * 0.02, grav: 0.09 });
    }
}

function spawnKillBeam(pos, hexColor) {
    addShake(1.6);
    if (!gfxSettings.particles) return;
    const mat = new THREE.MeshBasicMaterial({
        color: hexColor, side: THREE.DoubleSide, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const beam = new THREE.Mesh(GEO_BEAM, mat);
    beam.position.set(pos.x, 65, pos.z);
    scene.add(beam);
    vfxList.push({ type: 'beam', mesh: beam, mat, life: 1.0, decay: 0.028 });

    const groundPos = new THREE.Vector3(pos.x, 0.35, pos.z);
    spawnShockwave(groundPos, hexColor, 2, 26, 0.035, true);
    spawnShockwave(groundPos, 0xffffff, 1, 16, 0.05, true);
    spawnSparks(pos, hexColor, 26, 1.35);
}

function spawnLightning(startPos, endPos, hexColor, boltCount = 3) {
    if (!gfxSettings.particles) return;
    const segments = 7;
    for (let b = 0; b < boltCount; b++) {
        const pts = [];
        for (let i = 0; i <= segments; i++) {
            const t = i / segments;
            const p = new THREE.Vector3().lerpVectors(startPos, endPos, t);
            if (i > 0 && i < segments) {
                const spread = 2.6 + b * 0.8;
                p.x += (Math.random() - 0.5) * spread;
                p.y += (Math.random() - 0.5) * spread;
                p.z += (Math.random() - 0.5) * spread;
            }
            pts.push(p);
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color: b === 0 ? 0xffffff : hexColor,
            transparent: true, opacity: 1.0,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        vfxList.push({ type: 'line', mesh: line, geo, mat, life: 1.0, decay: 0.075 });
    }
}

function spawnRaptureRocks(startPos, dir) {
    if (!gfxSettings.particles) return;
    const flatDir = dir.clone(); flatDir.y = 0;
    if (flatDir.lengthSq() < 0.001) flatDir.set(0, 0, 1);
    flatDir.normalize();
    for (let i = 1; i <= 10; i++) {
        const rockPos = startPos.clone().add(flatDir.clone().multiplyScalar(i * 4.5));
        rockPos.y = 1.2;
        const mat = new THREE.MeshStandardMaterial({
            color: i % 2 === 0 ? 0x331100 : 0x221c1c,
            emissive: i % 2 === 0 ? 0xff4400 : 0xff1100,
            emissiveIntensity: i % 2 === 0 ? 1.8 : 0.7,
            transparent: true, opacity: 1.0
        });
        const rock = new THREE.Mesh(GEO_ROCK, mat);
        rock.scale.setScalar(0.8 + Math.random() * 0.9);
        rock.position.copy(rockPos);
        rock.position.x += (Math.random() - 0.5) * 3.5;
        rock.position.z += (Math.random() - 0.5) * 3.5;
        scene.add(rock);
        vfxList.push({
            type: 'rock', mesh: rock, mat,
            vel: new THREE.Vector3(0, 0.55 + Math.random() * 0.45, 0),
            life: 1.25, decay: 0.02, grav: 0.045
        });
    }
}

function spawnAfterimage(pos, hexColor) {
    if (!gfxSettings.particles) return;
    const mat = new THREE.MeshBasicMaterial({
        color: hexColor, transparent: true, opacity: 0.52,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const ghost = new THREE.Mesh(GEO_GHOST, mat);
    ghost.position.copy(pos);
    scene.add(ghost);
    vfxList.push({ type: 'fade', mesh: ghost, mat, life: 0.55, decay: 0.045 });
}

function spawnIceShatter(pos) {
    if (!gfxSettings.particles) return;
    spawnShockwave(pos, 0x00eeff, 2, 16, 0.05, true);
    for (let i = 0; i < 12; i++) {
        const mat = new THREE.MeshBasicMaterial({
            color: i % 2 === 0 ? 0x00eeff : 0xffffff,
            transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false
        });
        const m = new THREE.Mesh(GEO_ICE, mat);
        m.position.copy(pos);
        const vel = new THREE.Vector3((Math.random() - 0.5) * 2.6, Math.random() * 2.2 + 0.5, (Math.random() - 0.5) * 2.6);
        scene.add(m);
        vfxList.push({ type: 'rock', mesh: m, mat, vel, life: 1.0, decay: 0.032, grav: 0.08 });
    }
}

function spawnWindWall(owner, startPos, dir) {
    const flatDir = dir.clone(); flatDir.y = 0;
    if (flatDir.lengthSq() < 0.001) flatDir.set(0, 0, 1);
    flatDir.normalize();

    const g = new THREE.Group();
    const wallMat = new THREE.MeshBasicMaterial({
        color: 0xccffff, side: THREE.DoubleSide, transparent: true, opacity: 0.48,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(18, 12), wallMat);
    g.add(plane);
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(18.6, 12.6, 0.6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending })
    );
    g.add(frame);

    g.position.copy(startPos).add(flatDir.clone().multiplyScalar(8));
    g.position.y = 7;
    g.rotation.y = Math.atan2(flatDir.x, flatDir.z);
    scene.add(g);

    windWalls.push({ owner, mesh: g, dir: flatDir, life: 52, hitBall: false });
}

function spawnBladeTrap(owner, pos) {
    for (let i = arenaTraps.length - 1; i >= 0; i--) {
        if (arenaTraps[i].owner === owner) {
            scene.remove(arenaTraps[i].mesh);
            arenaTraps.splice(i, 1);
        }
    }
    const g = new THREE.Group();
    const base = new THREE.Mesh(
        new THREE.CylinderGeometry(7.2, 8.2, 0.8, 8),
        new THREE.MeshLambertMaterial({ color: 0x262235 })
    );
    g.add(base);
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(5.6, 7.6, 20),
        new THREE.MeshBasicMaterial({ color: 0xff1144, side: THREE.DoubleSide, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.5;
    g.add(ring);

    g.position.set(pos.x, 0.4, pos.z);
    scene.add(g);
    arenaTraps.push({ owner, mesh: g, ring, life: 1080, armed: true });
}

function spawnChieftainTotem(owner, pos) {
    for (let i = arenaTotems.length - 1; i >= 0; i--) {
        if (arenaTotems[i].owner === owner) {
            scene.remove(arenaTotems[i].mesh);
            arenaTotems.splice(i, 1);
        }
    }
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(1.4, 1.8, 12, 8),
        new THREE.MeshLambertMaterial({ color: 0x6e4422 })
    );
    pillar.position.y = 6;
    g.add(pillar);

    const wings = new THREE.Mesh(
        new THREE.BoxGeometry(7.5, 2.2, 0.9),
        new THREE.MeshLambertMaterial({ color: 0x8a5628 })
    );
    wings.position.y = 9.5;
    g.add(wings);

    const crown = new THREE.Mesh(
        new THREE.SphereGeometry(1.6, 12, 12),
        new THREE.MeshBasicMaterial({ color: 0xffcc33, blending: THREE.AdditiveBlending })
    );
    crown.position.y = 12.6;
    g.add(crown);

    const zoneRing = new THREE.Mesh(
        new THREE.RingGeometry(28.5, 30.5, 36),
        new THREE.MeshBasicMaterial({ color: 0xffbb22, side: THREE.DoubleSide, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    zoneRing.rotation.x = -Math.PI / 2;
    zoneRing.position.y = 0.25;
    g.add(zoneRing);

    const zoneFill = new THREE.Mesh(
        new THREE.CircleGeometry(28.5, 36),
        new THREE.MeshBasicMaterial({ color: 0xffaa00, side: THREE.DoubleSide, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    zoneFill.rotation.x = -Math.PI / 2;
    zoneFill.position.y = 0.2;
    g.add(zoneFill);

    g.position.set(pos.x, 0, pos.z);
    scene.add(g);
    arenaTotems.push({ owner, mesh: g, zoneRing, radius: 30, life: 600 });
}

function updateWorldAbilityObjects() {
    // Wind Walls (Gale's Edge)
    for (let i = windWalls.length - 1; i >= 0; i--) {
        const w = windWalls[i];
        w.life--;
        w.mesh.position.addScaledVector(w.dir, 1.75);
        if (!w.hitBall && isCombatState() && ball.mesh.visible && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
            const dist = Math.hypot(w.mesh.position.x - ball.mesh.position.x, w.mesh.position.z - ball.mesh.position.z);
            if (dist < 11) {
                w.hitBall = true;
                ball.unfreeze();
                ball.curveTimer = 26;
                ball.vel.copy(w.dir).multiplyScalar(Math.max(ball.speed * 1.45, 2.2));
                ball.vel.y = 0.35;
                spawnShockwave(ball.mesh.position.clone(), 0xccffff, 2, 16, 0.06, false, w.mesh.rotation.y);
                spawnSparks(ball.mesh.position.clone(), 0xffffff, 14, 1.1);
                playSynth(520, 1100, 0.2, 'sine', 0.26);
            }
        }
        if (w.life <= 0) {
            scene.remove(w.mesh);
            windWalls.splice(i, 1);
        }
    }

    // Blade Traps
    for (let i = arenaTraps.length - 1; i >= 0; i--) {
        const tr = arenaTraps[i];
        tr.life--;
        tr.ring.rotation.z += 0.07;
        if (tr.armed && isCombatState() && ball.mesh.visible && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
            const dist = Math.hypot(tr.mesh.position.x - ball.mesh.position.x, tr.mesh.position.z - ball.mesh.position.z);
            if (dist < 10.5 && ball.mesh.position.y < 16) {
                tr.armed = false;
                ball.unfreeze();
                ball.aeroTimer = 0;
                ball.trapTimer = 28;
                ball.trapOwner = tr.owner;
                ball.mesh.position.set(tr.mesh.position.x, 5.5, tr.mesh.position.z);
                spawnShockwave(tr.mesh.position.clone(), 0xff1144, 2, 18, 0.05, true);
                spawnSparks(ball.mesh.position.clone(), 0xff2255, 18, 1.1);
                playSynth(240, 680, 0.25, 'sawtooth', 0.3);
                scene.remove(tr.mesh);
                arenaTraps.splice(i, 1);
                continue;
            }
        }
        if (tr.life <= 0) {
            scene.remove(tr.mesh);
            arenaTraps.splice(i, 1);
        }
    }

    // Chieftain's Totems
    for (let i = arenaTotems.length - 1; i >= 0; i--) {
        const tm = arenaTotems[i];
        tm.life--;
        tm.zoneRing.rotation.z += 0.03;
        if (tm.life <= 0 || !tm.owner.isAlive) {
            scene.remove(tm.mesh);
            arenaTotems.splice(i, 1);
        }
    }
}

function updateVFX() {
    for (let i = vfxList.length - 1; i >= 0; i--) {
        const fx = vfxList[i];
        fx.life -= fx.decay;

        if (fx.type === 'ring') {
            const t = 1 - Math.max(0, fx.life);
            const s = fx.startScale + (fx.endScale - fx.startScale) * (1 - Math.pow(1 - t, 2));
            fx.mesh.scale.setScalar(s);
            fx.mat.opacity = Math.max(0, fx.life * 0.9);
        } else if (fx.type === 'slash') {
            if (fx.owner && fx.owner.isAlive) {
                fx.mesh.position.x = fx.owner.mesh.position.x;
                fx.mesh.position.y = fx.owner.mesh.position.y + 1.2;
                fx.mesh.position.z = fx.owner.mesh.position.z;
            }
            fx.mesh.rotation.y += fx.spinY;
            fx.mat.opacity = Math.max(0, fx.life);
        } else if (fx.type === 'spark') {
            fx.mesh.position.add(fx.vel);
            fx.vel.y -= fx.grav;
            fx.vel.multiplyScalar(0.95);
            fx.mesh.lookAt(fx.mesh.position.clone().add(fx.vel));
            fx.mat.opacity = Math.max(0, fx.life);
        } else if (fx.type === 'beam') {
            const w = Math.max(0.05, fx.life * 1.4);
            fx.mesh.scale.set(w, 1, w);
            fx.mat.opacity = Math.max(0, fx.life * 0.85);
        } else if (fx.type === 'rock') {
            fx.mesh.position.add(fx.vel);
            fx.vel.y -= fx.grav;
            if (fx.mesh.position.y < 0.8) { fx.mesh.position.y = 0.8; fx.vel.y *= -0.25; }
            fx.mesh.rotation.x += 0.09;
            fx.mesh.rotation.y += 0.08;
            fx.mat.opacity = Math.max(0, Math.min(1, fx.life));
        } else if (fx.type === 'line' || fx.type === 'fade') {
            fx.mat.opacity = Math.max(0, fx.life);
        }

        if (fx.life <= 0) {
            scene.remove(fx.mesh);
            if (fx.geo) fx.geo.dispose();
            if (fx.mat) fx.mat.dispose();
            vfxList.splice(i, 1);
        }
    }
}

// ==========================================
// CUSTOM SWORD (Группа.obj) + SWORD MODELS
// ==========================================
let prismaSwordTemplate = null;

function loadPrismaSword() {
    if (typeof THREE.OBJLoader === 'undefined') return;
    const loader = new THREE.OBJLoader();
    loader.load(
        encodeURI('Группа.obj'),
        (obj) => {
            const box = new THREE.Box3().setFromObject(obj);
            const size = new THREE.Vector3();
            const center = new THREE.Vector3();
            box.getSize(size);
            box.getCenter(center);
            const maxDim = Math.max(size.x, size.y, size.z, 0.001);
            const scale = 8.4 / maxDim;

            const neonMat = new THREE.MeshStandardMaterial({
                color: 0x162238,
                metalness: 0.85,
                roughness: 0.18,
                emissive: 0x00eeff,
                emissiveIntensity: 2.2
            });

            obj.traverse((child) => {
                if (child.isMesh) child.material = neonMat;
            });

            const wrapper = new THREE.Group();
            obj.position.sub(center);
            obj.scale.setScalar(scale);
            obj.position.y += 2.3;
            wrapper.add(obj);
            prismaSwordTemplate = wrapper;

            players.forEach(p => {
                if (p.swordId === 'prisma_blade') p.equipSword('prisma_blade');
            });
        },
        undefined,
        () => {}
    );
}
loadPrismaSword();

function buildSwordMesh(swordId, isLeftHand = false) {
    const g = new THREE.Group();
    if (swordId === 'prisma_blade') {
        if (prismaSwordTemplate) {
            g.add(prismaSwordTemplate.clone());
        } else {
            const blade = new THREE.Mesh(
                new THREE.BoxGeometry(0.85, 7.6, 0.32),
                new THREE.MeshStandardMaterial({ color: 0x102038, emissive: 0x00eeff, emissiveIntensity: 2.2, metalness: 0.85, roughness: 0.2 })
            );
            blade.position.y = 2.4; g.add(blade);
            const guard = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.5, 0.7), new THREE.MeshBasicMaterial({ color: 0x0099ff }));
            guard.position.y = -1.2; g.add(guard);
        }
    } else if (swordId === 'nebula_shard') {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.95, 7.6, 0.34), new THREE.MeshBasicMaterial({ color: 0x8833ff }));
        blade.position.y = 2.5; g.add(blade);
        const core = new THREE.Mesh(new THREE.BoxGeometry(0.4, 7.9, 0.45), new THREE.MeshBasicMaterial({ color: 0xffccff }));
        core.position.y = 2.6; g.add(core);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.8), new THREE.MeshBasicMaterial({ color: 0x330088 }));
        guard.position.y = -1.2; g.add(guard);
    } else if (swordId === 'nebula_staff' || swordId === 'dual_nebula_staff') {
        const mainCol = (swordId === 'dual_nebula_staff' && isLeftHand) ? 0x00ffff : 0xff33ff;
        const secCol = (swordId === 'dual_nebula_staff' && isLeftHand) ? 0x0088ff : 0x7722ff;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 10.2, 8), new THREE.MeshBasicMaterial({ color: secCol }));
        pole.position.y = 1.5; g.add(pole);
        const tip1 = new THREE.Mesh(new THREE.ConeGeometry(1.0, 3.2, 6), new THREE.MeshBasicMaterial({ color: mainCol }));
        tip1.position.y = 7.1; g.add(tip1);
        const tip2 = new THREE.Mesh(new THREE.ConeGeometry(0.75, 2.5, 6), new THREE.MeshBasicMaterial({ color: mainCol }));
        tip2.position.y = -4.1; tip2.rotation.x = Math.PI; g.add(tip2);
    } else {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.58, 6.4, 0.36), new THREE.MeshStandardMaterial({ color: 0xdde6f5, metalness: 0.75, roughness: 0.25, emissive: 0x223355, emissiveIntensity: 0.5 }));
        blade.position.y = 2; g.add(blade);
        const guard = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.42, 0.6), new THREE.MeshLambertMaterial({ color: 0x384255 }));
        guard.position.y = -1; g.add(guard);
    }
    g.position.set(0, -3.2, 1.8);
    g.rotation.x = Math.PI / 2;
    return g;
}

function getSwordAccentColor(swordId) {
    if (swordId === 'prisma_blade') return 0x00eeff;
    if (swordId === 'nebula_shard') return 0xaa44ff;
    if (swordId === 'nebula_staff') return 0xff33ff;
    if (swordId === 'dual_nebula_staff') return 0x00ffff;
    return 0x66ccff;
}

// ==========================================
// SMOOTH CAMERA, SHIFT LOCK & FLOATING JOYSTICK
// ==========================================
let camTheta = Math.PI, camPhi = 1.08, camRadius = 42;
let camThetaSmooth = camTheta, camPhiSmooth = camPhi;
let isCamDragging = false, lastTouchX = 0, lastTouchY = 0, camTouchId = null;
let shiftLockActive = false;

let joyX = 0, joyY = 0;
let moveX = 0, moveZ = 0, isMoving = false;
let joyActive = false, joyStart = { x: 0, y: 0 }, joyTouchId = null;
const maxJoy = 34;

const camZone = document.getElementById('camera-zone');
const knob = document.getElementById('joystick-knob');
const zone = document.getElementById('joystick-zone');
const crosshairEl = document.getElementById('crosshair');
const btnShiftLock = document.getElementById('btnShiftLock');

function setShiftLock(enabled) {
    shiftLockActive = !!enabled;
    if (btnShiftLock) btnShiftLock.classList.toggle('active', shiftLockActive);
    if (crosshairEl) crosshairEl.style.display = shiftLockActive ? 'block' : 'none';
}

if (btnShiftLock) {
    btnShiftLock.addEventListener('touchstart', (e) => {
        e.preventDefault(); e.stopPropagation();
        setShiftLock(!shiftLockActive);
    }, { passive: false });
    btnShiftLock.addEventListener('click', (e) => {
        e.stopPropagation();
        setShiftLock(!shiftLockActive);
    });
}

window.addEventListener('keydown', (e) => {
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') setShiftLock(!shiftLockActive);
    if (e.code === 'Space' && mainPlayer) mainPlayer.jump();
    if (e.code === 'KeyF' && mainPlayer) mainPlayer.tryParry();
    if ((e.code === 'KeyQ' || e.code === 'KeyE') && mainPlayer) mainPlayer.activateAbility();
});

function snapCamera(theta, phi = 1.08) {
    camTheta = theta;
    camThetaSmooth = theta;
    camPhi = phi;
    camPhiSmooth = phi;
}

function startJoystick(touch) {
    joyTouchId = touch.identifier;
    joyActive = true;
    const half = 46;
    const cx = Math.max(half + 6, Math.min(window.innerWidth * 0.44, touch.clientX));
    const cy = Math.max(76, Math.min(window.innerHeight - half - 6, touch.clientY));
    joyStart.x = cx;
    joyStart.y = cy;

    zone.style.left = `${cx - half}px`;
    zone.style.top = `${cy - half}px`;
    zone.style.bottom = 'auto';

    let dx = touch.clientX - cx;
    let dy = touch.clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > maxJoy) { dx = (dx / dist) * maxJoy; dy = (dy / dist) * maxJoy; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    joyX = dx / maxJoy;
    joyY = dy / maxJoy;
    isMoving = dist > 4;
}

function stopJoystick() {
    joyActive = false;
    joyTouchId = null;
    joyX = 0;
    joyY = 0;
    moveX = 0;
    moveZ = 0;
    isMoving = false;
    knob.style.transform = 'translate(0px, 0px)';
    zone.style.left = '';
    zone.style.top = '';
    zone.style.bottom = '';
}

function stopAllTouchControls() {
    stopJoystick();
    isCamDragging = false;
    camTouchId = null;
}

zone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    e.stopPropagation();
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (joyTouchId === null) {
            startJoystick(e.changedTouches[i]);
            break;
        }
    }
}, { passive: false });

camZone.addEventListener('touchstart', (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.clientX < window.innerWidth * 0.42 && t.clientY > 46) {
            if (joyTouchId === null) {
                e.preventDefault();
                startJoystick(t);
            }
        } else {
            if (camTouchId === null) {
                e.preventDefault();
                camTouchId = t.identifier;
                isCamDragging = true;
                lastTouchX = t.clientX;
                lastTouchY = t.clientY;
            }
        }
    }
}, { passive: false });

window.addEventListener('touchmove', (e) => {
    const sens = typeof gfxSettings.camSens === 'number' ? gfxSettings.camSens : 1.0;
    for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (joyActive && t.identifier === joyTouchId) {
            e.preventDefault();
            let dx = t.clientX - joyStart.x;
            let dy = t.clientY - joyStart.y;
            const dist = Math.hypot(dx, dy);
            if (dist > maxJoy) {
                dx = (dx / dist) * maxJoy;
                dy = (dy / dist) * maxJoy;
            }
            knob.style.transform = `translate(${dx}px, ${dy}px)`;
            joyX = dx / maxJoy;
            joyY = dy / maxJoy;
            isMoving = dist > 4;
        } else if (isCamDragging && t.identifier === camTouchId) {
            e.preventDefault();
            const dcx = t.clientX - lastTouchX;
            const dcy = t.clientY - lastTouchY;
            camTheta -= dcx * 0.0065 * sens;
            camPhi -= dcy * 0.0042 * sens;
            camPhi = Math.max(0.45, Math.min(1.3, camPhi));
            lastTouchX = t.clientX;
            lastTouchY = t.clientY;
        }
    }
}, { passive: false });

const onGlobalTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        const id = e.changedTouches[i].identifier;
        if (id === joyTouchId) stopJoystick();
        if (id === camTouchId) { isCamDragging = false; camTouchId = null; }
    }
};
window.addEventListener('touchend', onGlobalTouchEnd);
window.addEventListener('touchcancel', onGlobalTouchEnd);

function addAccessoryToHead(headMesh, accType) {
    if (accType === 'crown') {
        const crown = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.2, 0.9, 6), new THREE.MeshBasicMaterial({ color: 0xffd700 }));
        crown.position.y = 1.6; headMesh.add(crown);
    } else if (accType === 'visor') {
        const visor = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.75, 0.6), new THREE.MeshBasicMaterial({ color: 0x00eeff }));
        visor.position.set(0, 0.2, 1.15); headMesh.add(visor);
    } else if (accType === 'horns') {
        const hMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
        [-0.9, 0.9].forEach(hx => {
            const horn = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.6, 5), hMat);
            horn.position.set(hx, 1.8, 0); horn.rotation.z = hx > 0 ? -0.35 : 0.35;
            headMesh.add(horn);
        });
    } else if (accType === 'bandana') {
        const band = new THREE.Mesh(new THREE.BoxGeometry(2.65, 0.55, 2.65), new THREE.MeshBasicMaterial({ color: 0xff3355 }));
        band.position.y = 0.75; headMesh.add(band);
    }
}

// ==========================================
// TARGET HELPER FOR AIMED ABILITIES
// ==========================================
const _helperAim = new THREE.Vector3();
const _helperTo = new THREE.Vector3();

function getEntityAimVector(caster, outVec) {
    if (caster === mainPlayer) {
        camera.getWorldDirection(outVec);
        outVec.y = 0;
        if (outVec.lengthSq() < 0.0001) {
            outVec.set(Math.sin(caster.mesh.rotation.y), 0, Math.cos(caster.mesh.rotation.y));
        }
        return outVec.normalize();
    }
    return outVec.set(Math.sin(caster.mesh.rotation.y), 0, Math.cos(caster.mesh.rotation.y)).normalize();
}

function findAimedEnemy(caster, maxDist = 140, minDot = -0.15) {
    const others = players.filter(p => p.isAlive && p !== caster && !p.isInvis);
    if (others.length === 0) return null;

    getEntityAimVector(caster, _helperAim);

    let best = null;
    let bestScore = -999;
    others.forEach(c => {
        _helperTo.subVectors(c.mesh.position, caster.mesh.position);
        _helperTo.y = 0;
        const dist = Math.max(0.1, _helperTo.length());
        if (dist > maxDist) return;
        const dot = _helperAim.dot(_helperTo.divideScalar(dist));
        if (dot < minDot) return;
        const score = dot * 2.2 + (28 / (dist + 12));
        if (score > bestScore) { bestScore = score; best = c; }
    });
    return best;
}

// ==========================================
// ENTITIES (ALL 34 ABILITIES + SMART PRE-FIRE AI)
// ==========================================
const players = [];
let mainPlayer = null;
let gameState = 'lobby';
let matchKills = 0;
let lobbyTime = 15;
let lobbyTimerHandle = null;

class Entity {
    constructor(profile, isBot = true) {
        this.profile = profile;
        this.name = profile.name;
        this.isBot = isBot;
        this.isTestBot = !!profile.isTestBot;
        this.testSlot = profile.testSlot || 0;
        this.isAlive = true;
        this.tier = profile.tier || 'mid';
        this.baseSpeed = isBot ? (this.tier === 'sweat' ? 0.50 : (this.tier === 'pro' ? 0.45 : 0.39)) : 0.58;

        const skin = profile.skin || { head: 0x00aaff, torso: 0x0088ff, arms: 0x0077ee, legs: 0x0055bb, acc: 'none' };
        this.skinColors = skin;
        this.explosionColor = skin.torso;

        this.headMat = new THREE.MeshLambertMaterial({ color: skin.head });
        this.torsoMat = new THREE.MeshLambertMaterial({ color: skin.torso });
        this.armsMat = new THREE.MeshLambertMaterial({ color: skin.arms });
        this.legsMat = new THREE.MeshLambertMaterial({ color: skin.legs });
        this.allMats = [this.headMat, this.torsoMat, this.armsMat, this.legsMat];

        this.baseY = 6;
        this.velY = 0;
        this.jumpsLeft = 2;
        this.blockCooldown = 0;
        this.parryActiveTimer = 0;
        this.ability = isBot ? (profile.ability || 'dash') : gameData.equippedAbility;
        this.abilityReadyAt = 0;

        this.isInvis = false; this.invisTimer = 0;
        this.shadowTimer = 0;
        this.windTimer = 0;
        this.forcefieldTimer = 0; this.forcefieldMax = 420;
        this.stunTimer = 0;
        this.virusTimer = 0;
        this.scopoTimer = 0;
        this.scopoWeakHit = false;
        this.martyrSlowTimer = 0;
        this.qiTimer = 0;
        this.silencedTimer = 0;
        this.absConfTimer = 0;
        this.hookPullTimer = 0;
        this.hookDest = new THREE.Vector3();

        this.rapturePoseTimer = 0;
        this.blinkCharges = 3;
        this.galeCharges = 2;
        this.reaperStacks = 0;
        this.isPlatformActive = false;
        this.walkCycle = Math.random() * 10;

        // AI state for pre-fire & tactical spacing
        this.parryDecided = false;
        this.prefireLeadFrames = 9;
        this.currentReactionMs = 200;
        this.strafeDir = Math.random() < 0.5 ? 1 : -1;
        this.strafeSwapTimer = 60 + Math.floor(Math.random() * 90);

        this.mesh = new THREE.Group();
        this.mesh.position.set((Math.random() - 0.5) * 40, this.baseY, LOBBY_Z + (Math.random() - 0.5) * 40);
        scene.add(this.mesh);

        this.torso = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 2), this.torsoMat);
        this.mesh.add(this.torso);

        this.head = new THREE.Mesh(new THREE.BoxGeometry(2.5, 2.5, 2.5), this.headMat);
        this.head.position.y = 3.25;
        this.mesh.add(this.head);
        if (skin.acc && skin.acc !== 'none') addAccessoryToHead(this.head, skin.acc);

        this.lArmGroup = new THREE.Group(); this.lArmGroup.position.set(-2.75, 2, 0);
        this.lArm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 1.5), this.armsMat); this.lArm.position.y = -2;
        this.lArmGroup.add(this.lArm); this.mesh.add(this.lArmGroup);

        this.rArmGroup = new THREE.Group(); this.rArmGroup.position.set(2.75, 2, 0);
        this.rArm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 4, 1.5), this.armsMat); this.rArm.position.y = -2;
        this.rArmGroup.add(this.rArm); this.mesh.add(this.rArmGroup);

        this.lLegGroup = new THREE.Group(); this.lLegGroup.position.set(-1.05, -2, 0);
        this.lLeg = new THREE.Mesh(new THREE.BoxGeometry(1.9, 4, 1.9), this.legsMat); this.lLeg.position.y = -2;
        this.lLegGroup.add(this.lLeg); this.mesh.add(this.lLegGroup);

        this.rLegGroup = new THREE.Group(); this.rLegGroup.position.set(1.05, -2, 0);
        this.rLeg = new THREE.Mesh(new THREE.BoxGeometry(1.9, 4, 1.9), this.legsMat); this.rLeg.position.y = -2;
        this.rLegGroup.add(this.rLeg); this.mesh.add(this.rLegGroup);

        this.targetRing = new THREE.Mesh(
            new THREE.RingGeometry(4.0, 5.4, 28),
            new THREE.MeshBasicMaterial({ color: 0xff1122, side: THREE.DoubleSide, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        this.targetRing.rotation.x = -Math.PI / 2;
        this.targetRing.position.y = -5.65;
        this.targetRing.visible = false;
        this.mesh.add(this.targetRing);

        this.shieldGroup = new THREE.Group();
        const shieldOuter = new THREE.Mesh(
            new THREE.IcosahedronGeometry(7.2, 1),
            new THREE.MeshBasicMaterial({ color: 0xff6622, wireframe: true, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        const shieldInner = new THREE.Mesh(
            new THREE.SphereGeometry(6.8, 18, 14),
            new THREE.MeshBasicMaterial({ color: 0xff3311, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        this.shieldGroup.add(shieldOuter);
        this.shieldGroup.add(shieldInner);
        this.shieldGroup.visible = false;
        this.mesh.add(this.shieldGroup);

        this.windAuraGroup = new THREE.Group();
        [[-4.8, 4.6, 5.3], [-1.5, 3.8, 4.3], [1.8, 3.2, 3.7]].forEach(([yPos, r1, r2]) => {
            const r = new THREE.Mesh(
                new THREE.RingGeometry(r1, r2, 24),
                new THREE.MeshBasicMaterial({ color: 0x00ffaa, side: THREE.DoubleSide, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false })
            );
            r.rotation.x = -Math.PI / 2;
            r.position.y = yPos;
            this.windAuraGroup.add(r);
        });
        this.windAuraGroup.visible = false;
        this.mesh.add(this.windAuraGroup);

        // Qi Charge white/silver energy aura
        this.qiAuraGroup = new THREE.Group();
        [[-5.0, 4.4, 5.4], [0, 3.8, 4.5]].forEach(([yPos, r1, r2]) => {
            const r = new THREE.Mesh(
                new THREE.RingGeometry(r1, r2, 24),
                new THREE.MeshBasicMaterial({ color: 0xeeeeff, side: THREE.DoubleSide, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
            );
            r.rotation.x = -Math.PI / 2;
            r.position.y = yPos;
            this.qiAuraGroup.add(r);
        });
        this.qiAuraGroup.visible = false;
        this.mesh.add(this.qiAuraGroup);

        // Absolute Confidence fiery crimson ring
        this.absConfAura = new THREE.Mesh(
            new THREE.RingGeometry(5.6, 7.2, 28),
            new THREE.MeshBasicMaterial({ color: 0xff1133, side: THREE.DoubleSide, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        this.absConfAura.rotation.x = -Math.PI / 2;
        this.absConfAura.position.y = -5.4;
        this.absConfAura.visible = false;
        this.mesh.add(this.absConfAura);

        // Pulse silence lock indicator
        this.silencedAura = new THREE.Mesh(
            new THREE.TorusGeometry(2.8, 0.2, 6, 16),
            new THREE.MeshBasicMaterial({ color: 0xff2222, blending: THREE.AdditiveBlending })
        );
        this.silencedAura.rotation.x = Math.PI / 2;
        this.silencedAura.position.y = 2.0;
        this.silencedAura.visible = false;
        this.mesh.add(this.silencedAura);

        this.virusAura = new THREE.Mesh(
            new THREE.TorusGeometry(3.4, 0.24, 8, 22),
            new THREE.MeshBasicMaterial({ color: 0x22ff44, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending })
        );
        this.virusAura.rotation.x = Math.PI / 2;
        this.virusAura.position.y = -1.2;
        this.virusAura.visible = false;
        this.mesh.add(this.virusAura);

        this.scopoAura = new THREE.Mesh(
            new THREE.RingGeometry(2.4, 3.6, 18),
            new THREE.MeshBasicMaterial({ color: 0xff0044, side: THREE.DoubleSide, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
        );
        this.scopoAura.position.y = 6.2;
        this.scopoAura.visible = false;
        this.mesh.add(this.scopoAura);

        this.stunRing = new THREE.Mesh(
            new THREE.TorusGeometry(2.2, 0.22, 8, 20),
            new THREE.MeshBasicMaterial({ color: 0xffcc00, blending: THREE.AdditiveBlending })
        );
        this.stunRing.rotation.x = Math.PI / 2;
        this.stunRing.position.y = 5.4;
        this.stunRing.visible = false;
        this.mesh.add(this.stunRing);

        this.rSword = null; this.lSword = null;
        this.swordId = isBot ? (profile.sword || 'default') : (gameState === 'test' ? testState.sword : gameData.equippedSword);
        this.equipSword(this.swordId);

        if (isBot) {
            const tagColor = this.isTestBot ? '#00eeff' : (this.tier === 'sweat' ? '#ff5566' : (this.tier === 'pro' ? '#ffd700' : (this.tier === 'mid' ? '#aaffcc' : '#dddddd')));
            const killsStr = this.isTestBot ? 'TEST BOT' : (profile.kills >= 1000 ? `${(profile.kills / 1000).toFixed(1)}k kills` : `${profile.kills} kills`);
            this.nameTag = createNameSprite(this.name, killsStr, tagColor);
            this.nameTag.position.set(0, 7.6, 0);
            this.mesh.add(this.nameTag);
        }

        this.platformMesh = new THREE.Mesh(
            new THREE.BoxGeometry(8, 0.9, 8),
            new THREE.MeshBasicMaterial({ color: 0x00cc66, transparent: true, opacity: 0.78 })
        );
        this.platformMesh.visible = false;
        scene.add(this.platformMesh);

        this.targetWalkPos = this.mesh.position.clone();
        players.push(this);
    }

    getCurrentAbility() {
        if (this.isBot) return this.ability;
        return gameState === 'test' ? testState.ability : gameData.equippedAbility;
    }

    getMaxJumps() {
        return this.getCurrentAbility() === 'quad_jump' ? 4 : 2;
    }

    getTotemEffect() {
        let bonus = 1.0;
        let inOwn = false;
        for (let i = 0; i < arenaTotems.length; i++) {
            const tm = arenaTotems[i];
            const d = Math.hypot(this.mesh.position.x - tm.mesh.position.x, this.mesh.position.z - tm.mesh.position.z);
            if (d <= tm.radius) {
                if (tm.owner === this) { bonus = Math.max(bonus, 1.35); inOwn = true; }
                else bonus = Math.min(bonus, 0.7);
            }
        }
        return { speedMul: bonus, inOwn };
    }

    getMoveSpeed() {
        if (this.stunTimer > 0 || this.hookPullTimer > 0) return 0;
        let spd = this.baseSpeed;
        if (this.shadowTimer > 0) spd *= 2.05;
        if (this.windTimer > 0) spd *= 1.48;
        if (this.qiTimer > 0) spd *= 1.35;
        if (this.getCurrentAbility() === 'reaper' && this.reaperStacks > 0) {
            spd *= (1 + this.reaperStacks * 0.11);
        }
        spd *= this.getTotemEffect().speedMul;
        if (this.virusTimer > 0) spd *= 0.65;
        if (this.scopoTimer > 0) spd *= 0.55;
        if (this.martyrSlowTimer > 0) spd *= 0.6;
        return spd;
    }

    jump() {
        if (!this.isAlive || this.stunTimer > 0 || this.hookPullTimer > 0 || this.isPlatformActive) return;
        if (this.jumpsLeft <= 0) return;
        this.jumpsLeft--;
        this.velY = this.windTimer > 0 ? 2.15 : 1.68;

        const footPos = new THREE.Vector3(this.mesh.position.x, this.mesh.position.y - 5.4, this.mesh.position.z);
        const ringCol = this.getCurrentAbility() === 'quad_jump' ? 0xcc44ff : (this.windTimer > 0 ? 0x00ffaa : 0x88ccff);
        spawnShockwave(footPos, ringCol, 1.4, 7.5, 0.08, true);

        if (!this.isBot && gameState === 'lobby') {
            const p = this.mesh.position;
            if (p.x >= 36 && p.z <= LOBBY_Z - 36) {
                const now = Date.now();
                if (now - lastEventJumpTime > 5000) eventCornerJumps = 0;
                eventCornerJumps++;
                lastEventJumpTime = now;
                playSynth(300 + eventCornerJumps * 95, 560 + eventCornerJumps * 110, 0.14, 'triangle', 0.22);
                spawnShockwave(footPos, 0xaa44ff, 1.8, 10, 0.07, true);
                if (eventCornerJumps >= 5) {
                    eventCornerJumps = 0;
                    enterTestArena();
                    return;
                }
            } else {
                eventCornerJumps = 0;
                playSynth(280, 540, 0.11, 'sine', 0.15);
            }
        } else if (!this.isBot) {
            playSynth(280, 540, 0.11, 'sine', 0.15);
        }
    }

    updateVerticalPhysics() {
        if (this.hookPullTimer > 0) {
            this.hookPullTimer--;
            this.mesh.position.x += (this.hookDest.x - this.mesh.position.x) * 0.24;
            this.mesh.position.z += (this.hookDest.z - this.mesh.position.z) * 0.24;
            this.clampBounds();
            return;
        }
        if (this.isPlatformActive && isCombatState()) return;
        if (this.mesh.position.y > this.baseY || this.velY !== 0) {
            this.mesh.position.y += this.velY;
            this.velY -= 0.095;
            if (this.mesh.position.y <= this.baseY) {
                this.mesh.position.y = this.baseY;
                this.velY = 0;
                this.jumpsLeft = this.getMaxJumps();
            }
        } else {
            this.jumpsLeft = this.getMaxJumps();
        }
    }

    updateBuffTimers() {
        if (this.stunTimer > 0) {
            this.stunTimer--;
            this.stunRing.visible = true;
            this.stunRing.rotation.z += 0.22;
        } else {
            this.stunRing.visible = false;
        }

        if (this.silencedTimer > 0) {
            this.silencedTimer--;
            this.silencedAura.visible = true;
            this.silencedAura.rotation.z -= 0.18;
        } else {
            this.silencedAura.visible = false;
        }

        if (this.qiTimer > 0) {
            this.qiTimer--;
            this.qiAuraGroup.visible = true;
            this.qiAuraGroup.rotation.y += 0.14;
        } else {
            this.qiAuraGroup.visible = false;
        }

        if (this.absConfTimer > 0) {
            this.absConfTimer--;
            this.absConfAura.visible = true;
            this.absConfAura.rotation.z += 0.09;
            const p = 1.0 + Math.sin(performance.now() * 0.018) * 0.12;
            this.absConfAura.scale.setScalar(p);
        } else {
            this.absConfAura.visible = false;
        }

        if (this.virusTimer > 0) {
            this.virusTimer--;
            this.virusAura.visible = true;
            this.virusAura.rotation.z += 0.12;
            this.virusAura.position.y = -1.2 + Math.sin(performance.now() * 0.01) * 1.4;
        } else {
            this.virusAura.visible = false;
        }

        if (this.scopoTimer > 0) {
            this.scopoTimer--;
            this.scopoAura.visible = true;
            this.scopoAura.lookAt(camera.position);
            const s = 1 + Math.sin(performance.now() * 0.02) * 0.18;
            this.scopoAura.scale.setScalar(s);
        } else {
            this.scopoAura.visible = false;
            this.scopoWeakHit = false;
        }

        if (this.martyrSlowTimer > 0) this.martyrSlowTimer--;

        if (this.targetRing.visible) {
            const pulse = 1.0 + Math.sin(performance.now() * 0.015) * 0.14;
            this.targetRing.scale.setScalar(pulse);
            this.targetRing.rotation.z += 0.05;
        }

        if (this.isInvis) {
            this.invisTimer--;
            if (this.invisTimer <= 0) { this.isInvis = false; this.setOpacity(1); }
        }
        if (this.shadowTimer > 0) {
            this.shadowTimer--;
            if (this.shadowTimer % 4 === 0) spawnAfterimage(this.mesh.position, 0x7733ff);
        }
        if (this.windTimer > 0) {
            this.windTimer--;
            this.windAuraGroup.visible = true;
            this.windAuraGroup.rotation.y += 0.16;
            if (this.windTimer <= 0) this.windAuraGroup.visible = false;
        }
        if (this.forcefieldTimer > 0) {
            this.forcefieldTimer--;
            this.shieldGroup.visible = true;
            this.shieldGroup.rotation.y += 0.05;
            this.shieldGroup.rotation.x += 0.025;
            if (this.forcefieldTimer <= 0) this.shieldGroup.visible = false;
        }
    }

    stripActiveBuffs() {
        this.isInvis = false; this.invisTimer = 0; this.setOpacity(1);
        this.forcefieldTimer = 0; this.shieldGroup.visible = false;
        this.windTimer = 0; this.windAuraGroup.visible = false;
        this.shadowTimer = 0;
        this.qiTimer = 0; this.qiAuraGroup.visible = false;
        this.absConfTimer = 0; this.absConfAura.visible = false;
        this.isPlatformActive = false; this.platformMesh.visible = false;
    }

    setTargetHighlight(isTargeted) {
        this.targetRing.visible = isTargeted;
        if (isTargeted) {
            this.allMats.forEach(m => m.emissive ? m.emissive.setHex(0x550000) : null);
        } else {
            this.allMats.forEach(m => m.emissive ? m.emissive.setHex(0x000000) : null);
        }
    }

    setOpacity(val) {
        const transparent = val < 1;
        this.allMats.forEach(m => { m.opacity = val; m.transparent = transparent; });
        if (this.nameTag) this.nameTag.visible = val > 0.5;
    }

    equipSword(swordId) {
        this.swordId = swordId;
        if (this.rSword) this.rArmGroup.remove(this.rSword);
        if (this.lSword) this.lArmGroup.remove(this.lSword);
        this.rSword = buildSwordMesh(swordId, false);
        this.rArmGroup.add(this.rSword);
        if (swordId === 'dual_nebula_staff') {
            this.lSword = buildSwordMesh(swordId, true);
            this.lArmGroup.add(this.lSword);
        } else {
            this.lSword = null;
        }
    }

    animateWalk(moving) {
        if (this.rapturePoseTimer > 0) {
            this.rapturePoseTimer--;
            this.rArmGroup.rotation.x = -Math.PI * 0.85;
            this.lArmGroup.rotation.x = -Math.PI * 0.3;
            return;
        }
        if (this.parryActiveTimer > 0) return;
        if (moving && this.stunTimer <= 0) {
            this.walkCycle += 0.22;
            const swing = Math.sin(this.walkCycle) * 0.78;
            this.lLegGroup.rotation.x = swing;
            this.rLegGroup.rotation.x = -swing;
            this.lArmGroup.rotation.x = -swing;
            this.rArmGroup.rotation.x = swing;
        } else {
            this.lLegGroup.rotation.x = 0; this.rLegGroup.rotation.x = 0;
            this.lArmGroup.rotation.x = 0; this.rArmGroup.rotation.x = 0;
        }
    }

    tryParry() {
        if (this.blockCooldown > 0 || !this.isAlive) return;
        if (!isCombatState() && !(this === mainPlayer && training.active)) return;
        this.parryActiveTimer = 18;
        this.blockCooldown = 45;
        spawnSlashArc(this, getSwordAccentColor(this.swordId), 1.0);
    }

    activateAbility() {
        if (!this.isAlive || !isCombatState() || this.stunTimer > 0) return false;
        if (this.silencedTimer > 0) {
            if (!this.isBot) showStatus('АБИЛКА ОТКЛЮЧЕНА (PULSE)', '#ff2233', 1000);
            return false;
        }
        const type = this.getCurrentAbility();
        const abInfo = ABILITIES.find(a => a.id === type);
        if (!abInfo || abInfo.passive) return false;
        const ignoreCd = (!this.isBot && gameState === 'test' && testState.noCd);
        if (!ignoreCd && Date.now() < this.abilityReadyAt) return false;

        const aliveCount = players.filter(p => p.isAlive).length;
        // Invisibility is disabled in 1v1 duels
        if (type === 'invis' && gameState === 'playing' && aliveCount <= 2) {
            if (!this.isBot) showStatus('INVISIBILITY ОТКЛЮЧЕН В 1 НА 1', '#ffaa00', 1300);
            return false;
        }

        const cdMs = ignoreCd ? 250 : abInfo.cd * 1000;
        const aimVec = new THREE.Vector3();
        getEntityAimVector(this, aimVec);
        const rotY = Math.atan2(aimVec.x, aimVec.z);
        const startPos = this.mesh.position.clone();

        if (type === 'dash') {
            if (!this.isBot) { playSynth(320, 90, 0.2, 'sine', 0.3); targetFov = 71; }
            spawnShockwave(startPos, 0x00ccff, 2, 10, 0.08, false, rotY);
            spawnAfterimage(startPos, 0x00aaff);
            this.mesh.position.add(aimVec.clone().multiplyScalar(32));
            this.clampBounds();
            spawnSparks(this.mesh.position, 0x00ccff, 10, 0.9);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'thunder_dash') {
            if (!this.isBot) { playSynth(950, 220, 0.16, 'sawtooth', 0.26); addShake(0.45); targetFov = 72; }
            this.mesh.position.add(aimVec.clone().multiplyScalar(26));
            this.clampBounds();
            spawnLightning(startPos, this.mesh.position.clone(), 0xffdd00, 4);
            spawnShockwave(this.mesh.position, 0xffdd00, 2, 13, 0.07, true);
            spawnSparks(this.mesh.position, 0xffee44, 16, 1.1);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'blink') {
            if (!this.isBot) playSynth(700, 1250, 0.12, 'triangle', 0.25);
            spawnShockwave(startPos, 0x00eeff, 2, 9, 0.08, false, rotY);
            spawnAfterimage(startPos, 0x00eeff);
            this.mesh.position.add(aimVec.clone().multiplyScalar(23));
            this.clampBounds();
            spawnShockwave(this.mesh.position, 0x00eeff, 2, 10, 0.08, false, rotY);
            spawnSparks(this.mesh.position, 0x00eeff, 10, 0.8);
            this.blinkCharges--;
            if (this.blinkCharges <= 0) {
                this.abilityReadyAt = Date.now() + cdMs;
                this.blinkCharges = 3;
            } else {
                this.abilityReadyAt = Date.now() + 250;
            }
            if (!this.isBot) updateAbilityHudIcon();
        } else if (type === 'gales_edge') {
            if (!this.isBot) playSynth(440, 880, 0.2, 'sine', 0.28);
            this.rapturePoseTimer = 12;
            spawnSlashArc(this, 0xccffff, 1.25);
            spawnWindWall(this, startPos, aimVec);
            this.galeCharges--;
            if (this.galeCharges <= 0) {
                this.abilityReadyAt = Date.now() + cdMs;
                this.galeCharges = 2;
            } else {
                this.abilityReadyAt = Date.now() + 300;
            }
            if (!this.isBot) updateAbilityHudIcon();
        } else if (type === 'hell_hook') {
            const enemy = findAimedEnemy(this, 165, -0.1);
            if (!enemy) {
                if (!this.isBot) showStatus('НЕТ ЦЕЛИ ДЛЯ КРЮКА', '#4488ff', 1000);
                return false;
            }
            const toEnemy = new THREE.Vector3().subVectors(enemy.mesh.position, startPos);
            toEnemy.y = 0;
            if (toEnemy.lengthSq() > 0.001) toEnemy.normalize();
            const pullDest = startPos.clone().add(toEnemy.multiplyScalar(13));
            enemy.hookDest.set(pullDest.x, enemy.baseY, pullDest.z);
            enemy.hookPullTimer = 16;
            enemy.stunTimer = Math.max(enemy.stunTimer, 28);
            spawnLightning(startPos, enemy.mesh.position.clone(), 0x2266ff, 5);
            spawnShockwave(enemy.mesh.position.clone(), 0x2266ff, 2, 14, 0.06, true);
            spawnSparks(enemy.mesh.position.clone(), 0x55aaff, 16, 1.1);
            if (!this.isBot || enemy === mainPlayer) {
                playSynth(220, 560, 0.25, 'sawtooth', 0.32);
                addShake(0.6);
                if (enemy === mainPlayer) showStatus('ВАС ПРИТЯНУЛИ (HELL HOOK)', '#4488ff', 1300);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'qi_charge') {
            this.qiTimer = 420;
            spawnShockwave(startPos, 0xffffff, 2, 18, 0.05, true);
            spawnSparks(startPos, 0xddeeff, 18, 1.1);
            if (!this.isBot) {
                playSynth(300, 960, 0.34, 'triangle', 0.32);
                showStatus('QI CHARGE: СИЛА И СКОРОСТЬ (7с)', '#eef6ff', 1400);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'pulse') {
            spawnShockwave(startPos, 0xff1122, 3, 55, 0.04, true);
            spawnShockwave(startPos, 0xffffff, 2, 36, 0.055, true);
            spawnSparks(startPos, 0xff2233, 24, 1.4);
            if (!this.isBot) { playSynth(140, 480, 0.32, 'sawtooth', 0.36); addShake(0.8); }
            let hitCount = 0;
            players.forEach(p => {
                if (p.isAlive && p !== this) {
                    const d = Math.hypot(p.mesh.position.x - startPos.x, p.mesh.position.z - startPos.z);
                    if (d <= 58) {
                        p.silencedTimer = 300;
                        p.stripActiveBuffs();
                        spawnLightning(startPos, p.mesh.position.clone(), 0xff1122, 3);
                        hitCount++;
                        if (p === mainPlayer) {
                            playSynth(180, 70, 0.3, 'sawtooth', 0.3);
                            showStatus('PULSE: АБИЛКИ ОТКЛЮЧЕНЫ (5с)', '#ff2233', 1600);
                        }
                    }
                }
            });
            if (!this.isBot && hitCount > 0) showStatus(`PULSE ЗАДЕЛ ВРАГОВ: ${hitCount}`, '#ff2233', 1300);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'blade_trap') {
            spawnBladeTrap(this, startPos);
            spawnShockwave(new THREE.Vector3(startPos.x, 0.5, startPos.z), 0xff1144, 2, 12, 0.06, true);
            if (!this.isBot) {
                playSynth(420, 180, 0.2, 'triangle', 0.28);
                showStatus('BLADE TRAP УСТАНОВЛЕНА', '#ff2255', 1200);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'chieftains_totem') {
            spawnChieftainTotem(this, startPos);
            spawnShockwave(new THREE.Vector3(startPos.x, 0.5, startPos.z), 0xffbb22, 2, 30, 0.045, true);
            if (!this.isBot) {
                playSynth(280, 620, 0.3, 'triangle', 0.3);
                showStatus('ТОТЕМ УСТАНОВЛЕН (10с)', '#ffcc33', 1300);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'absolute_confidence') {
            this.absConfTimer = 360;
            spawnShockwave(startPos, 0xff1133, 2, 20, 0.05, true);
            spawnSparks(startPos, 0xff2244, 18, 1.1);
            if (!this.isBot) {
                playSynth(260, 720, 0.32, 'sawtooth', 0.32);
                showStatus('ABSOLUTE CONFIDENCE (6с)', '#ff2244', 1500);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'flash_counter') {
            this.abilityReadyAt = Date.now() + cdMs;
            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const range = 24 + (ball.speed * 3.4);
            if (ball.target === this && distToBall < range && ball.selfBounceGrace <= 0 && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
                this.rapturePoseTimer = 18;
                playClashSound(ball.speed + 2.2);
                playSynth(880, 320, 0.28, 'sawtooth', 0.38);
                spawnSlashArc(this, 0xcc44ff, 1.65);
                addShake(1.6);
                ball.triggerFlashCounter(this);
                this.blockCooldown = 0; this.parryActiveTimer = 0;
            } else {
                this.rapturePoseTimer = 40;
                spawnSlashArc(this, 0xaa33ff, 1.15);
                if (!this.isBot) playSynth(260, 140, 0.22, 'triangle', 0.22);
            }
        } else if (type === 'super_jump') {
            if (!this.isBot) playSynth(240, 820, 0.28, 'sine', 0.3);
            this.velY = 3.3;
            const footPos = new THREE.Vector3(startPos.x, startPos.y - 5, startPos.z);
            spawnShockwave(footPos, 0xffffff, 2, 15, 0.06, true);
            spawnShockwave(footPos, 0x66ccff, 1, 10, 0.08, true);
            spawnSparks(footPos, 0x99eeff, 14, 1.0);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'shadow_step') {
            if (!this.isBot) playSynth(420, 140, 0.25, 'triangle', 0.28);
            this.shadowTimer = 210;
            spawnShockwave(startPos, 0x8833ff, 2, 12, 0.07, true);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'wind_cloak') {
            if (!this.isBot) playSynth(380, 760, 0.28, 'sine', 0.28);
            this.windTimer = 600;
            spawnShockwave(startPos, 0x00ffaa, 2, 14, 0.06, true);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'invis') {
            if (!this.isBot) playSynth(550, 220, 0.3, 'triangle', 0.26);
            this.isInvis = true; this.invisTimer = 180;
            this.setOpacity(0.2);
            spawnShockwave(startPos, 0x88ccff, 2, 11, 0.07, true);
            if (ball.target === this) ball.pickNewTarget(this);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'platform') {
            this.isPlatformActive = !this.isPlatformActive;
            if (this.isPlatformActive) {
                this.platformMesh.visible = true;
                this.velY = 0;
                if (this.isBot) {
                    setTimeout(() => {
                        if (this.isAlive) { this.isPlatformActive = false; this.platformMesh.visible = false; }
                    }, 3000);
                }
            } else {
                this.platformMesh.visible = false;
            }
            this.abilityReadyAt = Date.now() + (this.isBot ? 7500 : 350);
        } else if (type === 'freeze') {
            ball.freeze(300);
            playSynth(1150, 400, 0.34, 'triangle', 0.3);
            showStatus('МЯЧ ЗАМОРОЖЕН', '#00eeff', 1400);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'forcefield') {
            this.forcefieldMax = aliveCount <= 2 ? 180 : 420;
            this.forcefieldTimer = this.forcefieldMax;
            spawnShockwave(startPos, 0xff5522, 2, 14, 0.06, true);
            if (!this.isBot) playSynth(300, 640, 0.28, 'sine', 0.3);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'swap') {
            const enemy = findAimedEnemy(this, 160, -0.2);
            if (!enemy) {
                if (!this.isBot) showStatus('НЕТ ЦЕЛИ В ПРИЦЕЛЕ', '#ffaa00', 1000);
                return false;
            }
            const myPos = this.mesh.position.clone();
            const enPos = enemy.mesh.position.clone();
            spawnLightning(myPos, enPos, 0x00eeff, 5);
            spawnLightning(myPos, enPos, 0xffcc00, 2);
            spawnShockwave(myPos, 0x00eeff, 2, 14, 0.06, true);
            spawnShockwave(enPos, 0xffcc00, 2, 14, 0.06, true);
            spawnSparks(myPos, 0x00eeff, 12, 1.0);
            spawnSparks(enPos, 0xffcc00, 12, 1.0);
            this.mesh.position.set(enPos.x, this.baseY, enPos.z);
            enemy.mesh.position.set(myPos.x, enemy.baseY, myPos.z);
            this.clampBounds();
            enemy.clampBounds();
            if (!this.isBot || enemy === mainPlayer) {
                playSynth(380, 980, 0.22, 'triangle', 0.3);
                addShake(0.6);
                if (enemy === mainPlayer) showStatus('ВАС ПОМЕНЯЛИ МЕСТАМИ (SWAP)', '#00eeff', 1300);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'scopophobia') {
            const enemy = findAimedEnemy(this, 150, 0.1);
            if (!enemy) {
                if (!this.isBot) showStatus('СМОТРИТЕ НА ВРАГА', '#ff2255', 1000);
                return false;
            }
            enemy.scopoTimer = 240;
            enemy.scopoWeakHit = true;
            spawnLightning(startPos, enemy.mesh.position.clone(), 0xff0044, 3);
            spawnShockwave(enemy.mesh.position.clone(), 0xff0044, 2, 15, 0.05, true);
            spawnSparks(enemy.mesh.position.clone(), 0xff1155, 14, 0.9);
            if (!this.isBot) {
                playSynth(190, 85, 0.32, 'sawtooth', 0.3);
                showStatus(`SCOPOPHOBIA: ${enemy.name} ЗАМЕДЛЕН`, '#ff2255', 1400);
            } else if (enemy === mainPlayer) {
                playSynth(180, 75, 0.32, 'sawtooth', 0.3);
                showStatus('SCOPOPHOBIA: ВЫ ЗАМЕДЛЕНЫ (4с)', '#ff2255', 1600);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'pull') {
            if (!ball.mesh.visible || ball.teleTimer > 0 || ball.trapTimer > 0) return false;
            if (ball.target === this) {
                if (!this.isBot) showStatus('МЯЧ УЖЕ ЛЕТИТ В ВАС', '#ff4466', 1000);
                return false;
            }
            ball.unfreeze();
            spawnLightning(startPos, ball.mesh.position.clone(), 0xff2244, 4);
            spawnShockwave(ball.mesh.position.clone(), 0xff2244, 2, 14, 0.06, true);
            spawnShockwave(startPos, 0xff2244, 2, 12, 0.06, true);
            ball.forceTarget(this, ball.lastHitBy);
            ball.speed = Math.min(ball.speed + 0.2, 9.2);
            if (!this.isBot) {
                playSynth(620, 240, 0.24, 'sawtooth', 0.3);
                addShake(0.45);
                showStatus('PULL: МЯЧ ПЕРЕХВАЧЕН НА ВАС', '#ff3355', 1200);
            }
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'ninja_dash') {
            if (!ball.mesh.visible || ball.teleTimer > 0 || ball.trapTimer > 0 || ball.selfBounceGrace > 0) return false;
            const bPos = ball.mesh.position.clone();
            const toBall = new THREE.Vector3().subVectors(bPos, startPos);
            const dist = toBall.length();
            if (dist > 130) {
                if (!this.isBot) showStatus('МЯЧ СЛИШКОМ ДАЛЕКО', '#ff4466', 1000);
                return false;
            }
            const mid1 = new THREE.Vector3().lerpVectors(startPos, bPos, 0.33);
            const mid2 = new THREE.Vector3().lerpVectors(startPos, bPos, 0.66);
            spawnAfterimage(startPos, 0xcc1133);
            spawnAfterimage(mid1, 0xff2244);
            spawnAfterimage(mid2, 0xff4455);

            const dirFlat = toBall.clone(); dirFlat.y = 0;
            if (dirFlat.lengthSq() > 0.001) dirFlat.normalize();
            const landPos = bPos.clone().sub(dirFlat.clone().multiplyScalar(5.5));
            this.mesh.position.set(landPos.x, this.baseY, landPos.z);
            this.clampBounds();
            if (dirFlat.lengthSq() > 0.001) this.mesh.rotation.y = Math.atan2(dirFlat.x, dirFlat.z);

            this.rapturePoseTimer = 14;
            this.blockCooldown = 0;
            this.parryActiveTimer = 0;
            ball.unfreeze();
            ball.aeroTimer = 0;
            ball.raptureBoost = false;
            ball.martyrBall = false;
            playClashSound(ball.speed + 1.2);
            playSynth(880, 260, 0.2, 'sawtooth', 0.3);
            spawnSlashArc(this, 0xff1144, 1.45);
            this.triggerParryImpactVFX(bPos, 0xff1144);
            if (!this.isBot) { targetFov = 73; addShake(0.9); }

            ball.speed = Math.min(ball.speed + 0.45, 9.4);
            ball.pickNewTarget(this);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'telekinesis') {
            if (!ball.mesh.visible || ball.teleTimer > 0 || ball.trapTimer > 0) return false;
            ball.startTelekinesis(this);
            playSynth(300, 920, 0.35, 'sine', 0.32);
            if (!this.isBot) showStatus('ТЕЛЕКИНЕЗ: НАВЕДИТЕ КАМЕРУ', '#cc44ff', 1700);
            else showStatus(`${this.name}: ТЕЛЕКИНЕЗ`, '#cc44ff', 1500);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'raging_deflect') {
            this.abilityReadyAt = Date.now() + cdMs;
            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const range = 22 + (ball.speed * 3.2);
            if (ball.target === this && distToBall < range && ball.selfBounceGrace <= 0 && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
                this.rapturePoseTimer = 20;
                playClashSound(ball.speed + 2.0);
                playSynth(210, 75, 0.35, 'sawtooth', 0.4);
                spawnSlashArc(this, 0xff1133, 1.5);
                addShake(1.4);
                ball.triggerRagingDeflect(this);
                this.blockCooldown = 0; this.parryActiveTimer = 0;
            } else {
                this.rapturePoseTimer = 45;
                spawnSlashArc(this, 0xff3344, 1.1);
                if (!this.isBot) playSynth(220, 140, 0.25, 'triangle', 0.22);
            }
        } else if (type === 'aerodynamic_slash') {
            this.abilityReadyAt = Date.now() + cdMs;
            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const range = 22 + (ball.speed * 3.2);
            if (ball.target === this && distToBall < range && ball.selfBounceGrace <= 0 && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
                this.rapturePoseTimer = 22;
                playClashSound(ball.speed + 2.2);
                playSynth(420, 1150, 0.36, 'sawtooth', 0.38);
                spawnSlashArc(this, 0xff2255, 1.65);
                addShake(1.5);
                ball.triggerAeroSlash(this);
                this.blockCooldown = 0; this.parryActiveTimer = 0;
            } else {
                this.rapturePoseTimer = 45;
                spawnSlashArc(this, 0xff2255, 1.15);
                if (!this.isBot) playSynth(240, 140, 0.25, 'triangle', 0.22);
            }
        } else if (type === 'rapture') {
            this.abilityReadyAt = Date.now() + cdMs;
            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const range = 22 + (ball.speed * 3.2);
            if (ball.target === this && distToBall < range && ball.selfBounceGrace <= 0 && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
                this.rapturePoseTimer = 24;
                playClashSound(ball.speed + 2.5);
                playSynth(180, 60, 0.38, 'sawtooth', 0.44);
                spawnSlashArc(this, 0xff5500, 1.7);
                addShake(1.8);
                ball.triggerRaptureLaunch(this);
                this.blockCooldown = 0; this.parryActiveTimer = 0;
            } else {
                this.rapturePoseTimer = 55;
                spawnSlashArc(this, 0xff5500, 1.15);
                if (!this.isBot) playSynth(220, 140, 0.28, 'triangle', 0.22);
            }
        }
        return true;
    }

    clampBounds() {
        const p = this.mesh.position;
        if (gameState === 'lobby') {
            p.x = Math.max(-76, Math.min(76, p.x));
            p.z = Math.max(LOBBY_Z - 76, Math.min(LOBBY_Z + 76, p.z));
        } else if (gameState === 'test') {
            p.x = Math.max(-86, Math.min(86, p.x));
            p.z = Math.max(TEST_Z - 86, Math.min(TEST_Z + 86, p.z));
        } else {
            p.x = Math.max(-106, Math.min(106, p.x));
            p.z = Math.max(-106, Math.min(106, p.z));
        }
    }

    triggerParryImpactVFX(hitPos, col) {
        spawnShockwave(hitPos, col, 1.6, 13 + ball.speed * 1.1, 0.065, false, this.mesh.rotation.y);
        spawnSparks(hitPos, col, 16, 1.0 + ball.speed * 0.08);
        if (this === mainPlayer) addShake(Math.min(1.1, 0.28 + ball.speed * 0.1));
    }

    applyStandardParryBoost() {
        const reaperBonus = (this.getCurrentAbility() === 'reaper') ? this.reaperStacks * 0.16 : 0;
        const qiBonus = this.qiTimer > 0 ? 0.45 : 0;
        const totemBonus = this.getTotemEffect().inOwn ? 0.35 : 0;
        let delta = 0.32 + reaperBonus + qiBonus + totemBonus;
        if (this.scopoWeakHit) {
            delta = -0.25;
            this.scopoWeakHit = false;
            if (this === mainPlayer) showStatus('УДАР ОСЛАБЛЕН (SCOPOPHOBIA)', '#ff2255', 1100);
        }
        ball.speed = Math.max(0.85, Math.min(ball.speed + delta, 9.4));
        ball.raptureBoost = false;
        ball.aeroTimer = 0;
        ball.martyrBall = false;
    }

    updateParryLogic() {
        if (this.forcefieldTimer > 0 && isCombatState() && ball.target === this && ball.selfBounceGrace <= 0 && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
            if (this.mesh.position.distanceTo(ball.mesh.position) < 14 + ball.speed * 1.5) {
                playClashSound(ball.speed);
                ball.unfreeze();
                this.applyStandardParryBoost();
                this.triggerParryImpactVFX(ball.mesh.position.clone(), 0xff6622);
                ball.pickNewTarget(this);
                return;
            }
        }

        if (this.parryActiveTimer > 0) {
            this.parryActiveTimer--;
            this.rArmGroup.rotation.x = -Math.PI / 1.5;

            if (isCombatState() && ball.target === this && ball.selfBounceGrace <= 0 && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
                const qiRangeBonus = this.qiTimer > 0 ? 4 : 0;
                const parryRange = 15 + qiRangeBonus + (ball.speed * 2.5);
                if (this.mesh.position.distanceTo(ball.mesh.position) < parryRange) {
                    playClashSound(ball.speed);
                    ball.unfreeze();
                    this.applyStandardParryBoost();
                    this.triggerParryImpactVFX(ball.mesh.position.clone(), getSwordAccentColor(this.swordId));
                    ball.pickNewTarget(this);
                    this.parryActiveTimer = 0; this.blockCooldown = 0;
                }
            }

            if (gameState === 'lobby' && this === mainPlayer && training.active && training.goingToPlayer) {
                const parryRange = 15 + (training.speed * 2.5);
                if (this.mesh.position.distanceTo(training.ballMesh.position) < parryRange) {
                    training.onPlayerParry();
                    this.parryActiveTimer = 0; this.blockCooldown = 0;
                }
            }
        }
        if (this.blockCooldown > 0 && this.parryActiveTimer === 0) this.blockCooldown--;
    }

    die() {
        if (gameState === 'test') {
            spawnKillBeam(this.mesh.position.clone(), this.explosionColor);
            if (!this.isBot) {
                showStatus('ПОПАДАНИЕ ПО ВАМ', '#ff3344', 1100);
                return;
            }
            this.isAlive = false;
            scene.remove(this.mesh);
            scene.remove(this.platformMesh);
            if (ball.lastHitBy === mainPlayer) {
                playKillSound();
                testState.kills++;
                showKillFeed(this.name, testState.kills);
                if (mainPlayer.getCurrentAbility() === 'reaper') {
                    mainPlayer.reaperStacks = Math.min(5, mainPlayer.reaperStacks + 1);
                    updateAbilityHudIcon();
                    showStatus(`REAPER x${mainPlayer.reaperStacks}`, '#ff2244', 1400);
                }
            }
            const slot = this.testSlot;
            const handle = setTimeout(() => {
                if (gameState === 'test') spawnTestBot(slot);
            }, 1500);
            testState.respawnTimers.push(handle);
            return;
        }

        if (gameState !== 'playing') return;

        this.isAlive = false;
        spawnKillBeam(this.mesh.position.clone(), this.explosionColor);
        scene.remove(this.mesh);
        scene.remove(this.platformMesh);

        const aliveList = players.filter(p => p.isAlive);
        document.getElementById('aliveCount').innerText = aliveList.length;

        // Entering 1v1: immediately cancel active Invisibility on remaining players
        if (aliveList.length === 2) {
            let strippedAny = false;
            aliveList.forEach(p => {
                if (p.isInvis) {
                    p.isInvis = false;
                    p.invisTimer = 0;
                    p.setOpacity(1);
                    strippedAny = true;
                }
            });
            if (strippedAny) showStatus('1 НА 1: НЕВИДИМОСТЬ ОТКЛЮЧЕНА', '#ffaa00', 1500);
        }

        if (ball.lastHitBy && ball.lastHitBy.isAlive && ball.lastHitBy !== this) {
            if (ball.lastHitBy.getCurrentAbility() === 'reaper') {
                ball.lastHitBy.reaperStacks = Math.min(5, ball.lastHitBy.reaperStacks + 1);
                if (ball.lastHitBy === mainPlayer) {
                    updateAbilityHudIcon();
                    showStatus(`REAPER x${mainPlayer.reaperStacks}`, '#ff2244', 1500);
                }
            }
            if (ball.lastHitBy.isBot && ball.lastHitBy.profile) ball.lastHitBy.profile.kills++;
        }

        if (this.isBot && ball.lastHitBy === mainPlayer) {
            playKillSound();
            matchKills++;
            gameData.kills++;
            gameData.coins += isX2Active() ? 20 : 10;
            saveGame();
            showKillFeed(this.name, matchKills);
        }

        if (!this.isBot) {
            gameState = 'gameover';
            stopAllTouchControls();
            hideStatus();
            hideBlockCdOverlay();
            ball.mesh.visible = false;
            ball.target = null;
            ballGroundRing.visible = false;
            resetBallTrail();
            document.getElementById('dangerVignette').classList.remove('active');
            document.getElementById('ballArrow').style.display = 'none';
            const mult = isX2Active() ? 2 : 1;
            document.getElementById('endMsg').innerText = 'ВЫ ВЫБЫЛИ';
            document.getElementById('endMsg').style.color = '#ff4455';
            document.getElementById('rewardMsg').innerText =
                `Убийств за матч: ${matchKills}\nНаграда: +${matchKills * 10 * mult} монет` + (mult > 1 ? ' (x2 буст)' : '');
            document.getElementById('gameOver').style.display = 'block';
        } else if (aliveList.length === 1 && aliveList[0] === mainPlayer) {
            gameState = 'gameover';
            stopAllTouchControls();
            hideStatus();
            hideBlockCdOverlay();
            mainPlayer.setTargetHighlight(false);
            ball.mesh.visible = false;
            ball.target = null;
            ballGroundRing.visible = false;
            resetBallTrail();
            document.getElementById('dangerVignette').classList.remove('active');
            document.getElementById('ballArrow').style.display = 'none';
            const mult = isX2Active() ? 2 : 1;
            const winBonus = 50 * mult;
            gameData.coins += winBonus;
            gameData.wins++;
            saveGame();
            document.getElementById('endMsg').innerText = 'ПОБЕДА';
            document.getElementById('endMsg').style.color = '#00ff66';
            document.getElementById('rewardMsg').innerText =
                `Убийств: ${matchKills} (+${matchKills * 10 * mult} монет)\nБонус за победу: +${winBonus} монет` + (mult > 1 ? ' (x2 буст)' : '');
            document.getElementById('gameOver').style.display = 'block';
        }
    }

    rollHumanReactionMs(isCloseClash = false) {
        if (this.isTestBot) return isCloseClash ? 45 : 85;
        if (isCloseClash) {
            if (this.tier === 'sweat') return 42 + Math.random() * 35;
            if (this.tier === 'pro') return 65 + Math.random() * 45;
            if (this.tier === 'mid') return 115 + Math.random() * 65;
            return 175 + Math.random() * 90;
        }
        if (this.tier === 'sweat') return 85 + Math.random() * 50;
        if (this.tier === 'pro') return 115 + Math.random() * 60;
        if (this.tier === 'mid') return 175 + Math.random() * 85;
        return 250 + Math.random() * 125;
    }

    rollPrefireLead() {
        // Frames before impact when bot swings block (enables genuine Pull baiting)
        if (this.isTestBot) return 9 + Math.random() * 4;
        if (this.tier === 'sweat') return 7 + Math.random() * 4;
        if (this.tier === 'pro') return 8 + Math.random() * 5;
        if (this.tier === 'mid') return 10 + Math.random() * 6;
        return 12 + Math.random() * 7;
    }

    pickBestEnemyToAimAt() {
        const others = players.filter(p => p.isAlive && p !== this && !p.isInvis);
        if (others.length === 0) return null;
        let best = others[0], bestScore = -999;
        others.forEach(e => {
            const d = this.mesh.position.distanceTo(e.mesh.position);
            let s = 40 / (d + 12);
            if (e.blockCooldown > 6) s += 3.5; // Punish players on block CD
            if (e.stunTimer > 0 || e.scopoTimer > 0 || e.virusTimer > 0) s += 2.2;
            if (s > bestScore) { bestScore = s; best = e; }
        });
        return best;
    }

    updateAI() {
        if (!this.isAlive || !this.isBot) return;
        this.updateBuffTimers();
        this.updateVerticalPhysics();
        this.updateParryLogic();

        // Test arena bots
        if (this.isTestBot && gameState === 'test') {
            if (testState.botMode === 'dummy') {
                this.animateWalk(false);
                if (mainPlayer && mainPlayer.isAlive && this.stunTimer <= 0) {
                    const toMe = new THREE.Vector3().subVectors(mainPlayer.mesh.position, this.mesh.position);
                    this.mesh.rotation.y = Math.atan2(toMe.x, toMe.z);
                }
                return;
            }
            if (this.mesh.position.distanceTo(this.targetWalkPos) < 5 || Math.random() < 0.015) {
                const anchorX = this.testSlot === 0 ? -24 : 24;
                this.targetWalkPos.set(anchorX + (Math.random() - 0.5) * 32, this.baseY, TEST_Z - 26 + (Math.random() - 0.5) * 30);
            }
            const spd = this.getMoveSpeed();
            let moving = false;
            if (spd > 0) {
                const walkDir = new THREE.Vector3().subVectors(this.targetWalkPos, this.mesh.position);
                if (walkDir.length() > 1.5) {
                    walkDir.y = 0; walkDir.normalize();
                    this.mesh.position.add(walkDir.multiplyScalar(spd * 0.65));
                    this.mesh.rotation.y = Math.atan2(walkDir.x, walkDir.z);
                    moving = true;
                }
            }
            this.animateWalk(moving);

            if (ball.target === this && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
                if (mainPlayer && mainPlayer.isAlive && this.stunTimer <= 0) {
                    const toPlayer = new THREE.Vector3().subVectors(mainPlayer.mesh.position, this.mesh.position);
                    this.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
                }
                const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
                const parryRange = 15 + (ball.speed * 2.5);
                const prefireDist = parryRange + (ball.speed * this.prefireLeadFrames);
                if (distToBall < prefireDist && !this.parryDecided) {
                    this.parryDecided = true;
                    this.tryParry();
                }
            } else {
                this.parryDecided = false;
            }
            return;
        }

        if (this.isPlatformActive) {
            this.mesh.position.y = Math.min(28, this.mesh.position.y + 0.8);
            this.platformMesh.position.set(this.mesh.position.x, this.mesh.position.y - 7, this.mesh.position.z);
        }

        // Lobby idle wandering
        if (gameState === 'lobby') {
            if (this.mesh.position.distanceTo(this.targetWalkPos) < 5 || Math.random() < 0.012) {
                this.targetWalkPos.set(-28 + Math.random() * 90, this.baseY, LOBBY_Z - 55 + Math.random() * 110);
            }
            const spd = this.getMoveSpeed();
            let moving = false;
            if (spd > 0) {
                const walkDir = new THREE.Vector3().subVectors(this.targetWalkPos, this.mesh.position);
                if (walkDir.length() > 1.2) {
                    walkDir.y = 0; walkDir.normalize();
                    this.mesh.position.add(walkDir.multiplyScalar(spd * 0.72));
                    this.mesh.rotation.y = Math.atan2(walkDir.x, walkDir.z);
                    moving = true;
                }
                if (Math.random() < 0.004) this.jump();
            }
            this.animateWalk(moving);
            return;
        }

        if (gameState !== 'playing') return;

        // Combat tactical positioning (real Blade Ball spacing & clash pushing)
        const aliveOthers = players.filter(p => p.isAlive && p !== this && !p.isInvis);
        const aliveCount = players.filter(p => p.isAlive).length;
        const ab = this.ability;

        this.strafeSwapTimer--;
        if (this.strafeSwapTimer <= 0) {
            this.strafeDir *= -1;
            this.strafeSwapTimer = 55 + Math.floor(Math.random() * 85);
        }

        const spd = this.getMoveSpeed();
        let moving = false;
        const focusEnemy = this.pickBestEnemyToAimAt();

        if (spd > 0 && focusEnemy) {
            const toEnemy = new THREE.Vector3().subVectors(focusEnemy.mesh.position, this.mesh.position);
            toEnemy.y = 0;
            const distEnemy = Math.max(0.1, toEnemy.length());
            const dirToEnemy = toEnemy.clone().divideScalar(distEnemy);
            const strafeVec = new THREE.Vector3(-dirToEnemy.z * this.strafeDir, 0, dirToEnemy.x * this.strafeDir);

            const moveVec = new THREE.Vector3();
            const isDuelAggressive = (this.tier === 'sweat' || this.tier === 'pro') && (aliveCount <= 2 || focusEnemy.blockCooldown > 10);

            if (isDuelAggressive) {
                // Close into clash distance (~20-26 units) and strafe
                const idealDist = this.tier === 'sweat' ? 20 : 25;
                if (distEnemy > idealDist + 5) moveVec.addScaledVector(dirToEnemy, 0.85);
                else if (distEnemy < idealDist - 5) moveVec.addScaledVector(dirToEnemy, -0.5);
                moveVec.addScaledVector(strafeVec, 0.72);
            } else if (ball.target === this) {
                // Backpedal slightly + strafe to buy parry reaction window
                if (distEnemy < 38) moveVec.addScaledVector(dirToEnemy, -0.65);
                moveVec.addScaledVector(strafeVec, 0.85);
            } else {
                // Maintain smart mid-range spacing around ~44 units
                if (distEnemy < 32) moveVec.addScaledVector(dirToEnemy, -0.7);
                else if (distEnemy > 62) moveVec.addScaledVector(dirToEnemy, 0.65);
                moveVec.addScaledVector(strafeVec, 0.8);
            }

            // Soft pull away from arena walls
            if (Math.abs(this.mesh.position.x) > 88) moveVec.x -= Math.sign(this.mesh.position.x) * 0.9;
            if (Math.abs(this.mesh.position.z) > 88) moveVec.z -= Math.sign(this.mesh.position.z) * 0.9;

            if (moveVec.lengthSq() > 0.01) {
                moveVec.normalize();
                this.mesh.position.addScaledVector(moveVec, spd * 0.92);
                this.clampBounds();
                moving = true;
            }

            // Face target enemy when about to parry, otherwise face movement
            if (ball.target === this) {
                this.mesh.rotation.y = Math.atan2(dirToEnemy.x, dirToEnemy.z);
            } else if (moving) {
                this.mesh.rotation.y = Math.atan2(moveVec.x, moveVec.z);
            }

            if (Math.random() < (this.tier === 'sweat' ? 0.012 : 0.005)) this.jump();
        }
        this.animateWalk(moving);

        // Proactive ability usage
        if (Date.now() >= this.abilityReadyAt && this.stunTimer <= 0 && this.silencedTimer <= 0) {
            if (ab === 'invis' && aliveCount > 2 && !this.isInvis && ball.target === this && Math.random() < 0.04) {
                this.activateAbility();
            } else if ((ab === 'freeze' || ab === 'telekinesis') && ball.frozenTimer <= 0 && ball.teleTimer <= 0 && ball.speed > 1.7 && Math.random() < 0.008) {
                this.activateAbility();
            } else if ((ab === 'wind_cloak' || ab === 'shadow_step' || ab === 'qi_charge' || ab === 'chieftains_totem' || ab === 'blade_trap') && Math.random() < 0.006) {
                this.activateAbility();
            } else if ((ab === 'scopophobia' || ab === 'swap' || ab === 'hell_hook') && focusEnemy && Math.random() < 0.006) {
                this.activateAbility();
            } else if (ab === 'pulse' && focusEnemy && this.mesh.position.distanceTo(focusEnemy.mesh.position) < 52 && Math.random() < 0.012) {
                this.activateAbility();
            } else if (ab === 'absolute_confidence' && aliveCount > 2 && ball.speed > 1.4 && Math.random() < 0.006) {
                this.activateAbility();
            } else if (ab === 'pull' && ball.target && ball.target !== this && ball.target.parryActiveTimer > 0 && Math.random() < 0.35) {
                // Smart bot Pull-baits when it sees someone pre-fire!
                this.activateAbility();
            } else if (ab === 'gales_edge' && ball.target === this && this.mesh.position.distanceTo(ball.mesh.position) < 42 && Math.random() < 0.03) {
                this.activateAbility();
            } else if (ab === 'ninja_dash' && ball.target !== this && this.mesh.position.distanceTo(ball.mesh.position) < 58 && Math.random() < 0.01) {
                this.activateAbility();
            }
        }

        // Pre-fire defensive parry & counter-ability logic
        if (ball.target === this && ball.teleTimer <= 0 && ball.trapTimer <= 0) {
            const elapsedSinceSwitch = performance.now() - ball.targetSetTime;
            if (elapsedSinceSwitch < this.currentReactionMs) return;

            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const qiBonus = this.qiTimer > 0 ? 4 : 0;
            const parryRange = 15 + qiBonus + (ball.speed * 2.5);
            const prefireDist = parryRange + (ball.speed * this.prefireLeadFrames);

            // Aim at the best enemy right before swinging so smart targeting sends it there
            if (focusEnemy && this.stunTimer <= 0) {
                const aim = new THREE.Vector3().subVectors(focusEnemy.mesh.position, this.mesh.position);
                this.mesh.rotation.y = Math.atan2(aim.x, aim.z);
            }

            // Counter-parry abilities (Rapture, Raging Deflect, Aero Slash, Flash Counter)
            if ((ab === 'rapture' || ab === 'raging_deflect' || ab === 'aerodynamic_slash' || ab === 'flash_counter') &&
                Date.now() >= this.abilityReadyAt && this.stunTimer <= 0 && this.silencedTimer <= 0) {
                if (distToBall < 22 + ball.speed * 3.2 && !this.parryDecided) {
                    const useChance = (aliveCount === 2 || ball.speed > 1.9) ? 0.72 : 0.45;
                    if (Math.random() < useChance) {
                        this.parryDecided = true;
                        this.activateAbility();
                        return;
                    }
                }
            }

            if (ab === 'ninja_dash' && Date.now() >= this.abilityReadyAt && this.stunTimer <= 0 && this.silencedTimer <= 0 && distToBall < 34 && Math.random() < 0.16) {
                this.parryDecided = true;
                this.activateAbility();
                return;
            }

            if (ab === 'forcefield' && Date.now() >= this.abilityReadyAt && this.stunTimer <= 0 && this.silencedTimer <= 0 && distToBall < prefireDist * 1.3 && Math.random() < 0.12) {
                this.activateAbility();
                if (this.forcefieldTimer > 0) return;
            }

            // Pre-fire block decision (swings early while ball is approaching)
            if (distToBall < prefireDist && !this.parryDecided && this.forcefieldTimer <= 0) {
                this.parryDecided = true;
                let baseAcc = this.tier === 'sweat' ? 0.96 : (this.tier === 'pro' ? 0.92 : (this.tier === 'mid' ? 0.83 : 0.68));
                let speedPenalty = ball.speed * (this.tier === 'sweat' ? 0.025 : (this.tier === 'pro' ? 0.036 : (this.tier === 'mid' ? 0.052 : 0.072)));
                let successChance = Math.max(0.22, baseAcc - speedPenalty);
                if (ball.raptureBoost || ball.aeroTimer > 0 || ball.martyrBall) {
                    successChance *= (this.tier === 'sweat' ? 0.72 : (this.tier === 'pro' ? 0.58 : 0.38));
                }

                if (Math.random() < successChance) {
                    // Good pre-fire timing: swing immediately so parryActiveTimer covers impact (and is baitable by Pull!)
                    this.tryParry();
                } else if (Math.random() < 0.55) {
                    // Bot panicked and swung way too early, burning its block CD
                    this.tryParry();
                }
            }
        } else {
            this.parryDecided = false;
        }
    }
}

// ==========================================
// BALL + SMART TARGETING + SPECIAL BALL STATES + TRAIL
// ==========================================
const ballGroup = new THREE.Group();
const ballCoreMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const ballCoreMesh = new THREE.Mesh(new THREE.SphereGeometry(2.4, 20, 20), ballCoreMat);

const ballShellMat = new THREE.MeshBasicMaterial({
    color: 0x00eeff, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false
});
const ballShellMesh = new THREE.Mesh(new THREE.SphereGeometry(3.4, 18, 18), ballShellMat);

const ballGlowSpriteMat = new THREE.SpriteMaterial({
    map: GLOW_TEX, color: 0x00eeff, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
});
const ballGlowSprite = new THREE.Sprite(ballGlowSpriteMat);
ballGlowSprite.scale.set(17, 17, 1);

const ballPointLight = new THREE.PointLight(0x00eeff, 2.4, 65);
ballGroup.add(ballCoreMesh);
ballGroup.add(ballShellMesh);
ballGroup.add(ballGlowSprite);
ballGroup.add(ballPointLight);

const iceShellMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(4.6, 0),
    new THREE.MeshBasicMaterial({ color: 0x00eeff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })
);
iceShellMesh.visible = false;
ballGroup.add(iceShellMesh);

const teleSphereMesh = new THREE.Mesh(
    new THREE.IcosahedronGeometry(5.4, 1),
    new THREE.MeshBasicMaterial({ color: 0xbb33ff, wireframe: true, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false })
);
teleSphereMesh.visible = false;
ballGroup.add(teleSphereMesh);

ballGroup.visible = false;
scene.add(ballGroup);

const ballGroundMat = new THREE.MeshBasicMaterial({
    color: 0x00eeff, side: THREE.DoubleSide, transparent: true, opacity: 0.78,
    blending: THREE.AdditiveBlending, depthWrite: false
});
const ballGroundRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 4.2, 24), ballGroundMat);
ballGroundRing.rotation.x = -Math.PI / 2;
ballGroundRing.position.y = 0.2;
ballGroundRing.visible = false;
scene.add(ballGroundRing);

const TRAIL_LEN = 14;
const trailNodes = [];
const trailGeo = new THREE.SphereGeometry(2.1, 10, 10);
for (let i = 0; i < TRAIL_LEN; i++) {
    const tMat = new THREE.MeshBasicMaterial({
        color: 0x00eeff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
    });
    const tMesh = new THREE.Mesh(trailGeo, tMat);
    tMesh.visible = false;
    scene.add(tMesh);
    trailNodes.push({ mesh: tMesh, mat: tMat });
}
const trailHistory = [];

function resetBallTrail() {
    trailHistory.length = 0;
    trailNodes.forEach(n => { n.mesh.visible = false; });
}

function updateBallTrail(pos, hexColor) {
    trailHistory.unshift(pos.clone());
    if (trailHistory.length > TRAIL_LEN) trailHistory.pop();
    for (let i = 0; i < TRAIL_LEN; i++) {
        const node = trailNodes[i];
        if (i < trailHistory.length && gfxSettings.particles) {
            const frac = 1 - (i / TRAIL_LEN);
            node.mesh.visible = true;
            node.mesh.position.copy(trailHistory[i]);
            node.mesh.scale.setScalar(0.25 + frac * 0.95);
            node.mat.color.setHex(hexColor);
            node.mat.opacity = frac * frac * 0.65;
        } else {
            node.mesh.visible = false;
        }
    }
}

const ballArrowEl = document.getElementById('ballArrow');
const dangerVignetteEl = document.getElementById('dangerVignette');
const _projVec = new THREE.Vector3();
const _aimDir = new THREE.Vector3();
const _toCand = new THREE.Vector3();

function updateBallScreenIndicator() {
    if (!isCombatState() || !ball.mesh.visible || !mainPlayer || !mainPlayer.isAlive) {
        ballArrowEl.style.display = 'none';
        dangerVignetteEl.classList.remove('active');
        return;
    }

    const targetingMe = (ball.target === mainPlayer);
    dangerVignetteEl.classList.toggle('active', targetingMe);

    _projVec.copy(ball.mesh.position).project(camera);
    const behind = _projVec.z > 1;
    let sx = _projVec.x;
    let sy = _projVec.y;

    const onScreen = !behind && Math.abs(sx) < 0.92 && Math.abs(sy) < 0.88;
    if (onScreen) {
        ballArrowEl.style.display = 'none';
        return;
    }

    if (behind) { sx = -sx; sy = -sy; }
    const angle = Math.atan2(sy, sx);
    const padX = window.innerWidth * 0.44;
    const padY = window.innerHeight * 0.4;
    const px = window.innerWidth * 0.5 + Math.cos(angle) * padX;
    const py = window.innerHeight * 0.5 - Math.sin(angle) * padY;

    ballArrowEl.style.display = 'block';
    ballArrowEl.style.left = `${px - 11}px`;
    ballArrowEl.style.top = `${py - 11}px`;
    ballArrowEl.style.borderBottomColor = targetingMe ? '#ff1122' : (ball.goldenBall ? '#ffd700' : '#00ddff');
    ballArrowEl.style.transform = `rotate(${90 - (angle * 180 / Math.PI)}deg)`;
}

const ball = {
    mesh: ballGroup,
    target: null,
    lastHitBy: null,
    targetSetTime: 0,
    speed: 0.85,
    vel: new THREE.Vector3(),
    raptureBoost: false,
    curveTimer: 0,
    aeroTimer: 0,
    aeroAngle: 0,
    teleTimer: 0,
    teleOwner: null,
    trapTimer: 0,
    trapOwner: null,
    goldenBall: false,
    martyrBall: false,
    selfBounceGrace: 0,
    frozenTimer: 0,
    currentColorHex: 0x00eeff,

    resetAllSpecials: function() {
        this.raptureBoost = false;
        this.curveTimer = 0;
        this.aeroTimer = 0;
        this.teleTimer = 0;
        this.teleOwner = null;
        this.trapTimer = 0;
        this.trapOwner = null;
        this.goldenBall = false;
        this.martyrBall = false;
        this.selfBounceGrace = 0;
        teleSphereMesh.visible = false;
        this.unfreeze();
    },

    freeze: function(frames) {
        this.frozenTimer = frames;
        iceShellMesh.visible = true;
        spawnIceShatter(this.mesh.position);
        this.updateVisualColor();
    },

    unfreeze: function() {
        if (this.frozenTimer > 0) {
            this.frozenTimer = 0;
            iceShellMesh.visible = false;
            spawnIceShatter(this.mesh.position);
        }
    },

        startTelekinesis: function(owner) {
        this.unfreeze();
        this.aeroTimer = 0;
        this.curveTimer = 0;
        this.teleTimer = 108;
        this.teleOwner = owner;
        teleSphereMesh.visible = true;
        spawnShockwave(this.mesh.position, 0xcc44ff, 2, 16, 0.05, true);
        spawnSparks(this.mesh.position, 0xcc44ff, 16, 1.2);
        this.updateVisualColor();
    },

    triggerRaptureLaunch: function(owner) {
        this.unfreeze();
        this.aeroTimer = 0;
        this.curveTimer = 0;
        this.martyrBall = false;
        this.raptureBoost = true;
        this.speed = Math.min(Math.max(this.speed * 1.45, this.speed + 1.3), 9.8);
        this.pickNewTarget(owner);
        const dir = new THREE.Vector3();
        if (this.target) {
            dir.subVectors(this.target.mesh.position, owner.mesh.position);
        } else {
            getEntityAimVector(owner, dir);
        }
        spawnRaptureRocks(owner.mesh.position, dir);
        spawnShockwave(this.mesh.position, 0xff5500, 2, 20, 0.05, true);
        spawnSparks(this.mesh.position, 0xff6600, 24, 1.4);
        this.updateVisualColor();
    },

    triggerRagingDeflect: function(owner) {
        this.unfreeze();
        this.aeroTimer = 0;
        this.curveTimer = 0;
        this.raptureBoost = false;
        this.martyrBall = false;
        this.speed = Math.min(this.speed + 1.15, 9.6);
        this.pickNewTarget(owner);
        spawnShockwave(this.mesh.position, 0xff1133, 2, 18, 0.055, true);
        spawnSparks(this.mesh.position, 0xff2244, 22, 1.35);
        this.updateVisualColor();
    },

    triggerAeroSlash: function(owner) {
        this.unfreeze();
        this.raptureBoost = false;
        this.curveTimer = 0;
        this.martyrBall = false;
        this.aeroTimer = 55;
        this.aeroAngle = 0;
        this.speed = Math.min(this.speed + 0.95, 9.5);
        this.pickNewTarget(owner);
        spawnShockwave(this.mesh.position, 0xff2255, 2, 18, 0.05, true);
        spawnSparks(this.mesh.position, 0xff4488, 20, 1.3);
        this.updateVisualColor();
    },

    triggerFlashCounter: function(owner) {
        this.unfreeze();
        this.aeroTimer = 0;
        this.raptureBoost = false;
        this.martyrBall = false;
        this.speed = Math.min(this.speed + 1.25, 9.8);
        const prevHitter = this.lastHitBy;
        spawnLightning(owner.mesh.position, this.mesh.position.clone(), 0xcc44ff, 4);
        if (prevHitter && prevHitter.isAlive && prevHitter !== owner && !prevHitter.isInvis) {
            this.forceTarget(prevHitter, owner);
        } else {
            this.pickNewTarget(owner);
        }
        spawnShockwave(this.mesh.position, 0xcc44ff, 2, 19, 0.05, true);
        spawnSparks(this.mesh.position, 0xdd66ff, 22, 1.35);
        this.updateVisualColor();
    },

    updateVisualColor: function() {
        let hex = 0x00eeff;
        if (this.frozenTimer > 0) hex = 0x66ffff;
        else if (this.teleTimer > 0) hex = 0xcc44ff;
        else if (this.raptureBoost) hex = 0xff5500;
        else if (this.aeroTimer > 0) hex = 0xff2266;
        else if (this.goldenBall) hex = 0xffd700;
        else if (this.martyrBall) hex = 0xaa22ff;
        else if (this.target === mainPlayer) hex = 0xff1122;

        this.currentColorHex = hex;
        ballShellMat.color.setHex(hex);
        ballGlowSpriteMat.color.setHex(hex);
        ballPointLight.color.setHex(hex);
        ballGroundMat.color.setHex(hex);
    },

    forceTarget: function(newTarget, hitter) {
        if (this.target) this.target.setTargetHighlight(false);
        this.target = newTarget;
        this.lastHitBy = hitter || null;
        this.targetSetTime = performance.now();

        if (newTarget) {
            newTarget.setTargetHighlight(true);
            newTarget.parryDecided = false;
            const isCloseClash = !!(hitter && hitter.mesh.position.distanceTo(newTarget.mesh.position) < 34);
            newTarget.currentReactionMs = newTarget.rollHumanReactionMs(isCloseClash);
            newTarget.prefireLeadFrames = newTarget.rollPrefireLead();

            if (hitter) {
                const ab = hitter.getCurrentAbility();
                if (ab === 'virus') {
                    newTarget.virusTimer = 180;
                } else if (ab === 'golden_ball' && Math.random() < 0.25) {
                    this.goldenBall = true;
                    this.speed = Math.min(this.speed + 0.4, 9.6);
                }
            }
        }
        this.updateVisualColor();
    },

    pickNewTarget: function(hitter) {
        let candidates = players.filter(p => p.isAlive && p !== hitter && !p.isInvis);
        if (candidates.length === 0) {
            candidates = players.filter(p => p.isAlive && p !== hitter);
        }
        if (candidates.length === 0) {
            if (hitter && hitter.isAlive) {
                this.selfBounceGrace = 24;
                this.forceTarget(hitter, hitter);
            } else {
                this.forceTarget(null, null);
            }
            return;
        }

        // Absolute Confidence приоритетно притягивает мяч
        const confCandidates = candidates.filter(c => c.absConfTimer > 0);
        if (confCandidates.length > 0) {
            this.forceTarget(confCandidates[0], hitter);
            return;
        }

        if (!hitter) {
            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            this.forceTarget(pick, null);
            return;
        }

        getEntityAimVector(hitter, _aimDir);
        let best = candidates[0];
        let bestScore = -999;

        candidates.forEach(c => {
            _toCand.subVectors(c.mesh.position, hitter.mesh.position);
            _toCand.y = 0;
            const dist = Math.max(0.1, _toCand.length());
            const dot = _aimDir.dot(_toCand.divideScalar(dist));
            const score = dot * 2.4 + (30 / (dist + 14));
            if (score > bestScore) {
                bestScore = score;
                best = c;
            }
        });

        this.forceTarget(best, hitter);
    },

    spawn: function(centerZ = 0) {
        this.resetAllSpecials();
        this.speed = 0.85;
        this.vel.set(0, 0, 0);
        this.mesh.position.set(0, 7, centerZ);
        this.mesh.visible = true;
        ballGroundRing.visible = true;
        resetBallTrail();
        this.pickNewTarget(null);
    },

    update: function() {
        if (!isCombatState() || !this.mesh.visible) {
            ballGroundRing.visible = false;
            return;
        }

        if (this.selfBounceGrace > 0) this.selfBounceGrace--;

        ballGroundRing.visible = true;
        ballGroundRing.position.set(this.mesh.position.x, 0.2, this.mesh.position.z);

        // Заморозка (Freeze)
        if (this.frozenTimer > 0) {
            this.frozenTimer--;
            iceShellMesh.rotation.y += 0.04;
            iceShellMesh.rotation.x += 0.025;
            if (this.frozenTimer <= 0) {
                this.unfreeze();
                this.updateVisualColor();
            }
            updateBallScreenIndicator();
            return;
        }

        // Телекинез (Telekinesis)
        if (this.teleTimer > 0) {
            this.teleTimer--;
            teleSphereMesh.rotation.y += 0.09;
            teleSphereMesh.rotation.x += 0.05;
            this.mesh.position.y += (12 - this.mesh.position.y) * 0.12;

            if (this.teleTimer <= 0 || !this.teleOwner || !this.teleOwner.isAlive) {
                teleSphereMesh.visible = false;
                const owner = this.teleOwner;
                this.teleOwner = null;
                this.speed = Math.min(this.speed + 0.85, 9.6);
                this.pickNewTarget(owner && owner.isAlive ? owner : null);
                spawnShockwave(this.mesh.position, 0xcc44ff, 2, 18, 0.05, true);
                spawnSparks(this.mesh.position, 0xcc44ff, 20, 1.3);
                playSynth(520, 180, 0.24, 'sawtooth', 0.3);
            }
            updateBallTrail(this.mesh.position, this.currentColorHex);
            updateBallScreenIndicator();
            return;
        }

        // Ловушка (Blade Trap)
        if (this.trapTimer > 0) {
            this.trapTimer--;
            this.mesh.position.y = 5.5 + Math.sin(performance.now() * 0.03) * 0.6;
            if (this.trapTimer <= 0) {
                const owner = this.trapOwner;
                this.trapOwner = null;
                this.speed = Math.min(this.speed + 0.75, 9.5);
                this.pickNewTarget(owner && owner.isAlive ? owner : null);
                spawnShockwave(this.mesh.position, 0xff1144, 2, 16, 0.05, true);
                playSynth(660, 220, 0.2, 'sawtooth', 0.28);
            }
            updateBallTrail(this.mesh.position, this.currentColorHex);
            updateBallScreenIndicator();
            return;
        }

        // Проверка актуальности цели
        const visibleAlive = players.filter(p => p.isAlive && !p.isInvis);
        if (!this.target || !this.target.isAlive || (this.target.isInvis && visibleAlive.length > 0)) {
            this.pickNewTarget(this.lastHitBy);
            if (!this.target) return;
        }

        const goal = this.target.mesh.position.clone();
        goal.y += 0.6;
        const toGoal = new THREE.Vector3().subVectors(goal, this.mesh.position);
        const dist = toGoal.length();
        const dirToGoal = dist > 0.001 ? toGoal.clone().divideScalar(dist) : new THREE.Vector3(0, 0, 1);

        if (this.curveTimer > 0) {
            this.curveTimer--;
            const desiredVel = dirToGoal.multiplyScalar(this.speed);
            this.vel.lerp(desiredVel, 0.14);
            this.mesh.position.add(this.vel);
        } else if (this.aeroTimer > 0) {
            this.aeroTimer--;
            this.aeroAngle += 0.26;
            const side = new THREE.Vector3(-dirToGoal.z, 0, dirToGoal.x);
            const curveStrength = Math.min(1, dist / 28) * 1.15;
            const moveDir = dirToGoal.clone().addScaledVector(side, Math.sin(this.aeroAngle) * curveStrength).normalize();
            this.vel.copy(moveDir).multiplyScalar(this.speed);
            this.mesh.position.add(this.vel);
        } else {
            const steer = Math.min(0.42, 0.18 + this.speed * 0.03);
            const desiredVel = dirToGoal.multiplyScalar(this.speed);
            if (this.vel.lengthSq() < 0.01) this.vel.copy(desiredVel);
            else this.vel.lerp(desiredVel, steer).setLength(this.speed);
            this.mesh.position.add(this.vel);
        }

        if (this.mesh.position.y < 2.6) this.mesh.position.y = 2.6;

        updateBallTrail(this.mesh.position, this.currentColorHex);
        updateBallScreenIndicator();

        // Попадание по цели
        const hitDist = this.mesh.position.distanceTo(goal);
        if (hitDist < 4.5 && this.selfBounceGrace <= 0) {
            const victim = this.target;

            // Absolute Confidence авто-отбитие при столкновении
            if (victim.absConfTimer > 0) {
                victim.absConfTimer = 0;
                playClashSound(this.speed + 1.0);
                victim.applyStandardParryBoost();
                this.speed = Math.min(this.speed + 0.55, 9.6);
                victim.triggerParryImpactVFX(this.mesh.position.clone(), 0xff1133);
                this.pickNewTarget(victim);
                return;
            }

            victim.setTargetHighlight(false);
            const wasGolden = this.goldenBall;
            const hitter = this.lastHitBy;

            if (wasGolden && hitter === mainPlayer && victim.isBot && gameState === 'playing') {
                const bonus = isX2Active() ? 30 : 15;
                gameData.coins += bonus;
                saveGame();
                showStatus(`GOLDEN BALL: +${bonus} МОНЕТ`, '#ffd700', 1400);
            }

            // Эффект пассивки Martyr при гибели
            if (victim.getCurrentAbility() === 'martyr') {
                players.forEach(p => {
                    if (p.isAlive && p !== victim && p.mesh.position.distanceTo(victim.mesh.position) < 42) {
                        p.martyrSlowTimer = 210;
                    }
                });
                spawnShockwave(victim.mesh.position.clone(), 0xaa22ff, 2, 34, 0.04, true);
            }

            victim.die();

            if (isCombatState()) {
                this.spawn(gameState === 'test' ? TEST_Z : 0);
            }
        }
    }
};

// ==========================================
// TRAINING ZONE (LOBBY)
// ==========================================
const trainingBallMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.1, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x00ffaa })
);
trainingBallMesh.visible = false;
scene.add(trainingBallMesh);

const training = {
    active: false,
    goingToPlayer: true,
    speed: 0.75,
    streak: 0,
    ballMesh: trainingBallMesh,

    reset: function() {
        this.active = false;
        this.goingToPlayer = true;
        this.speed = 0.75;
        this.streak = 0;
        this.ballMesh.visible = false;
    },

    onPlayerParry: function() {
        this.goingToPlayer = false;
        this.streak++;
        this.speed = Math.min(4.8, this.speed + 0.16);
        playClashSound(this.speed);
        spawnShockwave(this.ballMesh.position.clone(), 0x00ffaa, 1.5, 11, 0.07, true);
        spawnSparks(this.ballMesh.position.clone(), 0x00ffaa, 12, 0.9);
        showStatus(`СЕРИЯ ОТБИТИЙ: ${this.streak}`, '#00ffaa', 1100);
    },

    update: function() {
        if (gameState !== 'lobby' || !mainPlayer || !mainPlayer.isAlive) {
            if (this.active) this.reset();
            return;
        }

        const p = mainPlayer.mesh.position;
        const inZone = p.x >= TRAIN_X_MIN && p.x <= TRAIN_X_MAX && p.z >= TRAIN_Z_MIN && p.z <= TRAIN_Z_MAX;

        if (!inZone) {
            if (this.active) this.reset();
            return;
        }

        if (!this.active) {
            this.active = true;
            this.goingToPlayer = true;
            this.speed = 0.75;
            this.streak = 0;
            this.ballMesh.position.copy(TRAIN_TARGET_POS);
            this.ballMesh.visible = true;
            showStatus('ЗОНА ТРЕНИРОВКИ', '#00ffaa', 1200);
        }

        const dest = this.goingToPlayer ? p.clone().add(new THREE.Vector3(0, 0.8, 0)) : TRAIN_TARGET_POS;
        const toDest = new THREE.Vector3().subVectors(dest, this.ballMesh.position);
        const dist = toDest.length();

        if (dist <= this.speed + 2.4) {
            if (this.goingToPlayer) {
                // Игрок пропустил мяч
                spawnSparks(this.ballMesh.position.clone(), 0xff3344, 14, 1.0);
                playSynth(180, 80, 0.2, 'sawtooth', 0.25);
                showStatus(`ПРОМАХ! СЕРИЯ: ${this.streak}`, '#ff4455', 1200);
                this.streak = 0;
                this.speed = 0.75;
                this.ballMesh.position.copy(TRAIN_TARGET_POS);
            } else {
                // Отскок от мишени обратно к игроку
                this.goingToPlayer = true;
                spawnShockwave(TRAIN_TARGET_POS, 0x00ffaa, 1.5, 10, 0.08, false, 0);
                playSynth(420, 620, 0.1, 'sine', 0.18);
            }
        } else {
            this.ballMesh.position.addScaledVector(toDest.normalize(), this.speed);
        }
    }
};

// ==========================================
// TEST ARENA & MATCH / LOBBY LIFECYCLE
// ==========================================
function clearAllEntities() {
    clearWorldAbilityObjects();
    players.forEach(p => {
        scene.remove(p.mesh);
        scene.remove(p.platformMesh);
    });
    players.length = 0;
    mainPlayer = null;
}

function clearTestRespawnTimers() {
    testState.respawnTimers.forEach(id => clearTimeout(id));
    testState.respawnTimers.length = 0;
}

function spawnTestBot(slot = 0) {
    const bot = new Entity({
        name: slot === 0 ? 'Bot_Alpha' : 'Bot_Beta',
        tier: 'pro',
        kills: 0,
        ability: 'dash',
        sword: 'default',
        isTestBot: true,
        testSlot: slot,
        skin: { head: 0x00ddff, torso: 0x1a2d55, arms: 0x162444, legs: 0x0e1830, acc: 'visor' }
    }, true);
    bot.mesh.position.set(slot === 0 ? -24 : 24, bot.baseY, TEST_Z - 26);
    bot.targetWalkPos.copy(bot.mesh.position);
    return bot;
}

function enterTestArena() {
    clearInterval(lobbyTimerHandle);
    lobbyTimerHandle = null;
    clearTestRespawnTimers();
    training.reset();
    clearAllEntities();

    gameState = 'test';
    testState.kills = 0;
    testState.ability = gameData.equippedAbility;
    testState.sword = gameData.equippedSword;

    mainPlayer = new Entity({
        name: 'Player',
        skin: { head: 0x00ccff, torso: 0x0077ff, arms: 0x0066dd, legs: 0x004499, acc: 'none' }
    }, false);
    mainPlayer.mesh.position.set(0, mainPlayer.baseY, TEST_Z + 44);
    mainPlayer.equipSword(testState.sword);
    snapCamera(0, 1.08);

    spawnTestBot(0);
    spawnTestBot(1);
    ball.spawn(TEST_Z);

    const testHud = document.getElementById('testArenaHud');
    if (testHud) testHud.style.display = 'flex';
    const lobbyHud = document.getElementById('lobbyHud');
    if (lobbyHud) lobbyHud.style.display = 'none';
    const matchHud = document.getElementById('matchHud');
    if (matchHud) matchHud.style.display = 'none';

    updateAbilityHudIcon();
    showToast('СЕКРЕТНАЯ ТЕСТ-АРЕНА');
}

function exitTestArena() {
    clearTestRespawnTimers();
    const testHud = document.getElementById('testArenaHud');
    if (testHud) testHud.style.display = 'none';
    returnToLobby();
}

function spawnLobbyEntities() {
    clearAllEntities();
    mainPlayer = new Entity({
        name: 'Player',
        skin: { head: 0x00ccff, torso: 0x0077ff, arms: 0x0066dd, legs: 0x004499, acc: 'none' }
    }, false);
    mainPlayer.mesh.position.set(0, mainPlayer.baseY, LOBBY_Z - 4);
    mainPlayer.equipSword(gameData.equippedSword);
    snapCamera(Math.PI, 1.08);

    if (Array.isArray(serverRoster)) {
        serverRoster.forEach(botProfile => {
            const b = new Entity(botProfile, true);
            b.mesh.position.set(-24 + Math.random() * 80, b.baseY, LOBBY_Z - 48 + Math.random() * 96);
            b.targetWalkPos.copy(b.mesh.position);
        });
    }
    updateAbilityHudIcon();
    updateLeaderboards3D();
}

function startLobbyCountdown() {
    clearInterval(lobbyTimerHandle);
    lobbyTime = 15;
    const timerEl = document.getElementById('lobbyTimer');
    if (timerEl) timerEl.innerText = lobbyTime;

    lobbyTimerHandle = setInterval(() => {
        if (gameState !== 'lobby') {
            clearInterval(lobbyTimerHandle);
            lobbyTimerHandle = null;
            return;
        }
        lobbyTime--;
        if (timerEl) timerEl.innerText = Math.max(0, lobbyTime);
        if (lobbyTime <= 0) {
            clearInterval(lobbyTimerHandle);
            lobbyTimerHandle = null;
            startMatch();
        }
    }, 1000);
}

function startMatch() {
    training.reset();
    clearWorldAbilityObjects();
    gameState = 'playing';
    matchKills = 0;

    const total = players.length;
    players.forEach((p, idx) => {
        const angle = (idx / Math.max(1, total)) * Math.PI * 2;
        const radius = 64;
        p.isAlive = true;
        p.velY = 0;
        p.jumpsLeft = p.getMaxJumps();
        p.blockCooldown = 0;
        p.parryActiveTimer = 0;
        p.abilityReadyAt = 0;
        p.reaperStacks = 0;
        p.blinkCharges = 3;
        p.galeCharges = 2;
        p.stripActiveBuffs();
        p.stunTimer = 0;
        p.virusTimer = 0;
        p.scopoTimer = 0;
        p.silencedTimer = 0;
        p.martyrSlowTimer = 0;
        p.setTargetHighlight(false);
        p.mesh.position.set(Math.cos(angle) * radius, p.baseY, Math.sin(angle) * radius);
        p.mesh.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));
    });

    if (mainPlayer) {
        mainPlayer.ability = gameData.equippedAbility;
        mainPlayer.equipSword(gameData.equippedSword);
        snapCamera(mainPlayer.mesh.rotation.y + Math.PI, 1.08);
    }

    const aliveEl = document.getElementById('aliveCount');
    if (aliveEl) aliveEl.innerText = players.length;
    const lobbyHud = document.getElementById('lobbyHud');
    if (lobbyHud) lobbyHud.style.display = 'none';
    const matchHud = document.getElementById('matchHud');
    if (matchHud) matchHud.style.display = 'flex';
    const overEl = document.getElementById('gameOver');
    if (overEl) overEl.style.display = 'none';

    updateAbilityHudIcon();
    ball.spawn(0);
    showStatus('РАУНД НАЧАЛСЯ!', '#00eeff', 1500);
}

function returnToLobby() {
    clearTestRespawnTimers();
    stopAllTouchControls();
    hideStatus();
    hideBlockCdOverlay();
    ball.mesh.visible = false;
    ball.target = null;
    ballGroundRing.visible = false;
    resetBallTrail();
    dangerVignetteEl.classList.remove('active');
    ballArrowEl.style.display = 'none';

    gameState = 'lobby';
    const overEl = document.getElementById('gameOver');
    if (overEl) overEl.style.display = 'none';
    const matchHud = document.getElementById('matchHud');
    if (matchHud) matchHud.style.display = 'none';
    const testHud = document.getElementById('testArenaHud');
    if (testHud) testHud.style.display = 'none';
    const lobbyHud = document.getElementById('lobbyHud');
    if (lobbyHud) lobbyHud.style.display = 'flex';

    spawnLobbyEntities();
    startLobbyCountdown();
}

// ==========================================
// MAIN PLAYER INPUT, CAMERA & GAME LOOP
// ==========================================
const keysDown = {};
window.addEventListener('keydown', (e) => { keysDown[e.code] = true; });
window.addEventListener('keyup', (e) => { keysDown[e.code] = false; });

const _camForward = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camLookTarget = new THREE.Vector3();

function updateMainPlayer() {
    if (!mainPlayer || !mainPlayer.isAlive) return;

    mainPlayer.updateBuffTimers();
    mainPlayer.updateVerticalPhysics();
    mainPlayer.updateParryLogic();

    if (mainPlayer.isPlatformActive && isCombatState()) {
        mainPlayer.mesh.position.y = Math.min(28, mainPlayer.mesh.position.y + 0.8);
        mainPlayer.platformMesh.position.set(mainPlayer.mesh.position.x, mainPlayer.mesh.position.y - 7, mainPlayer.mesh.position.z);
    }

    camera.getWorldDirection(_camForward);
    _camForward.y = 0;
    if (_camForward.lengthSq() < 0.0001) _camForward.set(0, 0, -1);
    _camForward.normalize();
    _camRight.set(-_camForward.z, 0, _camForward.x);

    let inputX = joyX;
    let inputY = joyY;
    if (keysDown['KeyW'] || keysDown['ArrowUp']) inputY -= 1;
    if (keysDown['KeyS'] || keysDown['ArrowDown']) inputY += 1;
    if (keysDown['KeyA'] || keysDown['ArrowLeft']) inputX -= 1;
    if (keysDown['KeyD'] || keysDown['ArrowRight']) inputX += 1;

    const len = Math.hypot(inputX, inputY);
    const spd = mainPlayer.getMoveSpeed();
    let movingNow = false;

    if (len > 0.08 && spd > 0) {
        if (len > 1) { inputX /= len; inputY /= len; }
        moveX = (_camForward.x * (-inputY)) + (_camRight.x * inputX);
        moveZ = (_camForward.z * (-inputY)) + (_camRight.z * inputX);
        mainPlayer.mesh.position.x += moveX * spd;
        mainPlayer.mesh.position.z += moveZ * spd;
        mainPlayer.clampBounds();
        movingNow = true;
    } else {
        moveX = 0;
        moveZ = 0;
    }

    if (shiftLockActive) {
        mainPlayer.mesh.rotation.y = Math.atan2(_camForward.x, _camForward.z);
    } else if (movingNow) {
        mainPlayer.mesh.rotation.y = Math.atan2(moveX, moveZ);
    }

    mainPlayer.animateWalk(movingNow);

    // Обновление HUD-оверлеев КД блока и абилки
    const blockOverlay = document.getElementById('blockCdOverlay');
    if (blockOverlay) {
        if (mainPlayer.blockCooldown > 0 && mainPlayer.parryActiveTimer === 0) {
            blockOverlay.style.display = 'flex';
            blockOverlay.innerText = (mainPlayer.blockCooldown / 60).toFixed(1);
        } else {
            blockOverlay.style.display = 'none';
        }
    }

    const abOverlay = document.getElementById('abCdOverlay');
    if (abOverlay) {
        const remMs = mainPlayer.abilityReadyAt - Date.now();
        if (remMs > 0 && isCombatState()) {
            abOverlay.style.display = 'flex';
            abOverlay.innerText = Math.ceil(remMs / 1000);
        } else {
            abOverlay.style.display = 'none';
        }
    }

    // Подсказка колеса фортуны в лобби
    const wheelBtn = document.getElementById('btnWheelPrompt');
    if (wheelBtn) {
        const onWheelPad = gameState === 'lobby' && mainPlayer.mesh.position.distanceTo(WHEEL_PAD_POS) < 16;
        wheelBtn.style.display = onWheelPad ? 'block' : 'none';
    }
}

function updateCamera() {
    if (!mainPlayer) return;
    camThetaSmooth += (camTheta - camThetaSmooth) * 0.22;
    camPhiSmooth += (camPhi - camPhiSmooth) * 0.22;

    targetFov += (62 - targetFov) * 0.08;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
        camera.fov += (targetFov - camera.fov) * 0.18;
        camera.updateProjectionMatrix();
    }

    const p = mainPlayer.mesh.position;
    let offsetX = Math.sin(camThetaSmooth) * Math.sin(camPhiSmooth) * camRadius;
    let offsetY = Math.cos(camPhiSmooth) * camRadius + 6;
    let offsetZ = Math.cos(camThetaSmooth) * Math.sin(camPhiSmooth) * camRadius;

    _camLookTarget.set(p.x, p.y + 3.2, p.z);

    if (shiftLockActive) {
        const sideX = Math.cos(camThetaSmooth) * 4.2;
        const sideZ = -Math.sin(camThetaSmooth) * 4.2;
        offsetX += sideX;
        offsetZ += sideZ;
        _camLookTarget.x += sideX;
        _camLookTarget.z += sideZ;
    }

    let shakeX = 0, shakeY = 0;
    if (camShake > 0.02) {
        shakeX = (Math.random() - 0.5) * camShake;
        shakeY = (Math.random() - 0.5) * camShake;
        camShake *= 0.84;
    } else {
        camShake = 0;
    }

    camera.position.set(p.x + offsetX + shakeX, Math.max(2.5, p.y + offsetY + shakeY), p.z + offsetZ);
    camera.lookAt(_camLookTarget);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

function animate() {
    requestAnimationFrame(animate);

    updateMainPlayer();
    for (let i = 0; i < players.length; i++) {
        if (players[i].isBot) players[i].updateAI();
    }
    updateWorldAbilityObjects();
    ball.update();
    training.update();
    updateVFX();
    updateCamera();

    if (composer && gfxSettings.bloom !== false) {
        composer.render();
    } else {
        renderer.render(scene, camera);
    }
}

// Старт игры
saveGame();
spawnLobbyEntities();
startLobbyCountdown();
animate();

