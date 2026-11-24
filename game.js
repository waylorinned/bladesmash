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
    if (ab.charges && mainPlayer) {
        badge.style.display = 'block';
        badge.innerText = mainPlayer.blinkCharges;
    } else if (ab.id === 'reaper' && mainPlayer && isCombatState()) {
        badge.style.display = 'block';
        badge.innerText = `x${mainPlayer.reaperStacks}`;
    } else {
        badge.style.display = 'none';
    }
}

// Audio
let audioCtx = null;
let audioCtxUnlocked = false;
let musicPlaying = false;
let audioUnlockInFlight = false;
const soundBuffers = { smash: null, kill: null };

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
            const a = list[idx];
            idx = (idx + 1) % list.length;
            try {
                a.pause(); a.currentTime = 0;
                a.volume = volume; a.playbackRate = rate;
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
    if (audioCtx && soundBuffers[key]) {
        try {
            if (audioCtx.state === 'suspended') audioCtx.resume();
            const src = audioCtx.createBufferSource();
            const gain = audioCtx.createGain();
            src.buffer = soundBuffers[key];
            src.playbackRate.value = rate;
            gain.gain.value = volume;
            src.connect(gain); gain.connect(audioCtx.destination);
            src.start(0);
            return;
        } catch (e) {}
    }
    if (fallbackPool) fallbackPool.play(volume, rate);
}

function playClashSound(speed) {
    const rate = Math.min(1.9, Math.max(0.95, 1.0 + ((speed - 0.85) / 8.5)));
    playBuffer('smash', 0.95, rate, smashPool);
}
function playKillSound() { playBuffer('kill', 1.0, 1.0, killPool); }

function playSynth(freq1, freq2, dur, type = 'sine', vol = 0.28) {
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = type;
        osc.frequency.setValueAtTime(freq1, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), audioCtx.currentTime + dur);
        gain.gain.setValueAtTime(vol, audioCtx.currentTime);
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

function playRandomMusic() {
    if (unplayedIndices.length === 0) {
        unplayedIndices = [0, 1, 2].filter(i => i !== currentTrackIndex);
    }
    const pickPos = Math.floor(Math.random() * unplayedIndices.length);
    currentTrackIndex = unplayedIndices.splice(pickPos, 1)[0];
    const track = musicTracks[currentTrackIndex];
    if (!track) return Promise.reject();
    track.currentTime = 0;
    track.volume = 0.4;
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

// Scene & renderer
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
// VFX ENGINE
// ==========================================
const vfxList = [];
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
// SMOOTH CAMERA & FLOATING DYNAMIC JOYSTICK
// ==========================================
let camTheta = Math.PI, camPhi = 1.08, camRadius = 42;
let camThetaSmooth = camTheta, camPhiSmooth = camPhi;
let isCamDragging = false, lastTouchX = 0, lastTouchY = 0, camTouchId = null;

let joyX = 0, joyY = 0;
let moveX = 0, moveZ = 0, isMoving = false;
let joyActive = false, joyStart = { x: 0, y: 0 }, joyTouchId = null;
const maxJoy = 34;

const camZone = document.getElementById('camera-zone');
const knob = document.getElementById('joystick-knob');
const zone = document.getElementById('joystick-zone');

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
        // Left 42% of screen always controls floating joystick, never hijacks camera
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
            camTheta -= dcx * 0.0065;
            camPhi -= dcy * 0.0042;
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
// ENTITIES
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
        this.baseSpeed = isBot ? (this.tier === 'sweat' ? 0.46 : (this.tier === 'pro' ? 0.42 : 0.36)) : 0.58;

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
        this.rapturePoseTimer = 0;
        this.blinkCharges = 3;
        this.reaperStacks = 0;
        this.isPlatformActive = false;
        this.walkCycle = Math.random() * 10;
        this.parryDecided = false;
        this.currentReactionMs = 240;

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

    getMoveSpeed() {
        if (this.stunTimer > 0) return 0;
        let spd = this.baseSpeed;
        if (this.shadowTimer > 0) spd *= 2.05;
        if (this.windTimer > 0) spd *= 1.48;
        if (this.getCurrentAbility() === 'reaper' && this.reaperStacks > 0) {
            spd *= (1 + this.reaperStacks * 0.11);
        }
        return spd;
    }

    jump() {
        if (!this.isAlive || this.stunTimer > 0 || this.isPlatformActive) return;
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
        const type = this.getCurrentAbility();
        const abInfo = ABILITIES.find(a => a.id === type);
        if (!abInfo || abInfo.passive) return false;
        const ignoreCd = (!this.isBot && gameState === 'test' && testState.noCd);
        if (!ignoreCd && Date.now() < this.abilityReadyAt) return false;

        const cdMs = ignoreCd ? 250 : abInfo.cd * 1000;
        const rotY = this.mesh.rotation.y;
        const lookDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY));
        const startPos = this.mesh.position.clone();

        if (type === 'dash') {
            if (!this.isBot) { playSynth(320, 90, 0.2, 'sine', 0.3); targetFov = 71; }
            spawnShockwave(startPos, 0x00ccff, 2, 10, 0.08, false, rotY);
            spawnAfterimage(startPos, 0x00aaff);
            this.mesh.position.add(lookDir.multiplyScalar(32));
            this.clampBounds();
            spawnSparks(this.mesh.position, 0x00ccff, 10, 0.9);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'thunder_dash') {
            if (!this.isBot) { playSynth(950, 220, 0.16, 'sawtooth', 0.26); addShake(0.45); targetFov = 72; }
            this.mesh.position.add(lookDir.multiplyScalar(26));
            this.clampBounds();
            spawnLightning(startPos, this.mesh.position.clone(), 0xffdd00, 4);
            spawnShockwave(this.mesh.position, 0xffdd00, 2, 13, 0.07, true);
            spawnSparks(this.mesh.position, 0xffee44, 16, 1.1);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'blink') {
            if (!this.isBot) playSynth(700, 1250, 0.12, 'triangle', 0.25);
            spawnShockwave(startPos, 0x00eeff, 2, 9, 0.08, false, rotY);
            spawnAfterimage(startPos, 0x00eeff);
            this.mesh.position.add(lookDir.multiplyScalar(23));
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
            const aliveCount = players.filter(p => p.isAlive).length;
            this.forcefieldMax = aliveCount <= 2 ? 180 : 420;
            this.forcefieldTimer = this.forcefieldMax;
            spawnShockwave(startPos, 0xff5522, 2, 14, 0.06, true);
            if (!this.isBot) playSynth(300, 640, 0.28, 'sine', 0.3);
            this.abilityReadyAt = Date.now() + cdMs;
        } else if (type === 'raging_deflect') {
            this.abilityReadyAt = Date.now() + cdMs;
            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const range = 22 + (ball.speed * 3.2);
            if (ball.target === this && distToBall < range && ball.selfBounceGrace <= 0) {
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
        } else if (type === 'rapture') {
            this.abilityReadyAt = Date.now() + cdMs;
            const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
            const range = 22 + (ball.speed * 3.2);
            if (ball.target === this && distToBall < range && ball.selfBounceGrace <= 0) {
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

    updateParryLogic() {
        if (this.forcefieldTimer > 0 && isCombatState() && ball.target === this && ball.selfBounceGrace <= 0) {
            if (this.mesh.position.distanceTo(ball.mesh.position) < 14 + ball.speed * 1.5) {
                playClashSound(ball.speed);
                ball.unfreeze();
                ball.speed = Math.min(ball.speed + 0.32, 8.8);
                ball.raptureBoost = false;
                this.triggerParryImpactVFX(ball.mesh.position.clone(), 0xff6622);
                ball.pickNewTarget(this);
                return;
            }
        }

        if (this.parryActiveTimer > 0) {
            this.parryActiveTimer--;
            this.rArmGroup.rotation.x = -Math.PI / 1.5;

            if (isCombatState() && ball.target === this && ball.selfBounceGrace <= 0) {
                const parryRange = 15 + (ball.speed * 2.5);
                if (this.mesh.position.distanceTo(ball.mesh.position) < parryRange) {
                    playClashSound(ball.speed);
                    ball.unfreeze();
                    const reaperBonus = (this.getCurrentAbility() === 'reaper') ? this.reaperStacks * 0.16 : 0;
                    ball.speed = Math.min(ball.speed + 0.32 + reaperBonus, 9.2);
                    ball.raptureBoost = false;
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

    rollHumanReactionMs() {
        if (this.isTestBot) return 90;
        if (this.tier === 'sweat') return 115 + Math.random() * 65;
        if (this.tier === 'pro') return 150 + Math.random() * 75;
        if (this.tier === 'mid') return 215 + Math.random() * 105;
        return 295 + Math.random() * 150;
    }

    updateAI() {
        if (!this.isAlive || !this.isBot) return;
        this.updateBuffTimers();
        this.updateVerticalPhysics();
        this.updateParryLogic();

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

            if (ball.target === this) {
                if (mainPlayer && mainPlayer.isAlive && this.stunTimer <= 0) {
                    const toPlayer = new THREE.Vector3().subVectors(mainPlayer.mesh.position, this.mesh.position);
                    this.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
                }
                const distToBall = this.mesh.position.distanceTo(ball.mesh.position);
                const parryRange = 14 + (ball.speed * 2.5);
                if (distToBall < parryRange && !this.parryDecided) {
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

        const inLobby = (gameState === 'lobby');
        if (this.mesh.position.distanceTo(this.targetWalkPos) < 5 || Math.random() < 0.012) {
            if (inLobby) {
                this.targetWalkPos.set(-28 + Math.random() * 90, this.baseY, LOBBY_Z - 55 + Math.random() * 110);
            } else {
                this.targetWalkPos.set((Math.random() - 0.5) * 180, this.baseY, (Math.random() - 0.5) * 180);
            }
        }

        const spd = this.getMoveSpeed();
        let moving = false;
        if (spd > 0) {
            const walkDir = new THREE.Vector3().subVectors(this.targetWalkPos, this.mesh.position);
            if (walkDir.length() > 1.2) {
                walkDir.y = 0; walkDir.normalize();
                this.mesh.position.add(walkDir.multiplyScalar(spd * 0.78));
                this.mesh.rotation.y = Math.atan2(walkDir.x, walkDir.z);
                moving = true;
            }
            if (Math.random() < 0.004) this.jump();
        }
        this.animateWalk(moving);

        if (gameState !== 'playing') return;

        const aliveCount = players.filter(p => p.isAlive).length;
        const ab = this.ability;

        if (Date.now() >= this.abilityReadyAt && this.stunTimer <= 0) {
            if (ab === 'invis' && aliveCount === 2 && !this.isInvis && ball.target !== this && Math.random() < 0.025) {
                this.activateAbility();
            } else if (ab === 'freeze' && ball.frozenTimer <= 0 && ball.speed > 1.5 && Math.random() < 0.008) {
                this.activateAbility();
            } else if ((ab === 'wind_cloak' || ab === 'shadow_step') && Math.random() < 0.005) {
                this.activateAbility();
            }
        }

        if (ball.target === this) {
            const elapsedSinceSwitch = performance.now() - ball.targetSetTime;
            if (elapsedSinceSwitch < this.currentReactionMs) return;

            const toBall = new THREE.Vector3().subVectors(ball.mesh.position, this.mesh.position);
            if (this.stunTimer <= 0) this.mesh.rotation.y = Math.atan2(toBall.x, toBall.z);

            const distToBall = toBall.length();
            const parryRange = 15 + (ball.speed * 2.5);
            const reactionZone = parryRange + (ball.speed * 6.5);

            if ((ab === 'rapture' || ab === 'raging_deflect') && Date.now() >= this.abilityReadyAt && this.stunTimer <= 0) {
                if (distToBall < 22 + ball.speed * 3.2 && !this.parryDecided) {
                    const useChance = (aliveCount === 2 || ball.speed > 1.8) ? 0.7 : 0.42;
                    if (Math.random() < useChance) {
                        this.parryDecided = true;
                        this.activateAbility();
                        return;
                    }
                }
            }

            if (ab !== 'rapture' && ab !== 'raging_deflect' && Date.now() >= this.abilityReadyAt && this.stunTimer <= 0) {
                if (distToBall < reactionZone * 1.45 && Math.random() < (ab === 'forcefield' ? 0.09 : 0.04)) {
                    this.activateAbility();
                    if (this.isInvis || this.forcefieldTimer > 0) return;
                }
            }

            if (distToBall < reactionZone && !this.parryDecided && this.forcefieldTimer <= 0) {
                this.parryDecided = true;
                let baseAcc = this.tier === 'sweat' ? 0.94 : (this.tier === 'pro' ? 0.89 : (this.tier === 'mid' ? 0.79 : 0.65));
                let speedPenalty = ball.speed * (this.tier === 'sweat' ? 0.036 : (this.tier === 'pro' ? 0.045 : (this.tier === 'mid' ? 0.060 : 0.078)));
                let successChance = Math.max(0.16, baseAcc - speedPenalty);
                if (ball.raptureBoost) successChance *= (this.tier === 'sweat' ? 0.62 : (this.tier === 'pro' ? 0.50 : 0.34));

                if (Math.random() < successChance) {
                    const jitter = this.tier === 'sweat' ? Math.random() * 35 : (this.tier === 'pro' ? Math.random() * 50 : Math.random() * 95);
                    setTimeout(() => { if (this.isAlive && ball.target === this) this.tryParry(); }, jitter);
                } else if (Math.random() > 0.42) {
                    this.tryParry();
                }
            }
        } else {
            this.parryDecided = false;
        }
    }
}

// ==========================================
// BALL + SMART TARGETING + COMET TRAIL + SCREEN INDICATOR
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
    ballArrowEl.style.borderBottomColor = targetingMe ? '#ff1122' : '#00ddff';
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
    selfBounceGrace: 0,
    frozenTimer: 0,
    currentColorHex: 0x00eeff,

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

    updateVisualColor: function() {
        let col = 0x00ddff;
        let coreCol = 0xffffff;
        if (this.frozenTimer > 0) {
            col = 0x00eeff; coreCol = 0xd8ffff;
        } else if (this.raptureBoost && this.curveTimer > 0) {
            col = this.target === mainPlayer ? 0xff1100 : 0xff5500;
            coreCol = 0xffeeaa;
        } else if (this.target === mainPlayer) {
            col = 0xff1122; coreCol = 0xffdddd;
        }
        this.currentColorHex = col;
        ballCoreMat.color.setHex(coreCol);
        ballShellMat.color.setHex(col);
        ballGlowSpriteMat.color.setHex(col);
        ballPointLight.color.setHex(col);
        ballGroundMat.color.setHex(col);
    },

    selectSmartTarget: function(hitByEntity, candidates) {
        if (candidates.length === 1) return [candidates[0]];

        if (!hitByEntity) {
            return candidates.slice().sort(() => Math.random() - 0.5);
        }

        if (hitByEntity === mainPlayer) {
            camera.getWorldDirection(_aimDir);
            _aimDir.y = 0;
            if (_aimDir.lengthSq() < 0.0001) {
                _aimDir.set(Math.sin(hitByEntity.mesh.rotation.y), 0, Math.cos(hitByEntity.mesh.rotation.y));
            }
            _aimDir.normalize();
        } else {
            _aimDir.set(Math.sin(hitByEntity.mesh.rotation.y), 0, Math.cos(hitByEntity.mesh.rotation.y)).normalize();
        }

        const scored = candidates.map(c => {
            _toCand.subVectors(c.mesh.position, hitByEntity.mesh.position);
            _toCand.y = 0;
            const dist = Math.max(0.1, _toCand.length());
            const dot = _aimDir.dot(_toCand.divideScalar(dist));

            const aimScore = Math.pow(Math.max(0, (dot + 1) * 0.5), 2.5) * 1.45;
            const distScore = 30 / (dist + 10);
            const closeBonus = dist < 26 ? ((26 - dist) / 26) * 1.65 : 0;
            const score = aimScore + distScore + closeBonus + Math.random() * 0.14;
            return { entity: c, score };
        });

        scored.sort((a, b) => b.score - a.score);
        return scored.map(s => s.entity);
    },

    pickNewTarget: function(hitByEntity) {
        this.lastHitBy = hitByEntity;
        if (this.target && this.target.isAlive) this.target.setTargetHighlight(false);

        const visibleOthers = players.filter(p => p.isAlive && p !== hitByEntity && !p.isInvis);

        if (visibleOthers.length > 0) {
            const ranked = this.selectSmartTarget(hitByEntity, visibleOthers);
            let chosen = ranked[0];

            const aliveTotal = players.filter(p => p.isAlive).length;
            if (aliveTotal > 2 && ranked.length > 1 && chosen.getCurrentAbility() === 'luck' && Math.random() < 0.25) {
                if (chosen === mainPlayer) {
                    playSynth(600, 1100, 0.2, 'sine', 0.25);
                    showStatus('УДАЧА ОТВЕЛА МЯЧ', '#00ff66', 1300);
                    spawnShockwave(chosen.mesh.position, 0x00ff66, 2, 13, 0.06, true);
                }
                chosen = ranked[1];
            }

            this.target = chosen;
            this.selfBounceGrace = 0;
        } else if (hitByEntity && hitByEntity.isAlive && !hitByEntity.isInvis) {
            this.target = hitByEntity;
            this.selfBounceGrace = 20;
            this.curveTimer = Math.max(this.curveTimer, 28);
            const rotY = hitByEntity.mesh.rotation.y;
            const outDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).normalize();
            this.vel.copy(outDir).multiplyScalar(Math.max(this.speed * 1.15, 1.8));
            this.vel.y = Math.max(this.speed * 0.55, 1.0);
        } else {
            this.target = null;
            this.updateVisualColor();
            return;
        }

        this.targetSetTime = performance.now();
        this.target.setTargetHighlight(true);
        if (this.target.isBot) {
            this.target.parryDecided = false;
            this.target.currentReactionMs = this.target.rollHumanReactionMs();
        }
        this.updateVisualColor();
    },

    triggerRagingDeflect: function(caster) {
        this.unfreeze();
        this.raptureBoost = true;
        this.curveTimer = 26;
        this.speed = Math.min(Math.max(this.speed * 1.95, 2.2), 9.2);
        this.pickNewTarget(caster);
        spawnShockwave(caster.mesh.position, 0xff1133, 2, 20, 0.05, true);
        spawnSparks(caster.mesh.position, 0xff2244, 24, 1.4);
        if (this.target && this.target !== caster) {
            this.target.stunTimer = 90;
            spawnLightning(caster.mesh.position, this.target.mesh.position, 0xff2244, 4);
            if (this.target === mainPlayer) {
                showStatus('ОГЛУШЕНИЕ 1.5с', '#ff2244', 1400);
            }
        }
        if (this.target) {
            const dir = new THREE.Vector3().subVectors(this.target.mesh.position, this.mesh.position).normalize();
            this.vel.copy(dir).multiplyScalar(this.speed);
        }
        this.updateVisualColor();
    },

    triggerRaptureLaunch: function(caster) {
        this.unfreeze();
        this.raptureBoost = true;
        this.curveTimer = 42;
        this.speed = Math.min(Math.max(this.speed * 2.65, 2.6), 9.6);
        this.pickNewTarget(caster);
        this.updateVisualColor();
        spawnShockwave(caster.mesh.position, 0xff5500, 2, 24, 0.045, true);
        spawnSparks(caster.mesh.position, 0xff6600, 26, 1.5);

        if (this.target) {
            if (this.target === caster) {
                this.selfBounceGrace = 24;
                this.curveTimer = 44;
                const rotY = caster.mesh.rotation.y;
                const outDir = new THREE.Vector3(Math.sin(rotY), 0, Math.cos(rotY)).normalize();
                spawnRaptureRocks(caster.mesh.position, outDir);
                this.vel.copy(outDir).multiplyScalar(this.speed * 0.75);
                this.vel.y = this.speed * 1.25;
            } else {
                const toTarget = new THREE.Vector3().subVectors(this.target.mesh.position, this.mesh.position).normalize();
                spawnRaptureRocks(caster.mesh.position, toTarget);
                this.vel.copy(toTarget).multiplyScalar(this.speed * 0.65);
                this.vel.y = this.speed * 1.15;
            }
        }
    },

    update: function() {
        if (!isCombatState()) {
            ballGroundRing.visible = false;
            return;
        }
        ballGroundRing.visible = true;
        ballGroundRing.position.x = this.mesh.position.x;
        ballGroundRing.position.z = this.mesh.position.z;
        const glowPulse = 16 + Math.sin(performance.now() * 0.02) * 2.5 + this.speed * 1.2;
        ballGlowSprite.scale.set(glowPulse, glowPulse, 1);

        if (this.selfBounceGrace > 0) this.selfBounceGrace--;

        if (this.frozenTimer > 0) {
            this.frozenTimer--;
            iceShellMesh.rotation.y += 0.05;
            iceShellMesh.rotation.x += 0.03;
            if (this.frozenTimer <= 0) {
                this.unfreeze();
                this.updateVisualColor();
            }
            return;
        }

        const centerZ = gameState === 'test' ? TEST_Z : 0;

        if (!this.target || !this.target.isAlive || this.target.isInvis) {
            this.pickNewTarget(null);
            if (!this.target) {
                this.mesh.position.lerp(new THREE.Vector3(0, 8, centerZ), 0.04);
                updateBallTrail(this.mesh.position, this.currentColorHex);
                return;
            }
        }

        const dir = new THREE.Vector3().subVectors(this.target.mesh.position, this.mesh.position);
        const dist = dir.length();

        if (this.selfBounceGrace <= 0 && dist < 6 + (this.speed * 0.55)) {
            if (this.target.parryActiveTimer > 0 || this.target.forcefieldTimer > 0) {
                playClashSound(this.speed);
                const reaperBonus = (this.target.getCurrentAbility() === 'reaper') ? this.target.reaperStacks * 0.16 : 0;
                this.speed = Math.min(this.speed + 0.32 + reaperBonus, 9.2);
                this.raptureBoost = false;
                this.curveTimer = 0;
                this.target.triggerParryImpactVFX(this.mesh.position.clone(), getSwordAccentColor(this.target.swordId));
                this.pickNewTarget(this.target);
                this.target.parryActiveTimer = 0;
                this.target.blockCooldown = 0;
            } else {
                this.target.die();
                if (!isCombatState()) return;
                this.speed = 0.85;
                this.raptureBoost = false;
                this.curveTimer = 0;
                this.selfBounceGrace = 0;
                this.unfreeze();
                resetBallTrail();
                this.mesh.position.set(0, 6, centerZ);
                this.pickNewTarget(null);
            }
        } else {
            if (this.curveTimer > 0) {
                this.curveTimer--;
                const desired = dir.clone().normalize().multiplyScalar(this.speed);
                this.vel.lerp(desired, 0.09);
                this.mesh.position.add(this.vel);
                if (this.mesh.position.y < 2.5) this.mesh.position.y = 2.5;
                if (this.curveTimer === 0) this.updateVisualColor();
            } else {
                dir.normalize();
                this.mesh.position.add(dir.multiplyScalar(this.speed));
            }
            updateBallTrail(this.mesh.position, this.currentColorHex);
        }
    }
};

// ==========================================
// TRAINING MODE
// ==========================================
const trainBallGroup = new THREE.Group();
const trainBallCoreMat = new THREE.MeshBasicMaterial({ color: 0xffdddd });
const trainBallGlowMat = new THREE.SpriteMaterial({
    map: GLOW_TEX, color: 0xff1122, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false
});
trainBallGroup.add(new THREE.Mesh(new THREE.SphereGeometry(2.2, 16, 16), trainBallCoreMat));
const trainGlowSp = new THREE.Sprite(trainBallGlowMat);
trainGlowSp.scale.set(14, 14, 1);
trainBallGroup.add(trainGlowSp);
trainBallGroup.visible = false;
scene.add(trainBallGroup);

const training = {
    active: false, goingToPlayer: true, speed: 0.9, hits: 0,
    ballMesh: trainBallGroup,

    start: function() {
        this.active = true; this.goingToPlayer = true; this.speed = 0.9; this.hits = 0;
        this.ballMesh.position.copy(TRAIN_TARGET_POS);
        trainBallGlowMat.color.setHex(0xff1122);
        this.ballMesh.visible = true;
        mainPlayer.setTargetHighlight(true);
        document.getElementById('btnBlock').style.display = 'flex';
        document.getElementById('trainingHud').style.display = 'block';
        this.updateHud();
    },
    stop: function() {
        if (!this.active) return;
        this.active = false; this.ballMesh.visible = false;
        if (mainPlayer && mainPlayer.isAlive && gameState === 'lobby') mainPlayer.setTargetHighlight(false);
        if (gameState === 'lobby') document.getElementById('btnBlock').style.display = 'none';
        document.getElementById('trainingHud').style.display = 'none';
    },
    onPlayerParry: function() {
        playClashSound(this.speed);
        this.hits++; this.speed = Math.min(this.speed + 0.35, 8.5);
        this.goingToPlayer = false;
        trainBallGlowMat.color.setHex(0x00ff88);
        mainPlayer.setTargetHighlight(false);
        spawnShockwave(this.ballMesh.position, 0x00ff88, 1.5, 11, 0.07, false, mainPlayer.mesh.rotation.y);
        spawnSparks(this.ballMesh.position, 0x00ffaa, 14, 1.0);
        addShake(0.32);
        this.updateHud();
    },
    updateHud: function() {
        document.getElementById('trainHits').innerText = this.hits;
        document.getElementById('trainSpd').innerText = this.speed.toFixed(1);
    },
    update: function() {
        if (gameState !== 'lobby' || !mainPlayer || !mainPlayer.isAlive) { this.stop(); return; }
        const p = mainPlayer.mesh.position;
        const inside = (p.x >= TRAIN_X_MIN && p.x <= TRAIN_X_MAX && p.z >= TRAIN_Z_MIN && p.z <= TRAIN_Z_MAX);
        if (inside && !this.active) this.start();
        else if (!inside && this.active) { this.stop(); return; }
        if (!this.active) return;

        const dest = this.goingToPlayer ? mainPlayer.mesh.position : TRAIN_TARGET_POS;
        const dir = new THREE.Vector3().subVectors(dest, this.ballMesh.position);
        const dist = dir.length();

        if (this.goingToPlayer) {
            if (dist < 5.5 + this.speed * 0.5) {
                if (mainPlayer.parryActiveTimer > 0) {
                    this.onPlayerParry();
                    mainPlayer.parryActiveTimer = 0; mainPlayer.blockCooldown = 0;
                } else {
                    spawnKillBeam(mainPlayer.mesh.position.clone(), mainPlayer.explosionColor);
                    this.stop();
                    mainPlayer.mesh.position.set(0, mainPlayer.baseY, LOBBY_Z - 4);
                }
            } else {
                dir.normalize(); this.ballMesh.position.add(dir.multiplyScalar(this.speed));
            }
        } else {
            if (dist < 5 + this.speed * 0.5) {
                playClashSound(this.speed * 0.8);
                spawnSparks(TRAIN_TARGET_POS, 0x00ff88, 10, 0.8);
                this.goingToPlayer = true;
                trainBallGlowMat.color.setHex(0xff1122);
                mainPlayer.setTargetHighlight(true);
            } else {
                dir.normalize(); this.ballMesh.position.add(dir.multiplyScalar(this.speed));
            }
        }
    }
};

// ==========================================
// SECRET TEST ARENA
// ==========================================
function clearTestRespawnTimers() {
    testState.respawnTimers.forEach(t => clearTimeout(t));
    testState.respawnTimers.length = 0;
}

function spawnTestBot(slot) {
    const bot = new Entity({
        name: slot === 0 ? 'TestBot_1' : 'TestBot_2',
        tier: 'sweat',
        kills: 9999,
        wins: 999,
        isTestBot: true,
        testSlot: slot,
        sword: slot === 0 ? 'prisma_blade' : 'nebula_staff',
        ability: 'dash',
        skin: slot === 0
            ? { head: 0x151520, torso: 0x6622ff, arms: 0x00eeff, legs: 0x121226, acc: 'visor' }
            : { head: 0x1a1520, torso: 0xff2255, arms: 0x222233, legs: 0x14101c, acc: 'horns' }
    }, true);
    const xPos = slot === 0 ? -24 : 24;
    bot.mesh.position.set(xPos, bot.baseY, TEST_Z - 26);
    bot.mesh.rotation.y = 0;
    bot.targetWalkPos.copy(bot.mesh.position);
    spawnShockwave(bot.mesh.position, 0x00eeff, 1.5, 11, 0.06, true);
    return bot;
}

function initTestPanelControls() {
    const abSel = document.getElementById('testAbSelect');
    const swSel = document.getElementById('testSwSelect');
    abSel.innerHTML = '';
    swSel.innerHTML = '';

    ABILITIES.forEach(ab => {
        const opt = document.createElement('option');
        opt.value = ab.id;
        opt.textContent = ab.name;
        abSel.appendChild(opt);
    });
    SWORDS.forEach(sw => {
        const opt = document.createElement('option');
        opt.value = sw.id;
        opt.textContent = sw.name;
        swSel.appendChild(opt);
    });

    abSel.addEventListener('change', (e) => {
        testState.ability = e.target.value;
        if (mainPlayer) {
            mainPlayer.abilityReadyAt = 0;
            mainPlayer.blinkCharges = 3;
            mainPlayer.reaperStacks = 0;
            mainPlayer.isPlatformActive = false;
            mainPlayer.platformMesh.visible = false;
            mainPlayer.jumpsLeft = mainPlayer.getMaxJumps();
        }
        document.getElementById('platformControls').style.display = (testState.ability === 'platform') ? 'flex' : 'none';
        updateAbilityHudIcon();
    });

    swSel.addEventListener('change', (e) => {
        testState.sword = e.target.value;
        if (mainPlayer) mainPlayer.equipSword(testState.sword);
    });

    const btnNoCd = document.getElementById('btnTestNoCd');
    btnNoCd.addEventListener('click', (e) => {
        e.stopPropagation();
        testState.noCd = !testState.noCd;
        btnNoCd.innerText = testState.noCd ? 'КД: ВЫКЛ' : 'КД: ВКЛ';
        btnNoCd.classList.toggle('active', testState.noCd);
        if (testState.noCd && mainPlayer) mainPlayer.abilityReadyAt = 0;
    });

    const btnBotMode = document.getElementById('btnTestBotMode');
    btnBotMode.addEventListener('click', (e) => {
        e.stopPropagation();
        testState.botMode = testState.botMode === 'parry' ? 'dummy' : 'parry';
        btnBotMode.innerText = testState.botMode === 'parry' ? 'БОТ: ОТБИВ' : 'БОТ: МАНЕКЕН';
        btnBotMode.classList.toggle('active', testState.botMode === 'dummy');
    });

    document.getElementById('btnTestSpeed').addEventListener('click', (e) => {
        e.stopPropagation();
        ball.speed = Math.min(ball.speed + 1.5, 9.2);
        showStatus(`СКОРОСТЬ МЯЧА: ${ball.speed.toFixed(1)}`, '#00eeff', 1000);
    });

    document.getElementById('btnTestExit').addEventListener('click', (e) => {
        e.stopPropagation();
        returnToLobby();
    });
}
initTestPanelControls();

function enterTestArena() {
    training.stop();
    clearInterval(lobbyTimerHandle);
    clearTestRespawnTimers();
    stopAllTouchControls();
    hideStatus();

    gameState = 'test';
    testState.ability = gameData.equippedAbility;
    testState.sword = gameData.equippedSword;
    testState.kills = 0;
    camShake = 0;

    document.getElementById('testAbSelect').value = testState.ability;
    document.getElementById('testSwSelect').value = testState.sword;
    document.getElementById('btnTestNoCd').innerText = testState.noCd ? 'КД: ВЫКЛ' : 'КД: ВКЛ';
    document.getElementById('btnTestNoCd').classList.toggle('active', testState.noCd);
    document.getElementById('btnTestBotMode').innerText = testState.botMode === 'parry' ? 'БОТ: ОТБИВ' : 'БОТ: МАНЕКЕН';
    document.getElementById('btnTestBotMode').classList.toggle('active', testState.botMode === 'dummy');

    document.getElementById('leftHud').style.display = 'none';
    document.getElementById('topBar').style.display = 'none';
    document.getElementById('btnOpenMenu').style.display = 'none';
    document.getElementById('btnInteractWheel').style.display = 'none';
    document.getElementById('abilityMenu').style.display = 'none';
    document.getElementById('wheelModal').style.display = 'none';
    document.getElementById('playtimeModal').style.display = 'none';
    document.getElementById('settingsModal').style.display = 'none';
    document.getElementById('testPanel').style.display = 'flex';
    document.getElementById('killFeed').style.top = '54px';

    document.getElementById('btnBlock').style.display = 'flex';
    document.getElementById('btnAbility').style.display = 'flex';
    document.getElementById('platformControls').style.display = (testState.ability === 'platform') ? 'flex' : 'none';

    players.forEach(p => { scene.remove(p.mesh); scene.remove(p.platformMesh); });
    players.length = 0;

    mainPlayer = new Entity({
        name: 'Player', tier: 'pro', kills: gameData.kills, wins: gameData.wins,
        skin: { head: 0xffe0bd, torso: 0x0088ff, arms: 0x00aaff, legs: 0x113366, acc: 'none' }
    }, false);
    mainPlayer.mesh.position.set(0, mainPlayer.baseY, TEST_Z + 28);
    mainPlayer.mesh.rotation.y = Math.PI;
    snapCamera(0, 1.08);

    spawnTestBot(0);
    spawnTestBot(1);

    updateAbilityHudIcon();
    playSynth(440, 1200, 0.35, 'triangle', 0.32);
    spawnShockwave(mainPlayer.mesh.position, 0xaa44ff, 2, 18, 0.05, true);
    showToast('Тестовая арена открыта');

    ball.speed = 0.9; ball.raptureBoost = false; ball.curveTimer = 0;
    ball.selfBounceGrace = 0; ball.unfreeze();
    resetBallTrail();
    ball.mesh.position.set(0, 6, TEST_Z);
    ball.mesh.visible = true;
    ball.pickNewTarget(null);
}

// ==========================================
// MATCH LIFECYCLE
// ==========================================
function spawnEntitiesInLobby() {
    players.forEach(p => { scene.remove(p.mesh); scene.remove(p.platformMesh); });
    players.length = 0;

    mainPlayer = new Entity({
        name: 'Player', tier: 'pro', kills: gameData.kills, wins: gameData.wins,
        skin: { head: 0xffe0bd, torso: 0x0088ff, arms: 0x00aaff, legs: 0x113366, acc: 'none' }
    }, false);
    mainPlayer.mesh.position.set(0, mainPlayer.baseY, LOBBY_Z - 4);

    const picked = serverRoster.slice().sort(() => Math.random() - 0.5).slice(0, 6);
    picked.forEach(profile => {
        const bot = new Entity(profile, true);
        bot.mesh.position.set(-22 + Math.random() * 75, bot.baseY, LOBBY_Z - 40 + Math.random() * 80);
    });
}

function startLobbyTimer() {
    clearInterval(lobbyTimerHandle);
    lobbyTime = 15;
    document.getElementById('lobbyTimer').innerText = lobbyTime;
    document.getElementById('gameStateText').style.display = 'block';
    document.getElementById('aliveCountText').style.display = 'none';
    lobbyTimerHandle = setInterval(() => {
        lobbyTime--;
        document.getElementById('lobbyTimer').innerText = lobbyTime;
        if (lobbyTime <= 0) { clearInterval(lobbyTimerHandle); startGame(); }
    }, 1000);
}

function startGame() {
    training.stop();
    stopAllTouchControls();
    hideStatus();
    gameState = 'playing';
    matchKills = 0;
    camShake = 0;
    eventCornerJumps = 0;

    document.getElementById('gameStateText').style.display = 'none';
    document.getElementById('btnOpenMenu').style.display = 'none';
    document.getElementById('btnInteractWheel').style.display = 'none';
    document.getElementById('abilityMenu').style.display = 'none';
    document.getElementById('wheelModal').style.display = 'none';
    document.getElementById('playtimeModal').style.display = 'none';
    document.getElementById('settingsModal').style.display = 'none';

    document.getElementById('aliveCountText').style.display = 'block';
    document.getElementById('aliveCount').innerText = players.length;
    document.getElementById('btnBlock').style.display = 'flex';
    document.getElementById('btnAbility').style.display = 'flex';
    if (gameData.equippedAbility === 'platform') {
        document.getElementById('platformControls').style.display = 'flex';
    }

    players.forEach((p, idx) => {
        const angle = (idx / players.length) * Math.PI * 2;
        p.mesh.position.set(Math.cos(angle) * 60, p.baseY, Math.sin(angle) * 60);
        p.mesh.rotation.y = Math.atan2(-Math.cos(angle), -Math.sin(angle));
        p.setTargetHighlight(false); p.setOpacity(1);
        p.isInvis = false; p.invisTimer = 0; p.shadowTimer = 0;
        p.windTimer = 0; p.forcefieldTimer = 0; p.stunTimer = 0;
        p.blinkCharges = 3; p.reaperStacks = 0; p.velY = 0;
        p.abilityReadyAt = 0;
        p.shieldGroup.visible = false; p.windAuraGroup.visible = false; p.stunRing.visible = false;
    });
    if (mainPlayer) snapCamera(mainPlayer.mesh.rotation.y + Math.PI, 1.08);
    updateAbilityHudIcon();

    ball.speed = 0.85; ball.raptureBoost = false; ball.curveTimer = 0;
    ball.selfBounceGrace = 0; ball.unfreeze();
    resetBallTrail();
    ball.mesh.position.set(0, 6, 0);
    ball.mesh.visible = true;
    ball.pickNewTarget(null);
}

function returnToLobby() {
    clearTestRespawnTimers();
    stopAllTouchControls();
    gameState = 'lobby';
    platformMoveDir = 0;
    camShake = 0;
    eventCornerJumps = 0;
    hideStatus();
    dangerVignetteEl.classList.remove('active');
    ballArrowEl.style.display = 'none';
    ball.mesh.visible = false; ball.target = null; ball.unfreeze();
    ballGroundRing.visible = false;
    resetBallTrail();

    document.getElementById('testPanel').style.display = 'none';
    document.getElementById('leftHud').style.display = 'flex';
    document.getElementById('topBar').style.display = 'block';
    document.getElementById('killFeed').style.top = '28px';

    document.getElementById('gameOver').style.display = 'none';
    document.getElementById('btnBlock').style.display = 'none';
    document.getElementById('btnAbility').style.display = 'none';
    document.getElementById('platformControls').style.display = 'none';
    document.getElementById('effectBarContainer').style.display = 'none';
    document.getElementById('btnOpenMenu').style.display = 'block';

    rotateServerPlayers();
    spawnEntitiesInLobby();
    snapCamera(Math.PI, 1.08);
    updateLeaderboards3D();
    updateAbilityHudIcon();
    startLobbyTimer();
}
document.getElementById('btnBackLobby').addEventListener('click', returnToLobby);

// Controls
let platformMoveDir = 0;
document.getElementById('btnUp').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); platformMoveDir = 1; });
document.getElementById('btnUp').addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); platformMoveDir = 0; });
document.getElementById('btnDown').addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); platformMoveDir = -1; });
document.getElementById('btnDown').addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); platformMoveDir = 0; });

document.getElementById('btnAbility').addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (mainPlayer) mainPlayer.activateAbility();
});
document.getElementById('btnJump').addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (mainPlayer) mainPlayer.jump();
});
document.getElementById('btnBlock').addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (mainPlayer) mainPlayer.tryParry();
});

// Shop
const menuModal = document.getElementById('abilityMenu');
document.getElementById('btnOpenMenu').addEventListener('click', (e) => {
    e.stopPropagation(); stopAllTouchControls(); renderShop(); menuModal.style.display = 'flex';
});
document.getElementById('btnCloseMenu').addEventListener('click', (e) => {
    e.stopPropagation(); menuModal.style.display = 'none';
});
document.getElementById('tabAbilities').addEventListener('click', () => {
    document.getElementById('tabAbilities').classList.add('active');
    document.getElementById('tabSwords').classList.remove('active');
    document.getElementById('abilityGrid').style.display = 'grid';
    document.getElementById('swordGrid').style.display = 'none';
});
document.getElementById('tabSwords').addEventListener('click', () => {
    document.getElementById('tabSwords').classList.add('active');
    document.getElementById('tabAbilities').classList.remove('active');
    document.getElementById('swordGrid').style.display = 'grid';
    document.getElementById('abilityGrid').style.display = 'none';
});

function renderShop() {
    const abGrid = document.getElementById('abilityGrid');
    abGrid.innerHTML = '';
    ABILITIES.forEach(ab => {
        const owned = gameData.unlockedAbilities.includes(ab.id);
        const selected = gameData.equippedAbility === ab.id;
        const card = document.createElement('div');
        card.className = 'item-card' + (selected ? ' selected' : '') + (ab.wheelOnly ? ' wheel-only' : '');
        const priceText = selected ? 'ЭКИПИРОВАНО' : (owned ? 'ВЫБРАТЬ' : (ab.wheelOnly ? 'РУЛЕТКА (2%)' : `${ab.price} монет`));
        const priceClass = owned ? 'owned' : (ab.wheelOnly ? 'locked-wheel' : '');
        card.innerHTML = `
            <img src="${ab.img}" onerror="this.style.display='none'">
            <div class="item-name">${ab.name}</div>
            <div class="item-sub">${ab.desc}</div>
            <div class="item-price ${priceClass}">${priceText}</div>
        `;
        card.onclick = () => {
            if (owned) {
                gameData.equippedAbility = ab.id;
                saveGame(); renderShop();
            } else if (ab.wheelOnly) {
                showToast('Rapture выпадает только в колесе фортуны (2%)');
            } else if (gameData.coins >= ab.price) {
                gameData.coins -= ab.price;
                gameData.unlockedAbilities.push(ab.id);
                gameData.equippedAbility = ab.id;
                saveGame(); renderShop();
                showToast(`Куплена способность: ${ab.name}`);
            } else {
                showToast(`Недостаточно монет (нужно ${ab.price})`);
            }
        };
        abGrid.appendChild(card);
    });

    const swGrid = document.getElementById('swordGrid');
    swGrid.innerHTML = '';
    SWORDS.forEach(sw => {
        const owned = gameData.unlockedSwords.includes(sw.id);
        const selected = gameData.equippedSword === sw.id;
        const card = document.createElement('div');
        card.className = 'item-card' + (selected ? ' selected' : '') + (sw.wheelOnly ? ' wheel-only' : '');
        const iconHtml = sw.img
            ? `<img src="${sw.img}" onerror="this.style.display='none'">`
            : `<div style="height:42px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:12px;letter-spacing:1px;color:${sw.id === 'prisma_blade' ? '#00eeff' : '#aabbcc'};">${sw.id === 'prisma_blade' ? 'NEON' : 'BLADE'}</div>`;
        const priceText = selected ? 'ЭКИПИРОВАНО' : (owned ? 'ВЫБРАТЬ' : (sw.wheelOnly ? 'РУЛЕТКА' : `${sw.price} монет`));
        const priceClass = owned ? 'owned' : (sw.wheelOnly ? 'locked-wheel' : '');
        card.innerHTML = `
            ${iconHtml}
            <div class="item-name">${sw.name}</div>
            <div class="item-sub">${sw.desc}</div>
            <div class="item-price ${priceClass}">${priceText}</div>
        `;
        card.onclick = () => {
            if (owned) {
                gameData.equippedSword = sw.id;
                if (mainPlayer) mainPlayer.equipSword(sw.id);
                saveGame(); renderShop();
            } else if (sw.wheelOnly) {
                showToast(`${sw.name} выпадает только в колесе фортуны`);
            } else if (gameData.coins >= sw.price) {
                gameData.coins -= sw.price;
                gameData.unlockedSwords.push(sw.id);
                gameData.equippedSword = sw.id;
                if (mainPlayer) mainPlayer.equipSword(sw.id);
                saveGame(); renderShop();
                showToast(`Куплен меч: ${sw.name}`);
            } else {
                showToast(`Недостаточно монет (нужно ${sw.price})`);
            }
        };
        swGrid.appendChild(card);
    });
}

// Graphics & auto-optimization
function applyGraphicsSettings() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, gfxSettings.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
    starField.visible = gfxSettings.stars;
    document.getElementById('fpsBadge').style.display = gfxSettings.showFps ? 'block' : 'none';

    document.getElementById('optBloom').checked = gfxSettings.bloom;
    document.getElementById('optParticles').checked = gfxSettings.particles;
    document.getElementById('optStars').checked = gfxSettings.stars;
    document.getElementById('optFpsShow').checked = gfxSettings.showFps;
    document.getElementById('optRes').value = String(gfxSettings.pixelRatio);

    ['presetUltra', 'presetMed', 'presetFps'].forEach(id => document.getElementById(id).classList.remove('active'));
    if (gfxSettings.preset === 'ultra') document.getElementById('presetUltra').classList.add('active');
    else if (gfxSettings.preset === 'med') document.getElementById('presetMed').classList.add('active');
    else if (gfxSettings.preset === 'fps') document.getElementById('presetFps').classList.add('active');
    saveGfx();
}

function setGfxPreset(name) {
    gfxSettings.preset = name;
    if (name === 'ultra') {
        gfxSettings.bloom = true; gfxSettings.particles = true; gfxSettings.stars = true; gfxSettings.pixelRatio = 1.5;
    } else if (name === 'med') {
        gfxSettings.bloom = true; gfxSettings.particles = true; gfxSettings.stars = true; gfxSettings.pixelRatio = 1;
    } else {
        gfxSettings.bloom = false; gfxSettings.particles = true; gfxSettings.stars = false; gfxSettings.pixelRatio = 0.75;
    }
    applyGraphicsSettings();
}

document.getElementById('btnOpenSettings').addEventListener('click', (e) => {
    e.stopPropagation(); stopAllTouchControls(); applyGraphicsSettings(); document.getElementById('settingsModal').style.display = 'flex';
});
document.getElementById('btnCloseSettings').addEventListener('click', (e) => {
    e.stopPropagation(); document.getElementById('settingsModal').style.display = 'none';
});
document.getElementById('presetUltra').addEventListener('click', () => setGfxPreset('ultra'));
document.getElementById('presetMed').addEventListener('click', () => setGfxPreset('med'));
document.getElementById('presetFps').addEventListener('click', () => setGfxPreset('fps'));

document.getElementById('optBloom').addEventListener('change', (e) => { gfxSettings.bloom = e.target.checked; gfxSettings.preset = 'custom'; applyGraphicsSettings(); });
document.getElementById('optParticles').addEventListener('change', (e) => { gfxSettings.particles = e.target.checked; gfxSettings.preset = 'custom'; applyGraphicsSettings(); });
document.getElementById('optStars').addEventListener('change', (e) => { gfxSettings.stars = e.target.checked; gfxSettings.preset = 'custom'; applyGraphicsSettings(); });
document.getElementById('optFpsShow').addEventListener('change', (e) => { gfxSettings.showFps = e.target.checked; applyGraphicsSettings(); });
document.getElementById('optRes').addEventListener('change', (e) => { gfxSettings.pixelRatio = parseFloat(e.target.value); gfxSettings.preset = 'custom'; applyGraphicsSettings(); });

let currentFps = 60;
let autoOptRunning = false;
document.getElementById('btnAutoOpt').addEventListener('click', () => {
    if (autoOptRunning) return;
    autoOptRunning = true;
    const status = document.getElementById('autoOptStatus');
    status.innerText = 'Проверка производительности...';
    gfxSettings.bloom = true;
    applyGraphicsSettings();

    let frames = 0;
    const startT = performance.now();
    function bench() {
        frames++;
        const dt = performance.now() - startT;
        if (dt < 900) {
            requestAnimationFrame(bench);
        } else {
            const fps = Math.round((frames * 1000) / dt);
            const cores = navigator.hardwareConcurrency || 4;
            const mem = navigator.deviceMemory || 4;
            if (fps >= 52 && cores >= 6 && mem >= 4) {
                setGfxPreset('ultra');
                status.innerText = `Установлен пресет УЛЬТРА (${fps} FPS)`;
            } else if (fps >= 34) {
                setGfxPreset('med');
                status.innerText = `Установлен пресет НОРМ (${fps} FPS)`;
            } else {
                setGfxPreset('fps');
                status.innerText = `Установлен пресет ФПС+ (${fps} FPS, Bloom отключён)`;
            }
            autoOptRunning = false;
        }
    }
    requestAnimationFrame(bench);
});

// Wheel of fortune & playtime rewards
const wheelCanvas = document.getElementById('wheelCanvas');
const wCtx = wheelCanvas.getContext('2d');
let wheelAngle = 0, wheelSpinning = false;

function drawWheel(angle) {
    const cx = 120, cy = 120, r = 114, n = WHEEL_ITEMS.length, slice = (Math.PI * 2) / n;
    wCtx.clearRect(0, 0, 240, 240);
    for (let i = 0; i < n; i++) {
        const start = angle + i * slice - Math.PI / 2, end = start + slice;
        wCtx.beginPath(); wCtx.moveTo(cx, cy);
        wCtx.arc(cx, cy, r, start, end); wCtx.closePath();
        wCtx.fillStyle = WHEEL_ITEMS[i].color; wCtx.fill();
        wCtx.strokeStyle = '#fff'; wCtx.lineWidth = 2; wCtx.stroke();
        wCtx.save(); wCtx.translate(cx, cy); wCtx.rotate(start + slice / 2);
        wCtx.fillStyle = '#fff'; wCtx.font = 'bold 12px sans-serif'; wCtx.textAlign = 'right';
        wCtx.fillText(WHEEL_ITEMS[i].short, r - 10, 4); wCtx.restore();
    }
    wCtx.beginPath(); wCtx.arc(cx, cy, 18, 0, Math.PI * 2);
    wCtx.fillStyle = '#ff2244'; wCtx.fill();
    wCtx.strokeStyle = '#fff'; wCtx.lineWidth = 3; wCtx.stroke();
}
drawWheel(0);

function rollWheelIndex() {
    const total = WHEEL_ITEMS.reduce((s, it) => s + it.weight, 0);
    let r = Math.random() * total;
    for (let i = 0; i < WHEEL_ITEMS.length; i++) { r -= WHEEL_ITEMS[i].weight; if (r <= 0) return i; }
    return 0;
}

function spinWheel(useCoins) {
    if (wheelSpinning) return;
    if (useCoins) {
        if (gameData.dailyCoinSpinsUsed >= 3) { showToast('Лимит 3 прокрута за монеты в день исчерпан'); return; }
        if (gameData.coins < 3000) { showToast('Недостаточно монет (нужно 3,000)'); return; }
        gameData.coins -= 3000; gameData.dailyCoinSpinsUsed++;
    } else {
        if (gameData.spins <= 0) { showToast('Нет бесплатных спинов'); return; }
        gameData.spins--;
    }
    saveGame();

    wheelSpinning = true;
    document.getElementById('wheelResult').style.display = 'none';
    const winIdx = rollWheelIndex();
    const slice = (Math.PI * 2) / WHEEL_ITEMS.length;
    const targetOffset = (Math.PI * 2) - (winIdx * slice + slice / 2);
    const extraSpins = (isInstantSpinActive() ? 2 : 6) * Math.PI * 2;
    const startAngle = wheelAngle % (Math.PI * 2);
    const finalAngle = extraSpins + targetOffset;
    const duration = isInstantSpinActive() ? 700 : 3200;
    const startTime = performance.now();

    function animWheel(now) {
        const t = Math.min(1, (now - startTime) / duration);
        wheelAngle = startAngle + (finalAngle - startAngle) * (1 - Math.pow(1 - t, 3));
        drawWheel(wheelAngle);
        if (t < 1) requestAnimationFrame(animWheel);
        else { wheelSpinning = false; grantWheelPrize(WHEEL_ITEMS[winIdx]); }
    }
    playSynth(500, 900, 0.2, 'triangle', 0.28);
    requestAnimationFrame(animWheel);
}

function grantWheelPrize(item) {
    let msg = `Выпало: ${item.label}`;
    if (item.type === 'coins') gameData.coins += item.val;
    else if (item.type === 'instant') {
        gameData.spins += 1; gameData.instantSpinUntil = Date.now() + 30 * 60 * 1000;
        msg = 'Быстрый прокрут на 30 мин и +1 спин';
    } else if (item.type === 'x2') {
        gameData.x2CoinsUntil = Date.now() + 15 * 60 * 1000;
        msg = 'Буст x2 монет на 15 минут';
    } else if (item.type === 'ability') {
        if (gameData.unlockedAbilities.includes(item.val)) { gameData.coins += 40; msg = `${item.label} уже открыта (+40 монет)`; }
        else { gameData.unlockedAbilities.push(item.val); msg = `Открыта способность: ${item.label}`; }
    } else if (item.type === 'sword') {
        if (gameData.unlockedSwords.includes(item.val)) { gameData.coins += 40; msg = `${item.label} уже открыт (+40 монет)`; }
        else { gameData.unlockedSwords.push(item.val); msg = `Открыт меч: ${item.label}`; }
    }
    saveGame();
    playSynth(600, 1200, 0.35, 'triangle', 0.35);
    const resBox = document.getElementById('wheelResult');
    resBox.innerHTML = (item.img ? `<img src="${item.img}" onerror="this.style.display='none'">` : '') + msg;
    resBox.style.display = 'block';
}

document.getElementById('btnInteractWheel').addEventListener('click', (e) => { e.stopPropagation(); stopAllTouchControls(); saveGame(); document.getElementById('wheelModal').style.display = 'flex'; });
document.getElementById('btnCloseWheel').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('wheelModal').style.display = 'none'; });
document.getElementById('btnSpinFree').addEventListener('click', () => spinWheel(false));
document.getElementById('btnSpinCoins').addEventListener('click', () => spinWheel(true));

const SPIN_INTERVAL_SEC = 600;
function fmtTime(sec) {
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

function updatePlaytimeUI() {
    const leftSec = Math.max(0, SPIN_INTERVAL_SEC - gameData.playtimeSeconds);
    const leftStr = fmtTime(leftSec);
    const pending = gameData.pendingPlaytimeSpins || 0;

    document.getElementById('sessionTimerTxt').innerText = pending > 0 ? `+${pending} спин` : leftStr;
    document.getElementById('ptModalTime').innerText = leftStr;
    document.getElementById('ptProgressFill').style.width = `${Math.min(100, (gameData.playtimeSeconds / SPIN_INTERVAL_SEC) * 100)}%`;
    document.getElementById('ptPendingCount').innerText = pending;

    const claimBtn = document.getElementById('btnClaimPlaytime');
    claimBtn.disabled = pending <= 0;
    claimBtn.innerText = pending > 0 ? `ЗАБРАТЬ (+${pending})` : 'ЗАБРАТЬ';
    document.getElementById('btnPlaytime').classList.toggle('ready', pending > 0);

    const buffs = document.getElementById('buffsRow');
    buffs.innerHTML = '';
    if (isX2Active()) buffs.innerHTML += `<div class="buff-badge">x2 монеты: ${fmtTime(Math.ceil((gameData.x2CoinsUntil - Date.now()) / 1000))}</div>`;
    if (isInstantSpinActive()) buffs.innerHTML += `<div class="buff-badge">Быстрый прокрут: ${fmtTime(Math.ceil((gameData.instantSpinUntil - Date.now()) / 1000))}</div>`;
}

let ptSaveTick = 0;
setInterval(() => {
    gameData.playtimeSeconds = (gameData.playtimeSeconds || 0) + 1;
    let earnedNow = 0;
    while (gameData.playtimeSeconds >= SPIN_INTERVAL_SEC) {
        gameData.playtimeSeconds -= SPIN_INTERVAL_SEC;
        gameData.pendingPlaytimeSpins = (gameData.pendingPlaytimeSpins || 0) + 1;
        earnedNow++;
    }
    ptSaveTick++;
    if (earnedNow > 0) {
        saveGame();
        showToast(`Начислен спин за время в игре (+${earnedNow})`);
    } else if (ptSaveTick >= 5) {
        ptSaveTick = 0;
        localStorage.setItem('bladeBallV1', JSON.stringify(gameData));
    }
    updatePlaytimeUI();
}, 1000);

document.getElementById('btnPlaytime').addEventListener('click', (e) => { e.stopPropagation(); stopAllTouchControls(); updatePlaytimeUI(); document.getElementById('playtimeModal').style.display = 'flex'; });
document.getElementById('btnClosePlaytime').addEventListener('click', (e) => { e.stopPropagation(); document.getElementById('playtimeModal').style.display = 'none'; });
document.getElementById('btnClaimPlaytime').addEventListener('click', () => {
    const n = gameData.pendingPlaytimeSpins || 0;
    if (n <= 0) return;
    gameData.spins += n; gameData.pendingPlaytimeSpins = 0;
    saveGame(); updatePlaytimeUI();
    showToast(`Получено спинов: +${n}`);
});

// Boot & main loop
spawnEntitiesInLobby();
applyGraphicsSettings();
saveGame();
updatePlaytimeUI();
startLobbyTimer();

const effectBarContainer = document.getElementById('effectBarContainer');
const effectBar = document.getElementById('effectBar');
let fpsFrames = 0, lastFpsTime = performance.now();

function updatePlayerEffectBar() {
    let ratio = 0, color = '#00ffff';
    if (mainPlayer.isInvis) { ratio = mainPlayer.invisTimer / 180; color = '#00ffff'; }
    else if (mainPlayer.forcefieldTimer > 0) { ratio = mainPlayer.forcefieldTimer / mainPlayer.forcefieldMax; color = '#ff5522'; }
    else if (mainPlayer.windTimer > 0) { ratio = mainPlayer.windTimer / 600; color = '#00ff88'; }
    else if (mainPlayer.shadowTimer > 0) { ratio = mainPlayer.shadowTimer / 210; color = '#aa66ff'; }

    if (ratio > 0) {
        effectBarContainer.style.display = 'block';
        effectBarContainer.style.borderColor = color;
        effectBar.style.background = color;
        effectBar.style.width = `${Math.max(0, Math.min(100, ratio * 100))}%`;
    } else {
        effectBarContainer.style.display = 'none';
    }
}

function animate() {
    requestAnimationFrame(animate);

    fpsFrames++;
    const now = performance.now();
    if (now - lastFpsTime >= 500) {
        currentFps = Math.round((fpsFrames * 1000) / (now - lastFpsTime));
        fpsFrames = 0; lastFpsTime = now;
        if (gfxSettings.showFps) document.getElementById('fpsBadge').innerText = `${currentFps} FPS`;
    }

    if (starField.visible) starField.rotation.y += 0.00025;

    // Smooth camera interpolation
    camThetaSmooth += (camTheta - camThetaSmooth) * 0.35;
    camPhiSmooth += (camPhi - camPhiSmooth) * 0.35;

    // Recompute movement vector every frame using live camera angle
    if (joyActive && (Math.abs(joyX) > 0.08 || Math.abs(joyY) > 0.08)) {
        const sinT = Math.sin(camThetaSmooth);
        const cosT = Math.cos(camThetaSmooth);
        moveX = cosT * joyX + (-sinT) * (-joyY);
        moveZ = (-sinT) * joyX + (-cosT) * (-joyY);
        isMoving = true;
    } else {
        moveX = 0;
        moveZ = 0;
        isMoving = false;
    }

    if (mainPlayer && mainPlayer.isAlive) {
        mainPlayer.updateBuffTimers();
        mainPlayer.updateVerticalPhysics();

        const spd = mainPlayer.getMoveSpeed();
        if ((moveX !== 0 || moveZ !== 0) && spd > 0 && gameState !== 'gameover') {
            mainPlayer.mesh.position.x += moveX * spd;
            mainPlayer.mesh.position.z += moveZ * spd;
            mainPlayer.mesh.rotation.y = Math.atan2(moveX, moveZ);
            mainPlayer.clampBounds();
        }

        if (mainPlayer.isPlatformActive && isCombatState()) {
            mainPlayer.mesh.position.y = Math.max(mainPlayer.baseY, Math.min(48, mainPlayer.mesh.position.y + platformMoveDir * 0.8));
            mainPlayer.platformMesh.position.set(mainPlayer.mesh.position.x, mainPlayer.mesh.position.y - 7, mainPlayer.mesh.position.z);
        }

        mainPlayer.animateWalk(isMoving && gameState !== 'gameover');
        mainPlayer.updateParryLogic();
        updatePlayerEffectBar();

        const cdLeftMs = mainPlayer.abilityReadyAt - Date.now();
        const cdEl = document.getElementById('abCdOverlay');
        if (cdLeftMs > 0 && isCombatState() && !(gameState === 'test' && testState.noCd)) {
            cdEl.style.display = 'flex';
            cdEl.innerText = Math.ceil(cdLeftMs / 1000);
        } else {
            cdEl.style.display = 'none';
        }

        if (gameState === 'lobby') {
            const distWheel = Math.hypot(mainPlayer.mesh.position.x - WHEEL_PAD_POS.x, mainPlayer.mesh.position.z - WHEEL_PAD_POS.z);
            document.getElementById('btnInteractWheel').style.display = (distWheel < 15) ? 'block' : 'none';
        }

        let desiredFov = 62;
        if (mainPlayer.shadowTimer > 0) desiredFov = 72;
        else if (mainPlayer.windTimer > 0) desiredFov = 67;
        else if (isCombatState()) desiredFov = 62 + Math.min(8, Math.max(0, (ball.speed - 1.5) * 1.1));
        targetFov += (desiredFov - targetFov) * 0.08;
        if (Math.abs(camera.fov - targetFov) > 0.05) {
            camera.fov = targetFov;
            camera.updateProjectionMatrix();
        }

        const sx = camShake > 0.02 ? (Math.random() - 0.5) * camShake : 0;
        const sy = camShake > 0.02 ? (Math.random() - 0.5) * camShake : 0;
        camShake *= 0.84;

        camera.position.x = mainPlayer.mesh.position.x + camRadius * Math.sin(camPhiSmooth) * Math.sin(camThetaSmooth) + sx;
        camera.position.z = mainPlayer.mesh.position.z + camRadius * Math.sin(camPhiSmooth) * Math.cos(camThetaSmooth);
        camera.position.y = mainPlayer.mesh.position.y + camRadius * Math.cos(camPhiSmooth) + sy;
        camera.lookAt(mainPlayer.mesh.position);
    }

    players.forEach(p => { if (p !== mainPlayer) p.updateAI(); });
    ball.update();
    training.update();
    updateVFX();
    updateBallScreenIndicator();

    if (gfxSettings.bloom && composer) composer.render();
    else renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    if (composer) composer.setSize(window.innerWidth, window.innerHeight);
});

animate();
document.getElementById('btnExportSave').addEventListener('click', () => {
    const raw = localStorage.getItem('bladeBallV1') || JSON.stringify(gameData);
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(raw).then(() => showToast('Сохранение скопировано')).catch(() => prompt('Скопируй код сохранения:', raw));
    } else {
        prompt('Скопируй код сохранения:', raw);
    }
});

document.getElementById('btnImportSave').addEventListener('click', () => {
    const raw = prompt('Вставь код сохранения:');
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw.trim());
        if (typeof parsed.coins === 'number') {
            localStorage.setItem('bladeBallV1', JSON.stringify(parsed));
            location.reload();
        } else {
            showToast('Неверный формат сохранения');
        }
    } catch (e) {
        showToast('Ошибка чтения сохранения');
    }
});

