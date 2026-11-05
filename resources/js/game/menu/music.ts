/**
 * Музыка главного меню (раздел 12: «музыка только в меню»).
 *
 * Как добавить трек: положить файл .mp3 / .ogg / .m4a / .wav в `resources/audio/menu/`
 * и записать его в `docs/assets.md` (источник, лицензия, атрибуция). Больше ничего не нужно:
 * Vite сам подхватит файлы папки, порядок воспроизведения перемешивается при каждом заходе.
 */
const files = import.meta.glob<string>('../../../audio/menu/*.{mp3,ogg,m4a,wav}', { eager: true, query: '?url', import: 'default' });

export type Track = { title: string; url: string };

const STORAGE_KEY = 'menu-music';

/** Название трека из имени файла: `01-morning_patrol.mp3` → «morning patrol». */
export function trackTitle(path: string): string {
    const name = path.split('/').pop() ?? path;

    return name
        .replace(/\.[^.]+$/, '')
        .replace(/^\d+[-_. ]*/, '')
        .replace(/[-_]+/g, ' ')
        .trim();
}

export function menuTracks(source: Record<string, string> = files): Track[] {
    return Object.entries(source)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, url]) => ({ title: trackTitle(path), url }));
}

export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
    const out = [...items];

    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        const tmp = out[i] as T;

        out[i] = out[j] as T;
        out[j] = tmp;
    }

    return out;
}

type Settings = { volume: number; muted: boolean };

function loadSettings(): Settings {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};

        return { volume: typeof parsed.volume === 'number' ? parsed.volume : 0.5, muted: parsed.muted === true };
    } catch {
        return { volume: 0.5, muted: false };
    }
}

/**
 * Плеер плейлиста: играет треки по кругу, громкость и «без звука» сохраняются в браузере.
 * Браузеры не дают играть звук до действия пользователя — старт по первому клику/клавише.
 */
export class MenuMusic {
    readonly tracks: Track[];
    private readonly audio = new Audio();
    private index = 0;
    private settings: Settings = loadSettings();
    private started = false;
    private readonly listeners = new Set<() => void>();
    private readonly unlock = (): void => this.start();

    constructor(tracks: Track[] = menuTracks()) {
        this.tracks = shuffle(tracks);
        this.audio.preload = 'auto';
        this.audio.addEventListener('ended', () => this.next());
        this.apply();

        if (this.tracks.length > 0) {
            window.addEventListener('pointerdown', this.unlock, { once: true });
            window.addEventListener('keydown', this.unlock, { once: true });
        }
    }

    get current(): Track | null {
        return this.started ? (this.tracks[this.index] ?? null) : null;
    }

    get volume(): number {
        return this.settings.volume;
    }

    get muted(): boolean {
        return this.settings.muted;
    }

    onChange(fn: () => void): () => void {
        this.listeners.add(fn);

        return () => this.listeners.delete(fn);
    }

    start(): void {
        if (this.started || this.tracks.length === 0) {
            return;
        }

        this.started = true;
        this.play();
    }

    next(): void {
        if (this.tracks.length === 0) {
            return;
        }

        this.index = (this.index + 1) % this.tracks.length;
        this.started = true;
        this.play();
    }

    setVolume(volume: number): void {
        this.settings.volume = Math.min(1, Math.max(0, volume));
        this.apply();
    }

    toggleMute(): void {
        this.settings.muted = !this.settings.muted;
        this.apply();
        this.start();
    }

    dispose(): void {
        window.removeEventListener('pointerdown', this.unlock);
        window.removeEventListener('keydown', this.unlock);
        this.audio.pause();
        this.audio.src = '';
        this.listeners.clear();
    }

    private play(): void {
        const track = this.tracks[this.index];

        if (track === undefined) {
            return;
        }

        this.audio.src = track.url;
        void this.audio.play().catch(() => {
            // Автозапуск запрещён — дождёмся следующего действия пользователя.
            this.started = false;
            window.addEventListener('pointerdown', this.unlock, { once: true });
        });
        this.emit();
    }

    private apply(): void {
        this.audio.volume = this.settings.volume;
        this.audio.muted = this.settings.muted;

        try {
            window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
        } catch {
            // Хранилище недоступно (приватный режим) — настройки живут до перезагрузки.
        }

        this.emit();
    }

    private emit(): void {
        this.listeners.forEach((fn) => fn());
    }
}
