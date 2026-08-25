import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TextInput, Pressable, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme/colors";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";

export default function AdminMgmt() {
  const router = useRouter();
  const toast = useToast();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nama, setNama] = useState("");

  const load = async () => {
    try { setList(await api.listAdmins()); }
    catch (e: any) { toast.show(e.message, "error"); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const add = async () => {
    if (!username.trim() || !password.trim()) return toast.show("Isi username & password", "error");
    try {
      await api.createAdmin(username.trim(), password, nama.trim() || undefined);
      toast.show("Admin ditambahkan", "success");
      setUsername(""); setPassword(""); setNama(""); setShowAdd(false);
      load();
    } catch (e: any) { toast.show(e.message, "error"); }
  };

  const del = async (a: any) => {
    // --- KHUSUS WEB: Gunakan window.confirm bawaan browser ---
    if (Platform.OS === "web") {
      const confirmed = window.confirm(`Hapus admin?\n${a.username}`);
      if (confirmed) {
        try { 
          await api.deleteAdmin(a.id); 
          toast.show("Terhapus", "success"); 
          load(); 
        }
        catch (e: any) { toast.show(e.message, "error"); }
      }
      return;
    }

    // --- KHUSUS MOBILE (APK / Expo Go) ---
    Alert.alert("Hapus admin?", a.username, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await api.deleteAdmin(a.id); toast.show("Terhapus", "success"); load(); }
        catch (e: any) { toast.show(e.message, "error"); }
      } },
    ]);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="btn-back"><Ionicons name="arrow-back" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>Kelola Admin</Text>
        <Pressable onPress={() => setShowAdd(!showAdd)} testID="btn-add"><Ionicons name={showAdd ? "close" : "add"} size={26} color={colors.brandPrimary} /></Pressable>
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg }} keyboardShouldPersistTaps="handled">
          {showAdd && (
            <View style={styles.formCard}>
              <Text style={styles.formTitle}>Tambah Admin Baru</Text>
              <TextInput style={styles.input} placeholder="Username" placeholderTextColor={colors.muted} value={username} onChangeText={setUsername} autoCapitalize="none" testID="add-username" />
              <TextInput style={styles.input} placeholder="Nama (opsional)" placeholderTextColor={colors.muted} value={nama} onChangeText={setNama} testID="add-nama" />
              <TextInput style={styles.input} placeholder="Password (min 6 karakter)" placeholderTextColor={colors.muted} value={password} onChangeText={setPassword} secureTextEntry testID="add-password" />
              <Pressable style={styles.saveBtn} onPress={add} testID="btn-save-admin">
                <Ionicons name="checkmark" size={20} color="#fff" />
                <Text style={styles.saveText}>Simpan</Text>
              </Pressable>
            </View>
          )}
          {loading ? <ActivityIndicator color={colors.brandPrimary} /> : list.map((a) => (
            <View key={a.id} style={styles.card} testID={`admin-${a.id}`}>
              <View style={styles.cardHead}>
                <Ionicons name="shield-checkmark" size={26} color={colors.brandPrimary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardName}>{a.username}</Text>
                  <Text style={styles.cardMeta}>{a.nama || "Admin"}</Text>
                </View>
                <Pressable onPress={() => del(a)} hitSlop={10} testID={`del-admin-${a.id}`}
                style={Platform.OS === "web" ? ({ cursor: "pointer" } as any) : undefined}>
                  <Ionicons name="trash" size={20} color={colors.error} />
                </Pressable>
              </View>
            </View>
          ))}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  formCard: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.brandPrimary },
  formTitle: { fontSize: 14, fontWeight: "700", color: colors.brandPrimary, marginBottom: spacing.md, textTransform: "uppercase" },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 15, color: colors.onSurface, marginBottom: spacing.sm, backgroundColor: colors.surface },
  saveBtn: { height: 48, borderRadius: radius.md, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 },
  saveText: { color: "#fff", fontWeight: "700" },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  cardName: { fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
