import { Transform, TransformCallback } from 'stream';
import { Protocol, Record, RecordType, StreamRecord } from './protocol';
import assert from 'assert';
import { toBuffer } from './utils/buffer';

const DEFAULT_CHUNK_SIZE = 8;

const dataReocrds = new Set<RecordType>([
    RecordType.STDIN,
    RecordType.STDOUT,
    RecordType.STDERR,
    RecordType.DATA
]);

function encodeRecord(record: Record, chunkSize: number) {
    const headerBuffer = Buffer.alloc(Protocol.HEADER_LEN);
    headerBuffer.writeUInt8(Protocol.VERSION, 0);
    headerBuffer.writeUInt8(record.type, 1);
    headerBuffer.writeUInt16BE(record.requestId, 2);
    const contentBuffer = encodeRecordBody(record);
    const paddingLength = chunkSize - (contentBuffer.length % chunkSize);
    const paddingBuffer = Buffer.alloc(paddingLength);
    headerBuffer.writeUInt16BE(contentBuffer.length, 4);
    headerBuffer.writeUInt8(paddingLength, 6);
    return Buffer.concat([headerBuffer, contentBuffer, paddingBuffer]);
}

function encodeRecordBody(record: Record): Buffer {
    if (dataReocrds.has(record.type)) {
        return toBuffer((record as StreamRecord).data);
    }
    let buffer: Buffer;
    let arr: Buffer[] = [];
    switch (record.type) {
        case RecordType.BEGIN_REQUEST:
            buffer = Buffer.alloc(8);
            buffer.writeUInt16BE(record.role, 0);
            buffer.writeUInt8(record.flags, 2);
            return buffer;
        case RecordType.ABORT_REQUEST:
            return Buffer.alloc(0);
        case RecordType.END_REQUEST:
            buffer = Buffer.alloc(8);
            buffer.writeUInt32BE(record.appStatus, 0);
            buffer.writeUInt8(record.protocolStatus, 4);
            return buffer;
        case RecordType.PARAMS:
            for (const [name, value] of Object.entries(record.params)) {
                if (value === undefined) continue;
                const nameBuffer = Buffer.from(name);
                const valueBuffer = Buffer.from(value);
                const nameLenBuffer = Buffer.alloc(2);
                const valueLenBuffer = Buffer.alloc(2);
                nameLenBuffer.writeUInt16BE(nameBuffer.length, 0);
                valueLenBuffer.writeUInt16BE(valueBuffer.length, 0);
                arr.push(nameLenBuffer, nameBuffer, valueLenBuffer, valueBuffer);
            }
            return Buffer.concat(arr);
        case RecordType.GET_VALUES:
            for (const name of record.keys) {
                const nameBuffer = Buffer.from(name);
                const nameLenBuffer = Buffer.alloc(2);
                nameLenBuffer.writeUInt16BE(nameBuffer.length, 0);
                arr.push(nameLenBuffer, nameBuffer);
            }
            return Buffer.concat(arr);
        case RecordType.GET_VALUES_RESULT:
            for (const [name, value] of Object.entries(record.values)) {
                if (value === undefined) continue;
                const nameBuffer = Buffer.from(name);
                const valueBuffer = Buffer.from(value);
                const nameLenBuffer = Buffer.alloc(2);
                const valueLenBuffer = Buffer.alloc(2);
                nameLenBuffer.writeUInt16BE(nameBuffer.length, 0);
                valueLenBuffer.writeUInt16BE(valueBuffer.length, 0);
                arr.push(nameLenBuffer, nameBuffer, valueLenBuffer, valueBuffer);
            }
            return Buffer.concat(arr);
        case RecordType.UNKNOWN_TYPE:
            buffer = Buffer.alloc(8);
            buffer.writeUint8(record.unknownType, 0);
            return buffer;
        default:
            throw new Error(`Unknown record type: ${record.type}`);
    }
}

export class Encoder extends Transform {
    #fitToChunk: number = 0;

    constructor(fitToChunk: number = DEFAULT_CHUNK_SIZE) {
        super();
        assert(
            typeof fitToChunk === 'number' && fitToChunk > 0 && fitToChunk <= 255,
            'Invalid chunk size'
        );
        this.#fitToChunk = fitToChunk;
    }

    _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
        const record = chunk as Record;
        if (typeof record === 'string') {
            callback(new Error(record));
            return;
        }
        this.push(encodeRecord(record, this.#fitToChunk));
        callback(null);
    }
}
