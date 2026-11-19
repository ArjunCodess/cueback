const { createRequire } = require('node:module');

module.exports = function cameraSupported() {
  const sdk = '@smartspectra/node-sdk';
  try {
    const requireFromSdk = createRequire(require.resolve(sdk + '/package.json'));
    if (process.env.SMARTSPECTRA_CAPI_PATH) return true;
    return Boolean(requireFromSdk.resolve(`${sdk}-${process.platform}-${process.arch}/package.json`));
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return false;
  }
};
