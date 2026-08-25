import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme/colors";
import { clearAuth, getStoredUser } from "@/src/api/client";

export default function Profil() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  useEffect(() => { getStoredUser().then(setUser); }, []);

  const logout = async () => {
    // --- KHUSUS WEB: Gunakan window.confirm bawaan browser ---
    if (Platform.OS === "web") {
      const confirmed = window.confirm("Keluar?\nAnda akan keluar dari akun.");
      if (confirmed) {
        await clearAuth();
        router.replace("/");
      }
      return;
    }

    // --- KHUSUS MOBILE (APK / Expo Go) ---
    Alert.alert("Keluar?", "Anda akan keluar dari akun.", [
      { text: "Batal", style: "cancel" },
      { text: "Keluar", style: "destructive", onPress: async () => { await clearAuth(); router.replace("/"); } },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Profil</Text>
      </View>
      <View style={{ padding: spacing.lg }}>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={colors.brandPrimary} />
          </View>
          <Text style={styles.name}>{user?.nama || "-"}</Text>
          <Text style={styles.team}>Tim {user?.tim || "-"}</Text>
        </View>

        <Pressable 
          style={[
            styles.row, 
            Platform.OS === "web" && ({ cursor: "pointer" } as any)
          ]} 
          onPress={logout} 
          testID="btn-logout"
        >
          <Ionicons name="log-out-outline" size={22} color={colors.error} />
          <Text style={[styles.rowText, { color: colors.error }]}>Keluar</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 22, fontWeight: "800", color: colors.onSurface },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.xl, alignItems: "center", borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  name: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  team: { color: colors.brandPrimary, fontWeight: "600", marginTop: 4 },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    padding: spacing.lg, backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  rowText: { fontSize: 15, fontWeight: "600" },
});