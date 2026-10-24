const assert = require('node:assert/strict');
const { ChunkParser, parseBindChunks } = require('../build/index.js');

/** A chunk as the lounge sends it: its byte length including the new line, then the JSON */
function chunk(json) {
    return `${Buffer.byteLength(json, 'utf8') + 1}\n${json}\n`;
}

describe('chunks', () => {
    it('splits an answer into events', () => {
        const events = parseBindChunks(
            chunk('[[0,["c","sid-1","",8]],[1,["S","gsession-1"]]]') + chunk('[[2,["noop"]]]'),
        );
        assert.deepEqual(
            events.map(([id, [type]]) => [id, type]),
            [
                [0, 'c'],
                [1, 'S'],
                [2, 'noop'],
            ],
        );
    });

    it('counts bytes, so titles with umlauts and emojis do not break it', () => {
        const events = parseBindChunks(
            chunk('[[3,["nowPlaying",{"title":"Segeln über die Ostsee ⛵"}]]]') + chunk('[[4,["noop"]]]'),
        );
        assert.equal(events.length, 2);
        assert.equal(events[0][1][1].title, 'Segeln über die Ostsee ⛵');
    });

    it('waits for the rest of a chunk that arrives in pieces', () => {
        const parser = new ChunkParser();
        const data = Buffer.from(chunk('[[5,["onStateChange",{"state":"1"}]]]'));
        assert.deepEqual(parser.push(data.subarray(0, 10)), []);
        // split inside a multibyte character as well
        assert.deepEqual(parser.push(data.subarray(10, 20)), []);
        const events = parser.push(data.subarray(20));
        assert.deepEqual(events, [[5, ['onStateChange', { state: '1' }]]]);
    });
});
