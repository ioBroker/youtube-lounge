/** What to play: a video, a playlist, the uploads of a channel, or a player command */
export type YouTubeTarget =
    | { kind: 'video'; videoId: string }
    | { kind: 'playlist'; listId: string; videoId?: string }
    | { kind: 'channel'; channelId: string }
    | { kind: 'command'; command: PlayerCommand };

export type PlayerCommand = 'play' | 'pause' | 'next' | 'previous';

const COMMANDS: readonly string[] = ['play', 'pause', 'next', 'previous'];
const VIDEO_ID = /^[\w-]{11}$/;
const CHANNEL_ID = /^UC[\w-]{22}$/;
const LIST_ID = /^(?:PL|UU|LL|FL|OL|RD)[\w-]{10,}$/;

/**
 * Understand what to play.
 *
 * @param input a video ID, `PL…`, `UC…`, a youtube.com / youtu.be URL, or `play`, `pause`, `next`, `previous`
 * @throws {Error} for anything else; handles (`@name`) need the YouTube Data API to be resolved
 */
export function parseYouTubeTarget(input: string): YouTubeTarget {
    const text = String(input ?? '').trim();
    const command = text.toLowerCase();
    if (COMMANDS.includes(command)) {
        return { kind: 'command', command: command as PlayerCommand };
    }
    let url: URL | null = null;
    try {
        url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    } catch {
        url = null;
    }
    if (url && /(^|\.)(youtube\.com|youtu\.be)$/i.test(url.hostname)) {
        const list = url.searchParams.get('list');
        const video = url.hostname.endsWith('youtu.be') ? url.pathname.slice(1) : url.searchParams.get('v');
        if (list && LIST_ID.test(list)) {
            return video && VIDEO_ID.test(video)
                ? { kind: 'playlist', listId: list, videoId: video }
                : { kind: 'playlist', listId: list };
        }
        if (video && VIDEO_ID.test(video)) {
            return { kind: 'video', videoId: video };
        }
        const channel = /^\/channel\/(UC[\w-]{22})/.exec(url.pathname)?.[1];
        if (channel) {
            return { kind: 'channel', channelId: channel };
        }
        const short = /^\/(?:shorts|live)\/([\w-]{11})/.exec(url.pathname)?.[1];
        if (short) {
            return { kind: 'video', videoId: short };
        }
    }
    if (CHANNEL_ID.test(text)) {
        return { kind: 'channel', channelId: text };
    }
    if (LIST_ID.test(text)) {
        return { kind: 'playlist', listId: text };
    }
    if (VIDEO_ID.test(text)) {
        return { kind: 'video', videoId: text };
    }
    throw new Error(`Not a YouTube video, playlist or channel: "${text}"`);
}

/** The uploads playlist of a channel: `UC…` -> `UU…` */
export function uploadsPlaylistId(channelId: string): string {
    return `UU${channelId.slice(2)}`;
}
