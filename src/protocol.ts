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

export const Role = Object.freeze({
    RESPONDER: 1,
    AUTHORIZER: 2,
    FILTER: 3
} as const);

export type Role = (typeof Role)[keyof typeof Role];

export const Status = Object.freeze({
    REQUEST_COMPLETE: 0,
    CANT_MPX_CONN: 1,
    OVERLOADED: 2,
    UNKNOWN_ROLE: 3
} as const);

export type Status = (typeof Status)[keyof typeof Status];

export const Flags = Object.freeze({
    KEEP_CONN: 1
} as const);

export type Flags = number;

export interface Config {
    FCGI_MAX_CONNS?: number;
    FCGI_MAX_REQS?: number;
    FCGI_MPXS_CONNS?: boolean;
}

export type BufferLike = ArrayBufferView | string;

export type Params = {
    SERVER_NAME: string;
    SERVER_SOFTWARE: string;
    GATEWAY_INTERFACE: string;
    SERVER_PORT?: string;
    SERVER_PROTOCOL?: string;
    SCRIPT_FILENAME?: string;
    QUERY_STRING?: string;
    REQUEST_METHOD?: string;
    CONTENT_TYPE?: string;
    CONTENT_LENGTH?: string;
    SCRIPT_NAME?: string;
    REQUEST_URI?: string;
    DOCUMENT_URI?: string;
    DOCUMENT_ROOT?: string;
    SERVER_ADDR?: string;
    REMOTE_ADDR?: string;
    REMOTE_PORT?: string;
    PATH_INFO?: string;
    PATH_TRANSLATED?: string;
    HTTPS?: string;
    [key: string]: string | undefined;
};

export interface RecordHeader {
    version: number;
    type: RecordType;
    requestId: number;
    contentLength: number;
    paddingLength: number;
}

interface BaseRecord {
    type: RecordType;
    requestId: number;
}

export interface BeginRequestRecord extends BaseRecord {
    type: typeof RecordType.BEGIN_REQUEST;
    role: Role;
    flags: number;
}

export interface AbortRequestRecord extends BaseRecord {
    type: typeof RecordType.ABORT_REQUEST;
}

export interface EndRequestRecord extends BaseRecord {
    type: typeof RecordType.END_REQUEST;
    appStatus: number;
    protocolStatus: Status;
}

export interface ParamsRecord extends BaseRecord {
    type: typeof RecordType.PARAMS;
    params: Params;
}

export interface StreamRecord extends BaseRecord {
    type: typeof RecordType.STDIN | typeof RecordType.STDOUT | typeof RecordType.STDERR;
    data: BufferLike | null;
}

export interface DataRecord extends BaseRecord {
    type: typeof RecordType.DATA;
    data: BufferLike | null;
}

export interface GetValuesRecord extends BaseRecord {
    type: typeof RecordType.GET_VALUES;
    keys: string[];
}

export interface GetValuesResultRecord extends BaseRecord {
    type: typeof RecordType.GET_VALUES_RESULT;
    values: { [key: string]: string };
}

export interface UnknownTypeRecord extends BaseRecord {
    type: typeof RecordType.UNKNOWN_TYPE;
    unknownType: number;
}

export type Record =
    | BeginRequestRecord
    | AbortRequestRecord
    | EndRequestRecord
    | ParamsRecord
    | StreamRecord
    | DataRecord
    | GetValuesRecord
    | GetValuesResultRecord
    | UnknownTypeRecord;
