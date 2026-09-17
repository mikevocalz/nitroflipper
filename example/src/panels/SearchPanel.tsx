import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
// Gorhom's input, not the platform one: it reports focus to the sheet so the
// panel lifts above the keyboard instead of the field disappearing behind it.
import { BottomSheetTextInput } from '@gorhom/bottom-sheet';

import { MuPDFSource, type SearchResult } from 'nitro-flipper';

import { EmptyState, Sheet } from '../Sheet';
import { useReaderStore } from '../readerStore';
import { STRINGS } from '../strings';
import { HIT_SLOP_MIN, RADIUS, SPACE, THEMES, TYPE } from '../theme';

/**
 * Full-document search.
 *
 * Submit-driven, not search-as-you-type: a scan walks every page in the
 * document on the engine's single worker thread, and firing one per keystroke
 * would queue work faster than it completes and block page renders behind it.
 */
export function SearchPanel() {
  const source = useReaderStore((s) => s.source);
  const setPanel = useReaderStore((s) => s.setPanel);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const theme = THEMES[useReaderStore((s) => s.theme)];

  const [term, setTerm] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [results, setResults] = React.useState<SearchResult[] | null>(null);
  const [searchedFor, setSearchedFor] = React.useState('');

  const close = () => setPanel('none');

  const run = async () => {
    const needle = term.trim();
    if (needle.length === 0 || !(source instanceof MuPDFSource)) return;
    setRunning(true);
    setSearchedFor(needle);
    try {
      setResults(await source.search(needle));
    } catch {
      // A cancelled or failed scan shows as no matches rather than an alert:
      // the reader's next move is the same either way.
      setResults([]);
    } finally {
      setRunning(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <BottomSheetTextInput
        value={term}
        onChangeText={setTerm}
        onSubmitEditing={run}
        placeholder={STRINGS.search.placeholder}
        placeholderTextColor={theme.textMuted}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        accessibilityLabel={STRINGS.search.placeholder}
        style={[
          TYPE.body,
          styles.input,
          {
            backgroundColor: theme.surfaceRaised,
            color: theme.text,
            borderColor: theme.divider,
          },
        ]}
      />
      {results !== null && !running && (
        <Text style={[TYPE.caption, { color: theme.textMuted, marginTop: SPACE.sm }]}>
          {STRINGS.search.resultCount(results.length)}
        </Text>
      )}
    </View>
  );

  return (
    <Sheet title={STRINGS.search.title} onClose={close} header={header}>
      {running ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Text style={[TYPE.caption, { color: theme.textMuted, marginTop: SPACE.sm }]}>
            {STRINGS.search.searching}
          </Text>
        </View>
      ) : results === null ? null : results.length === 0 ? (
        <EmptyState
          text={STRINGS.search.noResults(searchedFor)}
          hint={STRINGS.search.noResultsHint}
        />
      ) : (
        results.map((hit, i) => (
          <Pressable
            key={`${hit.pageNumber}-${i}`}
            onPress={() => {
              setPageIndex(hit.pageNumber);
              close();
            }}
            style={({ pressed }) => [
              styles.row,
              pressed && { backgroundColor: theme.surfaceRaised },
            ]}
            accessibilityRole="button"
            accessibilityLabel={STRINGS.search.resultLabel(hit.pageNumber + 1)}
          >
            <Text style={[TYPE.body, { color: theme.text }]}>
              {STRINGS.search.resultLabel(hit.pageNumber + 1)}
            </Text>
            {/* The engine returns a quad, not surrounding text, so there is no
                snippet to show. Inventing one would mean a second extraction
                pass per hit; the page number is what navigates. */}
            <Text style={[TYPE.caption, { color: theme.textMuted }]}>
              {Math.round(hit.x0)}, {Math.round(hit.y0)}
            </Text>
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.sm },
  input: {
    minHeight: HIT_SLOP_MIN,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACE.md,
  },
  loading: { paddingVertical: SPACE.xxl, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: HIT_SLOP_MIN,
    paddingVertical: SPACE.md,
    gap: SPACE.md,
  },
});
