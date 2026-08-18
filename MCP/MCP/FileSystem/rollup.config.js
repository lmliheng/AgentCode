// rollup.config.js
export default {
    input: './index.mjs',
    output: [{
        file: 'dist/fs_mcp.mjs',
        format: 'esm'
    }]
}