const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Singleton packages that must resolve to the example's copy, never the
// library root's node_modules (duplicate React = "useRef of null" crash).
const singletons = [
  'react',
  'react-native',
  'react-native-nitro-modules',
  '@shopify/react-native-skia',
  'react-native-gesture-handler',
];
const root = path.resolve(__dirname, '..');

const config = {
  watchFolders: [path.resolve(__dirname, '..')],
  resolver: {
    blockList: new RegExp(
      `^${root}/node_modules/(${singletons.join('|')})/.*$`,
    ),
    extraNodeModules: Object.fromEntries(
      singletons.map(n => [n, path.join(__dirname, 'node_modules', n)]),
    ),
    assetExts: [
      ...getDefaultConfig(__dirname).resolver.assetExts,
      'cbz',
      'pdf',
      'epub',
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
