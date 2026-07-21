// Pairing screen: scan the desktop's QR (or paste the code when testing in a
// simulator). The payload carries the encryption key — it is decoded and
// stored in the Keychain, never logged or displayed back.

import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { T } from "@/theme";
import { useCompanion } from "@/state/companion";

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

      <Text style={s.or}>or paste the pairing code</Text>
      <TextInput
        style={s.input}
        value={manual}
        onChangeText={setManual}
        placeholder="budgetr1.…"
        placeholderTextColor={T.muted}
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
  root: { flex: 1, backgroundColor: T.bg, padding: 24, paddingTop: 84 },
  title: { color: T.paper, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  sub: { color: T.muted, fontSize: 14, lineHeight: 20, marginTop: 10, marginBottom: 20 },
  cameraWrap: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: T.line },
  camera: { height: 280 },
  button: {
    backgroundColor: T.jade,
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  buttonDim: { opacity: 0.4 },
  buttonText: { color: "#0b1f15", fontWeight: "600", fontSize: 15 },
  error: { color: T.coral, marginTop: 12, fontSize: 13 },
  or: { color: T.muted, fontSize: 12, textAlign: "center", marginTop: 22, marginBottom: 8 },
  input: {
    backgroundColor: T.panel,
    borderColor: T.line,
    borderWidth: 1,
    borderRadius: 10,
    color: T.paper,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 13,
  },
});
