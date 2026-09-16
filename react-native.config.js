module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        cmakeListsPath: 'CMakeLists.txt',
      },
      // Was `null`, which disabled the module on iOS entirely. The podspec
      // builds MuPDF from source at pod install time and pulls in Nitrogen's
      // generated sources, so autolinking has something real to find now.
      ios: {
        podspecPath: require('path').join(__dirname, 'NitroFlipper.podspec'),
      },
    },
  },
};
