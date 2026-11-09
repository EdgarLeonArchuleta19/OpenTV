/* screens/profiles-ui.js — Escritorio: "¿Quién está viendo?", editor de perfiles y copia de seguridad.
   Parte del módulo único de la app (ver ui/js/src/README.md). */

/* With two or more profiles the app opens on the picker; choosing one goes
   to Inicio. Profiles are created and edited here or from Mi cuenta. */
var profilePicker = null;
var profilePickerOpen = false;
var profileEditing = false;

function profileTile(p, onClick) {
  var tile = el('div', 'pp-tile focusable');
  var av = el('div', 'pp-avatar');
  av.innerHTML = avatarSvg(p.avatar);
  if (p.kids) { av.appendChild(el('span', 'pp-kids', 'Kids')); }
  var edit = el('div', 'pp-edit');
  edit.innerHTML = uiSvg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>');
  av.appendChild(edit);
  tile.appendChild(av);
  tile.appendChild(el('div', 'pp-name', p.name));
  tile._activate = onClick;
  tile.addEventListener('click', function (event) { event.stopPropagation(); onClick(); });
  return tile;
}

function renderProfilePicker() {
  clear(profilePicker);
  var box = el('div', 'pp-box');
  box.appendChild(el('div', 'pp-title', profileEditing ? 'Administrar perfiles' : '¿Quién está viendo?'));
  var grid = el('div', 'pp-grid');
  profilesData.list.forEach(function (p) {
    grid.appendChild(profileTile(p, function () {
      if (profileEditing) { openProfileEditor(p); return; }
      chooseProfile(p.id);
    }));
  });
  if (profilesData.list.length < PROFILES_MAX) {
    var add = el('div', 'pp-tile is-add focusable');
    var plus = el('div', 'pp-avatar');
    plus.innerHTML = uiSvg('<path d="M12 5v14M5 12h14"/>');
    add.appendChild(plus);
    add.appendChild(el('div', 'pp-name', 'Añadir perfil'));
    add._activate = function () { openProfileEditor(null); };
    add.addEventListener('click', function (event) { event.stopPropagation(); add._activate(); });
    grid.appendChild(add);
  }
  box.appendChild(grid);
  var manage = el('button', 'pp-manage focusable' + (profileEditing ? ' is-on' : ''), profileEditing ? 'Listo' : 'Administrar perfiles');
  manage.type = 'button';
  manage._activate = function () { profileEditing = !profileEditing; profilePicker.classList.toggle('is-editing', profileEditing); renderProfilePicker(); };
  manage.addEventListener('click', function (event) { event.stopPropagation(); manage._activate(); });
  box.appendChild(manage);
  profilePicker.appendChild(box);
  var first = grid.querySelector('.pp-tile');
  if (first) { setFocus(first, true); }
}

function showProfilePicker(editing) {
  if (!window.XUPER_DESKTOP) { return; }
  if (!profilePicker) {
    profilePicker = el('div', 'profile-picker');
    profilePicker.setAttribute('data-no-gesture', '');
    document.body.appendChild(profilePicker);
  }
  profileEditing = !!editing;
  profilePicker.classList.toggle('is-editing', profileEditing);
  profilePickerOpen = true;
  renderProfilePicker();
  profilePicker.classList.add('is-open');
}

function hideProfilePicker() {
  profilePickerOpen = false;
  if (profilePicker) { profilePicker.classList.remove('is-open'); }
  var start = homeTabIndex();
  if (state.screen === 'home' && pages[TABS[start] ? TABS[start].page : 1]) {
    var f = firstIn(pages[TABS[start].page]);
    if (f) { setFocus(f, true); }
  }
}

function chooseProfile(id) {
  if (switchToProfile(id)) { return; }   /* reloads with that profile */
  hideProfilePicker();
}

/* ------------------------------------------------------------ editor */
var profileEditor = null;
function openProfileEditor(p) {
  var isNew = !p;
  var draft = p ? { name: p.name, avatar: p.avatar, kids: !!p.kids } : { name: '', avatar: profilesData.list.length % AVATARS.length, kids: false };
  if (!profileEditor) {
    profileEditor = el('div', 'profile-editor');
    profileEditor.setAttribute('data-no-gesture', '');
    document.body.appendChild(profileEditor);
  }
  clear(profileEditor);
  var card = el('div', 'pe2-card');
  card.appendChild(el('div', 'pe2-title', isNew ? 'Añadir perfil' : 'Editar perfil'));
  var top = el('div', 'pe2-top');
  var preview = el('div', 'pe2-preview');
  preview.innerHTML = avatarSvg(draft.avatar);
  top.appendChild(preview);
  var name = document.createElement('input');
  name.type = 'text';
  name.maxLength = 20;
  name.className = 'pe2-name focusable';
  name.placeholder = 'Nombre';
  name.value = draft.name;
  name.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); save(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    event.stopPropagation();
  });
  top.appendChild(name);
  card.appendChild(top);

  card.appendChild(el('div', 'pe2-label', 'Elige un avatar'));
  var grid = el('div', 'pe2-avatars');
  AVATARS.forEach(function (a, i) {
    var b = el('button', 'pe2-av focusable' + (i === draft.avatar ? ' is-selected' : ''));
    b.type = 'button';
    b.innerHTML = avatarSvg(i);
    b.addEventListener('click', function () {
      draft.avatar = i;
      preview.innerHTML = avatarSvg(i);
      var all = grid.querySelectorAll('.pe2-av');
      for (var k = 0; k < all.length; k++) { all[k].classList.toggle('is-selected', all[k] === b); }
    });
    grid.appendChild(b);
  });
  card.appendChild(grid);

  var kids = el('label', 'pe2-kids');
  var box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = draft.kids;
  kids.appendChild(box);
  var kt = el('span');
  kt.appendChild(el('b', null, 'Perfil infantil'));
  kt.appendChild(el('small', null, 'Solo la sección Kids: sin TV en vivo, buscador ni contenido para adultos.'));
  kids.appendChild(kt);
  card.appendChild(kids);

  var msg = el('div', 'pe2-msg', '');
  card.appendChild(msg);
  var actions = el('div', 'pe2-actions');
  var ok = el('button', 'pe2-btn is-primary', 'Guardar');
  ok.type = 'button';
  ok.addEventListener('click', save);
  var cancel = el('button', 'pe2-btn', 'Cancelar');
  cancel.type = 'button';
  cancel.addEventListener('click', close);
  actions.appendChild(ok);
  actions.appendChild(cancel);
  if (!isNew && profilesData.list.length > 1) {
    var del = el('button', 'pe2-btn is-danger', 'Eliminar perfil');
    del.type = 'button';
    var armed = false;
    del.addEventListener('click', function () {
      if (!armed) { armed = true; del.textContent = '¿Seguro? Se borrará su historial y Mi lista'; return; }
      deleteProfile(p.id);
      close();
    });
    actions.appendChild(del);
  }
  card.appendChild(actions);
  profileEditor.appendChild(card);
  profileEditor.classList.add('is-open');
  setTimeout(function () { name.focus(); }, 50);

  function save() {
    var n = String(name.value || '').replace(/\s+/g, ' ').trim();
    if (!n) { msg.textContent = 'Escribe un nombre.'; name.focus(); return; }
    for (var i = 0; i < profilesData.list.length; i++) {
      if (profilesData.list[i] !== p && profilesData.list[i].name.toLowerCase() === n.toLowerCase()) { msg.textContent = 'Ya hay un perfil con ese nombre.'; return; }
    }
    if (isNew) {
      profilesData.list.push({ id: 'p' + Date.now().toString(36), name: n, avatar: draft.avatar, kids: box.checked, createdAt: Date.now() });
    } else {
      p.name = n; p.avatar = draft.avatar; p.kids = box.checked;
    }
    profilesData.created = true;
    saveProfiles();
    close();
    if (profilePickerOpen) { renderProfilePicker(); }
    refreshProfileChrome();
    /* Changing "infantil" on the profile in use needs the app to reload. */
    if (!isNew && p.id === activeProfileId) { setTimeout(function () { location.reload(); }, 150); }
  }
  function close() {
    profileEditor.classList.remove('is-open');
    if (profilePickerOpen) { renderProfilePicker(); }
  }
}

function deleteProfile(id) {
  if (profilesData.list.length < 2) { return; }
  profilesData.list = profilesData.list.filter(function (x) { return x.id !== id; });
  if (id !== 'main') {
    PROFILE_SCOPED_KEYS.forEach(function (k) { try { localStorage.removeItem(k + '@' + id); } catch (eDel) { /* gone */ } });
  }
  if (profilesData.last === id) { profilesData.last = profilesData.list[0].id; }
  saveProfiles();
  if (id === activeProfileId) { switchToProfile(profilesData.list[0].id); }
}

/* Avatar on the top bar instead of the generic user icon. */
function refreshProfileChrome() {
  var btn = document.querySelector('.home-notify .notify-item.personal');
  if (!btn) { return; }
  var p = activeProfile();
  var n = btn.querySelector('.n-normal');
  if (n) { n.innerHTML = avatarSvg(p.avatar); n.classList.add('is-avatar'); }
  btn.setAttribute('data-tip', p.name + ' · Mi cuenta y perfiles');
}

/* --------------------------------------------------------------- backup */
var profilesBackupTimer = null;
function profilesBackupApi() {
  return window.XUPER_DESKTOP && window.desktop && window.desktop.backup ? window.desktop.backup : null;
}
function collectProfilesBackup() {
  var data = { kind: 'opentv-profiles', version: 1, savedAt: Date.now(), profiles: profilesData, values: {} };
  profilesData.list.forEach(function (p) {
    PROFILE_SCOPED_KEYS.forEach(function (k) {
      var key = p.id === 'main' ? k : k + '@' + p.id;
      var raw = null;
      try { raw = localStorage.getItem(key); } catch (eRead) { raw = null; }
      if (raw !== null) { data.values[key] = raw; }
    });
  });
  return data;
}
function scheduleProfilesBackup() {
  var api = profilesBackupApi();
  if (!api || profilesBackupTimer) { return; }
  profilesBackupTimer = setTimeout(function () {
    profilesBackupTimer = null;
    api.write(collectProfilesBackup()).catch(function () {});
  }, 4000);
}

/* A fresh install (no profiles, no history) with a backup from before:
   offer to bring it back. */
function offerProfilesRestore(done) {
  var api = profilesBackupApi();
  var fresh = !localStorage.getItem(PROFILES_KEY) && !((localProfile.history || []).length) && !Object.keys(state.favs || {}).length;
  if (!api || !fresh) { done(false); return; }
  api.read().then(function (data) {
    if (!data || !data.profiles || !data.profiles.list || !data.values) { done(false); return; }
    var names = data.profiles.list.map(function (p) { return p.name; }).join(', ');
    var box = el('div', 'profile-restore');
    var card = el('div', 'pr-card');
    card.appendChild(el('div', 'pr-title', 'Encontramos tus perfiles'));
    card.appendChild(el('div', 'pr-text', 'Hay una copia de una instalación anterior de OpenTV con ' +
      data.profiles.list.length + (data.profiles.list.length === 1 ? ' perfil' : ' perfiles') + ' (' + names + '), con su historial y Mi lista. ¿Quieres restaurarla?'));
    var row = el('div', 'pe2-actions');
    var yes = el('button', 'pe2-btn is-primary', 'Restaurar');
    yes.type = 'button';
    var no = el('button', 'pe2-btn', 'Empezar de cero');
    no.type = 'button';
    yes.addEventListener('click', function () {
      try {
        Object.keys(data.values).forEach(function (k) { localStorage.setItem(k, data.values[k]); });
        localStorage.setItem(PROFILES_KEY, JSON.stringify(data.profiles));
      } catch (eRestore) { /* storage full */ }
      location.reload();
    });
    no.addEventListener('click', function () { box.remove(); done(false); });
    row.appendChild(yes);
    row.appendChild(no);
    card.appendChild(row);
    box.appendChild(card);
    document.body.appendChild(box);
    done(true);
  }).catch(function () { done(false); });
}

/* Start-up: restore offer on a fresh install, then the picker when there
   are several profiles (once per app start). */
function installProfiles() {
  if (!window.XUPER_DESKTOP) { return; }
  refreshProfileChrome();
  document.addEventListener('keydown', function (event) {
    if (!profilePickerOpen || (profileEditor && profileEditor.classList.contains('is-open'))) { return; }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (profileEditing) { profileEditing = false; profilePicker.classList.remove('is-editing'); renderProfilePicker(); }
      else { chooseProfile(activeProfileId); }
    }
  }, true);
  offerProfilesRestore(function (shown) {
    if (shown) { return; }
    if (profilesData.list.length > 1 && !profileChosenThisSession) { showProfilePicker(false); }
    scheduleProfilesBackup();
  });
}
