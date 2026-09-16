import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { MuPDFSource } from 'nitro-flipper';

import { Sheet } from '../Sheet';
import { useReaderStore } from '../readerStore';
import { STRINGS } from '../strings';
import {
  FONT_SIZES,
  HIT_SLOP_MIN,
  RADIUS,
  SPACE,
  THEMES,
  TYPE,
  type ThemeName,
} from '../theme';

/**
 * Text size and paper.
 *
 * This is the panel that exercises the relayout path end to end: a size change
 * calls setStyle + layout on the engine, which bumps the layout generation,
 * which invalidates every cached page texture. The reading position is carried
 * across on a chapter-anchored locator, because a page index means something
 * different after repagination.
 */
export function AppearancePanel() {
  const source = useReaderStore((s) => s.source);
  const setPanel = useReaderStore((s) => s.setPanel);
  const themeName = useReaderStore((s) => s.theme);
  const setTheme = useReaderStore((s) => s.setTheme);
  const fontSizePt = useReaderStore((s) => s.fontSizePt);
  const setFontSizePt = useReaderStore((s) => s.setFontSizePt);
  const relayouting = useReaderStore((s) => s.relayouting);
  const setRelayouting = useReaderStore((s) => s.setRelayouting);
  const pageIndex = useReaderStore((s) => s.pageIndex);
  const setPageIndex = useReaderStore((s) => s.setPageIndex);
  const size = useReaderStore((s) => s.size);
  const spread = useReaderStore((s) => s.spread);
  const theme = THEMES[themeName];

  const isMuPDF = source instanceof MuPDFSource;
  const reflowable = isMuPDF && source.layoutOf() === 'reflowable';

  const applySize = async (pt: number) => {
    if (!(source instanceof MuPDFSource) || !reflowable || relayouting) return;
    setFontSizePt(pt);
    setRelayouting(true);
    try {
      // Anchor first. After repagination this page index addresses different
      // content, so the only way back to where the reader was is a locator
      // that survives the relayout.
      const anchor = await source.persistentLocator(pageIndex);

      // ONE column, not the whole spread. Passing the spread width makes every
      // line run across both pages.
      const column = spread ? size.width / 2 : size.width;
      await source.setStyle({
        usePublisherStyles: true,
        userCss: THEMES[themeName].pageCss,
      });
      await source.relayout({
        width: column,
        height: size.height,
        fontSizePt: pt,
      });

      const restored = await source.pageForPersistentLocator(anchor);
      if (restored !== null) setPageIndex(restored);
    } finally {
      setRelayouting(false);
    }
  };

  const applyTheme = async (next: ThemeName) => {
    setTheme(next);
    if (!(source instanceof MuPDFSource) || !reflowable) return;
    // Paper colour is document CSS, so it needs the same relayout round trip.
    await applySize(fontSizePt);
  };

  return (
    <Sheet title={STRINGS.appearance.title} onClose={() => setPanel('none')}>
      <Text style={[TYPE.label, { color: theme.text, marginTop: SPACE.sm }]}>
        {STRINGS.appearance.textSize}
      </Text>
      <Text style={[TYPE.caption, { color: theme.textMuted, marginTop: SPACE.xs }]}>
        {reflowable
          ? STRINGS.appearance.textSizeHint
          : STRINGS.appearance.textSizeFixed}
      </Text>

      <View style={styles.sizes}>
        {FONT_SIZES.map((pt) => {
          const active = pt === fontSizePt;
          return (
            <Pressable
              key={pt}
              disabled={!reflowable || relayouting}
              onPress={() => applySize(pt)}
              style={[
                styles.size,
                {
                  backgroundColor: active ? theme.accent : theme.surfaceRaised,
                  borderColor: theme.divider,
                  opacity: reflowable ? 1 : 0.4,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !reflowable }}
              accessibilityLabel={STRINGS.appearance.currentSize(pt)}
            >
              <Text
                style={[
                  TYPE.label,
                  { color: active ? theme.onAccent : theme.text },
                ]}
              >
                {pt}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {relayouting && (
        <View style={styles.relayout}>
          <ActivityIndicator />
          {/* Repagination is slow enough to need saying so; a frozen panel
              reads as a crash. */}
          <Text style={[TYPE.caption, { color: theme.textMuted, marginLeft: SPACE.sm }]}>
            {STRINGS.loading.page}
          </Text>
        </View>
      )}

      <Text style={[TYPE.label, { color: theme.text, marginTop: SPACE.xl }]}>
        {STRINGS.appearance.theme}
      </Text>
      <View style={styles.themes}>
        {(['light', 'sepia', 'dark'] as const).map((name) => {
          const active = name === themeName;
          const swatch = THEMES[name];
          return (
            <Pressable
              key={name}
              onPress={() => applyTheme(name)}
              style={[
                styles.theme,
                {
                  backgroundColor: swatch.surface,
                  borderColor: active ? theme.accent : theme.divider,
                  borderWidth: active ? 2 : StyleSheet.hairlineWidth,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={STRINGS.appearance.themes[name]}
            >
              <Text style={[TYPE.label, { color: swatch.text }]}>
                {STRINGS.appearance.themes[name]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sizes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  size: {
    minWidth: HIT_SLOP_MIN,
    minHeight: HIT_SLOP_MIN,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  relayout: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SPACE.md,
  },
  themes: {
    flexDirection: 'row',
    gap: SPACE.sm,
    marginTop: SPACE.md,
  },
  theme: {
    flex: 1,
    minHeight: HIT_SLOP_MIN + SPACE.md,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
