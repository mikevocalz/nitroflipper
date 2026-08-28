import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useReaderStore } from './readerStore';

/**
 * Reader chrome: a single pill that both reports where you are and turns the
 * page. Readers that get out of the way (Headway, Deel) fuse those two jobs
 * into one control rather than spending a whole bar on each.
 */
export function ReaderChrome() {
  const source = useReaderStore((s) => s.source);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const requestTurn = useReaderStore((s) => s.requestTurn);
  const visible = useReaderStore((s) => s.chromeVisible);
  const toggleChrome = useReaderStore((s) => s.toggleChrome);
  const step = useReaderStore((s) => s.step);
  const spread = useReaderStore((s) => s.spread);

  if (source == null) return null;

  const count = source.pageCount;
  // Step and pairing come from the reader itself. Recomputing them here drifts
  // from the flip around wide pages, and the buttons then move by a different
  // amount than a swipe does.
  const label =
    spread && pageIndex + 1 < count
      ? `${pageIndex + 1}–${pageIndex + 2} of ${count}`
      : `${pageIndex + 1} of ${count}`;

  const canBack = pageIndex - step >= 0;
  const canNext = pageIndex + step < count;

  // Ask the reader to turn rather than jumping the index, so the button
  // animates the same curl a swipe does.
  const go = (dir: number) => requestTurn(dir);

  if (!visible) {
    return (
      <Pressable
        style={styles.hitArea}
        onPress={toggleChrome}
        accessibilityRole="button"
        accessibilityLabel="Show reader controls"
      />
    );
  }

  return (
    <View style={styles.bar} pointerEvents="box-none">
      <View style={styles.pill}>
        <Pressable
          onPress={() => go(-1)}
          disabled={!canBack}
          style={styles.tap}
          accessibilityRole="button"
          accessibilityLabel="Previous page"
        >
          <Text style={[styles.arrow, !canBack && styles.arrowOff]}>‹</Text>
        </Pressable>

        <Pressable onPress={toggleChrome} hitSlop={8}>
          <Text style={styles.label}>{label}</Text>
        </Pressable>

        <Pressable
          onPress={() => go(1)}
          disabled={!canNext}
          style={styles.tap}
          accessibilityRole="button"
          accessibilityLabel="Next page"
        >
          <Text style={[styles.arrow, !canNext && styles.arrowOff]}>›</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sits over the reader without stealing the page-turn drag.
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.82)',
  },
  label: {
    color: '#fff',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
  },
  // 44dp is the smallest target Apple's HIG and WCAG 2.5.5 accept. The glyph
  // is a fraction of that, so the target is the container, not the text.
  tap: {
    minWidth: 44,
    minHeight: 44,
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
