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
    FCGI_MAX_CONNS: 10,
    FCGI_MAX_REQS: 50,
    FCGI_MPXS_CONNS: true
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
    FCGI_MAX_CONNS: 10,
    FCGI_MAX_REQS: 50,
    FCGI_MPXS_CONNS: true
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
