import { Role } from './protocol';
import { IncomingRequest } from './request';
import { IncomingMessage, ServerResponse } from 'node:http';

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => void;

export function getURL(request: IncomingRequest) {
    const https = request.params.HTTPS === 'on';
    const host =
        request.params.HTTP_HOST ??
        request.params.SERVER_NAME ??
        `${request.params.SERVER_NAME ?? request.params.SERVER_ADDR}:${request.params.SERVER_PORT}`;
    const url = new URL(request.params.REQUEST_URI!, `${https ? 'https' : 'http'}://${host}`);
    url.search = request.params.QUERY_STRING ?? '';
    return url;
}

export function handleHttp(handler: HttpHandler) {
    return (req: IncomingRequest) => {
        if (req.role != Role.RESPONDER) {
            req.end(1);
        }
        handler(req.incomingMessage, req.serverResponse);
    };
}
