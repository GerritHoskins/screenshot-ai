// Launch the real bundle with an isolated, disposable test profile.
const { app } = require('electron');
const path = require('node:path');
if (!process.env.SCREENSHOT_AI_TEST_USER_DATA) throw new Error('Test profile required');
app.setPath('userData', process.env.SCREENSHOT_AI_TEST_USER_DATA);
// Load the native module to check ABI compatibility, then isolate its methods.
// userData does not isolate OS keychain service/accounts by itself.
const keytar = require('keytar');
for (const method of ['getPassword', 'setPassword', 'deletePassword', 'findCredentials']) {
  if (typeof keytar[method] !== 'function') throw new Error('Missing native keychain method: ' + method);
}
const credentials = new Map();
keytar.getPassword = async (service, account) => credentials.get(service)?.get(account) ?? null;
keytar.setPassword = async (service, account, password) => {
  if (!credentials.has(service)) credentials.set(service, new Map());
  credentials.get(service).set(account, password);
};
keytar.deletePassword = async (service, account) => credentials.get(service)?.delete(account) ?? false;
keytar.findCredentials = async service => Array.from(credentials.get(service) ?? [], ([account, password]) => ({ account, password }));
require(path.resolve(__dirname, '../../dist/main/index.js'));
