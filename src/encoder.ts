import { Transform, TransformCallback } from 'node:stream';
import { Protocol, FastCGIRecord, RecordType, StreamRecord } from './protocol';
import assert from 'node:assert';
import { toBuffer } from './utils/buffer';

const DEFAULT_CHUNK_SIZE = 8;

const streamRecordTypes = new Set<RecordType>([
    RecordType.STDIN,
    RecordType.STDOUT,
    RecordType.STDERR,
    RecordType.DATA
]);

function isStreamRecord(record: FastCGIRecord): record is StreamRecord {
    return streamRecordTypes.has(record.type);
}

function buildRecord(record: FastCGIRecord, chunkSize: number, contentBuffer: Buffer) {
    const headerBuffer = Buffer.alloc(Protocol.HEADER_LEN);
    headerBuffer.writeUInt8(Protocol.VERSION, 0);
    headerBuffer.writeUInt8(record.type, 1);
    headerBuffer.writeUInt16BE(record.requestId, 2);
    const notFit = contentBuffer.length % chunkSize;
    const paddingLength = notFit ? chunkSize - notFit : 0;
    const paddingBuffer = Buffer.alloc(paddingLength);
    headerBuffer.writeUInt16BE(contentBuffer.length, 4);
    headerBuffer.writeUInt8(paddingLength, 6);
    return [headerBuffer, contentBuffer, paddingBuffer];
}

function encodeRecord(record: FastCGIRecord, chunkSize: number, encoding: BufferEncoding): Buffer {
    if (isStreamRecord(record)) {
        let buffers: Buffer[] = [];
        let buffer = toBuffer(record.data, encoding);
        do {
            const chunk = buffer.subarray(0, chunkSize);
            buffer = buffer.subarray(chunkSize);
            buffers.push(...buildRecord(record, chunkSize, chunk));
        } while (buffer.length);
        return Buffer.concat(buffers);
    }
    return Buffer.concat(buildRecord(record, chunkSize, encodeRecordBody(record, encoding)));
}

function encodeRecordBody(record: FastCGIRecord, encoding: BufferEncoding): Buffer {
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
        case RecordType.PARAMS: {
            const entries = Object.entries(record.params);
            for (let i = 0; i < entries.length; i++) {
                const [name, value] = entries[i];
                if (value === undefined) continue;
                arr.push(...encodeKeyValuePair(name, value, encoding));
            }
            return Buffer.concat(arr);
        }
        case RecordType.GET_VALUES:
            for (let i = 0; i < record.keys.length; i++) {
                arr.push(...encodeKeyValuePair(record.keys[i], '', encoding));
            }
            return Buffer.concat(arr);
        case RecordType.GET_VALUES_RESULT: {
            const entries = Object.entries(record.values);
            for (let i = 0; i < entries.length; i++) {
                const [name, value] = entries[i];
                if (value === undefined) continue;
                arr.push(...encodeKeyValuePair(name, value, encoding));
            }
            return Buffer.concat(arr);
        }
        case RecordType.UNKNOWN_TYPE:
            buffer = Buffer.alloc(8);
            buffer.writeUint8(record.unknownType, 0);
            return buffer;
        default:
            throw new Error(`Unknown record type: ${record.type}`);
    }
}

function encodeKeyValuePair(name: string, value: string, encoding: BufferEncoding): Buffer[] {
    const nameBuffer = Buffer.from(name, encoding);
    const valueBuffer = Buffer.from(value, encoding);
    let nameLenBuffer: Buffer;
    if (nameBuffer.length < 0x80) {
        nameLenBuffer = Buffer.alloc(1);
        nameLenBuffer.writeUInt8(nameBuffer.length, 0);
    } else {
        nameLenBuffer = Buffer.alloc(4);
        nameLenBuffer.writeUInt32BE(nameBuffer.length | 0x80000000, 0);
    }
    let valueLenBuffer: Buffer;
    if (valueBuffer.length < 0x80) {
        valueLenBuffer = Buffer.alloc(1);
        valueLenBuffer.writeUInt8(valueBuffer.length, 0);
    } else {
        valueLenBuffer = Buffer.alloc(4);
        valueLenBuffer.writeUInt32BE(valueBuffer.length | 0x80000000, 0);
    }
    return [nameLenBuffer, valueLenBuffer, nameBuffer, valueBuffer];
}

export class Encoder extends Transform {
    #fitToChunk: number = 0;

    constructor(fitToChunk: number = DEFAULT_CHUNK_SIZE) {
        super({ writableObjectMode: true });
        assert(
            typeof fitToChunk === 'number' && fitToChunk > 0 && fitToChunk <= 255,
            'Invalid chunk size'
        );
        this.#fitToChunk = fitToChunk;
    }

    _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
        if (Array.isArray(chunk)) {
            this.push(
                Buffer.concat(
                    chunk.map((c) => encodeRecord(c as FastCGIRecord, this.#fitToChunk, encoding))
                )
            );
            callback();
            return;
        }
        this.push(encodeRecord(chunk as FastCGIRecord, this.#fitToChunk, encoding));
        callback();
    }
}
