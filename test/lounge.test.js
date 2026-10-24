const assert = require('node:assert/strict');
const { PlayerState, YouTubeLounge } = require('../build/index.js');

function chunk(json) {
    return `${Buffer.byteLength(json, 'utf8') + 1}\n${json}\n`;
}

/**
 * A fake lounge server. `script` answers each request: `(url, init) => Response`; every request is recorded.
 */
function fakeFetch(script) {
    const requests = [];
    const fn = async (url, init = {}) => {
        const request = {
            url: new URL(String(url)),
            method: init.method || 'GET',
            form: init.body ? Object.fromEntries(new URLSearchParams(String(init.body))) : {},
        };
        requests.push(request);
        return script(request, requests.length);
    };
    return { fn, requests };
}

const SESSION = chunk('[[0,["c","sid-1","",8]],[1,["S","gsession-1"]]]');

describe('YouTubeLounge', () => {
    it('pairs with a screen ID, connects and plays the uploads of a channel', async () => {
        const { fn, requests } = fakeFetch(request => {
            if (request.url.pathname.endsWith('get_lounge_token_batch')) {
                return new Response(JSON.stringify({ screens: [{ screenId: 'screen-1', loungeToken: 'token-1' }] }));
            }
            return new Response(request.form.req0__sc ? '' : SESSION);
        });
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        assert.deepEqual(await lounge.pairWithScreenId('screen-1'), { screenId: 'screen-1', loungeToken: 'token-1' });
        await lounge.play({ kind: 'channel', channelId: 'UCbmF2AHnpQsogOLW-MxBiJg' });
        assert.equal(lounge.connected, true);
        const command = requests.at(-1);
        assert.equal(command.form.req0__sc, 'setPlaylist');
        assert.equal(command.form.req0_listId, 'UUbmF2AHnpQsogOLW-MxBiJg');
        assert.equal(command.url.searchParams.get('SID'), 'sid-1');
        assert.equal(command.url.searchParams.get('gsessionid'), 'gsession-1');
    });

    it('pairs with the TV code', async () => {
        const { fn, requests } = fakeFetch(
            () => new Response(JSON.stringify({ screen: { screenId: 's-2', loungeToken: 't-2', name: 'Frame' } })),
        );
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        assert.deepEqual(await lounge.pairWithCode('123 456 789 012'), {
            screenId: 's-2',
            loungeToken: 't-2',
            name: 'Frame',
        });
        assert.equal(requests[0].form.pairing_code, '123456789012');
    });

    it('gets a new token when the old one expired', async () => {
        let binds = 0;
        const { fn, requests } = fakeFetch(request => {
            if (request.url.pathname.endsWith('get_lounge_token_batch')) {
                return new Response(JSON.stringify({ screens: [{ screenId: 's-1', loungeToken: 'fresh' }] }));
            }
            binds++;
            return binds === 1 ? new Response('', { status: 410 }) : new Response(SESSION);
        });
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        lounge.useScreen({ screenId: 's-1', loungeToken: 'expired' });
        await lounge.connect();
        assert.equal(lounge.screen.loungeToken, 'fresh');
        assert.equal(requests.at(-1).form.loungeIdToken, 'fresh');
    });

    it('opens a new session when the TV forgot the old one', async () => {
        let commands = 0;
        const { fn } = fakeFetch(request => {
            if (!request.form.req0__sc) {
                return new Response(SESSION);
            }
            commands++;
            return commands === 1 ? new Response('Unknown SID', { status: 400 }) : new Response('');
        });
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        lounge.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        await lounge.play({ kind: 'command', command: 'pause' });
        assert.equal(commands, 2);
    });

    it('reports what the TV plays', async () => {
        const answer =
            SESSION +
            chunk(
                '[[2,["nowPlaying",{"videoId":"jNQXAC9IVRw","currentTime":"12.5","duration":"19","state":"1","listId":""}]]]',
            ) +
            chunk('[[3,["onStateChange",{"currentTime":"14","state":"2"}]]]');
        const { fn } = fakeFetch(() => new Response(answer));
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        lounge.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        const reports = [];
        lounge.on('nowPlaying', playing => reports.push(playing));
        await lounge.connect();
        assert.deepEqual(reports.at(-1), {
            videoId: 'jNQXAC9IVRw',
            listId: '',
            currentTime: 14,
            duration: 19,
            state: PlayerState.Paused,
        });
    });

    it('knows whether the YouTube app is in the lounge', async () => {
        const status = devices => chunk(JSON.stringify([[2, ['loungeStatus', { devices: JSON.stringify(devices) }]]]));
        let answer = SESSION + status([{ type: 'REMOTE_CONTROL', name: 'ioBroker' }]);
        const { fn } = fakeFetch(() => new Response(answer));
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        lounge.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        await lounge.connect();
        assert.equal(lounge.screenOnline, false);
        answer = SESSION + status([{ type: 'LOUNGE_SCREEN', name: 'Frame' }]);
        lounge.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        await lounge.connect();
        assert.equal(lounge.screenOnline, true);
    });

    it('waits until the YouTube app joins the lounge', async () => {
        let polls = 0;
        // a long poll that answers at once would never let the timers run
        const later = () => new Promise(resolve => setTimeout(resolve, 5));
        const { fn } = fakeFetch(async request => {
            if (request.method === 'POST') {
                return new Response(SESSION);
            }
            await later();
            // the app joins with the second long poll
            polls++;
            const events = polls === 2 ? chunk('[[3,["nowPlaying",{"videoId":"jNQXAC9IVRw","state":"1"}]]]') : '';
            return new Response(events);
        });
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        lounge.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        assert.equal(await lounge.waitForScreen(1000), true);
        lounge.close();

        const empty = fakeFetch(async request => {
            if (request.method !== 'POST') {
                await later();
            }
            return new Response(request.method === 'POST' ? SESSION : '');
        });
        const alone = new YouTubeLounge({ fetch: empty.fn, api: 'https://lounge.test/api' });
        alone.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        assert.equal(await alone.waitForScreen(50), false);
        alone.close();
    });

    it('follows the TV over the long poll until closed', async () => {
        const { fn } = fakeFetch(request => {
            if (request.method === 'POST') {
                return new Response(SESSION);
            }
            // the long poll: a stream that sends one event and ends
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(
                        new TextEncoder().encode(chunk('[[4,["onVolumeChanged",{"volume":"30","muted":"false"}]]]')),
                    );
                    controller.close();
                },
            });
            return new Response(stream);
        });
        const lounge = new YouTubeLounge({ fetch: fn, api: 'https://lounge.test/api' });
        lounge.useScreen({ screenId: 's-1', loungeToken: 't-1' });
        const volume = new Promise(resolve => lounge.once('volume', resolve));
        lounge.subscribe();
        assert.deepEqual(await volume, { volume: 30, muted: false });
        lounge.close();
    });
});
