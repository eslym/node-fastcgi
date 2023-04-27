export const Protocol = Object.freeze({
    VERSION: 1,
    HEADER_LEN: 8,
    MAX_CONTENT_SIZE: 65535,
    MAX_PADDING_SIZE: 255,
    NULL_REQUEST_ID: 0
} as const);

export const RecordType = Object.freeze({
    BEGIN_REQUEST: 1,
    ABORT_REQUEST: 2,
    END_REQUEST: 3,
    PARAMS: 4,
    STDIN: 5,
    STDOUT: 6,
    STDERR: 7,
    DATA: 8,
    GET_VALUES: 9,
    GET_VALUES_RESULT: 10,
    UNKNOWN_TYPE: 11
} as const);

export type RecordType = (typeof RecordType)[keyof typeof RecordType];

export interface RecordHeader {
    version: number;
    type: RecordType;
    requestId: number;
    contentLength: number;
    paddingLength: number;
}

export interface Record {
    header: RecordHeader;
    contentData: Buffer;
    paddingData: Buffer;
}

export interface ResponseRecord {
    type: RecordType;
    requestId: number;
    contentData: Buffer;
}
