import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { ChunkParser, parseBindChunks, type LoungeEvent } from './chunks.js';
import { type YouTubeTarget, uploadsPlaylistId } from './target.js';

const API = 'https://www.youtube.com/api/lounge';
const TIMEOUT = 10_000;
/** Pause before the long poll starts again after an error: 5 s, doubled per failure, at most 5 min */
const RETRY_DELAY = 5_000;
const RETRY_DELAY_MAX = 300_000;

/** The YouTube app of a TV as the lounge knows it; store it to reconnect without pairing again */
export interface LoungeScreen {
    screenId: string;
    loungeToken: string;
    /** Name of the screen, only known after pairing with a TV code */
    name?: string;
}

/** Player states as the lounge reports them */
export enum PlayerState {
    Unstarted = -1,
    Ended = 0,
    Playing = 1,
    Paused = 2,
    Buffering = 3,
    Cued = 5,
    Advertisement = 1081,
}

/** What the TV plays */
export interface NowPlaying {
    videoId: string;
    listId: string;
    /** Position in seconds */
    currentTime: number;
    /** Length in seconds, 0 if not known yet */
    duration: number;
    state: PlayerState;
}

export interface LoungeOptions {
    /** Name of this remote control as the TV shows it */
    name?: string;
    /** Stable ID of this remote control */
    deviceId?: string;
    /** For tests */
    fetch?: typeof fetch;
    /** For tests */
    api?: string;
}

type Params = Record<string, string | number | undefined>;

/**
 * A remote control session with the YouTube app of a TV over the YouTube Lounge API ("Link with TV"). The
 * requests go to Google's servers; the protocol follows pyytlounge (FabioGNR/pyytlounge). Google does not document
 * it, so it may change.
 *
 * Events: `nowPlaying` (NowPlaying | null), `volume` ({ volume, muted }), `screen` (boolean: the YouTube app of
 * the TV joined or left the lounge), `disconnected` (the TV left the lounge), `error` (Error of the long poll).
 */
export class YouTubeLounge extends EventEmitter {
    private screenInfo: LoungeScreen | null = null;
    private sid = '';
    private gsessionid = '';
    private aid = 0;
    private rid = 1;
    private ofs = 0;
    private polling: AbortController | null = null;
    private readonly name: string;
    private readonly deviceId: string;
    private readonly fetchFn: typeof fetch;
    private readonly api: string;
    private current: NowPlaying | null = null;
    private screenUp = false;

    constructor(options: LoungeOptions = {}) {
        super();
        this.name = options.name ?? 'ioBroker';
        this.deviceId = options.deviceId ?? randomUUID();
        this.fetchFn = options.fetch ?? fetch;
        this.api = options.api ?? API;
    }

    /** The paired screen; `null` before pairing */
    get screen(): LoungeScreen | null {
        return this.screenInfo;
    }

    get connected(): boolean {
        return !!(this.sid && this.gsessionid);
    }

    /** Whether the YouTube app of the TV is in the lounge; Google accepts commands without it, but they get lost */
    get screenOnline(): boolean {
        return this.screenUp;
    }

    /** What the TV plays, as last reported */
    get nowPlaying(): NowPlaying | null {
        return this.current;
    }

    /** Use a screen stored from an earlier pairing */
    useScreen(screen: LoungeScreen): void {
        this.screenInfo = { ...screen };
        this.sid = this.gsessionid = '';
    }

    /** Pair with the screen ID the YouTube app reports over DIAL, see `getYouTubeScreenId` */
    async pairWithScreenId(screenId: string): Promise<LoungeScreen> {
        const { status, text } = await this.post(`${this.api}/pairing/get_lounge_token_batch`, {
            screen_ids: screenId,
        });
        const screen =
            status === 200
                ? (JSON.parse(text) as { screens?: { screenId?: string; loungeToken?: string }[] }).screens?.[0]
                : undefined;
        if (!screen?.loungeToken) {
            throw new Error(`YouTube: no lounge token for this screen (HTTP ${status})`);
        }
        this.useScreen({ screenId: screen.screenId ?? screenId, loungeToken: screen.loungeToken });
        return this.screenInfo!;
    }

    /** Pair with the code the YouTube app of the TV shows under Settings > Link with TV code */
    async pairWithCode(code: string): Promise<LoungeScreen> {
        const { status, text } = await this.post(`${this.api}/pairing/get_screen`, {
            pairing_code: String(code).replace(/\D/g, ''),
        });
        const screen =
            status === 200
                ? (JSON.parse(text) as { screen?: { screenId?: string; loungeToken?: string; name?: string } }).screen
                : undefined;
        if (!screen?.loungeToken || !screen.screenId) {
            throw new Error(`YouTube: the TV code was not accepted (HTTP ${status})`);
        }
        this.useScreen({ screenId: screen.screenId, loungeToken: screen.loungeToken, name: screen.name });
        return this.screenInfo!;
    }

    /** Open a session; the answer brings what the TV plays */
    async connect(): Promise<void> {
        if (!this.screenInfo) {
            throw new Error('YouTube: not paired');
        }
        this.rid = 1;
        this.ofs = 0;
        let { status, text } = await this.bind();
        if (status === 401 || status === 410) {
            // the lounge token expired: a new one for the same screen
            await this.pairWithScreenId(this.screenInfo.screenId);
            ({ status, text } = await this.bind());
        }
        if (status !== 200) {
            throw new Error(`YouTube: connection refused (HTTP ${status})`);
        }
        this.consume(parseBindChunks(text));
        if (!this.connected) {
            throw new Error('YouTube: no session');
        }
    }

    /** Send a lounge command, e.g. setPlaylist, play, pause, next, previous */
    async command(name: string, params: Params = {}): Promise<void> {
        if (!this.connected) {
            await this.connect();
        }
        let result = await this.sendCommand(name, params);
        if (result.status === 400 && /Unknown SID/i.test(result.text)) {
            // the session ended: once more with a new one
            this.sid = this.gsessionid = '';
            await this.connect();
            result = await this.sendCommand(name, params);
        }
        if (result.status !== 200) {
            throw new Error(`YouTube: command ${name} failed (HTTP ${result.status})`);
        }
    }

    /**
     * Wait until the YouTube app of the TV is in the lounge, e.g. after the TV or the app was started. Starts the
     * long poll if it does not run (`close()` ends it).
     *
     * @param timeout in ms
     * @returns whether the app is there
     */
    async waitForScreen(timeout = 30_000): Promise<boolean> {
        if (!this.connected) {
            // the answer names the devices in the lounge
            await this.connect();
        }
        if (this.screenUp) {
            return true;
        }
        this.subscribe();
        return new Promise(resolve => {
            const wait: { timer?: NodeJS.Timeout } = {};
            const onScreen = (online: boolean): void => {
                if (online) {
                    clearTimeout(wait.timer);
                    this.off('screen', onScreen);
                    resolve(true);
                }
            };
            wait.timer = setTimeout(() => {
                this.off('screen', onScreen);
                resolve(false);
            }, timeout);
            this.on('screen', onScreen);
        });
    }

    /** Play a target of `parseYouTubeTarget`; the TV starts the YouTube app if it can */
    play(target: YouTubeTarget): Promise<void> {
        switch (target.kind) {
            case 'video':
                return this.command('setPlaylist', { videoId: target.videoId, currentTime: 0, currentIndex: -1 });
            case 'playlist':
                return this.command('setPlaylist', {
                    listId: target.listId,
                    videoId: target.videoId,
                    currentIndex: 0,
                    currentTime: 0,
                });
            case 'channel':
                // the channel page cannot be opened this way, its uploads can
                return this.command('setPlaylist', {
                    listId: uploadsPlaylistId(target.channelId),
                    currentIndex: 0,
                    currentTime: 0,
                });
            default:
                return this.command(target.command);
        }
    }

    /** Jump to a position in seconds */
    seekTo(seconds: number): Promise<void> {
        return this.command('seekTo', { newTime: Math.max(0, Math.round(seconds)) });
    }

    /** Mute or unmute the YouTube player */
    setMuted(muted: boolean): Promise<void> {
        return this.command(muted ? 'mute' : 'unMute');
    }

    /** Set the volume 0-100 of the YouTube player */
    setVolume(volume: number): Promise<void> {
        return this.command('setVolume', { volume: Math.min(100, Math.max(0, Math.round(volume))) });
    }

    /** Follow the TV: emits `nowPlaying` and `volume` until `close()` */
    subscribe(): void {
        if (this.polling) {
            return;
        }
        this.polling = new AbortController();
        void this.poll(this.polling.signal);
    }

    /** Stop following the TV */
    close(): void {
        this.polling?.abort();
        this.polling = null;
    }

    private async poll(signal: AbortSignal): Promise<void> {
        let failures = 0;
        while (!signal.aborted) {
            try {
                if (!this.connected) {
                    await this.connect();
                }
                const url = new URL(`${this.api}/bc/bind`);
                for (const [key, value] of Object.entries(this.sessionParams({ RID: 'rpc', CI: 0, TYPE: 'xmlhttp' }))) {
                    if (value !== undefined) {
                        url.searchParams.set(key, String(value));
                    }
                }
                const res = await this.fetchFn(url, { signal });
                if (res.status === 400 || res.status === 404 || res.status === 410) {
                    // session or token ended
                    this.sid = this.gsessionid = '';
                    await res.body?.cancel();
                    continue;
                }
                if (res.status !== 200 || !res.body) {
                    throw new Error(`YouTube: long poll failed (HTTP ${res.status})`);
                }
                failures = 0;
                const parser = new ChunkParser();
                const reader = res.body.getReader();
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) {
                        break;
                    }
                    this.consume(parser.push(value));
                }
            } catch (e) {
                if (signal.aborted) {
                    return;
                }
                // without a listener an `error` event would end the process
                if (this.listenerCount('error')) {
                    this.emit('error', e instanceof Error ? e : new Error(String(e)));
                }
                failures++;
                await new Promise(resolve =>
                    setTimeout(resolve, Math.min(RETRY_DELAY_MAX, RETRY_DELAY * 2 ** (failures - 1))),
                );
            }
        }
    }

    private bind(): Promise<{ status: number; text: string }> {
        return this.post(
            `${this.api}/bc/bind`,
            {
                app: 'web',
                'mdx-version': 3,
                name: this.name,
                id: this.deviceId,
                device: 'REMOTE_CONTROL',
                capabilities: 'que,dsdtr,atp',
                magnaKey: 'cloudPairedDevice',
                ui: 'false',
                theme: 'cl',
                loungeIdToken: this.screenInfo?.loungeToken,
            },
            { RID: this.rid, VER: 8, CVER: 1, auth_failure_option: 'send_error' },
        );
    }

    private sendCommand(name: string, params: Params): Promise<{ status: number; text: string }> {
        const form: Params = { count: 1, ofs: this.ofs++, req0__sc: name };
        for (const [key, value] of Object.entries(params)) {
            form[`req0_${key}`] = value;
        }
        this.rid++;
        return this.post(`${this.api}/bc/bind`, form, this.sessionParams({ RID: this.rid, CVER: 1 }));
    }

    private sessionParams(extra: Params): Params {
        return {
            name: this.name,
            loungeIdToken: this.screenInfo?.loungeToken,
            SID: this.sid,
            AID: this.aid,
            gsessionid: this.gsessionid,
            device: 'REMOTE_CONTROL',
            app: 'youtube-desktop',
            VER: 8,
            v: 2,
            ...extra,
        };
    }

    private consume(events: LoungeEvent[]): void {
        for (const [id, [type, ...args]] of events) {
            this.aid = id;
            const data = (args[0] ?? {}) as Record<string, unknown>;
            switch (type) {
                case 'c':
                    this.sid = String(args[0]);
                    break;
                case 'S':
                    this.gsessionid = String(args[0]);
                    break;
                case 'nowPlaying':
                    // only the screen reports what plays
                    this.setScreen(true);
                    this.update(data, true);
                    break;
                case 'onStateChange':
                    this.setScreen(true);
                    this.update(data, false);
                    break;
                case 'loungeStatus':
                    this.setScreen(hasScreen(data.devices));
                    break;
                case 'onVolumeChanged':
                    this.emit('volume', { volume: Number(data.volume), muted: data.muted === 'true' });
                    break;
                case 'loungeScreenDisconnected':
                    this.sid = this.gsessionid = '';
                    this.setScreen(false);
                    this.emit('disconnected');
                    break;
                default:
                    break;
            }
        }
    }

    private setScreen(online: boolean): void {
        if (online !== this.screenUp) {
            this.screenUp = online;
            this.emit('screen', online);
        }
    }

    /** `nowPlaying` names the video, `onStateChange` only updates state and position */
    private update(data: Record<string, unknown>, newVideo: boolean): void {
        if (newVideo && !data.videoId) {
            this.current = null;
            this.emit('nowPlaying', null);
            return;
        }
        const number = (value: unknown, fallback: number): number =>
            value === undefined || value === '' || Number.isNaN(Number(value)) ? fallback : Number(value);
        const base = newVideo || !this.current ? null : this.current;
        this.current = {
            videoId: typeof data.videoId === 'string' ? data.videoId : (base?.videoId ?? ''),
            listId: typeof data.listId === 'string' ? data.listId : (base?.listId ?? ''),
            currentTime: number(data.currentTime, base?.currentTime ?? 0),
            duration: number(data.duration, base?.duration ?? 0),
            state: number(data.state, base?.state ?? PlayerState.Unstarted),
        };
        this.emit('nowPlaying', this.current);
    }

    private async post(url: string, form: Params, params: Params = {}): Promise<{ status: number; text: string }> {
        const target = new URL(url);
        for (const [key, value] of Object.entries(params)) {
            if (value !== undefined) {
                target.searchParams.set(key, String(value));
            }
        }
        const body = new URLSearchParams();
        for (const [key, value] of Object.entries(form)) {
            if (value !== undefined) {
                body.set(key, String(value));
            }
        }
        const res = await this.fetchFn(target, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
            signal: AbortSignal.timeout(TIMEOUT),
        });
        return { status: res.status, text: await res.text() };
    }
}

/** `devices` of `loungeStatus` is a JSON string; the YouTube app of the TV is the `LOUNGE_SCREEN` */
function hasScreen(devices: unknown): boolean {
    try {
        const list = JSON.parse(String(devices)) as { type?: string }[];
        return Array.isArray(list) && list.some(device => device.type === 'LOUNGE_SCREEN');
    } catch {
        return false;
    }
}
