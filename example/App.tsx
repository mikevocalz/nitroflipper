import React, { useEffect } from 'react';
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
  MuPDFSource,
  PageCurlView,
  type PageSource,
} from 'nitro-flipper';

import ltrAsset from './src/assets/MMPR1.cbz';
import pdfAsset from './src/assets/comic.pdf';
import epubAsset from './src/assets/comic.epub';
import { useReaderStore } from './src/readerStore';
import { ReaderChrome } from './src/ReaderChrome';
import { ContentsPanel } from './src/panels/ContentsPanel';
import { SearchPanel } from './src/panels/SearchPanel';
import { BookmarksPanel } from './src/panels/BookmarksPanel';
import { AppearancePanel } from './src/panels/AppearancePanel';

/**
 * Which fixture the reader opens.
 *
 * A switch rather than a picker: this example exists to prove the engine
 * works on a device, and a picker would be UI to debug before the thing it
 * is meant to be testing.
 */
const FORMAT: 'cbz' | 'pdf' | 'epub' = 'cbz';

const FIXTURES = {
  cbz: { asset: ltrAsset, name: 'sample.cbz' },
  pdf: { asset: pdfAsset, name: 'sample.pdf' },
  epub: { asset: epubAsset, name: 'sample.epub' },
} as const;

/** Copy a bundled asset to a real path, since the engines open files. */
async function materialise(asset: number, name: string): Promise<string> {
  const resolved = Image.resolveAssetSource(asset);
  const cachePath = `${RNBlobUtil.fs.dirs.CacheDir}/${name}`;
  const res = await RNBlobUtil.config({ fileCache: true }).fetch(
    'GET',
    resolved.uri,
  );
  const downloaded = res.path();
  if (!downloaded) {
    throw new Error(`Failed to download ${name}`);
  }
  await RNBlobUtil.fs.cp(downloaded, cachePath);
  await RNBlobUtil.fs.unlink(downloaded);
  return cachePath;
}

function useLocalArchive() {
  const source = useReaderStore((s) => s.source);
  const error = useReaderStore((s) => s.error);
  const setSource = useReaderStore((s) => s.setSource);
  const setError = useReaderStore((s) => s.setError);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const fixture = FIXTURES[FORMAT];
        const path = await materialise(fixture.asset, fixture.name);

        let src: PageSource;
        if (FORMAT === 'cbz') {
          const archive = createComicArchiveSource();
          await archive.open(path);
          src = archive;
        } else {
          // A single leaf's width, not the whole spread: passing the spread
          // width makes every line run across both pages.
          src = await MuPDFSource.open(path, {
            layout: { width: 360, height: 640, fontSizePt: 12 },
          });
        }

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

/** Only one panel is ever over the reader, so a switch is the whole router. */
function ActivePanel() {
  const panel = useReaderStore((s) => s.panel);
  switch (panel) {
    case 'toc':
      return <ContentsPanel />;
    case 'search':
      return <SearchPanel />;
    case 'bookmarks':
      return <BookmarksPanel />;
    case 'appearance':
      return <AppearancePanel />;
    default:
      return null;
  }
}

export default function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  // Measure the container instead of the window: the reader fills whatever
  // box it is given, with no assumption about system bar insets.
  const size = useReaderStore((s) => s.size);
  const setSize = useReaderStore((s) => s.setSize);
  const { source, error } = useLocalArchive();
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const turnRequest = useReaderStore((s) => s.turnRequest);

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
            <Text style={styles.label}>Loading {FORMAT.toUpperCase()}…</Text>
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
            onLayoutChange={useReaderStore.getState().setLayout}
            turnRequest={turnRequest}
            onPageLoadError={(e) =>
              useReaderStore.getState().setError(`page load failed: ${String(e)}`)
            }
          />
        )}
        {source && <ReaderChrome />}
        {source && <ActivePanel />}
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
