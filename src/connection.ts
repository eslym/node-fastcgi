import { Duplex, Readable, Transform, TransformCallback, Writable } from 'node:stream';
import { EventEmitter } from './utils/emitter';
import {
    Role,
    Config,
    Flags,
    Params,
    Status,
    FastCGIRecord,
    RecordType,
    BeginRequestRecord
} from './protocol';
import { OutgoingRequest, IncomingRequest } from './request';
import { noop, returnThis } from './utils/noop';
import { Decoder } from './decoder';
import { Encoder } from './encoder';
import { toBuffer } from './utils/buffer';

class DummyReadable extends Readable {
    _read() {}
}

class BufferToRecord extends Transform {
    #requestId: number;
    #type: RecordType;
    constructor(requestId: number, type: RecordType) {
        super({
            readableObjectMode: true
        });
        this.#requestId = requestId;
        this.#type = type;
    }

    _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback) {
        callback(null, {
            type: this.#type,
            requestId: this.#requestId,
            data: toBuffer(chunk, encoding)
        });
    }

    _flush(callback: TransformCallback) {
        callback(null, {
            type: this.#type,
            requestId: this.#requestId,
            data: toBuffer(Buffer.alloc(0), 'binary')
        });
    }
}

function createWriteStream(
    stream: Writable,
    requestId: number,
    type:
        | typeof RecordType.STDOUT
        | typeof RecordType.STDIN
        | typeof RecordType.STDERR
        | typeof RecordType.DATA
) {
    const bufferToRecord = new BufferToRecord(requestId, type);
    bufferToRecord.pipe(stream, { end: false });
    return bufferToRecord;
}

const cleanup = new WeakMap<object, () => void>();

function destroyRequest(request: IncomingRequest | OutgoingRequest) {
    if (cleanup.has(request)) {
        process.nextTick(cleanup.get(request)!);
        cleanup.delete(request);
    }
}

type IncomingConnectionEventMap = {
    request: (request: IncomingRequest) => void;
    error: (error: Error) => void;
    close: () => void;
};

export interface IncomingConnectionConfig {
    fastcgi?: Config;
    paddingFit?: number;
}

export class IncomingConnection extends EventEmitter<IncomingConnectionEventMap> {
    #stream: Duplex;
    #requests: Map<number, IncomingRequest> = new Map();
    #pendingRequests: Map<number, BeginRequestRecord & { params?: Params }> = new Map();
    #config: IncomingConnectionConfig;

    #closeConnection = false;

    get stream(): Duplex {
        return this.#stream;
    }

    get closed(): boolean {
        return this.#handleRecord === noop;
    }

    constructor(stream: Duplex, config: IncomingConnectionConfig = {}) {
        super();

        const io = {
            readable: new Decoder(),
            writable: new Encoder(config.paddingFit)
        };

        io.writable.pipe(stream).pipe(io.readable);

        this.#stream = Duplex.from(io);

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
        this.#handleRecord = noop;
        this.close = returnThis;
        for (const request of this.#requests.values()) {
            destroyRequest(request);
        }
        this.#requests.clear();
        this.#pendingRequests.clear();
        this.emit('close');
        return this;
    }

    #handleRecord = function (this: IncomingConnection, record: FastCGIRecord) {
        switch (record.type) {
            case RecordType.BEGIN_REQUEST:
                if (
                    this.#requests.has(record.requestId) ||
                    this.#pendingRequests.has(record.requestId) ||
                    record.requestId <= 0 ||
                    record.requestId > 0xffff
                ) {
                    return;
                }
                if (this.#closeConnection || !this.#config.fastcgi?.FCGI_MPXS_CONNS) {
                    this.#stream.write({
                        type: RecordType.END_REQUEST,
                        requestId: record.requestId,
                        appStatus: 0,
                        protocolStatus: Status.CANT_MPX_CONN
                    });
                    return;
                }
                this.#closeConnection =
                    !(record.flags & Flags.KEEP_CONN) || !this.#config.fastcgi?.FCGI_MPXS_CONNS;
                this.#pendingRequests.set(record.requestId, record);
                break;
            case RecordType.PARAMS:
                {
                    if (!this.#pendingRequests.has(record.requestId)) {
                        return;
                    }
                    const begin = this.#pendingRequests.get(record.requestId)!;
                    if (Object.keys(record.params).length > 0) {
                        begin.params = {
                            ...(begin.params ?? {}),
                            ...record.params
                        };
                        return;
                    }
                    this.#pendingRequests.delete(record.requestId);
                    const stdin = new DummyReadable();
                    const data = new DummyReadable();
                    const stdout = createWriteStream(
                        this.#stream,
                        record.requestId,
                        RecordType.STDOUT
                    );
                    const stderr = createWriteStream(
                        this.#stream,
                        record.requestId,
                        RecordType.STDERR
                    );
                    const request = new IncomingRequest({
                        role: begin.role,
                        stdin,
                        data,
                        stdout,
                        stderr,
                        params: (begin.params ?? {}) as Params
                    });
                    cleanup.set(request, () => {
                        if (!stdin.readableEnded) stdin.push(null);
                        if (!data.readableEnded) data.push(null);
                        // if (!stdout.closed) stdout.end();
                        // if (!stderr.closed) stderr.end();
                    });
                    this.#requests.set(record.requestId, request);
                    request.once(
                        'end',
                        (status: number = 0, protocolStatus: Status = Status.REQUEST_COMPLETE) => {
                            this.#stream.write({
                                type: RecordType.END_REQUEST,
                                requestId: record.requestId,
                                appStatus: status,
                                protocolStatus
                            });
                            destroyRequest(request);
                            this.#requests.delete(record.requestId);
                            if (this.#closeConnection) {
                                this.close();
                            }
                        }
                    );
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
                    request.abort();
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
                    const entries = Object.entries(this.#config.fastcgi ?? {});
                    for (let i = 0; i < entries.length; i++) {
                        const [key, val] = entries[i];
                        if (record.keys.includes(key) && typeof val !== 'undefined') {
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
    #encoder: Encoder;

    #requests: Map<number, OutgoingRequest> = new Map();

    #pendingGetValues: Set<(values: Config) => void> = new Set();

    #accId: number = 0;

    get stream(): Duplex {
        return this.#stream;
    }

    get closed(): boolean {
        return this.#handleRecord === noop;
    }

    constructor(stream: Duplex, paddingFit?: number) {
        super();

        const io = {
            readable: new Decoder(),
            writable: (this.#encoder = new Encoder(paddingFit))
        };

        io.writable.pipe(stream).pipe(io.readable);

        this.#stream = Duplex.from(io);

        this.#stream.on('data', (record) => {
            this.#handleRecord.call(this, record);
        });
    }

    async getValues(): Promise<Config> {
        if (this.#config) {
            return this.#config;
        }
        this.#stream.write({
            type: RecordType.GET_VALUES,
            requestId: 0,
            keys: ['FCGI_MAX_CONNS', 'FCGI_MAX_REQS', 'FCGI_MPXS_CONNS']
        });
        return new Promise((resolve) => {
            this.#pendingGetValues.add(resolve);
        });
    }

    async beginRequest(
        params: Params,
        { role = Role.RESPONDER, keepAlive = true }: BeginRequestOptions = {}
    ): Promise<OutgoingRequest> {
        if (this.#requests.size >= 0xffff) {
            throw new Error('Too many requests');
        }
        let requestId: number;
        do {
            requestId = (this.#accId++ % 0xffff) + 1;
        } while (this.#requests.has(requestId));
        const opts = {
            params,
            stdin: createWriteStream(this.#stream, requestId, RecordType.STDIN),
            data: createWriteStream(this.#stream, requestId, RecordType.DATA),
            stdout: new DummyReadable(),
            stderr: new DummyReadable()
        };
        const request = new OutgoingRequest(opts);
        cleanup.set(request, () => {
            if (!opts.stdout.readableEnded) opts.stdout.push(null);
            if (!opts.stderr.readableEnded) opts.stderr.push(null);
        });
        this.#requests.set(requestId, request);
        const records: FastCGIRecord[] = [
            {
                type: RecordType.BEGIN_REQUEST,
                role,
                requestId,
                flags: keepAlive ? Flags.KEEP_CONN : 0
            },
            {
                type: RecordType.PARAMS,
                requestId,
                params
            },
            {
                type: RecordType.PARAMS,
                requestId,
                params: {} as any
            }
        ];
        this.#stream.write(records);
        request.once('abort', () => {
            this.#stream.write({
                type: RecordType.ABORT_REQUEST,
                requestId
            });
            this.#requests.delete(requestId);
            destroyRequest(request);
            if (!keepAlive) {
                this.close();
            }
        });
        request.once('end', () => {
            this.#requests.delete(requestId);
            destroyRequest(request);
            if (!keepAlive) {
                this.close();
            }
        });
        return request;
    }

    close() {
        this.#handleRecord = noop;
        this.close = returnThis;
        for (const request of this.#requests.values()) {
            request.abort();
            destroyRequest(request);
        }
        this.emit('close');
        return this;
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
                    this.#requests.delete(record.requestId);
                    destroyRequest(request);
                    request.emit('end', record.appStatus, record.protocolStatus);
                }
                break;
        }
    };
}
