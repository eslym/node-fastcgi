import { isArrayBufferView } from 'util/types';
import { Transform, TransformCallback } from 'stream';
import {
    RecordHeader,
    Record,
    Protocol,
    RecordType,
    Role,
    Status,
    Params
} from './protocol';

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

        try {
            const record = this.#decodeRecordBody(this.#tempHeader, contentData);
            this.push(record);
        } catch (err) {
            callback(err as Error);
            return;
        }

        this.#buffer = this.#buffer.subarray(
            this.#tempHeader.contentLength + this.#tempHeader.paddingLength
        );
        this.#tempHeader = undefined;
        if (this.#buffer.length > 0) {
            new Promise<void>((resolve) => {
                this.#tryDecodeBuffer((err) => {
                    callback(err);
                    resolve();
                });
            });
            return;
        }
        callback();
    }

    #decodeRecordBody(header: RecordHeader, data: Buffer): Record {
        switch (header.type) {
            case RecordType.BEGIN_REQUEST:
                return {
                    type: RecordType.BEGIN_REQUEST,
                    requestId: header.requestId,
                    role: data.readUInt16BE(0) as Role,
                    flags: data.readUInt8(2)
                };
            case RecordType.ABORT_REQUEST:
                return {
                    type: RecordType.ABORT_REQUEST,
                    requestId: header.requestId
                };
            case RecordType.END_REQUEST:
                return {
                    type: RecordType.END_REQUEST,
                    requestId: header.requestId,
                    appStatus: data.readUInt32BE(0),
                    protocolStatus: data.readUInt8(4) as Status
                };
            case RecordType.PARAMS:
                const params: Params = {} as any;
                let i = 0;
                while (i < data.length) {
                    const nameLen = data.readUInt16BE(i);
                    i += 2;
                    if (nameLen === 0) {
                        break;
                    }
                    const name = data.subarray(i, i + nameLen).toString();
                    i += nameLen;
                    const valueLen = data.readUInt16BE(i);
                    i += 2;
                    const value = data.subarray(i, i + valueLen).toString();
                    i += valueLen;
                    params[name] = value;
                }
                return {
                    type: RecordType.PARAMS,
                    requestId: header.requestId,
                    params
                };
            case RecordType.STDIN:
            case RecordType.STDOUT:
            case RecordType.STDERR:
            case RecordType.DATA:
                return {
                    type: header.type,
                    requestId: header.requestId,
                    data
                };
            case RecordType.GET_VALUES:
                const keys: string[] = [];
                let j = 0;
                while (j < data.length) {
                    const keyLen = data.readUInt16BE(j);
                    j += 2;
                    if (keyLen === 0) {
                        break;
                    }
                    const key = data.subarray(j, j + keyLen).toString();
                    j += keyLen;
                    keys.push(key);
                }
                return {
                    type: RecordType.GET_VALUES,
                    requestId: header.requestId,
                    keys
                };
            case RecordType.GET_VALUES_RESULT:
                const values: { [key: string]: string } = {};
                let k = 0;
                while (k < data.length) {
                    const keyLen = data.readUInt16BE(k);
                    k += 2;
                    if (keyLen === 0) {
                        break;
                    }
                    const key = data.subarray(k, k + keyLen).toString();
                    k += keyLen;
                    const valueLen = data.readUInt16BE(k);
                    k += 2;
                    const value = data.subarray(k, k + valueLen).toString();
                    k += valueLen;
                    values[key] = value;
                }
                return {
                    type: RecordType.GET_VALUES_RESULT,
                    requestId: header.requestId,
                    values
                };
            case RecordType.UNKNOWN_TYPE:
                const type = data.readUInt8(0);
                return {
                    type: RecordType.UNKNOWN_TYPE,
                    requestId: header.requestId,
                    unknownType: type
                };
            default:
                throw new Error(`Unknown record type: ${header.type}`);
        }
    }
}
