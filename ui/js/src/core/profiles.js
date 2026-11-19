/* core/profiles.js — Perfiles locales (como en Netflix): lista, perfil activo y avatares.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* Everything stays on this computer. Each profile keeps its own history,
   Mi lista, searches, TV favourites/recents, preferences and private
   setting: those storage keys get the profile id appended ("key@p3"). The
   first profile ("main") keeps the original keys, so the data that existed
   before profiles is simply that profile's. The active profile is chosen
   before the rest of the app loads (the app reloads to switch). */
var PROFILES_KEY = 'opentv_profiles_v1';
var ACTIVE_PROFILE_SESSION = 'opentv_active_profile';
var PROFILES_MAX = 6;
var PROFILE_SCOPED_KEYS = [
  'opentv_local_profile_v1', 'opentv_global_playback_v1', 'opentv_recent_searches_v1',
  'opentv_live_saved_v1', 'opentv_catalog_density_v1'
];

function readProfiles() {
  var data = null;
  try { data = JSON.parse(localStorage.getItem(PROFILES_KEY) || 'null'); } catch (eRead) { data = null; }
  if (!data || !data.list || !data.list.length) {
    data = { list: [{ id: 'main', name: 'Mi usuario', avatar: 0, kids: false, createdAt: Date.now() }], last: 'main', created: false };
  }
  return data;
}

var profilesData = readProfiles();
var activeProfileId = (function () {
  var chosen = null;
  try { chosen = sessionStorage.getItem(ACTIVE_PROFILE_SESSION); } catch (eSession) { chosen = null; }
  var want = chosen || profilesData.last || 'main';
  for (var i = 0; i < profilesData.list.length; i++) { if (profilesData.list[i].id === want) { return want; } }
  return profilesData.list[0].id;
})();
/* True when this start-up already went through the profile picker. */
var profileChosenThisSession = (function () {
  try { return !!sessionStorage.getItem(ACTIVE_PROFILE_SESSION); } catch (eSession) { return false; }
})();

function activeProfile() {
  for (var i = 0; i < profilesData.list.length; i++) {
    if (profilesData.list[i].id === activeProfileId) { return profilesData.list[i]; }
  }
  return profilesData.list[0];
}
function isKidsProfile() { return !!(window.OPENTV_DESKTOP && activeProfile().kids); }

function profileKey(key) {
  if (!window.OPENTV_DESKTOP || activeProfileId === 'main' || PROFILE_SCOPED_KEYS.indexOf(key) === -1) { return key; }
  return key + '@' + activeProfileId;
}

function saveProfiles() {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(profilesData)); } catch (eSave) { /* storage full */ }
  if (typeof scheduleProfilesBackup === 'function') { scheduleProfilesBackup(); }
}

/* Switches profile: remember the choice for this session and reload, so
   every module starts with that profile's data. */
function switchToProfile(id) {
  profilesData.last = id;
  saveProfiles();
  try { sessionStorage.setItem(ACTIVE_PROFILE_SESSION, id); } catch (eSession) { /* private mode */ }
  if (id === activeProfileId) { return false; }
  location.reload();
  return true;
}

/* ------------------------------------------------------------- tabs */
/* Where the app starts and where Esc on the home screen goes: Inicio on
   desktop (Kids for a kids profile), TV on the TV set. */
function homeTabIndex() {
  if (!window.OPENTV_DESKTOP) { return 0; }
  var want = isKidsProfile() ? 4 : 1;
  for (var i = 0; i < TABS.length; i++) { if (TABS[i].page === want) { return i; } }
  return 0;
}
function onTvTab() { var t = TABS[state.tab]; return !!t && t.page === 0; }

/* ----------------------------------------------------------- avatars */
/* Drawn avatars: a coloured tile and a simple face. New ones go at the end
   (profiles keep their avatar by its index). */
var AVATARS = [
  { a: '#3a7bff', b: '#8a4dff', face: 'smile' },
  { a: '#ff5f6d', b: '#ffc371', face: 'cat' },
  { a: '#11998e', b: '#38ef7d', face: 'robot' },
  { a: '#f7b733', b: '#fc4a1a', face: 'star' },
  { a: '#ff6fd8', b: '#3813c2', face: 'bunny' },
  { a: '#00c6ff', b: '#0072ff', face: 'alien' },
  { a: '#232526', b: '#5b5e62', face: 'tv' },
  { a: '#ff9a44', b: '#fc6076', face: 'fox' },
  { a: '#7f53ac', b: '#647dee', face: 'ghost' },
  { a: '#e52d27', b: '#b31217', face: 'love' },
  { a: '#141e30', b: '#3a6186', face: 'planet' },
  { a: '#a8e063', b: '#56ab2f', face: 'frog' },
  { a: '#8e5a2b', b: '#c48a4a', face: 'bear' },
  { a: '#3e3e46', b: '#8a8a96', face: 'panda' },
  { a: '#b06ab3', b: '#4568dc', face: 'owl' },
  { a: '#1e3c72', b: '#2a5298', face: 'penguin' },
  { a: '#56ab2f', b: '#1d976c', face: 'dino' },
  { a: '#f12711', b: '#f5af19', face: 'cool' },
  { a: '#ec008c', b: '#fc6767', face: 'wink' },
  { a: '#0f2027', b: '#2c5364', face: 'ninja' },
  { a: '#8e0e00', b: '#1f1c18', face: 'pirate' },
  { a: '#f7971e', b: '#ffd200', face: 'crown' },
  { a: '#e53935', b: '#e35d5b', face: 'popcorn' },
  { a: '#7b4397', b: '#dc2430', face: 'monster' }
];

var avatarSvgSeq = 0;
function avatarSvg(index) {
  var av = AVATARS[(index >>> 0) % AVATARS.length];
  /* A unique gradient id per drawing: copies of one id clash. */
  var g = 'av' + index + '-' + (++avatarSvgSeq);
  var eyes = '<circle cx="36" cy="44" r="6" fill="#fff"/><circle cx="64" cy="44" r="6" fill="#fff"/>';
  var mouth = '<path d="M36 64c8 8 20 8 28 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
  var extra = '';
  switch (av.face) {
    case 'cat': extra = '<path d="M20 30 26 8l14 14M80 30 74 8 60 22" fill="#fff" opacity=".9"/>'; break;
    case 'robot':
      eyes = '<rect x="28" y="38" width="14" height="12" rx="3" fill="#fff"/><rect x="58" y="38" width="14" height="12" rx="3" fill="#fff"/>';
      mouth = '<rect x="34" y="62" width="32" height="7" rx="3.5" fill="#fff"/>';
      extra = '<path d="M50 22V10" stroke="#fff" stroke-width="4" stroke-linecap="round"/><circle cx="50" cy="9" r="4" fill="#fff"/>'; break;
    case 'star': extra = '<path d="M50 6l4 9 10 1-7 7 2 10-9-5-9 5 2-10-7-7 10-1z" fill="#fff" opacity=".95"/>'; break;
    case 'bunny': extra = '<rect x="30" y="2" width="11" height="28" rx="5.5" fill="#fff" opacity=".9"/><rect x="59" y="2" width="11" height="28" rx="5.5" fill="#fff" opacity=".9"/>'; break;
    case 'alien':
      eyes = '<ellipse cx="34" cy="46" rx="8" ry="10" fill="#fff"/><ellipse cx="66" cy="46" rx="8" ry="10" fill="#fff"/><circle cx="50" cy="30" r="5" fill="#fff"/>';
      mouth = '<path d="M42 68h16" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
    case 'tv':
      extra = '<path d="M38 12 50 22 62 12" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><rect x="18" y="24" width="64" height="52" rx="10" fill="none" stroke="#fff" stroke-width="4"/>';
      eyes = '<circle cx="38" cy="46" r="5" fill="#fff"/><circle cx="62" cy="46" r="5" fill="#fff"/>';
      mouth = '<path d="M40 60c6 5 14 5 20 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; break;
    case 'fox': extra = '<path d="M16 34 22 6l22 18M84 34 78 6 56 24" fill="#fff" opacity=".85"/><path d="M44 58l6 6 6-6z" fill="#fff"/>'; mouth = ''; break;
    case 'ghost':
      extra = '<path d="M22 88V42a28 28 0 0 1 56 0v46l-9-7-10 7-9-7-10 7-9-7z" fill="#fff" opacity=".22"/>';
      eyes = '<ellipse cx="38" cy="44" rx="6" ry="8" fill="#fff"/><ellipse cx="62" cy="44" rx="6" ry="8" fill="#fff"/>';
      mouth = '<ellipse cx="50" cy="64" rx="6" ry="7" fill="#fff"/>'; break;
    case 'love':
      eyes = '<path d="M36 50l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z" fill="#fff"/><path d="M64 50l-8-8a5 5 0 0 1 8-6 5 5 0 0 1 8 6z" fill="#fff"/>'; break;
    case 'planet': extra = '<ellipse cx="50" cy="50" rx="44" ry="12" fill="none" stroke="#fff" stroke-width="3" opacity=".5" transform="rotate(-18 50 50)"/><circle cx="80" cy="18" r="3" fill="#fff"/><circle cx="18" cy="80" r="2" fill="#fff"/>'; break;
    case 'frog': eyes = '<circle cx="34" cy="34" r="10" fill="#fff"/><circle cx="66" cy="34" r="10" fill="#fff"/><circle cx="34" cy="34" r="4" fill="#123"/><circle cx="66" cy="34" r="4" fill="#123"/>'; mouth = '<path d="M28 62c12 10 32 10 44 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
    case 'bear':
      extra = '<circle cx="22" cy="20" r="11" fill="#fff" opacity=".85"/><circle cx="78" cy="20" r="11" fill="#fff" opacity=".85"/><ellipse cx="50" cy="62" rx="15" ry="11" fill="#fff" opacity=".3"/><ellipse cx="50" cy="57" rx="5" ry="4" fill="#fff"/>';
      mouth = '<path d="M43 66c4 4 10 4 14 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; break;
    case 'panda':
      extra = '<circle cx="20" cy="18" r="11" fill="#111" opacity=".6"/><circle cx="80" cy="18" r="11" fill="#111" opacity=".6"/><ellipse cx="34" cy="46" rx="11" ry="13" fill="#111" opacity=".55" transform="rotate(-20 34 46)"/><ellipse cx="66" cy="46" rx="11" ry="13" fill="#111" opacity=".55" transform="rotate(20 66 46)"/>';
      eyes = '<circle cx="35" cy="46" r="4.5" fill="#fff"/><circle cx="65" cy="46" r="4.5" fill="#fff"/>';
      mouth = '<path d="M44 64c3 4 9 4 12 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/><ellipse cx="50" cy="58" rx="5" ry="3.5" fill="#fff"/>'; break;
    case 'owl':
      extra = '<path d="M18 22 30 30M82 22 70 30" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
      eyes = '<circle cx="34" cy="46" r="13" fill="#fff"/><circle cx="66" cy="46" r="13" fill="#fff"/><circle cx="34" cy="46" r="5" fill="#222"/><circle cx="66" cy="46" r="5" fill="#222"/>';
      mouth = '<path d="M44 62l6 9 6-9z" fill="#ffd34d"/>'; break;
    case 'penguin':
      extra = '<ellipse cx="50" cy="60" rx="28" ry="32" fill="#fff" opacity=".92"/>';
      eyes = '<circle cx="40" cy="46" r="5" fill="#1e3c72"/><circle cx="60" cy="46" r="5" fill="#1e3c72"/>';
      mouth = '<path d="M42 56h16l-8 9z" fill="#ffb02e"/>'; break;
    case 'dino':
      extra = '<path d="M30 14l6-10 6 10M46 10l6-10 6 10M62 14l6-10 6 10" fill="#fff" opacity=".85"/>';
      eyes = '<circle cx="34" cy="42" r="6" fill="#fff"/><circle cx="66" cy="42" r="6" fill="#fff"/>';
      mouth = '<path d="M28 62h44" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M38 62v6M50 62v6M62 62v6" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'; break;
    case 'cool':
      eyes = '<path d="M20 38h60" stroke="#111" stroke-width="5" stroke-linecap="round"/><rect x="22" y="38" width="24" height="14" rx="6" fill="#111"/><rect x="54" y="38" width="24" height="14" rx="6" fill="#111"/>';
      mouth = '<path d="M38 66c8 6 18 4 26-4" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
    case 'wink':
      eyes = '<circle cx="36" cy="44" r="6" fill="#fff"/><path d="M57 45c3-4 11-4 14 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
      mouth = '<path d="M34 62c10 10 24 10 32 0" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M58 66c2 6 8 8 10 2" fill="#ff8fb1"/>'; break;
    case 'ninja':
      extra = '<rect x="10" y="32" width="80" height="26" rx="6" fill="#111" opacity=".75"/><path d="M84 40l12-6-6 12" fill="#e52d27"/>';
      eyes = '<path d="M28 46l14 2M58 48l14-2" stroke="#fff" stroke-width="6" stroke-linecap="round"/>';
      mouth = ''; break;
    case 'pirate':
      extra = '<path d="M14 30c10-22 62-22 72 0z" fill="#111" opacity=".8"/><circle cx="50" cy="20" r="4" fill="#fff"/><path d="M20 36 80 50" stroke="#111" stroke-width="3"/>';
      eyes = '<circle cx="36" cy="46" r="6" fill="#fff"/><ellipse cx="64" cy="47" rx="9" ry="8" fill="#111"/>';
      mouth = '<path d="M38 66c8 4 18 4 24-2" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round"/>'; break;
    case 'crown':
      extra = '<path d="M24 26 30 6l12 12 8-14 8 14 12-12 6 20z" fill="#fff" opacity=".95"/>'; break;
    case 'popcorn':
      extra = '<path d="M28 44h44l-6 46H34z" fill="#fff"/><path d="M38 44l2 46M50 44v46M62 44l-2 46" stroke="#e53935" stroke-width="4"/><circle cx="34" cy="38" r="9" fill="#fff6d5"/><circle cx="50" cy="32" r="10" fill="#fff6d5"/><circle cx="66" cy="38" r="9" fill="#fff6d5"/>';
      eyes = '<circle cx="42" cy="60" r="3.5" fill="#e53935"/><circle cx="58" cy="60" r="3.5" fill="#e53935"/>';
      mouth = '<path d="M44 70c3 3 9 3 12 0" fill="none" stroke="#e53935" stroke-width="3.5" stroke-linecap="round"/>'; break;
    case 'monster':
      extra = '<path d="M26 22 18 6M74 22 82 6" stroke="#fff" stroke-width="5" stroke-linecap="round"/>';
      eyes = '<circle cx="50" cy="42" r="14" fill="#fff"/><circle cx="50" cy="42" r="6" fill="#222"/>';
      mouth = '<path d="M30 66h40" stroke="#fff" stroke-width="5" stroke-linecap="round"/><path d="M36 66l4 8 4-8M56 66l4 8 4-8" fill="#fff"/>'; break;
  }
  return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="' + g + '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' + av.a + '"/><stop offset="1" stop-color="' + av.b + '"/></linearGradient></defs>' +
    '<rect width="100" height="100" rx="18" fill="url(#' + g + ')"/>' + extra + eyes + mouth + '</svg>';
}
