/** An event of the lounge channel: `[id, [type, ...args]]` */
export type LoungeEvent = [number, [string, ...unknown[]]];

/**
 * Splits the chunked answer of bc/bind (`<length>\n<json>\n<length>\n<json>…`) into events. The length counts
 * bytes, including the new line after the JSON. Data may arrive in pieces, as on the long poll; a chunk is
 * reported once it is complete.
 */
export class ChunkParser {
    private buffer = Buffer.alloc(0);

    /** Add received data; returns the events of all chunks completed by it */
    push(data: Buffer | Uint8Array | string): LoungeEvent[] {
        this.buffer = Buffer.concat([this.buffer, typeof data === 'string' ? Buffer.from(data, 'utf8') : data]);
        const events: LoungeEvent[] = [];
        for (;;) {
            const newLine = this.buffer.indexOf(0x0a);
            if (newLine < 0) {
                break;
            }
            const header = this.buffer.subarray(0, newLine).toString('ascii').trim();
            if (!/^\d+$/.test(header)) {
                // not a length: skip the line
                this.buffer = this.buffer.subarray(newLine + 1);
                continue;
            }
            const length = Number(header);
            const start = newLine + 1;
            if (this.buffer.length < start + length) {
                break;
            }
            const chunk = this.buffer.subarray(start, start + length).toString('utf8');
            this.buffer = this.buffer.subarray(start + length);
            try {
                events.push(...(JSON.parse(chunk) as LoungeEvent[]));
            } catch {
                // not JSON: ignored
            }
        }
        return events;
    }
}

/** All events of a complete answer */
export function parseBindChunks(data: Buffer | string): LoungeEvent[] {
    return new ChunkParser().push(data);
}
