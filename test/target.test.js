const assert = require('node:assert/strict');
const { parseYouTubeTarget, uploadsPlaylistId } = require('../build/index.js');

describe('parseYouTubeTarget', () => {
    it('understands IDs and URLs', () => {
        assert.deepEqual(parseYouTubeTarget('jNQXAC9IVRw'), { kind: 'video', videoId: 'jNQXAC9IVRw' });
        assert.deepEqual(parseYouTubeTarget('https://www.youtube.com/watch?v=jNQXAC9IVRw&t=5'), {
            kind: 'video',
            videoId: 'jNQXAC9IVRw',
        });
        assert.deepEqual(parseYouTubeTarget('youtu.be/jNQXAC9IVRw'), { kind: 'video', videoId: 'jNQXAC9IVRw' });
        assert.deepEqual(parseYouTubeTarget('https://youtube.com/shorts/jNQXAC9IVRw'), {
            kind: 'video',
            videoId: 'jNQXAC9IVRw',
        });
        assert.deepEqual(parseYouTubeTarget('UCbmF2AHnpQsogOLW-MxBiJg'), {
            kind: 'channel',
            channelId: 'UCbmF2AHnpQsogOLW-MxBiJg',
        });
        assert.deepEqual(parseYouTubeTarget('https://www.youtube.com/channel/UCbmF2AHnpQsogOLW-MxBiJg/videos'), {
            kind: 'channel',
            channelId: 'UCbmF2AHnpQsogOLW-MxBiJg',
        });
        assert.deepEqual(
            parseYouTubeTarget('https://www.youtube.com/watch?v=jNQXAC9IVRw&list=PLbpi6ZahtOH6Blw3RGYpW'),
            {
                kind: 'playlist',
                listId: 'PLbpi6ZahtOH6Blw3RGYpW',
                videoId: 'jNQXAC9IVRw',
            },
        );
        assert.deepEqual(parseYouTubeTarget(' Next '), { kind: 'command', command: 'next' });
    });

    it('rejects handles and foreign URLs', () => {
        assert.throws(() => parseYouTubeTarget('@SailingOceanaire'), /Not a YouTube video/);
        assert.throws(() => parseYouTubeTarget('https://example.com/watch?v=jNQXAC9IVRw'), /Not a YouTube video/);
    });

    it('plays the uploads of a channel', () => {
        assert.equal(uploadsPlaylistId('UCbmF2AHnpQsogOLW-MxBiJg'), 'UUbmF2AHnpQsogOLW-MxBiJg');
    });
});
