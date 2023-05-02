export const noop = (() => {}) as (..._: any[]) => any;

export const returnThis = function (this: any, ..._: any[]) {
    return this;
};
