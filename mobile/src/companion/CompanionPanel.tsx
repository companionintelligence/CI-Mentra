import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { Banner, Button, ButtonRow, Card, Hint, InfoRow, StatusPill } from '../components/ui';
import { radius, space, toneColor, usePalette } from '../theme';
import type { CompanionController } from './useCompanion';

/** The companion section above the tabs: sign-in, where data goes, what is captured, and asking. */
export function CompanionPanel({ companion }: { companion: CompanionController }) {
  const palette = usePalette();
  const [expanded, setExpanded] = useState(false);
  const [addressDraft, setAddressDraft] = useState<string | null>(null);
  const [question, setQuestion] = useState('');

  const { settings, account } = companion;
  const signedIn = account !== null;
  const statusLabel = signedIn
    ? (account.user?.email ?? account.user?.name ?? 'Signed in')
    : settings.applianceUrl
      ? 'Not signed in'
      : 'Set appliance';

  const inputStyle = [
    styles.input,
    { color: palette.foreground, borderColor: palette.border, backgroundColor: palette.background },
  ];

  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel="Companion settings"
        onPress={() => setExpanded((open) => !open)}
        style={[styles.header, { backgroundColor: palette.card, borderColor: palette.border }]}>
        <Text style={[styles.headerTitle, { color: palette.foreground }]}>Companion</Text>
        <StatusPill label={statusLabel} tone={signedIn ? 'success' : 'warning'} />
        <Text style={[styles.toggle, { color: palette.mutedForeground }]}>{expanded ? 'Hide' : 'Show'}</Text>
      </Pressable>

      {companion.notice ? (
        <Banner tone={companion.notice.tone} message={companion.notice.message} onDismiss={companion.dismissNotice} />
      ) : null}

      {expanded ? (
        <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <Card title="Appliance">
            <InfoRow label="Address" value={settings.applianceUrl || 'Not set'} last />
            <TextInput
              value={addressDraft ?? settings.applianceUrl}
              onChangeText={setAddressDraft}
              placeholder="https://ci-mentra.example.ts.net"
              placeholderTextColor={palette.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Appliance address"
              style={inputStyle}
            />
            <Button
              label="Save address"
              variant="secondary"
              onPress={() => {
                companion.saveAddress(addressDraft ?? settings.applianceUrl);
                setAddressDraft(null);
              }}
            />
            <Hint>Use the https address your appliance serves, such as a Tailscale HTTPS name or a Hub tunnel.</Hint>
          </Card>

          <Card title="Account">
            {signedIn ? (
              <>
                <InfoRow label="Signed in as" value={account.user?.email ?? account.user?.name ?? 'Owner'} />
                <InfoRow label="Appliance memory" value={account.memoryEnabled ? 'On' : 'Off'} last />
                <ButtonRow>
                  <Button label="Sign out" variant="danger" onPress={() => void companion.signOut()} />
                </ButtonRow>
              </>
            ) : (
              <>
                <Hint>Sign in with your CI-Portal account. It must be the owner account for this appliance.</Hint>
                <Button
                  label="Sign in with CI-Portal"
                  onPress={() => void companion.signIn()}
                  disabled={!settings.applianceUrl || companion.busy !== null}
                  busy={companion.busy === 'Signing in'}
                />
              </>
            )}
          </Card>

          <Card title="Capture to memory">
            <SwitchRow
              label="Capture to memory"
              value={settings.captureEnabled}
              onValueChange={companion.setCapture}
            />
            <SwitchRow
              label="What the wearer says"
              value={settings.captureSpeech}
              disabled={!settings.captureEnabled}
              onValueChange={(value) => companion.setSource('captureSpeech', value)}
            />
            <SwitchRow
              label="Buttons, touch and head movement"
              value={settings.captureInput}
              disabled={!settings.captureEnabled}
              onValueChange={(value) => companion.setSource('captureInput', value)}
            />
            <SwitchRow
              label="Battery and connection"
              value={settings.captureDevice}
              disabled={!settings.captureEnabled}
              onValueChange={(value) => companion.setSource('captureDevice', value)}
              last
            />
            <InfoRow label="Waiting to send" value={`${companion.queueSize} records`} last />
            <Hint>
              While capture is on and the glasses are connected, the glasses microphone is on, and the glasses show
              their own indicator. Only final transcripts are stored, never raw audio.
            </Hint>
          </Card>

          <Card title="Ask your companion">
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder="Type a question"
              placeholderTextColor={palette.mutedForeground}
              accessibilityLabel="Question for your companion"
              style={inputStyle}
            />
            <ButtonRow>
              <Button
                label="Ask"
                disabled={!question.trim() || !signedIn}
                busy={companion.busy === 'Asking your companion'}
                onPress={() => {
                  const text = question;
                  setQuestion('');
                  void companion.ask(text);
                }}
              />
              <Button
                label={companion.askArmed ? 'Listening' : 'Ask by voice'}
                variant="secondary"
                disabled={!signedIn || !companion.glassesReady}
                onPress={companion.armAsk}
              />
            </ButtonRow>
            {companion.lastAnswer ? (
              <Text selectable style={[styles.answer, { color: palette.foreground }]}>
                {companion.lastAnswer}
              </Text>
            ) : null}
            <Hint>Press the glasses button briefly, then ask within 20 seconds. The answer also shows on the glasses.</Hint>
          </Card>

          <Card title="Photo">
            <Button
              label="Take a photo with the glasses"
              variant="secondary"
              disabled={!signedIn || !companion.glassesReady || companion.busy !== null}
              busy={companion.busy === 'Taking a photo'}
              onPress={() => void companion.takePhoto()}
            />
            <Hint>The photo goes to your appliance and is noted in memory.</Hint>
          </Card>

          <Card title="Activity">
            {companion.log.length === 0 ? <Hint>Nothing yet.</Hint> : null}
            {companion.log.slice(0, 8).map((line) => (
              <Text key={line.id} style={[styles.logLine, { color: toneColor(palette, line.tone) }]}>
                {line.text}
              </Text>
            ))}
          </Card>
        </ScrollView>
      ) : null}
    </View>
  );
}

function SwitchRow({
  label,
  value,
  onValueChange,
  disabled = false,
  last = false,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  const palette = usePalette();
  return (
    <View style={[styles.switchRow, !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.switchLabel, { color: disabled ? palette.mutedForeground : palette.foreground }]}>{label}</Text>
      <Switch
        value={value}
        disabled={disabled}
        onValueChange={onValueChange}
        accessibilityLabel={label}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    marginHorizontal: space.md,
    marginTop: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.md,
  },
  headerTitle: { fontSize: 15, fontWeight: '600' },
  toggle: { marginLeft: 'auto', fontSize: 13 },
  body: { maxHeight: 460 },
  bodyContent: { padding: space.md, gap: space.md },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
  },
  answer: { fontSize: 15, lineHeight: 21 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
  },
  switchLabel: { flex: 1, fontSize: 14, paddingRight: space.md },
  logLine: { fontSize: 13, lineHeight: 18 },
});
