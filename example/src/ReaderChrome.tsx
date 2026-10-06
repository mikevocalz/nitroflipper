import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MuPDFSource, zoomPercent } from 'nitro-flipper';

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
  // What is drawn, not what was requested: the counter must not tick over
  // while the previous page is still on the canvas.
  const visiblePages = useReaderStore((s) => s.visiblePages);
  const shownIndex = visiblePages[0] ?? pageIndex;
  const requestTurn = useReaderStore((s) => s.requestTurn);
  const visible = useReaderStore((s) => s.chromeVisible);
  const toggleChrome = useReaderStore((s) => s.toggleChrome);
  const step = useReaderStore((s) => s.step);
  const spread = useReaderStore((s) => s.spread);
  const setPanel = useReaderStore((s) => s.setPanel);
  const zoomScale = useReaderStore((s) => s.zoomScale);
  const requestZoom = useReaderStore((s) => s.requestZoom);
  const addBookmark = useReaderStore((s) => s.addBookmark);
  const bookmarks = useReaderStore((s) => s.bookmarks);

  if (source == null) return null;

  const count = source.pageCount;
  // Step and pairing come from the reader itself. Recomputing them here drifts
  // from the flip around wide pages, and the buttons then move by a different
  // amount than a swipe does.
  const label =
    visiblePages.length > 1
      ? STRINGS.reader.spreadOf(shownIndex + 1, shownIndex + 2, count)
      : STRINGS.reader.pageOf(shownIndex + 1, count);

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
      {/* Magnification sits in its own row above the panel affordances: it is
          a reading control like the page pill, not navigation, and it only
          earns its space once there is something to say about it. */}
      <View style={styles.actions}>
        <ChromeButton
          label={STRINGS.zoom.out}
          glyph="−"
          onPress={() => requestZoom('out')}
          disabled={zoomScale <= 1.01}
        />
        <Pressable
          onPress={() => requestZoom('fit')}
          disabled={zoomScale <= 1.01}
          style={styles.zoomReadout}
          accessibilityRole="button"
          accessibilityLabel={STRINGS.zoom.fitTo(zoomPercent(zoomScale))}
          accessibilityHint={STRINGS.zoom.hint}
          hitSlop={SPACE.sm}
        >
          <Text style={[TYPE.caption, { color: '#fff' }]}>
            {zoomPercent(zoomScale)}%
          </Text>
        </Pressable>
        <ChromeButton
          label={STRINGS.zoom.in}
          glyph="+"
          onPress={() => requestZoom('in')}
          disabled={zoomScale >= 4}
        />
      </View>
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
  disabled = false,
}: {
  label: string;
  glyph: string;
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={styles.action}
      accessibilityRole="button"
      accessibilityLabel={label}
      // Dimmed AND announced: a control that only looks unavailable tells a
      // screen-reader user nothing.
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.actionGlyph, disabled && styles.actionDisabled]}>{glyph}</Text>
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
  actionDisabled: {
    opacity: 0.35,
  },
  zoomReadout: {
    minWidth: 52,
    minHeight: HIT_SLOP_MIN,
    alignItems: 'center',
    justifyContent: 'center',
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
