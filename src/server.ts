import { IncomingConnection } from './connection';
import { IncomingRequest } from './request';
import { Socket, Server as TCPServer } from 'net';
import { EventEmitter } from './utils/emitter';
import { ProtocolStream } from './stream';
import { Config } from './protocol';

type ServerEventMap = {
    connection: (connection: IncomingConnection) => void;
    request: (request: IncomingRequest) => void;
    error: (error: Error) => void;
    close: () => void;
};

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

    constructor(config: Config = {}) {
        super();
        this.#config = config;
        this.#server = new TCPServer();
        this.#server.on('connection', (socket) => {
            this.emit(
                'connection',
                new IncomingConnection(new ProtocolStream(socket), this.#config)
            );
            this.#connections.add(socket);
            socket.on('close', () => {
                this.#connections.delete(socket);
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
                    request.stdout.write('503 Service Unavailable\r\n\r\n');
                    request.stdout.end();
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

    listen(port: number, host?: string) {
        this.#server.listen(port, host);
    }

    close() {
        this.#server.close();
    }
}
