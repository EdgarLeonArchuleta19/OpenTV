import type { MediaItem, WatchProgress } from '../types/models';

const GENRE_ES: Record<string, string> = {
  action: 'Acción',
  adventure: 'Aventura',
  animation: 'Animación',
  cartoon: 'Animación',
  comedy: 'Comedia',
  crime: 'Crimen',
  documentary: 'Documental',
  drama: 'Drama',
  family: 'Familia',
  fantasy: 'Fantasía',
  history: 'Historia',
  horror: 'Terror',
  music: 'Música',
  musical: 'Musical',
  mystery: 'Misterio',
  romance: 'Romance',
  'sci-fi': 'Ciencia ficción',
  'science fiction': 'Ciencia ficción',
  sport: 'Deporte',
  thriller: 'Suspenso',
  war: 'Bélica',
  western: 'Western',
  biography: 'Biografía',
  'reality-tv': 'Reality',
  reality: 'Reality',
  anime: 'Anime',
  short: 'Corto',
  'tv movie': 'Película de TV',
  'game show': 'Concurso',
  news: 'Noticias',
  kids: 'Infantil',
  'talk-show': 'Entrevistas',
  soap: 'Telenovela',
  suspense: 'Suspenso',
  'sci-fi & fantasy': 'Ciencia ficción',
  'action & adventure': 'Acción',
  'war & politics': 'Bélica',
  'film-noir': 'Cine negro',
};

export function translateGenre(raw: string): string {
  const k = String(raw || '').trim().toLowerCase();
  return GENRE_ES[k] || String(raw || '').trim();
}

export function localizedGenres(genres: string[], max = 3): string[] {
  const out: string[] = [];
  for (const g of genres || []) {
    if (out.length >= max) break;
    const es = translateGenre(g);
    if (es && !/^sin clasificar$/i.test(es) && !/^\d+$/.test(es) && !out.includes(es)) {
      out.push(es);
    }
  }
  return out;
}

export function formatDuration(raw: string): string {
  const s = String(raw || '').trim();
  if (!s || s === '—') return '';
  const mOnly = /^(\d+)\s*min$/i.exec(s);
  if (mOnly) {
    const mins = parseInt(mOnly[1], 10);
    if (mins >= 60) {
      const h = Math.floor(mins / 60);
      const rem = mins % 60;
      return rem ? `${h} h ${rem} min` : `${h} h`;
    }
    return `${mins} min`;
  }
  return s;
}

export function formatHeroMeta(item: MediaItem): string {
  const bits: string[] = [];
  const sc = parseFloat(item.score);
  if (Number.isFinite(sc) && sc > 0) bits.push(`★ ${sc.toFixed(1)}`);
  const yr = /\d{4}/.exec(item.year || '');
  if (yr) bits.push(yr[0]);
  bits.push(item.type === 'movie' ? 'Película' : 'Serie');
  if (item.type === 'movie' && item.duration && item.duration !== '—') {
    const dur = formatDuration(item.duration);
    if (dur) bits.push(dur);
  }
  return bits.join(' · ');
}

export function formatContinueSubtitle(entry: WatchProgress): string {
  const parts: string[] = [];
  if (entry.type !== 'movie' && entry.episode > 0) {
    parts.push(`Episodio ${entry.episode}`);
  }
  if (entry.durationMs > 0) {
    const leftSec = Math.max(0, Math.round((entry.durationMs - entry.positionMs) / 1000));
    if (leftSec / (entry.durationMs / 1000) < 0.05) {
      parts.push('Terminado');
    } else if (leftSec >= 3600) {
      const h = Math.floor(leftSec / 3600);
      const m = Math.round((leftSec % 3600) / 60);
      parts.push(`Quedan ${h} h ${m} min`);
    } else {
      parts.push(`Quedan ${Math.max(1, Math.round(leftSec / 60))} min`);
    }
  }
  return parts.join(' · ');
}
