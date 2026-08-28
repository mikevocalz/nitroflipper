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
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const visible = useReaderStore((s) => s.chromeVisible);
  const toggleChrome = useReaderStore((s) => s.toggleChrome);

  if (source == null) return null;

  const count = source.pageCount;
  // The reader pairs pages, so the pill reports the spread, not one page.
  const showsSpread = pageIndex + 1 < count;
  const label = showsSpread
    ? `${pageIndex + 1}–${pageIndex + 2} of ${count}`
    : `${pageIndex + 1} of ${count}`;

  const step = showsSpread ? 2 : 1;
  const canBack = pageIndex - step >= 0;
  const canNext = pageIndex + step < count;

  const go = (delta: number) => {
    const next = pageIndex + delta;
    if (next >= 0 && next < count) setPageIndex(next);
  };

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
          onPress={() => go(-step)}
          disabled={!canBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Previous page"
        >
          <Text style={[styles.arrow, !canBack && styles.arrowOff]}>‹</Text>
        </Pressable>

        <Pressable onPress={toggleChrome} hitSlop={8}>
          <Text style={styles.label}>{label}</Text>
        </Pressable>

        <Pressable
          onPress={() => go(step)}
          disabled={!canNext}
          hitSlop={12}
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
    gap: 20,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.82)',
  },
  label: {
    color: '#fff',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
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
