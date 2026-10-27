// Launch the real bundle with an isolated, disposable test profile.
const { app } = require('electron');
const path = require('node:path');
if (!process.env.SCREENSHOT_AI_TEST_USER_DATA) throw new Error('Test profile required');
app.setPath('userData', process.env.SCREENSHOT_AI_TEST_USER_DATA);
// Check native ABI compatibility without reading or writing any credentials.
require('keytar');
require(path.resolve(__dirname, '../../dist/main/index.js'));
