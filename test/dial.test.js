const assert = require('node:assert/strict');
const http = require('node:http');
const { getYouTubeScreenId, launchYouTubeOverDial, readDialDevice } = require('../build/index.js');

describe('DIAL', () => {
    let server;
    let base;
    let launched = false;

    before(done => {
        server = http.createServer((req, res) => {
            if (req.url === '/dd.xml') {
                res.writeHead(200, { 'Application-URL': `${base}/ws/app` });
                res.end(
                    '<root><device><friendlyName>Samsung The Frame 55</friendlyName><manufacturer>Samsung</manufacturer>' +
                        '<modelName>GQ55LS03BAUXZG</modelName><UDN>uuid:b72e0bb7</UDN></device></root>',
                );
            } else if (req.url === '/ws/app/YouTube' && req.method === 'GET') {
                res.writeHead(200);
                res.end(
                    '<service><name>YouTube</name><additionalData><screenId>screen-42</screenId></additionalData></service>',
                );
            } else if (req.url === '/ws/app/YouTube' && req.method === 'POST') {
                launched = true;
                res.writeHead(201);
                res.end();
            } else {
                res.writeHead(404);
                res.end();
            }
        });
        server.listen(0, '127.0.0.1', () => {
            base = `http://127.0.0.1:${server.address().port}`;
            done();
        });
    });

    after(() => server.close());

    it('reads the device description and the app URL', async () => {
        assert.deepEqual(await readDialDevice(`${base}/dd.xml`), {
            ip: '127.0.0.1',
            name: 'Samsung The Frame 55',
            manufacturer: 'Samsung',
            model: 'GQ55LS03BAUXZG',
            udn: 'uuid:b72e0bb7',
            appUrl: `${base}/ws/app/`,
        });
        assert.equal(await readDialDevice(`${base}/missing.xml`), null);
    });

    it('reads the screen ID and starts the app', async () => {
        assert.equal(await getYouTubeScreenId(`${base}/ws/app/`), 'screen-42');
        assert.equal(await launchYouTubeOverDial(`${base}/ws/app/`), true);
        assert.equal(launched, true);
    });
});
