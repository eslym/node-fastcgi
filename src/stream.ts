import { Duplex } from 'stream';
import { Encoder } from './encoder';
import { Decoder } from './decoder';

export class ProtocolStream extends Duplex {
    #encoder: Encoder;
    #decoder: Decoder;
    #stream: Duplex;

    constructor(stream: Duplex, encoderChunkSize?: number) {
        super();
        this.#stream = stream;

        this.#encoder = new Encoder(encoderChunkSize);
        this.#decoder = new Decoder();

        this.#encoder.pipe(this.#stream);
        this.#stream.pipe(this.#decoder);

        this.#decoder.on('data', (chunk) => {
            this.push(chunk);
        });
        this.#decoder.on('finish', () => {
            this.push(null);
        });
        this.#decoder.on('end', () => {
            this.push(null);
        });

        this.#decoder.on('error', (error) => {
            this.destroy(error);
        });
        this.#stream.on('error', (error) => {
            this.destroy(error);
        });
        this.#encoder.on('error', (error) => {
            this.destroy(error);
        });

        this.#stream.on('close', () => {
            this.destroy();
        });
        this.on('close', () => {
            this.#stream.destroy();
        });
    }

    _write(
        chunk: any,
        encoding: BufferEncoding,
        callback: (error?: Error | null | undefined) => void
    ): void {
        this.#encoder.write(chunk, encoding, callback);
    }
}
