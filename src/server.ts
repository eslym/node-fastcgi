import { IncomingConnection } from './connection';
import { IncomingRequest } from './request';
import { Socket, Server as TCPServer } from 'node:net';
import { EventEmitter } from './utils/emitter';
import { Config } from './protocol';
import { Abortable } from 'node:events';
import { Decoder } from './decoder';
import { Encoder } from './encoder';
import { Duplex } from 'node:stream';

type ServerEventMap = {
    connection: (connection: IncomingConnection) => void;
    request: (request: IncomingRequest) => void;
    error: (error: Error) => void;
    close: () => void;
};

interface ServerConfig {
    paddingFitToChunk?: number;
    server?: TCPServer;
    fastcgi?: Config;
}

interface ListenOptions extends Abortable {
    port?: number | undefined;
    host?: string | undefined;
    backlog?: number | undefined;
    path?: string | undefined;
    exclusive?: boolean | undefined;
    readableAll?: boolean | undefined;
    writableAll?: boolean | undefined;
    /**
     * @default false
     */
    ipv6Only?: boolean | undefined;
}

export class Server extends EventEmitter<ServerEventMap> {
    #server: TCPServer;
    #config: Config;
    #connections: Set<Socket> = new Set();
    #requests: Set<IncomingRequest> = new Set();

    get connections(): ReadonlySet<Socket> {
        return this.#connections;
    }

    get requests(): ReadonlySet<IncomingRequest> {
        return this.#requests;
    }

    constructor(config: ServerConfig = {}) {
        super();
        this.#config = config.fastcgi ?? {};
        this.#config.FCGI_MPXS_CONNS = config.fastcgi?.FCGI_MPXS_CONNS ?? true;
        this.#server = config.server ?? new TCPServer();
        this.#server.on('connection', (socket) => {
            const encoder = new Encoder(config.paddingFitToChunk);
            const decoder = new Decoder();
            socket.pipe(decoder);
            encoder.pipe(socket);
            const stream = Duplex.from({
                readable: decoder,
                writable: encoder
            });
            const connection = new IncomingConnection(stream);
            this.emit('connection', connection);
            this.#connections.add(socket);
            socket.on('close', () => {
                this.#connections.delete(socket);
                connection.close();
            });
            connection.on('close', () => {
                this.#connections.delete(socket);
                socket.destroy();
            });
        });

        this.#server.on('error', (error) => {
            this.emit('error', error);
        });

        this.#server.on('close', () => {
            this.emit('close');
        });

        this.on('connection', (connection) => {
            connection.on('request', (request) => {
                if (
                    this.#config.FCGI_MAX_REQS &&
                    this.#requests.size >= this.#config.FCGI_MAX_REQS
                ) {
                    request.end(0);
                    return;
                }
                this.emit('request', request);
                this.#requests.add(request);
                request.on('end', () => {
                    this.#requests.delete(request);
                });
            });
            connection.on('error', (error) => {
                this.emit('error', error);
            });
        });

        if (this.#config.FCGI_MAX_CONNS) {
            this.#server.maxConnections = this.#config.FCGI_MAX_CONNS;
        }
    }

    listen(port?: number, hostname?: string, backlog?: number): this;
    listen(port?: number, hostname?: string): this;
    listen(port?: number, backlog?: number): this;
    listen(port?: number): this;
    listen(path: string, backlog?: number): this;
    listen(path: string): this;
    listen(options: ListenOptions): this;
    listen(handle: any, backlog?: number): this;
    listen(handle: any): this;
    listen(...args: any[]) {
        this.#server.listen(...args);
        return this;
    }

    close() {
        this.#server.close();
        return this;
    }
}
