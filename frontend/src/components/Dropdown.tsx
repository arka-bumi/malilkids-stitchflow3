import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Modal, FlatList, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context"; // <-- 1. Import safe area insets
import { colors, radius, spacing } from "../theme/colors";

type Props = {
  label: string;
  value: string;
  options: string[];
  placeholder?: string;
  onChange: (v: string) => void;
  onAddNew?: (v: string) => Promise<void> | void;
  testID?: string;
  required?: boolean;
};

export function Dropdown({ label, value, options, placeholder = "Pilih...", onChange, onAddNew, testID, required }: Props) {
  const insets = useSafeAreaInsets(); // <-- 2. Panggil hook insets
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [addMode, setAddMode] = useState(false);
  const [newVal, setNewVal] = useState("");

  const filtered = options.filter((o) => o.toLowerCase().includes(search.toLowerCase()));

  const handleAdd = async () => {
    const v = newVal.trim();
    if (!v) return;
    if (onAddNew) await onAddNew(v);
    onChange(v);
    setAddMode(false); setNewVal(""); setOpen(false); setSearch("");
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>
        {label} {required && <Text style={{ color: colors.error }}>*</Text>}
      </Text>
      <Pressable style={styles.field} onPress={() => setOpen(true)} testID={testID}>
        <Text style={[styles.value, !value && { color: colors.muted }]}>{value || placeholder}</Text>
        <Ionicons name="chevron-down" size={20} color={colors.onSurfaceSecondary} />
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        {/* 3. Tambahkan paddingBottom dari insets.bottom agar tidak tertutup nav bar HP */}
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{label}</Text>
            <Pressable onPress={() => setOpen(false)} testID={`${testID}-close`}>
              <Ionicons name="close" size={26} color={colors.onSurface} />
            </Pressable>
          </View>

          {!addMode && (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={18} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Cari..."
                  value={search}
                  onChangeText={setSearch}
                  placeholderTextColor={colors.muted}
                />
              </View>
              <FlatList
                data={filtered}
                keyExtractor={(i) => i}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.optionRow}
                    onPress={() => { onChange(item); setOpen(false); setSearch(""); }}
                    testID={`${testID}-opt-${item}`}
                  >
                    <Text style={styles.optionText}>{item}</Text>
                    {value === item && <Ionicons name="checkmark" size={22} color={colors.brandPrimary} />}
                  </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.empty}>Tidak ada opsi</Text>}
              />
              {onAddNew && (
                <Pressable style={styles.addBtn} onPress={() => setAddMode(true)} testID={`${testID}-add-new`}>
                  <Ionicons name="add-circle" size={22} color={colors.brandPrimary} />
                  <Text style={styles.addBtnText}>Tambah Opsi Baru</Text>
                </Pressable>
              )}
            </>
          )}

          {addMode && (
            <View style={{ padding: spacing.lg }}>
              <Text style={styles.label}>Opsi Baru</Text>
              <TextInput
                style={styles.input}
                value={newVal}
                onChangeText={setNewVal}
                placeholder="Ketik nilai baru"
                placeholderTextColor={colors.muted}
                autoFocus
              />
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                <Pressable style={[styles.actionBtn, styles.actionCancel]} onPress={() => { setAddMode(false); setNewVal(""); }}>
                  <Text style={styles.actionCancelText}>Batal</Text>
                </Pressable>
                <Pressable style={[styles.actionBtn, styles.actionSave]} onPress={handleAdd} testID={`${testID}-save-new`}>
                  <Text style={styles.actionSaveText}>Simpan</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurface, marginBottom: spacing.xs },
  field: {
    minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, backgroundColor: colors.surface,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  value: { fontSize: 16, color: colors.onSurface, flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  sheet: {
    position: "absolute", bottom: 0, left: 0, right: 0, backgroundColor: colors.surface,
    borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "80%", minHeight: "50%",
  },
  sheetHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  sheetTitle: { fontSize: 18, fontWeight: "700", color: colors.onSurface },
  searchWrap: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    margin: spacing.lg, paddingHorizontal: spacing.md, borderWidth: 1,
    borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary,
  },
  searchInput: { flex: 1, height: 44, fontSize: 15, color: colors.onSurface },
  optionRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  optionText: { fontSize: 16, color: colors.onSurface },
  empty: { textAlign: "center", padding: spacing.xl, color: colors.muted },
  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.divider,
  },
  addBtnText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 15 },
  input: {
    minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, fontSize: 16, color: colors.onSurface, backgroundColor: colors.surface,
  },
  actionBtn: { flex: 1, height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center" },
  actionCancel: { backgroundColor: colors.surfaceSecondary },
  actionCancelText: { color: colors.onSurface, fontWeight: "700" },
  actionSave: { backgroundColor: colors.brandPrimary },
  actionSaveText: { color: colors.onBrandPrimary, fontWeight: "700" },
});