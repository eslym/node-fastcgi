import { Duplex, Readable, Writable } from 'stream';
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
import { toBuffer } from './utils/buffer';
import { connect } from 'net';

function writeAsync(stream: Writable, record: FastCGIRecord): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(record, (error) => {
            if (error) {
                reject(error);
            } else {
                resolve();
            }
        });
    });
}

const noop = (() => {}) as (...any: any[]) => any;

class DummyReadable extends Readable {
    _read() {}
}

function createWriteStream(
    stream: Writable,
    type:
        | typeof RecordType.STDOUT
        | typeof RecordType.STDIN
        | typeof RecordType.STDERR
        | typeof RecordType.DATA
) {
    return new Writable({
        write(chunk, encoding, callback) {
            writeStream(stream, type, 0, chunk, encoding).then(callback as () => void, callback);
        },
        final(callback) {
            writeStream(stream, type, 0, null, 'utf8').then(callback as () => void, callback);
        }
    });
}

type destroyable = {
    destroy(): void;
};

function destroyRequest(request: IncomingRequest | OutgoingRequest) {
    (request.stdin as any as destroyable).destroy();
    (request.data as any as destroyable).destroy();
    (request.stdout as any as destroyable).destroy();
    (request.stderr as any as destroyable).destroy();
}

async function writeStream(
    stream: Writable,
    type:
        | typeof RecordType.STDOUT
        | typeof RecordType.STDIN
        | typeof RecordType.STDERR
        | typeof RecordType.DATA,
    requestId: number,
    data: BufferLike | null,
    encoding: BufferEncoding
) {
    let buffer = toBuffer(data, encoding);
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
    #stream: Duplex;
    #requests: Map<number, IncomingRequest> = new Map();
    #pendingRequests: Map<number, BeginRequestRecord> = new Map();
    #config: Config;

    #closeConnection = false;

    get stream(): Duplex {
        return this.#stream;
    }

    get closed(): boolean {
        return this.#handleRecord === noop;
    }

    constructor(stream: Duplex, config: Config = {}) {
        super();
        this.#stream = stream;
        this.#config = config;
        this.#stream.on('data', (record: FastCGIRecord) => {
            this.#handleRecord.call(this, record);
        });

        this.#stream.on('error', (error: Error) => {
            this.emit('error', error);
        });

        this.#stream.on('close', () => {
            this.close();
        });
    }

    close() {
        if (this.closed) {
            return;
        }
        this.#handleRecord = noop;
        this.close = noop;
        for (const request of this.#requests.values()) {
            destroyRequest(request);
        }
        this.#requests.clear();
        this.#pendingRequests.clear();
        this.emit('close');
    }

    #handleRecord = function (this: IncomingConnection, record: FastCGIRecord) {
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
                        destroyRequest(request);
                        this.#requests.delete(record.requestId);
                        if (this.#closeConnection) {
                            this.close();
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
                    destroyRequest(request);
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
    };
}

type OutgoingConnectionEventMap = {
    close: () => void;
    error: (error: Error) => void;
};

interface BeginRequestOptions {
    role?: Role;
    keepAlive?: boolean;
    serverSoftware?: string;
}

export class OutgoingConnection extends EventEmitter<OutgoingConnectionEventMap> {
    #stream: Duplex;
    #config?: Config;

    #requests: Map<number, OutgoingRequest> = new Map();

    #pendingGetValues: Set<(values: Config) => void> = new Set();

    #accId: number = 0;

    get stream(): Duplex {
        return this.#stream;
    }

    get closed(): boolean {
        return this.#handleRecord === noop;
    }

    constructor(stream: Duplex) {
        super();
        this.#stream = stream;

        this.#stream.write({
            type: RecordType.GET_VALUES,
            requestId: 0,
            keys: ['FCGI_MAX_CONNS', 'FCGI_MAX_REQS', 'FCGI_MPXS_CONNS']
        });

        this.#stream.on('data', (record) => {
            this.#handleRecord.call(this, record);
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
            data: createWriteStream(this.#stream, RecordType.DATA),
            stdout: new DummyReadable(),
            stderr: new DummyReadable()
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
        request.once('abort', () => {
            this.#stream.write({
                type: RecordType.ABORT_REQUEST,
                requestId
            });
            this.#requests.delete(requestId);
            destroyRequest(request);
            if (!shouldKeepAlive) {
                this.close();
            }
        });
        request.once('end', () => {
            this.#requests.delete(requestId);
            destroyRequest(request);
            if (!shouldKeepAlive) {
                this.close();
            }
        });
        return request;
    }

    close() {
        if (this.closed) {
            return;
        }
        this.#handleRecord = noop;
        for (const request of this.#requests.values()) {
            request.abort();
            destroyRequest(request);
        }
        this.emit('close');
    }

    #handleRecord = function (this: OutgoingConnection, record: FastCGIRecord) {
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
                    const dest =
                        record.type === RecordType.STDOUT ? request.stdout : request.stderr;
                    if (buffer.length === 0) {
                        (dest as Readable).push(null);
                    } else {
                        (dest as Readable).push(buffer);
                    }
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
                    destroyRequest(request);
                }
                break;
        }
    };
}
