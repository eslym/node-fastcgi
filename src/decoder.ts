import { isArrayBufferView } from 'util/types';
import { Transform, TransformCallback } from 'stream';
import { RecordHeader, FastCGIRecord, Protocol, RecordType, Role, Status, Params } from './protocol';



function decodeRecordBody(header: RecordHeader, data: Buffer): FastCGIRecord {
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
        case RecordType.PARAMS: {
            const params: Params = {} as any;
            let i = 0;
            while (i < data.length) {
                const pair = decodeNameValuePair(data.subarray(i));
                i += pair.bytes;
                params[pair.name] = pair.value;
            }
            return {
                type: RecordType.PARAMS,
                requestId: header.requestId,
                params
            };
        }
        case RecordType.STDIN:
        case RecordType.STDOUT:
        case RecordType.STDERR:
        case RecordType.DATA:
            return {
                type: header.type,
                requestId: header.requestId,
                data
            };
        case RecordType.GET_VALUES: {
            const keys: string[] = [];
            let i = 0;
            while (i < data.length) {
                const pair = decodeNameValuePair(data.subarray(i));
                i += pair.bytes;
                keys.push(pair.name);
            }
            return {
                type: RecordType.GET_VALUES,
                requestId: header.requestId,
                keys
            };
        }
        case RecordType.GET_VALUES_RESULT: {
            const values: { [key: string]: string } = {};
            let i = 0;
            while (i < data.length) {
                const pair = decodeNameValuePair(data.subarray(i));
                i += pair.bytes;
                values[pair.name] = pair.value;
            }
            return {
                type: RecordType.GET_VALUES_RESULT,
                requestId: header.requestId,
                values
            };
        }
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

function decodeNameValuePair(data: Buffer): { bytes: number; name: string; value: string } {
    let offset = 0;
    let nameLen = data.readUint8(0);
    if (nameLen & 0x80) {
        nameLen =
            ((nameLen & 0x7f) << 24) |
            (data.readUint8(1) << 16) |
            (data.readUint8(2) << 8) |
            data.readUint8(3);
        offset = 4;
    } else {
        offset = 1;
    }
    let valueLen = data.readUint8(offset);
    if (valueLen & 0x80) {
        valueLen =
            ((valueLen & 0x7f) << 24) |
            (data.readUint8(offset + 1) << 16) |
            (data.readUint8(offset + 2) << 8) |
            data.readUint8(offset + 3);
        offset += 4;
    } else {
        offset += 1;
    }
    const name = data.subarray(offset, offset + nameLen).toString();
    offset += nameLen;
    const value = data.subarray(offset, offset + valueLen).toString();
    offset += valueLen;
    return {
        bytes: offset,
        name,
        value
    };
}

export class Decoder extends Transform {
    #buffer: Buffer = Buffer.from([]);
    #tempHeader?: RecordHeader;

    constructor() {
        super({ readableObjectMode: true });
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
            const record = decodeRecordBody(this.#tempHeader, contentData);
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
}
