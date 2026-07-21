// Pairing screen — the app's front door, styled like the desktop's onboarding:
// Fraunces wordmark, brass eyebrow, jade primary action. Scan the desktop's QR
// (or paste the code when testing in a simulator). The payload carries the
// encryption key — decoded into the Keychain, never logged or displayed back.

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { F, T } from "@/theme";
import { useCompanion } from "@/state/companion";
import { Aurora, Eyebrow } from "@/ui/bits";

export function PairingScreen() {
  const { pair } = useCompanion();
  const [permission, requestPermission] = useCameraPermissions();
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [scanning, setScanning] = useState(true);

  const tryPair = async (payload: string) => {
    setScanning(false);
    const err = await pair(payload);
    if (err) {
      setError(err);
      setTimeout(() => setScanning(true), 1500); // let the camera re-arm
    }
  };

  return (
    <View style={s.root}>
      <Aurora />
      <Eyebrow>Companion</Eyebrow>
      <Text style={s.title}>budgetr</Text>
      <Text style={s.sub}>
        Open budgetr on your Mac → Settings → Phone companion → Pair phone, then scan the code.
        Your devices exchange the encryption key directly, on-screen — it never touches a server.
      </Text>

      {permission?.granted ? (
        <View style={s.cameraWrap}>
          <CameraView
            style={s.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={scanning ? ({ data }) => void tryPair(data) : undefined}
          />
        </View>
      ) : (
        <Pressable style={s.button} onPress={() => void requestPermission()}>
          <Text style={s.buttonText}>Allow camera to scan</Text>
        </Pressable>
      )}

      {error ? <Text style={s.error}>{error}</Text> : null}

      <Text style={s.or}>OR PASTE THE PAIRING CODE</Text>
      <TextInput
        style={s.input}
        value={manual}
        onChangeText={setManual}
        placeholder="budgetr1.…"
        placeholderTextColor={T.faint}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        style={[s.button, !manual.trim() && s.buttonDim]}
        disabled={!manual.trim()}
        onPress={() => void tryPair(manual)}
      >
        <Text style={s.buttonText}>Pair</Text>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.ink, padding: 26, paddingTop: 92 },
  title: { color: T.paper, fontSize: 44, fontFamily: F.displayBold, letterSpacing: -1, marginTop: 6 },
  sub: { color: T.muted, fontSize: 14, lineHeight: 21, marginTop: 12, marginBottom: 22, fontFamily: F.sans },
  cameraWrap: {
    borderRadius: T.radius,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: T.lineStrong,
  },
  camera: { height: 280 },
  button: {
    backgroundColor: T.jade,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: "center",
    marginTop: 14,
  },
  buttonDim: { opacity: 0.4 },
  buttonText: { color: T.onJade, fontFamily: F.sansSemiBold, fontSize: 15 },
  error: { color: T.coral, marginTop: 12, fontSize: 13, fontFamily: F.sans },
  or: {
    color: T.brass,
    fontSize: 10.5,
    fontFamily: F.sansSemiBold,
    letterSpacing: 1.8,
    textAlign: "center",
    marginTop: 26,
    marginBottom: 10,
  },
  input: {
    backgroundColor: T.panel,
    borderColor: T.line,
    borderWidth: 1,
    borderRadius: 12,
    color: T.paper,
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
    fontFamily: F.mono,
  },
});
