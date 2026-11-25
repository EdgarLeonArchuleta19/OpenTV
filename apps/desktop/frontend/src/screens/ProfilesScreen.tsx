import React, { useState } from 'react';
import { Lock, Pencil, Plus, X } from 'lucide-react';
import type { UserProfile } from '../types/models';
import { AVATARS, ProfileAvatar } from '../components/Avatars';

interface ProfilesScreenProps {
  initialManage?: boolean;
  profiles: UserProfile[];
  activeProfileId: string;
  parentalPin: string;
  parentalLocked: boolean;
  onSelectProfile: (id: string) => void;
  onAddProfile: (name: string, kids: boolean, avatarIndex: number) => void;
  onUpdateProfile: (id: string, patch: Partial<Pick<UserProfile, 'name' | 'kids' | 'avatarIndex'>>) => void;
  onRemoveProfile: (id: string) => void;
  onToast: (msg: string) => void;
}

/**
 * Exact 1:1 replica of OpenTV v1 Profiles screen (`07-inicio-hero-perfiles.css:303-386` + `core/profiles.js`):
 * - Radial page-glow backdrop (`--ot-glow` → `--ot-bg`)
 * - Centered `¿Quién está viendo?` + all 24 gradient SVG avatars + `"KIDS"` badge + dashed `+ Agregar` tile
 * - Manage mode with pencil overlay + 8-column avatar picker modal + 4-digit Parental PIN gate.
 */
export const ProfilesScreen: React.FC<ProfilesScreenProps> = ({
  initialManage = false,
  profiles,
  activeProfileId,
  parentalPin,
  parentalLocked,
  onSelectProfile,
  onAddProfile,
  onUpdateProfile,
  onRemoveProfile,
  onToast,
}) => {
  const [manageMode, setManageMode] = useState(initialManage);
  const [editorProfile, setEditorProfile] = useState<UserProfile | 'new' | null>(null);
  const [edName, setEdName] = useState('');
  const [edKids, setEdKids] = useState(false);
  const [edAvatar, setEdAvatar] = useState(0);

  const [pinTargetId, setPinTargetId] = useState<string | null>(null);
  const [pinEntry, setPinEntry] = useState('');
  const [pinError, setPinError] = useState(false);

  const activeProfile = profiles.find((p) => p.id === activeProfileId);

  const openEditor = (p: UserProfile | 'new') => {
    setEditorProfile(p);
    if (p === 'new') {
      setEdName('');
      setEdKids(false);
      setEdAvatar(profiles.length % AVATARS.length);
    } else {
      setEdName(p.name);
      setEdKids(p.kids);
      setEdAvatar(p.avatarIndex);
    }
  };

  const handleTileClick = (p: UserProfile) => {
    if (manageMode) {
      openEditor(p);
      return;
    }
    if (parentalLocked && parentalPin.length === 4 && activeProfile?.kids && !p.kids) {
      setPinTargetId(p.id);
      setPinEntry('');
      setPinError(false);
      return;
    }
    onSelectProfile(p.id);
  };

  const handleSaveEditor = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = edName.trim();
    if (!clean) return;
    if (editorProfile === 'new') {
      onAddProfile(clean, edKids, edAvatar);
      onToast('Perfil agregado');
    } else if (editorProfile) {
      onUpdateProfile(editorProfile.id, { name: clean, kids: edKids, avatarIndex: edAvatar });
      onToast('Perfil actualizado');
    }
    setEditorProfile(null);
  };

  const handleVerifyPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinEntry === parentalPin && pinTargetId) {
      const target = pinTargetId;
      setPinTargetId(null);
      setPinEntry('');
      onSelectProfile(target);
    } else {
      setPinError(true);
      setPinEntry('');
    }
  };

  return (
    <div
      style={{ background: 'radial-gradient(70% 70% at 50% 40%, var(--ot-glow) 0%, var(--ot-bg) 70%)' }}
      className="flex h-full w-full flex-col items-center justify-center px-8 py-12"
    >
      <div className="flex flex-col items-center gap-10">
        <h1 className="font-display text-[clamp(30px,3.6vw,46px)] font-semibold tracking-[-0.015em] text-fg">
          {manageMode ? 'Administrar perfiles' : '¿Quién está viendo?'}
        </h1>

        <div className="flex max-w-[1040px] flex-wrap items-center justify-center gap-7">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleTileClick(p)}
              className="group flex w-[clamp(112px,11vw,158px)] flex-col items-center gap-3.5 cursor-pointer"
            >
              <div className="relative aspect-square w-full overflow-hidden rounded-[16%] transition duration-200 group-hover:scale-105 group-hover:ring-4 group-hover:ring-fg">
                <ProfileAvatar index={p.avatarIndex} className="h-full w-full" />
                {p.kids && (
                  <span className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[11px] font-extrabold tracking-wide text-white">
                    KIDS
                  </span>
                )}
                {manageMode && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white">
                    <Pencil className="h-9 w-9" />
                  </div>
                )}
              </div>
              <span className="truncate text-[17px] font-medium text-fg/65 transition group-hover:text-fg">
                {p.name}
              </span>
            </button>
          ))}

          {profiles.length < 6 && (
            <button
              type="button"
              onClick={() => openEditor('new')}
              className="group flex w-[clamp(112px,11vw,158px)] flex-col items-center gap-3.5 cursor-pointer"
            >
              <div className="flex aspect-square w-full items-center justify-center rounded-[16%] border-2 border-dashed border-fg/30 bg-fg/[0.03] text-fg/60 transition duration-200 group-hover:scale-105 group-hover:border-fg group-hover:text-fg">
                <Plus className="h-12 w-12" />
              </div>
              <span className="text-[17px] font-medium text-fg/65 transition group-hover:text-fg">Agregar</span>
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setManageMode((m) => !m)}
          style={manageMode ? { backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' } : undefined}
          className={`rounded-[10px] border px-7 py-2.5 text-[14.5px] font-semibold tracking-[0.08em] uppercase transition cursor-pointer ${
            manageMode
              ? 'border-transparent'
              : 'border-fg/35 bg-transparent text-fg/75 hover:border-fg hover:text-fg'
          }`}
        >
          {manageMode ? 'Listo' : 'Administrar perfiles'}
        </button>
      </div>

      {/* Exact Profile Editor Modal with 8-column 24-Avatar Picker (`07-inicio-hero-perfiles.css:353-385`) */}
      {editorProfile !== null && (
        <div
          data-ot-modal
          onClick={() => setEditorProfile(null)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/72 p-6 backdrop-blur-md"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleSaveEditor}
            className="ot-fade-up max-h-[88vh] w-full max-w-[540px] space-y-5 overflow-y-auto rounded-[22px] border border-fg/12 bg-[#16161b]/98 light:bg-surface p-7 shadow-[0_30px_90px_rgba(0,0,0,0.65)]"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[22px] font-bold text-fg">
                {editorProfile === 'new' ? 'Nuevo perfil' : 'Editar perfil'}
              </h2>
              <button
                type="button"
                onClick={() => setEditorProfile(null)}
                className="flex h-8 w-8 items-center justify-center rounded-full text-fg/60 hover:bg-fg/10 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center gap-4">
              <ProfileAvatar index={edAvatar} size={78} className="shrink-0" />
              <input
                type="text"
                value={edName}
                onChange={(e) => setEdName(e.target.value)}
                maxLength={24}
                placeholder="Nombre del perfil"
                autoFocus
                className="h-12 min-w-0 flex-1 rounded-[12px] border border-fg/15 bg-fg/[0.06] px-4 text-[17px] text-fg placeholder-fg/40 light:placeholder-faint outline-none focus:border-fg"
              />
            </div>

            <div>
              <div className="mb-2.5 text-[12px] font-semibold tracking-[0.08em] text-fg/50 light:text-muted uppercase">Avatar</div>
              <div className="grid grid-cols-8 gap-2.5">
                {AVATARS.map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setEdAvatar(idx)}
                    className={`aspect-square overflow-hidden rounded-[12px] transition cursor-pointer ${
                      edAvatar === idx
                        ? 'scale-105 opacity-100 ring-[3px] ring-fg'
                        : 'opacity-75 hover:scale-105 hover:opacity-100'
                    }`}
                  >
                    <ProfileAvatar index={idx} className="h-full w-full" />
                  </button>
                ))}
              </div>
            </div>

            {(editorProfile === 'new' || editorProfile.id !== 'main') && (
              <label className="flex cursor-pointer items-start gap-3 rounded-[12px] bg-fg/[0.05] px-4 py-3">
                <input
                  type="checkbox"
                  checked={edKids}
                  onChange={(e) => setEdKids(e.target.checked)}
                  className="mt-1 h-4 w-4 accent-fg"
                />
                <span>
                  <b className="block text-[14.5px] text-fg">Perfil infantil (Kids)</b>
                  <small className="text-[12.5px] text-fg/55 light:text-muted">Muestra solo contenido familiar.</small>
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              <button
                type="submit"
                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                className="rounded-[10px] px-6 py-2.5 text-[14.5px] font-bold cursor-pointer"
              >
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setEditorProfile(null)}
                className="rounded-[10px] border border-fg/18 px-5 py-2.5 text-[14.5px] font-semibold text-fg hover:bg-fg/10 cursor-pointer"
              >
                Cancelar
              </button>
              {editorProfile !== 'new' && editorProfile.id !== 'main' && (
                <button
                  type="button"
                  onClick={() => {
                    onRemoveProfile(editorProfile.id);
                    setEditorProfile(null);
                    onToast(`Perfil “${editorProfile.name}” eliminado`);
                  }}
                  className="ml-auto rounded-[10px] border border-[#ff8a8a]/35 px-4 py-2.5 text-[14px] font-semibold text-[#ff8a8a] light:text-[#c62828] hover:bg-[#ff5a5a]/15 cursor-pointer"
                >
                  Eliminar
                </button>
              )}
            </div>
          </form>
        </div>
      )}

      {/* Parental PIN Gate Modal */}
      {pinTargetId && (
        <div
          data-ot-modal
          onClick={() => setPinTargetId(null)}
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-6 backdrop-blur-sm"
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleVerifyPin}
            className="ot-fade-up w-full max-w-sm space-y-5 rounded-[24px] border border-fg/10 bg-surface p-7 text-center shadow-2xl"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-fg/10 text-fg">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-[20px] font-bold text-fg">PIN de bloqueo</h2>
              <p className="mt-1 text-[13px] text-fg/55 light:text-muted">Ingresa el PIN de 4 dígitos para salir de Kids.</p>
            </div>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinEntry}
              onChange={(e) => {
                setPinEntry(e.target.value.replace(/\D/g, '').slice(0, 4));
                setPinError(false);
              }}
              autoFocus
              placeholder="••••"
              className="h-12 w-full rounded-xl border border-fg/15 bg-fg/[0.06] text-center text-[22px] font-bold tracking-[0.5em] text-fg outline-none focus:border-fg/40"
            />
            {pinError && <div className="text-[13px] font-semibold text-[#ff7377] light:text-[#c62828]">PIN incorrecto</div>}
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => setPinTargetId(null)}
                className="rounded-xl px-4 py-2 text-[14px] font-semibold text-fg/70 hover:text-fg cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
                className="rounded-xl px-6 py-2 text-[14px] font-bold cursor-pointer"
              >
                Desbloquear
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
