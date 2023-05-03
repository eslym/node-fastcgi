import { Socket, isIPv4 } from 'node:net';
import { Duplex } from 'node:stream';
import { noop } from './noop';
import { Params } from '../protocol';
import { IncomingRequest } from '../request';
import { ServerResponse, IncomingMessage } from 'node:http';

function defineGetter<T, K extends keyof T>(object: T, property: K, getter: () => T[K]) {
    Object.defineProperty(object, property, { get: getter });
}

function decorateServerResponse(response: ServerResponse) {
    // not an always guaranteed working trick
    // hooking into the private _storeHeader method
    // to replace the status line with the fastcgi status
    const storeHeader = (response as any)._storeHeader;
    (response as any)._storeHeader = function (this: ServerResponse, _: string, headers: any) {
        return storeHeader.call(this, `Status: ${this.statusCode}\r\n`, headers);
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

    // somehow if use push(), the write for the response will broke
    socket.on('data', (chunk) => request.emit('data', chunk));
    socket.on('end', () => request.emit('end'));
    socket.on('error', (err) => request.destroy(err));

    const qs =
        req.params.QUERY_STRING && !req.params.QUERY_STRING.startsWith('?')
            ? `?${req.params.QUERY_STRING}`
            : req.params.QUERY_STRING ?? '';

    request.url = req.params.REQUEST_URI + qs;
    request.method = req.params.REQUEST_METHOD;

    const response = new ServerResponse(request);

    decorateServerResponse(response);

    response.assignSocket(socket);

    response.on('finish', () => {
        req.end(0);
    });

    return { request, response };
}
