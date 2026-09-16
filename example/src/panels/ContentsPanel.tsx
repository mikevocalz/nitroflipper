import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { MuPDFSource, type OutlineEntry } from 'nitro-flipper';

import { EmptyState, Sheet } from '../Sheet';
import { useReaderStore } from '../readerStore';
import { STRINGS } from '../strings';
import { HIT_SLOP_MIN, SPACE, THEMES, TYPE } from '../theme';

/**
 * Table of contents, straight from the document's own outline.
 *
 * MuPDF flattens the outline with a depth per entry rather than nesting it, so
 * indentation here is presentation of that depth and not a tree the UI has to
 * rebuild.
 */
export function ContentsPanel() {
  const source = useReaderStore((s) => s.source);
  const setPanel = useReaderStore((s) => s.setPanel);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const theme = THEMES[useReaderStore((s) => s.theme)];

  const [entries, setEntries] = React.useState<OutlineEntry[] | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!(source instanceof MuPDFSource)) {
      setEntries([]);
      return;
    }
    source
      .getOutline()
      .then((result) => {
        if (!cancelled) setEntries(result);
      })
      .catch(() => {
        // An absent or unreadable outline is not an error worth a dialog; the
        // empty state says the same thing more usefully.
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const close = () => setPanel('none');

  return (
    <Sheet title={STRINGS.toc.title} onClose={close}>
      {entries === null ? (
        <ActivityIndicator style={styles.loading} />
      ) : entries.length === 0 ? (
        <EmptyState text={STRINGS.toc.empty} />
      ) : (
        entries.map((entry, i) => {
          // -1 means the entry does not resolve in the current layout. Showing
          // it greyed is more honest than hiding it: the chapter exists in the
          // document, we just cannot jump there.
          const resolvable = entry.pageNumber >= 0;
          return (
            <Pressable
              key={`${entry.title}-${i}`}
              disabled={!resolvable}
              onPress={() => {
                setPageIndex(entry.pageNumber);
                close();
              }}
              style={({ pressed }) => [
                styles.row,
                { paddingLeft: SPACE.lg * Math.min(entry.depth, 3) },
                pressed && { backgroundColor: theme.surfaceRaised },
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !resolvable }}
              accessibilityLabel={
                resolvable
                  ? STRINGS.toc.entryLabel(entry.title, entry.pageNumber + 1)
                  : `${entry.title}, ${STRINGS.toc.unresolved}`
              }
            >
              <Text
                style={[
                  TYPE.body,
                  {
                    color: resolvable ? theme.text : theme.textMuted,
                    // Top-level entries carry the structure; deeper ones are
                    // navigation detail and should not compete with them.
                    fontWeight: entry.depth === 0 ? '600' : '400',
                  },
                  styles.title,
                ]}
                numberOfLines={2}
              >
                {entry.title}
              </Text>
              <Text style={[TYPE.caption, { color: theme.textMuted }]}>
                {resolvable ? entry.pageNumber + 1 : STRINGS.toc.unresolved}
              </Text>
            </Pressable>
          );
        })
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  loading: { marginVertical: SPACE.xxl },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: HIT_SLOP_MIN,
    paddingVertical: SPACE.md,
    gap: SPACE.md,
  },
  title: { flex: 1 },
});
