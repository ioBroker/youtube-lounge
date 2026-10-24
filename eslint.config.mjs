import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                allowDefaultProject: {
                    allow: ['*.js', '*.mjs', 'lib/*.js', 'test/*.js'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
    {
        files: ['test/**/*.js'],
        languageOptions: { globals: globals.mocha },
    },
    {
        ignores: ['build/**/*', 'node_modules/**/*'],
    },
];
