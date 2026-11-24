import React from 'react';
import { Download, Maximize2, Minimize2, Minus, Pin, Square, X } from 'lucide-react';
import { desktopApi } from '../services/tauri';
import { OpenTvLogo } from './CommonComponents';

interface TitleBarProps {
  sectionLabel: string;
  isFullscreen: boolean;
  isPinned: boolean;
  activeDownloadPct: number | null;
  onTogglePin: () => void;
  onToggleFullscreen: () => void;
  onOpenDownloads: () => void;
}

/**
 * Exact 1:1 replica of OpenTV v1 Windows TitleBar (`06-ventana-arranque.css` + `inicio.jpg`):
 * Seamless `#0e0e11` 36px strip, OpenTV TV mark + bold brand + `· Section`,
 * active download green pill, pin (rotates -28deg when pinned), fullscreen, and Windows controls.
 */
export const TitleBar: React.FC<TitleBarProps> = ({
  sectionLabel,
  isFullscreen,
  isPinned,
  activeDownloadPct,
  onTogglePin,
  onToggleFullscreen,
  onOpenDownloads,
}) => {
  if (isFullscreen) return null;

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    if (e.detail === 2) {
      void desktopApi.windowControl('max');
    } else {
      void desktopApi.startDragging();
    }
  };

  return (
    <header
      onMouseDown={handleMouseDown}
      className="fixed top-0 right-0 left-0 z-[100] flex h-9 items-center bg-[#0e0e11] pl-3.5 text-[12.5px] text-white/75 select-none"
    >
      <div className="flex items-center gap-2 font-semibold tracking-[0.01em] text-white">
        <OpenTvLogo className="h-[18px] w-[18px]" />
        <span>OpenTV</span>
      </div>

      {sectionLabel && (
        <span className="ml-2.5 flex min-w-0 items-center truncate text-white/50">
          <span className="mr-2.5 text-white/30">·</span>
          <span className="truncate">{sectionLabel}</span>
        </span>
      )}

      <div className="ml-auto flex h-full items-center">
        {activeDownloadPct !== null && (
          <button
            type="button"
            onClick={onOpenDownloads}
            title="Descargas en curso"
            className="mr-1.5 inline-flex h-[26px] items-center gap-1.5 rounded-full border border-[#7ee2a8]/35 bg-[#7ee2a8]/10 px-2.5 text-[12px] font-bold tabular-nums text-[#7ee2a8] transition hover:bg-[#7ee2a8]/20 cursor-pointer"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{activeDownloadPct}%</span>
          </button>
        )}

        <button
          type="button"
          onClick={onTogglePin}
          title={isPinned ? 'Dejar de fijar encima' : 'Fijar siempre encima'}
          className={`inline-flex h-[26px] w-7 items-center justify-center rounded-md border transition cursor-pointer ${
            isPinned
              ? 'border-white/30 bg-white/15 text-white'
              : 'border-transparent text-white/55 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Pin className={`h-[14px] w-[14px] transition-transform duration-200 ${isPinned ? '-rotate-[28deg] fill-current' : ''}`} />
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          title="Pantalla completa (F11)"
          className="ml-1 mr-2 inline-flex h-[26px] w-7 items-center justify-center rounded-md text-white/55 transition hover:bg-white/10 hover:text-white cursor-pointer"
        >
          {isFullscreen ? <Minimize2 className="h-[14px] w-[14px]" /> : <Maximize2 className="h-[14px] w-[14px]" />}
        </button>

        <button
          type="button"
          aria-label="Minimizar"
          onClick={() => void desktopApi.windowControl('min')}
          className="inline-flex h-9 w-[46px] items-center justify-center text-white/65 transition hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Maximizar"
          onClick={() => void desktopApi.windowControl('max')}
          className="inline-flex h-9 w-[46px] items-center justify-center text-white/65 transition hover:bg-white/10 hover:text-white cursor-pointer"
        >
          <Square className="h-3 w-3" />
        </button>
        <button
          type="button"
          aria-label="Cerrar"
          onClick={() => void desktopApi.windowControl('close')}
          className="inline-flex h-9 w-[46px] items-center justify-center text-white/65 transition hover:bg-[#e81123] hover:text-white cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
};
