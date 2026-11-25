import React, { useEffect, useRef } from 'react';
import { Download, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react';
import type { UpdateStatus } from '../types/models';
import { formatBytes } from '../services/sourceRanker';

interface ForceUpdateGateProps {
  currentVersion: string;
  status: UpdateStatus;
  onDownload: () => void;
  onInstall: () => void;
  onRetryCheck: () => void;
  onOpenReleases: () => void;
}

/**
 * Non-dismissible full-screen update gate that enforces running only the latest release of OpenTV.
 * Leaves the top 36px window drag/close bar accessible so the user can still close the app window.
 */
export const ForceUpdateGate: React.FC<ForceUpdateGateProps> = ({
  currentVersion,
  status,
  onDownload,
  onInstall,
  onRetryCheck,
  onOpenReleases,
}) => {
  const autoInstalledRef = useRef(false);

  // Auto-launch the downloaded installer as soon as download finishes
  useEffect(() => {
    if (status.state === 'ready' && !autoInstalledRef.current) {
      autoInstalledRef.current = true;
      onInstall();
    }
    if (status.state !== 'ready' && status.state !== 'installing') {
      autoInstalledRef.current = false;
    }
  }, [status.state, onInstall]);

  // Block all keyboard shortcuts / Escape while the update lock is active
  useEffect(() => {
    const trap = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'F11' || ((e.ctrlKey || e.metaKey) && ['f', 'h', ','].includes(e.key.toLowerCase()))) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('keydown', trap, true);
    return () => window.removeEventListener('keydown', trap, true);
  }, []);

  const targetVer = status.available || 'nueva';
  const downloading = status.state === 'downloading';
  const ready = status.state === 'ready';
  const installing = status.state === 'installing';
  const pct = Math.max(0, Math.min(100, Number(status.progress) || 0));
  const hasDirectAsset = Boolean(status.downloadUrl);

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="force-update-title"
      data-testid="force-update-gate"
      className="fixed inset-x-0 top-[36px] bottom-0 z-[9990] flex items-center justify-center bg-page/98 px-6 backdrop-blur-md"
    >
      <div className="w-full max-w-[520px] rounded-[24px] border border-fg/[0.12] bg-surface p-8 shadow-[0_32px_90px_rgba(0,0,0,0.85)]">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-fg/[0.08] text-fg">
            <ShieldAlert className="h-6 w-6 text-[#7ee2a8] light:text-[#15803d]" />
          </div>
          <div>
            <div className="text-[11px] font-bold tracking-[0.14em] text-[#7ee2a8] light:text-[#15803d] uppercase">
              Actualización obligatoria
            </div>
            <h1 id="force-update-title" className="text-[24px] font-extrabold tracking-tight text-fg">
              Nueva versión v{targetVer} disponible
            </h1>
          </div>
        </div>

        <p className="mt-4 text-[14.5px] leading-relaxed text-fg/75">
          Para garantizar seguridad, compatibilidad de plugins y la mejor reproducción, OpenTV requiere usar siempre la
          versión más reciente. Esta versión (<span className="font-semibold text-fg">v{currentVersion}</span>) ya
          no puede continuar ejecutándose.
        </p>

        {status.notes && (
          <div className="mt-4 max-h-32 overflow-y-auto rounded-xl border border-fg/[0.08] bg-fg/[0.03] px-4 py-3 text-[12.5px] leading-relaxed whitespace-pre-line text-fg/65">
            {status.notes}
          </div>
        )}

        {(downloading || ready || installing) && (
          <div className="mt-5 space-y-2">
            <div className="flex items-center justify-between text-[13px] font-semibold text-fg/85">
              <span>
                {installing
                  ? 'Iniciando instalador de OpenTV…'
                  : ready
                    ? 'Descarga completa · Listo para instalar'
                    : 'Descargando actualización…'}
              </span>
              <span className="tabular-nums text-[#7ee2a8] light:text-[#15803d]">
                {downloading && status.total
                  ? `${formatBytes(status.bytes || 0)} / ${formatBytes(status.total)} · ${pct}%`
                  : `${ready || installing ? 100 : pct}%`}
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-fg/10">
              <div
                style={{ width: `${ready || installing ? 100 : Math.max(4, pct)}%`, backgroundColor: 'var(--ot-accent)' }}
                className="h-full rounded-full transition-[width] duration-200"
              />
            </div>
          </div>
        )}

        {status.error && (
          <div className="mt-4 rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-2.5 text-[13px] text-red-200">
            {status.error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          {ready ? (
            <button
              type="button"
              onClick={onInstall}
              style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[14.5px] font-bold transition hover:opacity-95 cursor-pointer"
            >
              <Download className="h-4.5 w-4.5" />
              <span>Instalar ahora</span>
            </button>
          ) : hasDirectAsset ? (
            <button
              type="button"
              disabled={downloading || installing}
              onClick={onDownload}
              style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[14.5px] font-bold transition hover:opacity-95 cursor-pointer disabled:opacity-60"
            >
              <Download className={`h-4.5 w-4.5 ${downloading ? 'animate-bounce' : ''}`} />
              <span>
                {installing
                  ? 'Abriendo instalador…'
                  : downloading
                    ? `Descargando (${pct}%)…`
                    : `Actualizar ahora a v${targetVer}`}
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenReleases}
              style={{ backgroundColor: 'var(--ot-accent)', color: 'var(--ot-accent-ink)' }}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl px-5 text-[14.5px] font-bold transition hover:opacity-95 cursor-pointer"
            >
              <ExternalLink className="h-4.5 w-4.5" />
              <span>Descargar v{targetVer}</span>
            </button>
          )}

          {!downloading && !installing && (
            <button
              type="button"
              onClick={onRetryCheck}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-fg/15 bg-fg/[0.06] px-4 text-[13.5px] font-semibold text-fg/85 transition hover:bg-fg/[0.12] cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Reintentar</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
