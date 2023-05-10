import { EventEmitter } from './utils/emitter';
import { Params, Role, Status } from './protocol';
import { returnThis } from './utils/noop';
import { mockRequest } from './utils/http';
import type { IncomingMessage, ServerResponse } from 'node:http';

type IncomingRequestEvent = {
    error: (error: Error) => void;
    abort: () => void;
    end: (status?: number, protocolStatus?: Status) => void;
};

/**
 * Represents an incoming request from webserver.
 */
export class IncomingRequest extends EventEmitter<IncomingRequestEvent> {
    #role: Role;
    #stdin: NodeJS.ReadableStream;
    #data: NodeJS.ReadableStream;
    #stdout: NodeJS.WritableStream;
    #stderr: NodeJS.WritableStream;
    #abortController: AbortController = new AbortController();

    #ended: boolean = false;
    #aborted: boolean = false;

    #params: Params;

    /**
     * The role of the request.
     */
    get role(): Role {
        return this.#role;
    }

    /**
     * The request's stdin stream.
     */
    get stdin(): NodeJS.ReadableStream {
        return this.#stdin;
    }

    /**
     * The request's data stream.
     */
    get data(): NodeJS.ReadableStream {
        return this.#data;
    }

    /**
     * The request's stdout stream.
     */
    get stdout(): NodeJS.WritableStream {
        return this.#stdout;
    }

    /**
     * The request's stderr stream.
     */
    get stderr(): NodeJS.WritableStream {
        return this.#stderr;
    }

    /**
     * The request's params.
     */
    get params(): Params {
        return this.#params;
    }

    /**
     * Whether the request has ended.
     */
    get ended(): boolean {
        return this.#ended;
    }

    /**
     * Whether the request has been aborted.
     */
    get aborted(): boolean {
        return this.#aborted;
    }

    /**
     * The request's abort signal.
     */
    get abortedSignal(): AbortSignal {
        return this.#abortController.signal;
    }

    /**
     * Mocking the request into an http.IncomingMessage for compatibility.
     * ex: used as standard `res` argument for Express.
     */
    get incomingMessage(): IncomingMessage {
        return this.#mockRequest().request;
    }

    /**
     * Mocking the response into an http.ServerResponse for compatibility.
     * ex: used as standard `res` argument for Express.
     */
    get serverResponse(): ServerResponse {
        return this.#mockRequest().response;
    }

    constructor({
        role,
        stdin,
        data,
        stdout,
        stderr,
        params
    }: {
        role?: Role;
        stdin: NodeJS.ReadableStream;
        data: NodeJS.ReadableStream;
        stdout: NodeJS.WritableStream;
        stderr: NodeJS.WritableStream;
        params: Params;
    }) {
        super();
        this.#role = role ?? Role.RESPONDER;
        this.#stdin = stdin;
        this.#data = data;
        this.#stdout = stdout;
        this.#stderr = stderr;
        this.#params = params;
    }

    abort(reason?: string) {
        this.abort = returnThis;
        this.end = returnThis;
        this.#aborted = true;
        process.nextTick(() => {
            this.#abortController.abort(reason);
            this.emit('abort');
        });
        return this.end(1);
    }

    end(status?: number, protocolStatus?: Status) {
        this.end = returnThis;
        this.abort = returnThis;
        this.#ended = true;
        this.#stdout.end();
        this.#stderr.end();
        this.emit('end', status, protocolStatus);
        return this;
    }

    #mockRequest = () => {
        const http = mockRequest(this);
        this.#mockRequest = () => http;
        return http;
    };
}

type OutgoingRequestEvent = {
    error: (error: Error) => void;
    end: (status?: number, protocolStatus?: Status) => void;
    abort: () => void;
};

/**
 * Represents an outgoing request to FastCGI server.
 * Since making a FastCGI request is relatively complicated than serving one,
 * this class is provided to simplify the process, http API mocking is not provided.
 *
 * p/s: Making a FastCGI request requires Params to be properly set, ex:
 * `SCRIPT_FILENAME`, `DOCUMENT_ROOT`, `TRANSLATED_PATH`, etc.
 */
export class OutgoingRequest extends EventEmitter<OutgoingRequestEvent> {
    #params: Params;
    #stdin: NodeJS.WritableStream;
    #data: NodeJS.WritableStream;
    #stdout: NodeJS.ReadableStream;
    #stderr: NodeJS.ReadableStream;

    get params(): Params {
        return this.#params;
    }

    get stdin(): NodeJS.WritableStream {
        return this.#stdin;
    }

    get data(): NodeJS.WritableStream {
        return this.#data;
    }

    get stdout(): NodeJS.ReadableStream {
        return this.#stdout;
    }

    get stderr(): NodeJS.ReadableStream {
        return this.#stderr;
    }

    get aborted(): boolean {
        return this.abort === returnThis;
    }

    constructor({
        params,
        stdin,
        data,
        stdout,
        stderr
    }: {
        params: Params;
        stdin: NodeJS.WritableStream;
        data: NodeJS.WritableStream;
        stdout: NodeJS.ReadableStream;
        stderr: NodeJS.ReadableStream;
    }) {
        super();
        this.#params = params;
        this.#stdin = stdin;
        this.#data = data;
        this.#stdout = stdout;
        this.#stderr = stderr;
    }

    abort() {
        this.abort = returnThis;
        this.#stdin.end();
        this.emit('abort');
        return this;
    }

    write(chunk: Buffer | string) {
        this.#stdin.write(chunk);
    }
}
