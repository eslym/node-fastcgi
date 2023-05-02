# node-fastcgi

An implementation of [fastcgi protocol](https://fast-cgi.github.io/) for NodeJS

```shell
npm i @eslym/fastcgi
```

```shell
yarn add @eslym/fastcgi
```

## Usage

### Simple Usage

```typescript
import { Server } from '@eslym/fastcgi';

const server = new Server({
    fastcgi: {
        FCGI_MAX_CONNS: 10,
        FCGI_MAX_REQS: 50,
        FCGI_MPXS_CONNS: true
    }
});

async function writeAsync(stream, data) {
    return new Promise((resolve, reject) => {
        stream.write(data, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
}

server.on('request', async (req) => {
    console.log(req.params);
    try {
        await writeAsync(req.stdout, 'Status: 200\r\n');
        await writeAsync(req.stdout, 'Content-Type: text/plain\r\n');
        await writeAsync(req.stdout, 'Content-Length: 12\r\n\r\n');
        await writeAsync(req.stdout, 'Hello World!');
        req.stdout.end();
        req.end(0);
    } catch (e) {
        console.error(e);
    }
});

server.on('error', (err) => {
    console.error(err);
});

server.listen(9000);
```

### HTTP Helper

```typescript
import { Server, handleHttp } from '@eslym/fastcgi';

const server = new Server({
    fastcgi: {
        FCGI_MAX_CONNS: 10,
        FCGI_MAX_REQS: 50,
        FCGI_MPXS_CONNS: true
    }
});

async function readAsync(stream) {
    return new Promise((resolve, reject) => {
        let data: Buffer[] = [];
        stream.on('data', (chunk) => {
            data.push(chunk);
        });
        stream.on('end', () => {
            resolve(Buffer.concat(data));
        });
        stream.on('error', (err) => {
            reject(err);
        });
    });
}

server.on('request', (request) => {
    console.log('FastCGI Params', request.params);
    handleHttp(async (req, res) => {
        console.log('HTTP Headers', req.headers);
        if (req.headers['content-length'] !== '0') {
            const body = await readAsync(req);
            console.log('HTTP Body', body.toString());
        }
        res.writeHead(200, {
            'Content-Type': 'text/plain'
        });
        res.end('Hello World');
    })(request);
});

server.on('error', (err) => {
    console.error(err);
});

server.listen(9000);
```

### Use as a client

```typescript
import { OutgoingConnection } from '@eslym/fastcgi';
import { connect } from 'net';

const socket = connect(9000);

socket.on('connect', async () => {
    const conn = new OutgoingConnection(socket);

    const req = await conn.beginRequest(
        {
            QUERY_STRING: '',
            REQUEST_METHOD: 'GET',
            CONTENT_TYPE: '',
            CONTENT_LENGTH: '0',
            SCRIPT_FILENAME: '/var/www/html/index.php',
            SCRIPT_NAME: '/index.php',
            REQUEST_URI: '/',
            DOCUMENT_URI: '/index.php',
            DOCUMENT_ROOT: '/var/www/html',
            PATH_INFO: '',
            PATH_TRANSLATED: '',
            SERVER_PROTOCOL: 'HTTP/1.1',
            GATEWAY_INTERFACE: 'CGI/1.1',
            SERVER_SOFTWARE: 'nodejs',
            REMOTE_ADDR: '127.0.0.1',
            REMOTE_PORT: '12345',
            SERVER_ADDR: '127.0.0.1',
            SERVER_PORT: '80',
            SERVER_NAME: 'localhost',
            HTTP_HOST: 'www.example.com',
            HTTP_USER_AGENT: 'nodejs',
            HTTP_ACCEPT: '*/*',
            HTTP_ACCEPT_LANGUAGE: 'en-US'
        },
        {
            keepAlive: true
        }
    );

    let buffer = [];

    req.stdout.on('data', (chunk) => {
        buffer.push(chunk);
    });

    req.on('end', (status) => {
        console.log(Buffer.concat(buffer).toString());
        console.log(`Request end with status ${status}`);
    });
});
```
