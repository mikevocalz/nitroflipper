import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import RNBlobUtil from 'react-native-blob-util';

import {
  createComicArchiveSource,
  PageCurlView,
  type ComicArchiveSource,
} from 'nitro-flipper';

import ltrAsset from './src/assets/ltr.cbz';

function useLocalArchive() {
  const [source, setSource] = useState<ComicArchiveSource | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const asset = Image.resolveAssetSource(ltrAsset);
        const cachePath = `${RNBlobUtil.fs.dirs.CacheDir}/sample.cbz`;
        const res = await RNBlobUtil.config({ fileCache: true }).fetch(
          'GET',
          asset.uri,
        );
        const downloaded = res.path();
        if (!downloaded) {
          throw new Error('Failed to download CBZ asset');
        }
        await RNBlobUtil.fs.cp(downloaded, cachePath);
        await RNBlobUtil.fs.unlink(downloaded);

        const src = createComicArchiveSource();
        await src.open(cachePath);

        if (!mounted) return;
        setSource(src);
      } catch (e) {
        if (!mounted) return;
        setError(String(e));
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return { source, error };
}

export default function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  // Measure the container instead of the window: the reader fills whatever
  // box it is given, with no assumption about system bar insets.
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { source, error } = useLocalArchive();
  const [pageIndex, setPageIndex] = useState(0);

  return (
    <GestureHandlerRootView style={styles.root}>
      <View
        style={styles.container}
        onLayout={(e) => setSize(e.nativeEvent.layout)}
      >
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        {error ? (
          <View style={styles.centered}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : !source ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" />
            <Text style={styles.label}>Loading comic…</Text>
          </View>
        ) : (
          <PageCurlView
            source={source}
            pageIndex={pageIndex}
            onPageIndexChange={setPageIndex}
            width={size.width}
            height={size.height}
            // No gutter: the pages meet at the spine, which lands on the
            // Surface Duo fold — the seam becomes the book's gutter.
            gutter={0}
          />
        )}
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#222',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: 12,
    color: '#fff',
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
    marginHorizontal: 24,
  },
});
