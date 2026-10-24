// The package is CommonJS, so the folder of the ES module build has to say that it is ESM
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

writeFileSync(
    join(__dirname, '../build/esm/package.json'),
    `${JSON.stringify({ type: 'module', sideEffects: false }, null, 4)}\n`,
);
