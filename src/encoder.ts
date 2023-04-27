import { isArrayBufferView } from 'util/types';
import { Transform, TransformCallback } from 'stream';
import { Protocol, ResponseRecord } from './protocol';
import assert from 'assert';

function ensureRecord(object: any): ResponseRecord | string {
    if (typeof object !== 'object') {
        return 'Invalid record type';
    }
    if (typeof object.type !== 'number' || object.type <= 0 || object.type >= 12) {
        return 'Invalid record type';
    }
    if (typeof object.requestId !== 'number') {
        return 'Invalid record requestId';
    }
    if (!isArrayBufferView(object.contentData) || typeof object.contentData !== 'string') {
        return 'Invalid record contentData';
    }
    return {
        type: object.type,
        requestId: object.requestId,
        contentData: Buffer.isBuffer(object.contentData)
            ? object.contentData
            : isArrayBufferView(object.contentData)
            ? Buffer.from(object.contentData.buffer)
            : Buffer.from(object.contentData, 'utf8')
    };
}

function recordToBuffer(record: ResponseRecord, chunkSize: number) {
    const headerBuffer = Buffer.alloc(Protocol.HEADER_LEN);
    headerBuffer.writeUInt8(Protocol.VERSION, 0);
    headerBuffer.writeUInt8(record.type, 1);
    headerBuffer.writeUInt16BE(record.requestId, 2);
    headerBuffer.writeUInt16BE(record.contentData.length, 4);
    const contentBuffer = record.contentData;
    const paddingBuffer = Buffer.alloc((headerBuffer.length + contentBuffer.length) % chunkSize);
    headerBuffer.writeUInt8(paddingBuffer.length, 6);
    return Buffer.concat([headerBuffer, contentBuffer, paddingBuffer]);
}

export class Encoder extends Transform {
    #chunkSize: number = 0;

    constructor(chunkSize: number) {
        super();
        assert(typeof chunkSize === 'number' && chunkSize > 0, 'Invalid chunk size');
        this.#chunkSize = chunkSize;
    }

    _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
        const record = ensureRecord(chunk);
        if (typeof record === 'string') {
            callback(new Error(record));
            return;
        }
        const buffer = recordToBuffer(record, this.#chunkSize);
        callback(null, buffer);
    }
}
