import { BufferLike } from '../protocol';

export function toBuffer(chunk: BufferLike | null): Buffer {
    if (chunk === null) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(chunk)) {
        return chunk;
    }
    if (typeof chunk === 'string') {
        return Buffer.from(chunk);
    }
    return Buffer.from(chunk.buffer);
}
