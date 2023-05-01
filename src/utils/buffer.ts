import { BufferLike } from '../protocol';

export function toBuffer(chunk: BufferLike | null, encoding?: BufferEncoding): Buffer {
    if (Buffer.isBuffer(chunk)) {
        return chunk;
    }
    if (chunk === null) {
        return Buffer.alloc(0);
    }
    if (typeof chunk === 'string') {
        return Buffer.from(chunk, encoding);
    }
    return Buffer.from(chunk.buffer);
}
