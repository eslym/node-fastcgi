import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import sourcemaps from 'rollup-plugin-sourcemaps';
import dts from 'rollup-plugin-dts';
import { builtinModules } from 'module';

/** @type {import('rollup').RollupOptions[]} */
export default [
    {
        input: {
            index: 'src/index.ts'
        },
        output: {
            dir: 'dist',
            format: 'module',
            sourcemap: true
        },
        plugins: [
            nodeResolve({
                extensions: ['.js', '.ts']
            }),
            commonjs(),
            typescript(),
            sourcemaps()
        ],
        external: [/^node:/, ...builtinModules]
    },
    {
        input: './dist/types/index.d.ts',
        output: [{ file: 'dist/index.d.ts', format: 'es' }],
        plugins: [dts()],
        external: [/^node:/, ...builtinModules]
    }
];
