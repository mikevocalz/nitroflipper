import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MuPDFSource } from 'nitro-flipper';

import { useReaderStore } from './readerStore';
import { STRINGS } from './strings';
import { HIT_SLOP_MIN, RADIUS, SPACE, TYPE } from './theme';

/**
 * Reader chrome: a pill that reports where you are and turns the page, plus a
 * row of panel affordances.
 *
 * Two levels on purpose. The pill is the reading control and stays minimal;
 * contents, search, bookmarks and appearance are navigation, and putting them
 * in the same pill would make the common action harder to hit.
 */
export function ReaderChrome() {
  const source = useReaderStore((s) => s.source);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const requestTurn = useReaderStore((s) => s.requestTurn);
  const visible = useReaderStore((s) => s.chromeVisible);
  const toggleChrome = useReaderStore((s) => s.toggleChrome);
  const step = useReaderStore((s) => s.step);
  const spread = useReaderStore((s) => s.spread);
  const setPanel = useReaderStore((s) => s.setPanel);
  const addBookmark = useReaderStore((s) => s.addBookmark);
  const bookmarks = useReaderStore((s) => s.bookmarks);

  if (source == null) return null;

  const count = source.pageCount;
  // Step and pairing come from the reader itself. Recomputing them here drifts
  // from the flip around wide pages, and the buttons then move by a different
  // amount than a swipe does.
  const label =
    spread && pageIndex + 1 < count
      ? STRINGS.reader.spreadOf(pageIndex + 1, pageIndex + 2, count)
      : STRINGS.reader.pageOf(pageIndex + 1, count);

  const canBack = pageIndex - step >= 0;
  const canNext = pageIndex + step < count;
  const isMuPDF = source instanceof MuPDFSource;

  // Ask the reader to turn rather than jumping the index, so the button
  // animates the same curl a swipe does.
  const go = (dir: number) => requestTurn(dir);

  const bookmarkHere = async () => {
    if (!(source instanceof MuPDFSource)) return;
    const locator = await source.persistentLocator(pageIndex);
    addBookmark({ locator, page: pageIndex, savedAt: Date.now() });
  };

  const alreadyBookmarked = bookmarks.some((b) => b.page === pageIndex);

  if (!visible) {
    return (
      <Pressable
        style={styles.hitArea}
        onPress={toggleChrome}
        accessibilityRole="button"
        accessibilityLabel={STRINGS.reader.showControls}
      />
    );
  }

  return (
    <View style={styles.bar} pointerEvents="box-none">
      {/* Panel row sits above the pill so the page-turn control keeps the
          easiest position for the thumb. */}
      <View style={styles.actions}>
        {/* Contents, search and bookmarks need a document model. A CBZ is a
            list of images with no outline, no text and no locator, so offering
            them against an archive would be three dead buttons. Appearance is
            app-level -- paper colour applies to any source. */}
        {isMuPDF && (
          <>
            <ChromeButton
              label={STRINGS.toc.title}
              glyph="☰"
              onPress={() => setPanel('toc')}
            />
            <ChromeButton
              label={STRINGS.search.title}
              glyph="⌕"
              onPress={() => setPanel('search')}
            />
            <ChromeButton
              label={
                alreadyBookmarked
                  ? STRINGS.bookmarks.title
                  : STRINGS.bookmarks.add
              }
              glyph={alreadyBookmarked ? '★' : '☆'}
              onPress={
                alreadyBookmarked ? () => setPanel('bookmarks') : bookmarkHere
              }
              onLongPress={() => setPanel('bookmarks')}
            />
          </>
        )}
        <ChromeButton
          label={STRINGS.appearance.title}
          glyph="Aa"
          onPress={() => setPanel('appearance')}
        />
      </View>

      <View style={styles.pill}>
        <Pressable
          onPress={() => go(-1)}
          disabled={!canBack}
          style={styles.tap}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.reader.previous}
          accessibilityHint={STRINGS.reader.previousHint}
          accessibilityState={{ disabled: !canBack }}
        >
          <Text style={[styles.arrow, !canBack && styles.arrowOff]}>‹</Text>
        </Pressable>

        <Pressable
          onPress={toggleChrome}
          hitSlop={SPACE.sm}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={STRINGS.reader.hideControls}
        >
          <Text style={styles.label}>{label}</Text>
        </Pressable>

        <Pressable
          onPress={() => go(1)}
          disabled={!canNext}
          style={styles.tap}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.reader.next}
          accessibilityHint={STRINGS.reader.nextHint}
          accessibilityState={{ disabled: !canNext }}
        >
          <Text style={[styles.arrow, !canNext && styles.arrowOff]}>›</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChromeButton({
  label,
  glyph,
  onPress,
  onLongPress,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.actionGlyph}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Sits over the reader without stealing the page-turn drag.
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: SPACE.xl,
    alignItems: 'center',
    gap: SPACE.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.xs,
    paddingVertical: SPACE.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(20,20,20,0.82)',
  },
  action: {
    minWidth: HIT_SLOP_MIN,
    minHeight: HIT_SLOP_MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionGlyph: {
    color: '#fff',
    fontSize: 18,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACE.xs,
    paddingHorizontal: SPACE.sm,
    paddingVertical: 2,
    borderRadius: RADIUS.pill,
    backgroundColor: 'rgba(20,20,20,0.82)',
  },
  label: {
    color: '#fff',
    ...TYPE.body,
    fontVariant: ['tabular-nums'],
  },
  // The glyph is a fraction of the target, so the target is the container.
  // 48 is the floor: it satisfies Android's 48dp as well as WCAG 2.5.5.
  tap: {
    minWidth: HIT_SLOP_MIN,
    minHeight: HIT_SLOP_MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: {
    color: '#fff',
    fontSize: 26,
    lineHeight: 28,
  },
  arrowOff: {
    color: 'rgba(255,255,255,0.28)',
  },
  hitArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 64,
  },
});
