export type BufferLike = ArrayBufferView | string;

export function toBuffer(chunk: BufferLike | null, encoding?: BufferEncoding): Buffer {
    if (Buffer.isBuffer(chunk)) {
        return chunk;
    }
    if (typeof chunk === 'string') {
        return Buffer.from(chunk, encoding);
    }
    if (chunk === null) {
        return Buffer.alloc(0);
    }
    return Buffer.from(chunk.buffer);
}
