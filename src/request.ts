import { EventEmitter } from './utils/emitter';
import { Params, Role } from './protocol';
import { returnThis } from './utils/noop';

type IncomingRequestEvent = {
    error: (error: Error) => void;
    abort: () => void;
    end: (status?: number) => void;
};

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

    get role(): Role {
        return this.#role;
    }

    get stdin(): NodeJS.ReadableStream {
        return this.#stdin;
    }

    get data(): NodeJS.ReadableStream {
        return this.#data;
    }

    get stdout(): NodeJS.WritableStream {
        return this.#stdout;
    }

    get stderr(): NodeJS.WritableStream {
        return this.#stderr;
    }

    get params(): Params {
        return this.#params;
    }

    get ended(): boolean {
        return this.#ended;
    }

    get aborted(): boolean {
        return this.#aborted;
    }

    get abortedSignal(): AbortSignal {
        return this.#abortController.signal;
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

    end(status?: number) {
        this.end = returnThis;
        this.abort = returnThis;
        this.#ended = true;
        this.#stdout.end();
        this.#stderr.end();
        process.nextTick(() => this.emit('end', status));
        return this;
    }
}

type OutgoingRequestEvent = {
    error: (error: Error) => void;
    end: (status?: number) => void;
    abort: () => void;
};

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
        this.emit('abort');
        this.#stdin.end();
        return this;
    }

    write(chunk: Buffer | string) {
        this.#stdin.write(chunk);
    }
}
