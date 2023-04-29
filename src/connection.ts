import { Readable, Writable } from 'stream';
import { EventEmitter } from './utils/emitter';
import {
    Role,
    Config,
    BufferLike,
    Flags,
    Params,
    Status,
    FastCGIRecord,
    RecordType,
    BeginRequestRecord
} from './protocol';
import { OutgoingRequest, IncomingRequest } from './request';
import { ProtocolStream } from './stream';
import { toBuffer } from './utils/buffer';

function writeAsync(stream: ProtocolStream, record: FastCGIRecord): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(record, undefined, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

class DummyReadable extends Readable {
    _read() {}
}

function createWriteStream(
    stream: ProtocolStream,
    type:
        | typeof RecordType.STDOUT
        | typeof RecordType.STDIN
        | typeof RecordType.STDERR
        | typeof RecordType.DATA
) {
    return new Writable({
        write(chunk, encoding, callback) {
            writeStream(stream, type, 0, chunk).then(callback as () => void, callback);
        },
        final(callback) {
            writeStream(stream, type, 0, null).then(callback as () => void, callback);
        }
    });
}

async function writeStream(
    stream: ProtocolStream,
    type:
        | typeof RecordType.STDOUT
        | typeof RecordType.STDIN
        | typeof RecordType.STDERR
        | typeof RecordType.DATA,
    requestId: number,
    data: BufferLike | null
) {
    let buffer = toBuffer(data);
    do {
        const chunk = buffer.subarray(0, 0xffff);
        buffer = buffer.subarray(0xffff);
        await writeAsync(stream, {
            type,
            requestId,
            data: chunk
        });
    } while (buffer.length > 0);
}

type IncomingConnectionEventMap = {
    request: (request: IncomingRequest) => void;
    error: (error: Error) => void;
    close: () => void;
};

export class IncomingConnection extends EventEmitter<IncomingConnectionEventMap> {
    #stream: ProtocolStream;
    #requests: Map<number, IncomingRequest> = new Map();
    #pendingRequests: Map<number, BeginRequestRecord> = new Map();
    #config: Config;

    #closeConnection = false;

    get stream(): ProtocolStream {
        return this.#stream;
    }

    constructor(stream: ProtocolStream, config: Config = {}) {
        super();
        this.#stream = stream;
        this.#config = config;
        this.#stream.on('data', (record: FastCGIRecord) => {
            this.#handleRecord(record);
        });

        this.#stream.on('error', (error: Error) => {
            this.emit('error', error);
        });

        this.#stream.on('close', () => {
            this.destroy();
        });
    }

    destroy() {
        this.#stream.destroy();
        for (const request of this.#requests.values()) {
            this.#destroyRequest(request);
        }
        this.#requests.clear();
        this.#pendingRequests.clear();
        this.emit('close');
    }

    #handleRecord(record: FastCGIRecord) {
        switch (record.type) {
            case RecordType.BEGIN_REQUEST:
                if (
                    this.#requests.has(record.requestId) ||
                    this.#pendingRequests.has(record.requestId) ||
                    record.requestId <= 0 ||
                    record.requestId > 0xffff ||
                    record.role !== Role.RESPONDER ||
                    this.#closeConnection
                ) {
                    return;
                }
                this.#closeConnection = !(record.flags & Flags.KEEP_CONN);
                this.#pendingRequests.set(record.requestId, record);
                break;
            case RecordType.PARAMS:
                {
                    if (!this.#pendingRequests.has(record.requestId)) {
                        return;
                    }
                    const begin = this.#pendingRequests.get(record.requestId)!;
                    this.#pendingRequests.delete(record.requestId);
                    const stdin = new DummyReadable();
                    const data = new DummyReadable();
                    const stdout = createWriteStream(this.#stream, RecordType.STDOUT);
                    const stderr = createWriteStream(this.#stream, RecordType.STDERR);
                    const request = new IncomingRequest({
                        role: begin.role,
                        stdin,
                        data,
                        stdout,
                        stderr,
                        params: record.params
                    });
                    this.#requests.set(record.requestId, request);
                    request.once('end', (status: number = 0) => {
                        this.#stream.write({
                            type: RecordType.END_REQUEST,
                            requestId: record.requestId,
                            appStatus: status,
                            protocolStatus: Status.REQUEST_COMPLETE
                        });
                        this.#destroyRequest(request);
                        this.#requests.delete(record.requestId);
                        if (this.#closeConnection) {
                            this.destroy();
                        }
                    });
                    this.emit('request', request);
                }
                break;
            case RecordType.STDIN:
            case RecordType.DATA:
                {
                    if (!this.#requests.has(record.requestId)) {
                        return;
                    }
                    const request = this.#requests.get(record.requestId)!;
                    const readable = (
                        record.type === RecordType.STDIN ? request.stdin : request.data
                    ) as Readable;
                    if ((record.data as Buffer).length === 0) {
                        readable.push(null);
                    } else {
                        readable.push(record.data);
                    }
                }
                break;
            case RecordType.ABORT_REQUEST:
                {
                    if (!this.#requests.has(record.requestId)) {
                        return;
                    }
                    const request = this.#requests.get(record.requestId)!;
                    request.emit('abort');
                    this.#destroyRequest(request);
                    this.#requests.delete(record.requestId);
                    this.#stream.write({
                        type: RecordType.END_REQUEST,
                        requestId: record.requestId,
                        appStatus: 0,
                        protocolStatus: Status.REQUEST_COMPLETE
                    });
                }
                break;
            case RecordType.GET_VALUES:
                {
                    const values: { [key: string]: string } = {};
                    for (const key of record.keys) {
                        if (key in this.#config) {
                            let val = (this.#config as any)[key];
                            values[key] = typeof val === 'boolean' ? (val ? '1' : '0') : `${val}`;
                        }
                    }
                    this.#stream.write({
                        type: RecordType.GET_VALUES_RESULT,
                        requestId: 0,
                        values
                    });
                }
                break;
        }
    }

    #destroyRequest(request: IncomingRequest) {
        (request.stdin as Readable).destroy();
        (request.data as Readable).destroy();
        (request.stdout as Writable).destroy();
        (request.stderr as Writable).destroy();
    }
}

type OutgoingConnectionEventMap = {
    close: () => void;
    error: (error: Error) => void;
};

interface BeginRequestOptions {
    role?: Role;
    keepAlive?: boolean;
}

export class OutgoingConnection extends EventEmitter<OutgoingConnectionEventMap> {
    #stream: ProtocolStream;
    #config?: Config;

    #requests: Map<number, OutgoingRequest> = new Map();

    #pendingGetValues: Set<(values: Config) => void> = new Set();

    #accId: number = 0;

    get stream(): ProtocolStream {
        return this.#stream;
    }

    constructor(stream: ProtocolStream) {
        super();
        this.#stream = stream;

        this.#stream.write({
            type: RecordType.GET_VALUES,
            requestId: 0,
            keys: ['FCGI_MAX_CONNS', 'FCGI_MAX_REQS', 'FCGI_MPXS_CONNS']
        });

        this.#stream.on('data', (record) => {
            this.#handleRecord(record);
        });
    }

    async getValues(): Promise<Config> {
        if (this.#config) {
            return this.#config;
        }
        return new Promise((resolve) => {
            this.#pendingGetValues.add(resolve);
        });
    }

    async beginRequest(
        params: Params,
        { role = Role.RESPONDER, keepAlive = true }: BeginRequestOptions = {}
    ): Promise<OutgoingRequest> {
        const downStreamConfig = await this.getValues();
        const shouldKeepAlive = keepAlive && downStreamConfig.FCGI_MPXS_CONNS;
        const requestId = (this.#accId++ % 0xffff) + 1;
        const request = new OutgoingRequest({
            params,
            stdin: createWriteStream(this.#stream, RecordType.STDIN),
            data: createWriteStream(this.#stream, RecordType.DATA)
        });
        this.#requests.set(requestId, request);
        await writeAsync(this.#stream, {
            type: RecordType.BEGIN_REQUEST,
            role,
            requestId,
            flags: shouldKeepAlive ? Flags.KEEP_CONN : 0
        });
        await writeAsync(this.#stream, {
            type: RecordType.PARAMS,
            requestId,
            params
        });
        request.on('abort', () => {
            this.#stream.write({
                type: RecordType.ABORT_REQUEST,
                requestId
            });
        });
        return request;
    }

    close() {
        this.#stream.destroy();
    }

    #handleRecord(record: FastCGIRecord) {
        switch (record.type) {
            case RecordType.GET_VALUES_RESULT:
                if (record.requestId !== 0) {
                    return;
                }
                this.#config = {};
                if (record.values.FCGI_MAX_CONNS) {
                    this.#config.FCGI_MAX_CONNS = parseInt(record.values.FCGI_MAX_CONNS);
                }
                if (record.values.FCGI_MAX_REQS) {
                    this.#config.FCGI_MAX_REQS = parseInt(record.values.FCGI_MAX_REQS);
                }
                this.#config.FCGI_MPXS_CONNS = record.values.FCGI_MPXS_CONNS === '1';
                for (const resolve of this.#pendingGetValues) {
                    resolve(this.#config);
                }
                this.#pendingGetValues.clear();
                break;
            case RecordType.STDOUT:
            case RecordType.STDERR:
                {
                    if (!this.#requests.has(record.requestId)) {
                        return;
                    }
                    const request = this.#requests.get(record.requestId)!;
                    const buffer = record.data as Buffer;
                    request.emit(
                        record.type === RecordType.STDOUT ? 'stdout' : 'stderr',
                        buffer.length === 0 ? null : buffer
                    );
                }
                break;
            case RecordType.END_REQUEST:
                {
                    if (!this.#requests.has(record.requestId)) {
                        return;
                    }
                    const request = this.#requests.get(record.requestId)!;
                    request.emit('end', record.appStatus);
                    this.#requests.delete(record.requestId);
                }
                break;
        }
    }
}
