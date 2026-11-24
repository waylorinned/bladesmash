const ABILITIES = [
    { id: 'dash', name: 'Dash', img: 'Dash.webp', price: 0, wheelOnly: false, passive: false, cd: 8, desc: 'Рывок вперёд по направлению взгляда (КД 8с)' },
    { id: 'invis', name: 'Invisibility', img: 'inviz.webp', price: 100, wheelOnly: false, passive: false, cd: 15, desc: 'Невидимость 3с. В 1 на 1 возвращает мяч врагу' },
    { id: 'platform', name: 'Platform', img: 'Platform.webp', price: 150, wheelOnly: false, passive: false, cd: 1, desc: 'Подъёмная платформа под ногами' },
    { id: 'super_jump', name: 'Super Jump', img: 'Super_Jump.webp', price: 350, wheelOnly: false, passive: false, cd: 12, desc: 'Высокий прыжок вверх (КД 12с)' },
    { id: 'quad_jump', name: 'Quad Jump', img: 'Quad_Jump.webp', price: 450, wheelOnly: false, passive: true, cd: 0, desc: 'Пассив: 4 прыжка подряд' },
    { id: 'luck', name: 'Luck', img: 'Luck_image.webp', price: 1000, wheelOnly: false, passive: true, cd: 0, desc: 'Пассив: 25% шанс отвести мяч (отключён в 1 на 1)' },
    { id: 'thunder_dash', name: 'Thunder Dash', img: 'Thunder_Dash.webp', price: 1200, wheelOnly: false, passive: false, cd: 4, desc: 'Быстрый молниевый рывок (КД 4с)' },
    { id: 'shadow_step', name: 'Shadow Step', img: 'Shadow_Step.webp', price: 1600, wheelOnly: false, passive: false, cd: 18, desc: 'Ускорение на 3.5с с теневыми следами (КД 18с)' },
    { id: 'freeze', name: 'Freeze', img: 'Freeze.webp', price: 2000, wheelOnly: false, passive: false, cd: 35, desc: 'Замораживает мяч на 5с или до удара (КД 35с)' },
    { id: 'wind_cloak', name: 'Wind Cloak', img: 'Wind_Cloak.webp', price: 2000, wheelOnly: false, passive: false, cd: 30, desc: 'Аура ветра на 10с: скорость и высокий прыжок (КД 30с)' },
    { id: 'blink', name: 'Blink', img: 'Blink_new (1).webp', price: 2000, wheelOnly: false, passive: false, cd: 18, charges: 3, desc: '3 коротких телепорта подряд (КД 18с)' },
    { id: 'forcefield', name: 'Forcefield', img: 'Forcefield.webp', price: 2000, wheelOnly: false, passive: false, cd: 30, desc: 'Щит авто-отбива 7с (в 1 на 1 — 3с, КД 30с)' },
    { id: 'reaper', name: 'Reaper', img: 'Reaper.webp', price: 3000, wheelOnly: false, passive: true, cd: 0, desc: 'Пассив: за каждое убийство (до x5) ускоряет бег и удар' },
    { id: 'raging_deflect', name: 'Raging Deflect', img: 'Raging_Deflect.webp', price: 4000, wheelOnly: false, passive: false, cd: 30, desc: 'Усиленный отбив x2 скорость и оглушение на 1.5с (КД 30с)' },
    { id: 'rapture', name: 'Rapture', img: 'rapture.webp', price: 0, wheelOnly: true, passive: false, cd: 30, desc: 'Апперкот с камнями, дугой вверх и x3 скоростью (2%)' }
];

const SWORDS = [
    { id: 'default', name: 'Classic Blade', img: '', price: 0, wheelOnly: false, desc: 'Стандартный клинок' },
    { id: 'prisma_blade', name: 'Neon Blade', img: '', price: 400, wheelOnly: false, objFile: 'Группа.obj', desc: 'Неоновый энергетический клинок' },
    { id: 'nebula_shard', name: 'Nebula Shard', img: 'NebulaSh.webp', price: 0, wheelOnly: true, desc: 'Космический осколок (Рулетка 1%)' },
    { id: 'nebula_staff', name: 'Nebula Staff', img: 'NebulaSt.webp', price: 0, wheelOnly: true, desc: 'Энергетический посох (Рулетка 0.25%)' },
    { id: 'dual_nebula_staff', name: 'Dual Nebula Staff', img: 'DualNebualSt.webp', price: 0, wheelOnly: true, desc: 'Двойной посох (Рулетка 0.1%)' }
];

const WHEEL_ITEMS = [
    { id: 'coins_250', label: '250 монет', short: '250', weight: 29, color: '#2b7de9', type: 'coins', val: 250 },
    { id: 'instant_30m', label: 'Быстрый прокрут 30м (+1 спин)', short: 'Быстр. 30м', weight: 27, color: '#00b894', type: 'instant', val: 30 },
    { id: 'x2_15m', label: 'x2 монеты на 15 мин', short: 'x2 15м', weight: 24, color: '#f39c12', type: 'x2', val: 15 },
    { id: 'coins_500', label: '500 монет', short: '500', weight: 17.9, color: '#e67e22', type: 'coins', val: 500 },
    { id: 'ab_rapture', label: 'Rapture', short: 'Rapture', weight: 2, color: '#e74c3c', type: 'ability', val: 'rapture', img: 'rapture.webp' },
    { id: 'sw_shard', label: 'Nebula Shard', short: 'N.Shard', weight: 1, color: '#6c5ce7', type: 'sword', val: 'nebula_shard', img: 'NebulaSh.webp' },
    { id: 'sw_staff', label: 'Nebula Staff', short: 'N.Staff', weight: 0.25, color: '#a55eea', type: 'sword', val: 'nebula_staff', img: 'NebulaSt.webp' },
    { id: 'sw_dual', label: 'Dual Nebula Staff', short: 'DUAL', weight: 0.1, color: '#00d2d3', type: 'sword', val: 'dual_nebula_staff', img: 'DualNebualSt.webp' }
];

const NAME_PREFIXES = ['xX_', 'Not', 'Real', 'Its', 'Pro', 'Dark', 'Neo', 'Hyper', 'Zxc', 'Lil', 'Vex', 'Kiro', 'Soul', 'Void', ''];
const NAME_ROOTS = [
    'Shadow', 'Vortex', 'Parry', 'Blade', 'Ghoul', 'Rapture', 'Reaper', 'Wolf',
    'Phantom', 'Striker', 'Ninja', 'Frost', 'Blaze', 'Sanya', 'Dima', 'Arsen',
    'Kira', 'Nova', 'Ghost', 'Slayer', 'Clash', 'Titan', 'Venom', 'Pulse', 'Zero', 'Warden'
];
const NAME_SUFFIXES = ['_Xx', 'YT', '99', '777', 'PvP', 'GD', 'God', '228', 'Pro', '_TV', '1337', '_x', ''];

const SKIN_PRESETS = {
    sweat: [
        { head: 0x151515, torso: 0x880022, arms: 0x111111, legs: 0x0d0d0d, acc: 'crown' },
        { head: 0x221133, torso: 0x5500cc, arms: 0x00eeff, legs: 0x141424, acc: 'visor' },
        { head: 0x111111, torso: 0x1a1a1a, arms: 0xff2244, legs: 0x101010, acc: 'horns' },
        { head: 0xffffff, torso: 0x090910, arms: 0xaa00ff, legs: 0x090910, acc: 'crown' }
    ],
    pro: [
        { head: 0xffe0bd, torso: 0xcc2200, arms: 0x222222, legs: 0x1a1a22, acc: 'horns' },
        { head: 0xddeeff, torso: 0x006699, arms: 0x112233, legs: 0x0f1926, acc: 'visor' },
        { head: 0xf1c27d, torso: 0x222222, arms: 0xffaa00, legs: 0x1b1b1b, acc: 'crown' },
        { head: 0x222222, torso: 0x00aa55, arms: 0x111111, legs: 0x182228, acc: 'bandana' }
    ],
    mid: [
        { head: 0xffdbac, torso: 0x1e66cc, arms: 0x3388ee, legs: 0x223344, acc: 'bandana' },
        { head: 0xf1c27d, torso: 0xff6600, arms: 0x2a2a2a, legs: 0x242430, acc: 'visor' },
        { head: 0xffd5b5, torso: 0xaa2288, arms: 0xff66bb, legs: 0x252035, acc: 'bandana' },
        { head: 0xffe0bd, torso: 0x228844, arms: 0x1d4d2c, legs: 0x222222, acc: 'none' }
    ],
    noob: [
        { head: 0xffdd00, torso: 0x0066ff, arms: 0xffdd00, legs: 0x44aa22, acc: 'none' },
        { head: 0xffe0bd, torso: 0x33aa55, arms: 0xffe0bd, legs: 0x334455, acc: 'none' },
        { head: 0xffdbac, torso: 0xcc4444, arms: 0xffdbac, legs: 0x222233, acc: 'none' },
        { head: 0xffffff, torso: 0x333333, arms: 0x222222, legs: 0x1a1a1a, acc: 'none' }
    ]
};

const META_ABILITIES = ['rapture', 'invis', 'raging_deflect', 'forcefield', 'freeze', 'reaper'];
const NORMAL_ABILITIES = ['dash', 'platform', 'super_jump', 'quad_jump', 'luck', 'thunder_dash', 'shadow_step', 'wind_cloak', 'blink'];

function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function generateUniqueName(existingNames) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const name = (
            NAME_PREFIXES[randInt(0, NAME_PREFIXES.length - 1)] +
            NAME_ROOTS[randInt(0, NAME_ROOTS.length - 1)] +
            NAME_SUFFIXES[randInt(0, NAME_SUFFIXES.length - 1)]
        ).slice(0, 15);
        if (!existingNames.has(name)) return name;
    }
    return 'Player_' + randInt(100, 999);
}

function generateBotProfile(existingNames, forcedTier = null) {
    let tier = forcedTier;
    if (!tier) {
        const r = Math.random();
        if (r < 0.14) tier = 'sweat';
        else if (r < 0.36) tier = 'pro';
        else if (r < 0.70) tier = 'mid';
        else tier = 'noob';
    }

    let kills, wins, sword, metaChance;
    if (tier === 'sweat') {
        kills = randInt(7500, 28500);
        wins = Math.round(kills * (0.08 + Math.random() * 0.06));
        sword = Math.random() < 0.45 ? 'dual_nebula_staff' : 'nebula_staff';
        metaChance = 0.75;
    } else if (tier === 'pro') {
        kills = randInt(1600, 6900);
        wins = Math.round(kills * (0.07 + Math.random() * 0.05));
        sword = Math.random() < 0.35 ? 'nebula_staff' : (Math.random() < 0.5 ? 'nebula_shard' : 'prisma_blade');
        metaChance = 0.52;
    } else if (tier === 'mid') {
        kills = randInt(220, 1450);
        wins = Math.round(kills * (0.06 + Math.random() * 0.05));
        sword = Math.random() < 0.3 ? 'prisma_blade' : 'default';
        metaChance = 0.30;
    } else {
        kills = randInt(8, 190);
        wins = Math.max(0, Math.round(kills * (0.04 + Math.random() * 0.05)));
        sword = 'default';
        metaChance = 0.14;
    }

    const ability = Math.random() < metaChance
        ? META_ABILITIES[randInt(0, META_ABILITIES.length - 1)]
        : NORMAL_ABILITIES[randInt(0, NORMAL_ABILITIES.length - 1)];

    const presets = SKIN_PRESETS[tier];
    const skin = Object.assign({}, presets[randInt(0, presets.length - 1)]);
    const name = generateUniqueName(existingNames);
    existingNames.add(name);
    return { name, kills, wins, tier, sword, ability, skin };
}

let serverRoster = [];
function initServerRoster() {
    serverRoster = [];
    const used = new Set(['Player']);
    serverRoster.push(generateBotProfile(used, 'sweat'));
    serverRoster.push(generateBotProfile(used, 'pro'));
    for (let i = 0; i < 8; i++) serverRoster.push(generateBotProfile(used));
}
function rotateServerPlayers() {
    const churnCount = randInt(2, 4);
    const used = new Set(serverRoster.map(b => b.name));
    used.add('Player');
    for (let i = 0; i < churnCount; i++) {
        const idx = randInt(0, serverRoster.length - 1);
        used.delete(serverRoster[idx].name);
        serverRoster[idx] = generateBotProfile(used);
    }
    if (!serverRoster.some(b => b.kills >= 5000) && Math.random() < 0.65) {
        serverRoster[randInt(0, serverRoster.length - 1)] = generateBotProfile(used, 'sweat');
    }
}
initServerRoster();

const todayStr = () => new Date().toISOString().slice(0, 10);
const defaultSave = {
    coins: 0, spins: 0, kills: 0, wins: 0,
    unlockedAbilities: ['dash'], unlockedSwords: ['default'],
    equippedAbility: 'dash', equippedSword: 'default',
    x2CoinsUntil: 0, instantSpinUntil: 0,
    dailySpinDate: todayStr(), dailyCoinSpinsUsed: 0,
    playtimeSeconds: 0, pendingPlaytimeSpins: 0
};
let gameData = Object.assign({}, defaultSave, JSON.parse(localStorage.getItem('bladeBallV1') || '{}'));
if (gameData.dailySpinDate !== todayStr()) {
    gameData.dailySpinDate = todayStr();
    gameData.dailyCoinSpinsUsed = 0;
}

const defaultGfx = {
    preset: 'med',
    bloom: true,
    particles: true,
    stars: true,
    showFps: false,
    pixelRatio: 1
};
let gfxSettings = Object.assign({}, defaultGfx, JSON.parse(localStorage.getItem('bladeBallGfx') || '{}'));
function saveGfx() { localStorage.setItem('bladeBallGfx', JSON.stringify(gfxSettings)); }
