import React from 'react';
import {
  AccessibilityInfo,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { useReaderStore } from './readerStore';
import { HIT_SLOP_MIN, RADIUS, SHEET_MAX_WIDTH, SPACE, THEMES, TYPE } from './theme';

interface SheetProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  /** Content that should not scroll with the body (a search field). */
  readonly header?: React.ReactNode;
}

/**
 * The one container every reader panel uses.
 *
 * A real Modal rather than an absolutely positioned View, so the platform
 * handles the focus trap and the Android back button. Rolling that by hand is
 * how a panel ends up reachable by a screen reader while the page behind it is
 * still focusable.
 */
export function Sheet({ title, onClose, children, header }: SheetProps) {
  const themeName = useReaderStore((s) => s.theme);
  const theme = THEMES[themeName];

  // Announce the panel on open. Without this a screen-reader user gets focus
  // moved with no idea what opened.
  React.useEffect(() => {
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
      accessibilityViewIsModal
    >
      {/* Modal's own content container has no height of its own, so an
          absoluteFill child resolves against zero and collapses. This flex
          root is what gives the scrim and the sheet something to fill. */}
      <View style={styles.root}>
        {/* Tapping the scrim closes, which is the gesture people try first. */}
        <Pressable
          style={[styles.scrim, { backgroundColor: theme.scrim }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
        />
        <View style={[styles.sheet, { backgroundColor: theme.surface }]}>
          <View style={[styles.grabber, { backgroundColor: theme.divider }]} />
        <View style={styles.titleRow}>
          <Text
            style={[TYPE.title, { color: theme.text }]}
            accessibilityRole="header"
          >
            {title}
          </Text>
          <Pressable
            onPress={onClose}
            style={styles.close}
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            hitSlop={SPACE.md}
          >
            <Text style={[TYPE.title, { color: theme.textMuted }]}>✕</Text>
          </Pressable>
        </View>
        {header}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Shared empty state. An empty list with no words reads as a broken list. */
export function EmptyState({ text, hint }: { text: string; hint?: string }) {
  const theme = THEMES[useReaderStore((s) => s.theme)];
  return (
    <View style={styles.empty}>
      <Text style={[TYPE.body, { color: theme.text }]}>{text}</Text>
      {hint !== undefined && (
        <Text
          style={[TYPE.caption, { color: theme.textMuted, marginTop: SPACE.sm }]}
        >
          {hint}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  root: {
    flex: 1,
    // Row container, so the axes read: justifyContent places the sheet
    // horizontally, alignItems sizes it vertically. Putting the horizontal
    // intent on alignItems instead shrinks the sheet to its content height,
    // which collapses it to a strip across the top.
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  sheet: {
    // Full height, from alignItems: 'stretch' above. No flex and no absolute
    // positioning: flex would grow along the row and defeat the width cap,
    // and an absolute box inside the modal has nothing to resolve against.
    //
    // Centred at 768dp. On this dual-screen the hinge runs down the middle at
    // 540dp, so a centred sheet does straddle the fold -- a deliberate choice
    // to keep one layout everywhere rather than a dual-screen special case.
    width: '100%',
    maxWidth: SHEET_MAX_WIDTH,
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    paddingBottom: SPACE.xl,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: RADIUS.pill,
    alignSelf: 'center',
    marginTop: SPACE.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.md,
    paddingBottom: SPACE.sm,
  },
  close: {
    minWidth: HIT_SLOP_MIN,
    minHeight: HIT_SLOP_MIN,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    paddingHorizontal: SPACE.lg,
    paddingBottom: SPACE.lg,
  },
  empty: {
    paddingVertical: SPACE.xxl,
    alignItems: 'center',
  },
});
