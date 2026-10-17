import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "../components/AppSymbol";

import { AppText, AppTextInput } from "../components/AppText";
import { GlassSurface } from "../components/GlassSurface";
import { pairComputer } from "../data/computers";
import { useSirus } from "../data/store";

/**
 * First screen (ADR-135): the Mac's tailnet address and a pairing code from its Settings →
 * Connections. More computers are added later in Settings.
 */
export function ConnectScreen(props: { readonly title?: string; readonly onDone?: () => void } = {}) {
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const ready = address.trim().length > 3 && code.replace(/\D/g, "").length === 6;
  const connect = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await useSirus.getState().addComputer(await pairComputer(address, code));
      props.onDone?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  return <View className="flex-1 bg-screen" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, justifyContent: "center", gap: 24, paddingHorizontal: 24 }}>
      <View className="items-center gap-3">
        <SymbolView name="desktopcomputer" size={44} tintColorClassName="accent-icon" />
        <AppText className="font-app-bold text-2xl">{props.title ?? "Conectar ao seu Mac"}</AppText>
        <AppText className="text-center text-sm text-foreground-muted">No Mac, abra Ajustes → Conexões. Digite o endereço seguro e o código embaixo do QR code.</AppText>
      </View>
      <View className="gap-3">
        <GlassSurface className="px-4 py-3" style={{ borderRadius: 18 }}>
          <AppTextInput value={address} onChangeText={setAddress} placeholder="mac.tailnet.ts.net" autoCapitalize="none" autoCorrect={false} keyboardType="url" className="text-base" />
        </GlassSurface>
        <GlassSurface className="px-4 py-3" style={{ borderRadius: 18 }}>
          <AppTextInput value={code} onChangeText={setCode} placeholder="Código de 6 dígitos" keyboardType="number-pad" maxLength={7} className="text-base" onSubmitEditing={() => void connect()} />
        </GlassSurface>
      </View>
      {error ? <AppText className="text-center text-sm text-danger-foreground">{error}</AppText> : null}
      <Pressable disabled={!ready || busy} onPress={() => void connect()} className="h-12 items-center justify-center rounded-full bg-foreground active:opacity-80 disabled:opacity-30">
        {busy ? <ActivityIndicator /> : <AppText className="font-app-medium text-base text-screen">Conectar</AppText>}
      </Pressable>
    </KeyboardAvoidingView>
  </View>;
}
