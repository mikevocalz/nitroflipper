import React from 'react';
import {
  AccessibilityInfo,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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
 * Two stops rather than a measured content height.
 *
 * Appearance is four rows and Contents can be two hundred, so one height
 * cannot serve both: the panel opens at the lower stop and the grabber pulls
 * it to the upper one. That also makes the grabber honest -- it now drags, and
 * dragging past the bottom closes, which a fixed-height panel only pretended
 * to offer.
 */
const SNAP_POINTS = ['48%', '88%'];

/**
 * The one container every reader panel uses.
 *
 * A Gorhom modal rather than a platform Modal: the reader underneath is a
 * Skia surface driven by gesture-handler, and a sheet that does not share that
 * gesture system either steals the page-turn pan or gets stolen from. Gorhom
 * arbitrates with the same handlers, so dragging the sheet cannot turn a page.
 *
 * Mounted only while a panel is open -- `ActivePanel` holds one panel at a
 * time, so there is no path to two sheets stacking on one another.
 */
export function Sheet({ title, onClose, children, header }: SheetProps) {
  const themeName = useReaderStore((s) => s.theme);
  const theme = THEMES[themeName];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const sheet = React.useRef<BottomSheetModal>(null);

  // Centred at 768dp, as a horizontal margin on the *hosting container*.
  //
  // Not `width`/`maxWidth`: Gorhom lays the sheet out absolutely and composes
  // the caller's style FIRST -- `[style, styles.container, ...]` in
  // BottomSheetBody -- so its own `left: 0, right: 0` overrides any inset and a
  // width cap just fights the absolute box. The sheet then presents off-screen,
  // reporting index 0 while drawing nothing. Margins are not in either of those
  // style lists, so they survive and narrow the box as intended.
  //
  // Not the `style` prop: that reaches BottomSheetBody, and on Gesture Handler
  // 3.x a margin there clips the sheet to a ~170dp strip in the middle while
  // the accessibility tree still reports the full 768dp -- the layout is right
  // and only the paint is wrong, which is why it reads as a blank white box.
  // `containerStyle` is correct on both 2.x and 3.x.
  //
  // Read from the window each render, so a fold, unfold or rotation re-centres
  // it rather than keeping a gutter measured against the old screen.
  const gutter = Math.max(0, (width - SHEET_MAX_WIDTH) / 2);

  // Present on mount and announce. Without the announcement a screen-reader
  // user gets focus moved with no idea what opened.
  React.useEffect(() => {
    sheet.current?.present();
    AccessibilityInfo.announceForAccessibility(title);
  }, [title]);

  // Every exit goes through dismiss() so the panel animates out. Calling
  // onClose directly would unmount it mid-slide.
  const close = React.useCallback(() => sheet.current?.dismiss(), []);

  // Gorhom does not claim the hardware back button -- unlike the platform
  // Modal this replaced, which got it from onRequestClose. Without this, back
  // on Android closes the whole app while a panel is open.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [close]);

  const backdrop = React.useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        accessibilityLabel={`Close ${title}`}
      />
    ),
    [title],
  );

  return (
    <BottomSheetModal
      ref={sheet}
      snapPoints={SNAP_POINTS}
      index={0}
      enableDynamicSizing={false}
      onDismiss={onClose}
      containerStyle={{ marginHorizontal: gutter }}
      backdropComponent={backdrop}
      // A search field in the header must stay above the keyboard, and the
      // list position it was scrolled to has to survive the resize.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      backgroundStyle={[styles.surface, { backgroundColor: theme.surface }]}
      handleIndicatorStyle={{ backgroundColor: theme.divider }}
      accessibilityLabel={title}
    >
      <View style={styles.titleRow}>
        <Text style={[TYPE.title, { color: theme.text }]} accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          onPress={close}
          style={styles.close}
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          hitSlop={SPACE.md}
        >
          <Text style={[TYPE.title, { color: theme.textMuted }]}>✕</Text>
        </Pressable>
      </View>
      {header}
      <BottomSheetScrollView
        style={styles.body}
        contentContainerStyle={[
          styles.bodyContent,
          // Clear of the home indicator, so the last row in the panel is not
          // sitting under the system gesture bar.
          { paddingBottom: insets.bottom + SPACE.lg },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
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
  surface: {
    borderTopLeftRadius: RADIUS.lg,
    borderTopRightRadius: RADIUS.lg,
    // The reader draws paper lifting off paper, and the panel is the same
    // gesture at a larger scale -- so it gets the curl's restrained contact
    // shadow rather than a stock elevation ramp.
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
    elevation: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.sm,
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
  },
  empty: {
    paddingVertical: SPACE.xxl,
    alignItems: 'center',
  },
});
