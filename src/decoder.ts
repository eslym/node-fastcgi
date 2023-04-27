import { isArrayBufferView } from 'util/types';
import { Transform, TransformCallback } from 'stream';
import { RecordHeader, Record, Protocol, RecordType } from './protocol';

export class Decoder extends Transform {
    #buffer: Buffer = Buffer.from([]);
    #tempHeader?: RecordHeader;

    constructor() {
        super();
    }

    _transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
        if (!isArrayBufferView(chunk) && typeof chunk !== 'string') {
            callback(new Error(`Invalid chunk type: ${typeof chunk}`));
            return;
        }
        this.#buffer = Buffer.concat([
            this.#buffer,
            Buffer.isBuffer(chunk)
                ? chunk
                : isArrayBufferView(chunk)
                ? Buffer.from(chunk.buffer)
                : Buffer.from(chunk, encoding)
        ]);
        this.#tryDecodeBuffer(callback);
    }

    #tryDecodeBuffer(callback: TransformCallback) {
        if (this.#buffer.length < Protocol.HEADER_LEN) {
            return callback();
        }
        if (!this.#tempHeader) {
            this.#tempHeader = {
                version: this.#buffer.readUInt8(0),
                type: this.#buffer.readUInt8(1) as RecordType,
                requestId: this.#buffer.readUInt16BE(2),
                contentLength: this.#buffer.readUInt16BE(4),
                paddingLength: this.#buffer.readUInt8(6)
            };
            if (this.#tempHeader.version !== Protocol.VERSION) {
                callback(new Error(`Unsupported protocol version: ${this.#tempHeader.version}`));
                return;
            }
            if (this.#tempHeader.contentLength > Protocol.MAX_CONTENT_SIZE) {
                callback(new Error(`Content length too large: ${this.#tempHeader.contentLength}`));
                return;
            }
            if (this.#tempHeader.paddingLength > Protocol.MAX_PADDING_SIZE) {
                callback(new Error(`Padding length too large: ${this.#tempHeader.paddingLength}`));
                return;
            }
            if (this.#tempHeader.type <= 0 || this.#tempHeader.type >= 12) {
                callback(new Error(`Unknown record type: ${this.#tempHeader.type}`));
                return;
            }
            this.#buffer = this.#buffer.subarray(Protocol.HEADER_LEN);
        }
        if (this.#buffer.length < this.#tempHeader.contentLength + this.#tempHeader.paddingLength) {
            return callback();
        }
        const contentData = this.#buffer.subarray(0, this.#tempHeader.contentLength);
        const paddingData = this.#buffer.subarray(
            this.#tempHeader.contentLength,
            this.#tempHeader.contentLength + this.#tempHeader.paddingLength
        );
        const record: Record = {
            header: this.#tempHeader,
            contentData,
            paddingData
        };
        this.push(record);
        this.#tempHeader = undefined;
        callback();
    }
}
