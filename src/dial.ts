import dgram from 'node:dgram';
import http from 'node:http';
import os from 'node:os';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const DIAL_SERVICE = 'urn:dial-multiscreen-org:service:dial:1';

/** A device with a DIAL server, e.g. a TV with the YouTube app */
export interface DialDevice {
    /** Address of the device */
    ip: string;
    /** Name from the device description */
    name: string;
    manufacturer: string;
    model: string;
    /** UDN of the device description, a stable ID */
    udn: string;
    /** Base URL of the DIAL apps (`Application-URL`), e.g. `http://192.168.1.147:8080/ws/app/` */
    appUrl: string;
}

function request(
    url: string,
    method = 'GET',
    timeout = 5000,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise(resolve => {
        const req = http.request(url, { method, timeout, agent: false }, res => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => (body += chunk));
            res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
        });
        req.on('timeout', () => req.destroy());
        req.on('error', () => resolve({ status: 0, headers: {}, body: '' }));
        req.end();
    });
}

function xmlValue(xml: string, tag: string): string {
    return new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml)?.[1]?.trim() ?? '';
}

/**
 * Read the device description of a DIAL device.
 *
 * @param location the `LOCATION` of its SSDP answer
 * @returns the device, `null` if it has no DIAL `Application-URL`
 */
export async function readDialDevice(location: string): Promise<DialDevice | null> {
    const { status, headers, body } = await request(location);
    const appUrl = headers['application-url'];
    if (status !== 200 || typeof appUrl !== 'string' || !appUrl) {
        return null;
    }
    return {
        ip: new URL(location).hostname,
        name: xmlValue(body, 'friendlyName'),
        manufacturer: xmlValue(body, 'manufacturer'),
        model: xmlValue(body, 'modelName'),
        udn: xmlValue(body, 'UDN'),
        appUrl: appUrl.endsWith('/') ? appUrl : `${appUrl}/`,
    };
}

/**
 * Find DIAL devices with SSDP. The search goes out on every IPv4 interface: a host with several of them (docker,
 * VPN) sends a single multicast out of one only.
 *
 * @param timeout how long to wait for answers, in ms
 */
export async function discoverDialDevices(timeout = 4000): Promise<DialDevice[]> {
    const message = Buffer.from(
        `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${DIAL_SERVICE}\r\n\r\n`,
    );
    const addresses = Object.values(os.networkInterfaces())
        .flat()
        .filter(entry => entry && entry.family === 'IPv4' && !entry.internal)
        .map(entry => entry!.address);
    const locations = new Set<string>();
    await Promise.all(
        (addresses.length ? addresses : ['0.0.0.0']).map(
            address =>
                new Promise<void>(resolve => {
                    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
                    socket.on('message', answer => {
                        const location = /^location:\s*(\S+)/im.exec(answer.toString('utf8'))?.[1];
                        if (location) {
                            locations.add(location);
                        }
                    });
                    socket.on('error', () => resolve());
                    socket.bind(0, address, () => {
                        try {
                            socket.setMulticastInterface(address);
                        } catch {
                            // the default interface then
                        }
                        socket.send(message, SSDP_PORT, SSDP_ADDRESS);
                        setTimeout(() => {
                            socket.close();
                            resolve();
                        }, timeout);
                    });
                }),
        ),
    );
    const devices = await Promise.all([...locations].map(location => readDialDevice(location)));
    const byUdn = new Map<string, DialDevice>();
    for (const device of devices) {
        if (device) {
            byUdn.set(device.udn || device.ip, device);
        }
    }
    return [...byUdn.values()];
}

/**
 * Read the screen ID of the YouTube app from its DIAL description. Many TVs report it only while the app runs or
 * has run since they were switched on.
 *
 * @param appUrl the `appUrl` of the device
 * @returns the screen ID, `null` if the app reports none
 */
export async function getYouTubeScreenId(appUrl: string): Promise<string | null> {
    const { status, body } = await request(`${appUrl}YouTube`);
    return status === 200 ? xmlValue(body, 'screenId') || null : null;
}

/**
 * Start the YouTube app over DIAL. Some TVs refuse it (The Frame 2022: 403); then start it in another way.
 *
 * @param appUrl the `appUrl` of the device
 * @returns whether the TV accepted it
 */
export async function launchYouTubeOverDial(appUrl: string): Promise<boolean> {
    const { status } = await request(`${appUrl}YouTube`, 'POST');
    return status >= 200 && status < 300;
}
