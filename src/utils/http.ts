import { Socket, isIPv4 } from 'node:net';
import { Duplex, PassThrough } from 'node:stream';
import { noop } from './noop';
import { Params } from '../protocol';
import { IncomingRequest } from '../request';
import { ServerResponse, IncomingMessage } from 'node:http';

function defineGetter<T, K extends keyof T>(object: T, property: K, getter: () => T[K]) {
    Object.defineProperty(object, property, { get: getter });
}

const storeHeader = (ServerResponse as any).prototype._storeHeader as Function;

function decorateServerResponse(response: ServerResponse) {
    // not an always guaranteed working trick
    // hooking into the private _storeHeader method
    // to replace the status line with the fastcgi status
    (response as any)._storeHeader = function (this: ServerResponse, _: string, headers: any) {
        return storeHeader.call(this, `Status: ${this.statusCode}\r\n`, headers);
    };

    (response as any)._onPendingData = function (this: ServerResponse, size: number) {
        if (this.writableNeedDrain) {
            this.emit('drain');
        }
    };
}

export function mockSocket(
    src: NodeJS.ReadableStream,
    dest: NodeJS.WritableStream,
    params: Params
) {
    const duplex = Duplex.from({
        readable: src,
        writable: dest
    }) as Socket;

    const remote = {
        address: params.REMOTE_ADDR,
        port: params.REMOTE_PORT ? Number(params.REMOTE_PORT) : undefined,
        family: params.REMOTE_ADDR ? (isIPv4(params.REMOTE_ADDR) ? 'IPv4' : 'IPv6') : undefined
    };

    defineGetter(duplex, 'remoteAddress', () => remote.address);
    defineGetter(duplex, 'remotePort', () => remote.port);
    defineGetter(duplex, 'remoteFamily', () => remote.family);
    defineGetter(duplex, 'address', () => () => remote);
    defineGetter(duplex, 'localAddress', () => params.SERVER_ADDR);
    defineGetter(duplex, 'localPort', () =>
        params.SERVER_PORT ? Number(params.SERVER_PORT) : undefined
    );
    defineGetter(duplex, 'setKeepAlive', () => noop);
    defineGetter(duplex, 'setTimeout', () => noop);
    defineGetter(duplex, 'setNoDelay', () => noop);
    defineGetter(duplex, 'ref', () => () => duplex);
    defineGetter(duplex, 'unref', () => () => duplex);
    defineGetter(duplex, 'encrypted' as any, () => params.HTTPS === 'on');

    return duplex;
}

export function mockRequest(req: IncomingRequest) {
    const socket = mockSocket(req.stdin, req.stdout, req.params);
    const request = new IncomingMessage(socket);
    const pairs = Object.entries(req.params);
    for (let i = 0; i < pairs.length; i++) {
        const [key, value] = pairs[i];
        if (!key.startsWith('HTTP_')) continue;
        request.headers[key.replace('HTTP_', '').replace(/_/g, '-').toLowerCase()] = value;
    }

    if (req.params.CONTENT_LENGTH && !('content-length' in request.headers)) {
        request.headers['content-length'] = req.params.CONTENT_LENGTH;
    }

    let contentLength = parseInt(`${req.params.CONTENT_LENGTH}`);

    if (!isNaN(contentLength) && contentLength > 0) {
        let bytesRead = 0;
        const read = (chunk: Buffer) => {
            bytesRead += chunk.length;
            request.push(chunk);
            if (bytesRead >= contentLength) {
                request.complete = true;
                request.push(null);
                req.stdin.off('data', read);
            }
        };
        req.stdin.on('data', read);
        req.stdin.once('end', () => {
            request.complete = true;
            request.push(null);
            req.stdin.off('data', read);
        });
    } else {
        request.complete = true;
        request.push(null);
    }

    const qs =
        req.params.QUERY_STRING && !req.params.QUERY_STRING.startsWith('?')
            ? `?${req.params.QUERY_STRING}`
            : req.params.QUERY_STRING ?? '';

    request.url = req.params.REQUEST_URI + qs;
    request.method = req.params.REQUEST_METHOD;

    if (req.params.SERVER_PROTOCOL) {
        const [major, minor] = req.params.SERVER_PROTOCOL.replace('HTTP/', '').split('.');
        request.httpVersionMajor = Number(major);
        request.httpVersionMinor = Number(minor);
        request.httpVersion = `HTTP/${major}.${minor}`;
    }

    const response = new ServerResponse(request);

    response.assignSocket(socket);

    decorateServerResponse(response);

    const onDrain = () => {
        (response as any)._onPendingData(0);
    };

    socket.on('drain', onDrain);

    socket.on('close', () => {
        socket.off('drain', onDrain);
    });

    response.on('finish', () => {
        req.end(0);
    });

    return { request, response };
}
