import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import RNBlobUtil from 'react-native-blob-util';

import {
  createComicArchiveSource,
  MuPDFSource,
  PageCurlView,
  type PageSource,
} from 'nitro-flipper';

import ltrAsset from './src/assets/MMPR1.cbz';
import pdfAsset from './src/assets/comic.pdf';
// Named apart from comic.pdf on purpose: Android flattens a bundled asset to
// its basename as a raw resource, so comic.pdf and comic.epub both become
// `raw/src_assets_comic` and the release build fails on duplicate resources.
import epubAsset from './src/assets/book.epub';
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

/**
 * The app's package, read off its own sandbox path (/data/user/0/<pkg>/cache).
 * Only needed to address bundled raw resources in a release build.
 */
const packageName =
  RNBlobUtil.fs.dirs.CacheDir.split('/').filter(Boolean)[3] ?? '';

/**
 * Where the iOS bundle keeps the fixtures: the asset pipeline mirrors each
 * file's path from the project root under `assets/`, so `src/assets/MMPR1.cbz`
 * ships as `assets/src/assets/MMPR1.cbz`. Move the imports and this moves too.
 */
const IOS_ASSET_DIR = 'assets/src/assets';

/** Cache name -> the file Gradle packaged into the APK's assets. */
const FIXTURES_BY_NAME: Record<string, string> = {
  'sample.cbz': 'MMPR1.cbz',
  'sample.pdf': 'comic.pdf',
  'sample.epub': 'book.epub',
};

const FIXTURES = {
  cbz: { asset: ltrAsset, name: 'sample.cbz' },
  pdf: { asset: pdfAsset, name: 'sample.pdf' },
  epub: { asset: epubAsset, name: 'sample.epub' },
} as const;

/**
 * Copy a bundled asset to a real path, since the engines open files.
 *
 * The asset's URI is only an http URL while Metro is serving it. In a release
 * build Android has flattened it into a raw resource and `resolveAssetSource`
 * returns a bare resource name with no scheme, which the fetch turns into
 * "url == nullnull" -- the release app opened to a red error string and no
 * book. A name with no scheme is a resource, so address it as one.
 */
async function materialise(asset: number, name: string): Promise<string> {
  const resolved = Image.resolveAssetSource(asset);
  // Metro serves the asset over http while the dev server is running; that URL
  // is the fastest path and keeps Fast Refresh working on a changed fixture.
  // Everything else -- every release build -- reads the copy Gradle packaged
  // into the APK's assets, addressed with the one scheme ReactNativeBlobUtil
  // actually understands for bundled files.
  const served = /^https?:/i.test(resolved?.uri ?? '') ? resolved.uri : null;
  const uri = served ?? Platform.select({
    android: `bundle-assets://${FIXTURES_BY_NAME[name] ?? name}`,
    // iOS keeps the file at its source path under assets/, where Gradle
    // flattens to a basename. Checked against the built app: the fixtures sit
    // at assets/src/assets/MMPR1.cbz and its two siblings. `bundle-assets://`
    // cannot reach them either, because on iOS that goes through
    // pathForResource:ofType:, which only searches the top of the bundle.
    // MainBundleDir is the .app itself, so name the path they are actually at.
    default: `${RNBlobUtil.fs.dirs.MainBundleDir}/${IOS_ASSET_DIR}/${
      FIXTURES_BY_NAME[name] ?? name}`,
  });
  const cachePath = `${RNBlobUtil.fs.dirs.CacheDir}/${name}`;
  if (await RNBlobUtil.fs.exists(cachePath)) return cachePath;
  if (served === null) {
    // Already a file inside the package -- copy it straight out. Routing a
    // bundled asset through the HTTP client would only re-encode it.
    await RNBlobUtil.fs.cp(uri, cachePath);
    return cachePath;
  }
  const res = await RNBlobUtil.config({ fileCache: true }).fetch('GET', uri);
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

/**
 * Non-fatal message over a working reader. Clears itself, because a page that
 * failed once is usually fine on the next pass and a stuck banner is worse
 * than the miss it reports.
 */
function Notice() {
  const notice = useReaderStore((s) => s.notice);
  const setNotice = useReaderStore((s) => s.setNotice);
  useEffect(() => {
    if (notice === null) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice, setNotice]);
  if (notice === null) return null;
  return (
    <View style={styles.notice} pointerEvents="none">
      <Text style={styles.noticeText} numberOfLines={2}>
        {notice}
      </Text>
    </View>
  );
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
  const zoomRequest = useReaderStore((s) => s.zoomRequest);
  const setZoomScale = useReaderStore((s) => s.setZoomScale);
  const reduceMotion = useReaderStore((s) => s.reduceMotion);

  return (
    // The provider has to sit above everything, including the panels: they
    // render in a Modal and still read their bottom inset from this context.
    <SafeAreaProvider>
      <GestureHandlerRootView style={styles.root}>
        {/* Above the reader and below nothing else: panels present into this
            scope, so it must outlive any one panel. */}
        <BottomSheetModalProvider>
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
                zoomRequest={zoomRequest}
                zoom={{ max: 4, doubleTap: 2, reducedMotion: reduceMotion }}
                onZoomChange={(z) => setZoomScale(z.scale)}
                onSpreadVisible={useReaderStore.getState().setVisiblePages}
                // A page that will not render is NOT a fatal document error.
                // Routing it into `error` unmounted the reader and replaced the
                // whole book with a red string the reader could not get out of.
                // It is a transient notice over a still-usable reader.
                onPageLoadError={(e) =>
                  useReaderStore.getState().setNotice(String(e))
                }
              />
            )}
            {source && <ReaderChrome />}
            {source && <ActivePanel />}
            {source && <Notice />}
          </View>
        </BottomSheetModalProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
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
  notice: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 96,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.78)',
  },
  noticeText: {
    color: '#fff',
    fontSize: 13,
    textAlign: 'center',
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
    marginHorizontal: 24,
  },
});
