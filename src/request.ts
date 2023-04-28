import { EventEmitter } from './utils/emitter';
import { Params } from './protocol';

type IncomingRequestEvent = {
    error: (error: Error) => void;
    abort: () => void;
    end: (status?: number) => void;
};

export class IncomingRequest extends EventEmitter<IncomingRequestEvent> {
    #stdin: NodeJS.ReadableStream;
    #stdout: NodeJS.WritableStream;
    #stderr: NodeJS.WritableStream;

    #params: Params;

    get stdin(): NodeJS.ReadableStream {
        return this.#stdin;
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
        stdin,
        stdout,
        stderr,
        params
    }: {
        stdin: NodeJS.ReadableStream;
        stdout: NodeJS.WritableStream;
        stderr: NodeJS.WritableStream;
        params: Params;
    }) {
        super();
        this.#stdin = stdin;
        this.#stdout = stdout;
        this.#stderr = stderr;
        this.#params = params;
    }

    end(status?: number) {
        this.emit('end', status);
        this.#stdout.end();
        this.#stderr.end();
    }
}

type OutgoingRequestEvent = {
    error: (error: Error) => void;
    stdout: (chunk: Buffer | null) => void;
    stderr: (chunk: Buffer | null) => void;
    end: (status?: number) => void;
    abort: () => void;
};

export class OutgoingRequest extends EventEmitter<OutgoingRequestEvent> {
    #params: Params;
    #stdin: NodeJS.WritableStream;

    get params(): Params {
        return this.#params;
    }

    get stdin(): NodeJS.WritableStream {
        return this.#stdin;
    }

    constructor({ params, stdin }: { params: Params; stdin: NodeJS.WritableStream }) {
        super();
        this.#params = params;
        this.#stdin = stdin;
    }

    abort() {
        this.emit('abort');
        this.#stdin.end();
    }

    write(chunk: Buffer | string) {
        this.#stdin.write(chunk);
    }
}
