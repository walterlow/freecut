// Local alias for the SDK. During development this resolves to the
// workspace SDK's built dist/. When this package is published to npm it
// becomes a regular dependency — swap this file for a single line:
//   export * from '@freecut/sdk';
export * from '../../sdk/dist/index.js';
