import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';

import type { Tone } from '../lib/glassesStatus';
import { radius, space, toneColor, usePalette } from '../theme';

export function ScreenTitle({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={styles.titleRow}>
      <View style={styles.titleText}>
        <Text accessibilityRole="header" style={[styles.title, { color: palette.foreground }]}>
          {title}
        </Text>
        {subtitle ? <Text style={[styles.subtitle, { color: palette.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  );
}

export function Card({ title, children, style }: { title?: string; children: ReactNode; style?: ViewStyle }) {
  const palette = usePalette();
  return (
    <View style={[styles.card, { backgroundColor: palette.card, borderColor: palette.border }, style]}>
      {title ? (
        <Text accessibilityRole="header" style={[styles.cardTitle, { color: palette.foreground }]}>
          {title}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  busy = false,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  busy?: boolean;
  accessibilityHint?: string;
}) {
  const palette = usePalette();
  const background =
    variant === 'primary' ? palette.primary : variant === 'danger' ? palette.destructive : palette.muted;
  const foreground =
    variant === 'primary'
      ? palette.primaryForeground
      : variant === 'danger'
        ? palette.destructiveForeground
        : palette.foreground;
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: background, opacity: inactive ? 0.45 : pressed ? 0.8 : 1 },
      ]}>
      {busy ? <ActivityIndicator size="small" color={foreground} /> : null}
      <Text style={[styles.buttonLabel, { color: foreground }]}>{label}</Text>
    </Pressable>
  );
}

export function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>;
}

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  const palette = usePalette();
  const color = toneColor(palette, tone);
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <View style={[styles.pillDot, { backgroundColor: color }]} />
      <Text style={[styles.pillLabel, { color }]}>{label}</Text>
    </View>
  );
}

export function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  const palette = usePalette();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={[styles.infoRow, !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.infoLabel, { color: palette.mutedForeground }]}>{label}</Text>
      <Text selectable style={[styles.infoValue, { color: palette.foreground }]}>
        {value}
      </Text>
    </View>
  );
}

export function Banner({
  tone,
  message,
  onDismiss,
  actionLabel,
  onAction,
}: {
  tone: Tone;
  message: string;
  onDismiss?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette = usePalette();
  const color = toneColor(palette, tone);
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.banner, { borderColor: color, backgroundColor: palette.card }]}>
      <View style={[styles.bannerStripe, { backgroundColor: color }]} />
      <Text style={[styles.bannerText, { color: palette.foreground }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable accessibilityRole="button" onPress={onAction} hitSlop={8} style={styles.bannerAction}>
          <Text style={[styles.bannerActionLabel, { color: palette.primary }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
          onPress={onDismiss}
          hitSlop={8}
          style={styles.bannerAction}>
          <Text style={[styles.bannerActionLabel, { color: palette.mutedForeground }]}>Dismiss</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ProgressBar({ progress, label }: { progress: number; label: string }) {
  const palette = usePalette();
  const percent = Math.round(Math.max(0, Math.min(1, progress)) * 100);
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.progressTrack, { backgroundColor: palette.muted }]}>
      <View style={[styles.progressFill, { width: `${percent}%`, backgroundColor: palette.primary }]} />
    </View>
  );
}

export function Hint({ children }: { children: ReactNode }) {
  const palette = usePalette();
  return <Text style={[styles.hint, { color: palette.mutedForeground }]}>{children}</Text>;
}

export function Chip({
  label,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? palette.primary : palette.card,
          borderColor: selected ? palette.primary : palette.mutedForeground,
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      <Text style={[styles.chipLabel, { color: selected ? palette.primaryForeground : palette.foreground }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.sm,
  },
  titleText: { flex: 1, gap: 2 },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  subtitle: { fontSize: 14 },
  card: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    gap: space.md,
  },
  cardTitle: { fontSize: 17, fontWeight: '600' },
  button: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: space.sm,
  },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: space.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillDot: { width: 8, height: 8, borderRadius: 4 },
  pillLabel: { fontSize: 13, fontWeight: '600' },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md, paddingVertical: 10 },
  infoLabel: { fontSize: 15 },
  infoValue: { fontSize: 15, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  banner: {
    marginHorizontal: space.lg,
    marginTop: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingRight: space.md,
  },
  bannerStripe: { width: 4, alignSelf: 'stretch' },
  bannerText: { flex: 1, fontSize: 15, lineHeight: 20, paddingVertical: space.md },
  bannerAction: { minHeight: 44, justifyContent: 'center' },
  bannerActionLabel: { fontSize: 15, fontWeight: '600' },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  hint: { fontSize: 14, lineHeight: 19 },
  chip: {
    flex: 1,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  chipLabel: { fontSize: 15, fontWeight: '600' },
});
