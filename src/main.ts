import './style.css';
import { GameController, GameMode } from './game/GameController';
import { IslandMapId, WW2_ISLANDS } from './maps/ww2Islands';
import { WeaponId, WEAPONS } from './weapons/weapons';
import { sound } from './audio/sound';

const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const tagsLayer = document.getElementById('tags-layer') as HTMLElement;
const hudEl = document.getElementById('hud') as HTMLElement;
const menuOverlay = document.getElementById('menu-overlay') as HTMLElement;
const victoryOverlay = document.getElementById('victory-overlay') as HTMLElement;
const mapPicker = document.getElementById('map-picker') as HTMLElement;
const modePicker = document.getElementById('mode-picker') as HTMLElement;
const squadPicker = document.getElementById('squad-picker') as HTMLElement;
const weaponBar = document.getElementById('weapon-bar') as HTMLElement;
const announcementEl = document.getElementById('announcement') as HTMLElement;
const helpModal = document.getElementById('help-modal') as HTMLElement;

const teamBadge = document.getElementById('team-badge') as HTMLElement;
const soldierNameEl = document.getElementById('soldier-name') as HTMLElement;
const turnTimerEl = document.getElementById('turn-timer') as HTMLElement;
const phaseHintEl = document.getElementById('phase-hint') as HTMLElement;
const barAllies = document.getElementById('bar-allies') as HTMLElement;
const barAxis = document.getElementById('bar-axis') as HTMLElement;
const hpAlliesEl = document.getElementById('hp-allies') as HTMLElement;
const hpAxisEl = document.getElementById('hp-axis') as HTMLElement;
const windArrowEl = document.getElementById('wind-arrow') as HTMLElement;
const windSpeedEl = document.getElementById('wind-speed') as HTMLElement;
const chargeWrap = document.getElementById('charge-wrap') as HTMLElement;
const chargeFill = document.getElementById('charge-fill') as HTMLElement;
const btnCam = document.getElementById('btn-cam') as HTMLButtonElement;
const btnMute = document.getElementById('btn-mute') as HTMLButtonElement;
const victoryTitle = document.getElementById('victory-title') as HTMLElement;
const victoryStats = document.getElementById('victory-stats') as HTMLElement;

let selectedMap: IslandMapId = 'normandy';
let selectedMode: GameMode = 'ai';
let selectedSquadSize = 3;
let announceTimeout = 0;

function showAnnouncement(text: string): void {
  announcementEl.textContent = text;
  announcementEl.classList.remove('hidden');
  window.clearTimeout(announceTimeout);
  announceTimeout = window.setTimeout(() => {
    announcementEl.classList.add('hidden');
  }, 2400);
}

// Build Weapon Hotbar
const weaponButtons = new Map<WeaponId, HTMLButtonElement>();
for (const w of WEAPONS) {
  const btn = document.createElement('button');
  btn.className = 'weapon-slot';
  btn.title = w.shortDesc;
  btn.innerHTML = `<div class="weapon-top"><span>[${w.key}]</span><span class="w-ammo">${w.ammo < 0 ? '∞' : w.ammo}</span></div><div class="weapon-name">${w.name}</div>`;
  btn.addEventListener('click', () => game.selectWeapon(w.id));
  weaponBar.appendChild(btn);
  weaponButtons.set(w.id, btn);
}

const game = new GameController(canvas, tagsLayer, {
  onHudUpdate: (s) => {
    teamBadge.textContent = s.team === 'allies' ? 'ALLIES' : 'AXIS';
    teamBadge.classList.toggle('axis', s.team === 'axis');
    soldierNameEl.textContent = s.soldierName;
    turnTimerEl.textContent = String(s.timer);
    turnTimerEl.classList.toggle('urgent', s.timer <= 8);

    if (s.isAiTurn) {
      phaseHintEl.textContent = 'Axis AI calculating artillery fire...';
    } else if (s.freeCam) {
      phaseHintEl.textContent = 'FREE CAM: WASD pan · Right-Drag orbit · C return';
    } else if (s.phase === 'retreat') {
      phaseHintEl.textContent = 'RETREAT! Move away from blast zone!';
    } else if (s.phase === 'projectile') {
      phaseHintEl.textContent = 'Shell airborne...';
    } else {
      phaseHintEl.textContent = 'WASD Move · Shift Jump · Right-Drag Aim · Hold LMB/Space Fire';
    }

    barAllies.style.width = `${(s.alliesHp / s.maxTeamHp) * 100}%`;
    barAxis.style.width = `${(s.axisHp / s.maxTeamHp) * 100}%`;
    hpAlliesEl.textContent = String(s.alliesHp);
    hpAxisEl.textContent = String(s.axisHp);

    windArrowEl.style.transform = `rotate(${(s.windAngle * 180) / Math.PI}deg)`;
    windSpeedEl.textContent = `${s.windSpeed.toFixed(1)}`;
    btnCam.textContent = s.freeCam ? 'CAM: FREE' : 'CAM: FOLLOW';

    if (s.phase === 'charging') {
      chargeWrap.classList.remove('hidden');
      chargeFill.style.width = `${Math.round(s.charge * 100)}%`;
    } else {
      chargeWrap.classList.add('hidden');
    }

    for (const w of WEAPONS) {
      const btn = weaponButtons.get(w.id)!;
      const count = s.ammo[w.id];
      btn.classList.toggle('active', s.selectedWeapon === w.id);
      btn.disabled = count === 0 || s.isAiTurn || s.phase !== 'aiming';
      const ammoSpan = btn.querySelector('.w-ammo');
      if (ammoSpan) ammoSpan.textContent = count < 0 ? '∞' : String(count);
    }
  },
  onAnnouncement: showAnnouncement,
  onVictory: (winner, stats) => {
    victoryTitle.textContent =
      winner === 'allies'
        ? 'ALLIES VICTORIOUS'
        : winner === 'axis'
        ? 'AXIS VICTORIOUS'
        : 'MUTUAL ANNIHILATION';
    victoryStats.textContent = stats;
    victoryOverlay.classList.remove('hidden');
  },
});

// Build Island Map Picker Cards (clicking previews the 3D island immediately!)
for (const m of WW2_ISLANDS) {
  const btn = document.createElement('button');
  btn.className = `map-btn${m.id === selectedMap ? ' selected' : ''}`;
  btn.innerHTML = `<div class="map-btn-title">${m.name}</div><div class="map-btn-desc">${m.subtitle}</div>`;
  btn.addEventListener('click', () => {
    selectedMap = m.id;
    mapPicker.querySelectorAll('.map-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    game.loadIslandPreview(m.id);
  });
  mapPicker.appendChild(btn);
}

modePicker.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedMode = (btn.getAttribute('data-mode') as GameMode) ?? 'ai';
    modePicker.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

squadPicker.querySelectorAll('button').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedSquadSize = parseInt(btn.getAttribute('data-size') ?? '3', 10);
    squadPicker.querySelectorAll('button').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
  });
});

function deployMatch(): void {
  menuOverlay.classList.add('hidden');
  victoryOverlay.classList.add('hidden');
  helpModal.classList.add('hidden');
  hudEl.classList.remove('hidden');
  game.startMatch(selectedMap, selectedMode, selectedSquadSize);
}

document.getElementById('btn-deploy')!.addEventListener('click', deployMatch);
document.getElementById('btn-rematch')!.addEventListener('click', deployMatch);

document.getElementById('btn-change-map')!.addEventListener('click', () => {
  victoryOverlay.classList.add('hidden');
  hudEl.classList.add('hidden');
  menuOverlay.classList.remove('hidden');
  game.returnToMenu();
});

document.getElementById('btn-menu')!.addEventListener('click', () => {
  hudEl.classList.add('hidden');
  helpModal.classList.add('hidden');
  menuOverlay.classList.remove('hidden');
  game.returnToMenu();
});

btnCam.addEventListener('click', () => game.toggleFreeCamera());

btnMute.addEventListener('click', () => {
  sound.muted = !sound.muted;
  btnMute.textContent = sound.muted ? 'SFX OFF' : 'SFX ON';
});

document.getElementById('btn-help')!.addEventListener('click', () => {
  helpModal.classList.toggle('hidden');
});

document.getElementById('btn-close-help')!.addEventListener('click', () => {
  helpModal.classList.add('hidden');
});
