import { EventEmitter } from './utils/emitter';
import { Params, Role } from './protocol';

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

    end(status?: number) {
        this.#stdout.end();
        this.#stderr.end();
        this.emit('end', status);
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
        this.emit('abort');
        this.#stdin.end();
    }

    write(chunk: Buffer | string) {
        this.#stdin.write(chunk);
    }
}
