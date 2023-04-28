import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';

/** @type {import('rollup').RollupOptions} */
export default {
    input: {
        index: 'src/index.ts',
    },
    output: {
        dir: 'dist',
        format: 'module'
    },
    plugins: [
        nodeResolve({
            extensions: ['.js', '.ts']
        }),
        commonjs(),
        typescript()
    ]
};
