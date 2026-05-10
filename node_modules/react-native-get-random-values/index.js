const base64Decode = require('fast-base64-decode')
const { TurboModuleRegistry } = require('react-native')

class TypeMismatchError extends Error {}
class QuotaExceededError extends Error {}

let warned = false
function insecureRandomValues (array) {
  if (!warned) {
    console.warn('Using an insecure random number generator, this should only happen when running in a debugger without support for crypto.getRandomValues')
    warned = true
  }

  for (let i = 0, r; i < array.length; i++) {
    if ((i & 0x03) === 0) r = Math.random() * 0x100000000
    array[i] = (r >>> ((i & 0x03) << 3)) & 0xff
  }

  return array
}

let module = null
/**
 * @param {number} byteLength
 * @returns {string}
 */
function getRandomBase64 (byteLength) {
  if (module == null) {
    module = TurboModuleRegistry.getEnforcing('RNGetRandomValues')
  }

  return module.getRandomBase64(byteLength)
}

/**
 * @param {Int8Array|Uint8Array|Int16Array|Uint16Array|Int32Array|Uint32Array|Uint8ClampedArray} array
 */
function getRandomValues (array) {
  if (!(array instanceof Int8Array || array instanceof Uint8Array || array instanceof Int16Array || array instanceof Uint16Array || array instanceof Int32Array || array instanceof Uint32Array || array instanceof Uint8ClampedArray)) {
    throw new TypeMismatchError('Expected an integer array')
  }

  if (array.byteLength > 65536) {
    throw new QuotaExceededError('Can only request a maximum of 65536 bytes')
  }

  // Expo SDK 48+
  if (global.expo?.modules?.ExpoCrypto?.getRandomValues) {
    // ExpoCrypto.getRandomValues doesn't return the array
    global.expo.modules.ExpoCrypto.getRandomValues(array)
    return array
  }

  // Calling getRandomBase64 in remote debugging mode leads to the error
  // "Calling synchronous methods on native modules is not supported in Chrome".
  // So in that specific case we fall back to just using Math.random().
  if (isRemoteDebuggingInChrome()) {
    return insecureRandomValues(array)
  }

  base64Decode(getRandomBase64(array.byteLength), new Uint8Array(array.buffer, array.byteOffset, array.byteLength))

  return array
}

function isRemoteDebuggingInChrome () {
  // Remote debugging in Chrome is not supported in bridgeless
  if ('RN$Bridgeless' in global && RN$Bridgeless === true) {
    return false
  }

  return __DEV__ && typeof global.nativeCallSyncHook === 'undefined'
}

if (typeof global.crypto !== 'object') {
  global.crypto = {}
}

if (typeof global.crypto.getRandomValues !== 'function') {
  global.crypto.getRandomValues = getRandomValues
}
