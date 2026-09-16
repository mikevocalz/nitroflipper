import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MuPDFSource } from 'nitro-flipper';

import { EmptyState, Sheet } from '../Sheet';
import { useReaderStore } from '../readerStore';
import { STRINGS } from '../strings';
import { HIT_SLOP_MIN, SPACE, THEMES, TYPE } from '../theme';

/**
 * Bookmarks, stored as engine locators rather than page numbers.
 *
 * A page index stops meaning anything the moment the book repaginates, so each
 * bookmark is re-resolved through the engine when tapped. One that no longer
 * resolves says so instead of silently jumping somewhere plausible.
 */
export function BookmarksPanel() {
  const source = useReaderStore((s) => s.source);
  const setPanel = useReaderStore((s) => s.setPanel);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const bookmarks = useReaderStore((s) => s.bookmarks);
  const removeBookmark = useReaderStore((s) => s.removeBookmark);
  const theme = THEMES[useReaderStore((s) => s.theme)];

  const [stale, setStale] = React.useState<Set<string>>(new Set());

  const open = async (locator: string) => {
    if (!(source instanceof MuPDFSource)) return;
    const page = await source.pageForPersistentLocator(locator);
    if (page === null) {
      setStale((prev) => new Set(prev).add(locator));
      return;
    }
    setPageIndex(page);
    setPanel('none');
  };

  return (
    <Sheet title={STRINGS.bookmarks.title} onClose={() => setPanel('none')}>
      {bookmarks.length === 0 ? (
        <EmptyState
          text={STRINGS.bookmarks.empty}
          hint={STRINGS.bookmarks.emptyHint}
        />
      ) : (
        bookmarks.map((bookmark) => {
          const isStale = stale.has(bookmark.locator);
          return (
            <View key={bookmark.locator} style={styles.row}>
              <Pressable
                style={styles.main}
                onPress={() => open(bookmark.locator)}
                accessibilityRole="button"
                accessibilityLabel={STRINGS.bookmarks.itemLabel(bookmark.page + 1)}
              >
                <Text style={[TYPE.body, { color: theme.text }]}>
                  {STRINGS.bookmarks.itemLabel(bookmark.page + 1)}
                </Text>
                {isStale && (
                  <Text
                    style={[TYPE.caption, { color: theme.textMuted, marginTop: SPACE.xs }]}
                  >
                    {STRINGS.bookmarks.stale}
                  </Text>
                )}
              </Pressable>
              <Pressable
                onPress={() => removeBookmark(bookmark.locator)}
                style={styles.remove}
                accessibilityRole="button"
                accessibilityLabel={STRINGS.bookmarks.remove}
                hitSlop={SPACE.sm}
              >
                <Text style={[TYPE.body, { color: theme.textMuted }]}>✕</Text>
              </Pressable>
            </View>
          );
        })
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HIT_SLOP_MIN,
    paddingVertical: SPACE.sm,
  },
  main: { flex: 1, justifyContent: 'center', minHeight: HIT_SLOP_MIN },
  remove: {
    minWidth: HIT_SLOP_MIN,
    minHeight: HIT_SLOP_MIN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
