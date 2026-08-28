module.exports = {
  presets: ['module:@react-native/babel-preset'],
  // Must stay last: it rewrites worklet functions for the UI runtime.
  plugins: ['react-native-worklets/plugin'],
};
