import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";

type Props = { label: string; value: string; onChange: (v: string) => void; testID?: string };

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function fmt(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function parse(v: string) {
  if (v && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [y, m, d] = v.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}
function display(v: string) {
  const d = parse(v);
  const months = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function DateField({ label, value, onChange, testID }: Props) {
  const [show, setShow] = useState(false);
  const handleChange = (_e: any, selected?: Date) => {
    if (Platform.OS !== "ios") setShow(false);
    if (selected) onChange(fmt(selected));
  };

  // --- JIKA DIBUKA DI BROWSER WEB ---
  if (Platform.OS === "web") {
    return (
      <View style={{ marginBottom: spacing.md }}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.field}>
          <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceSecondary} />
          <input
            type="date"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            style={{
              flex: 1,
              border: "none",
              backgroundColor: "transparent",
              fontSize: "16px",
              color: colors.onSurface || "#000",
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </View>
      </View>
    );
  }

  // --- JIKA DIBUKA DI MOBILE (ANDROID / IOS) ---
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.field} onPress={() => setShow(true)} testID={testID}>
        <Ionicons name="calendar-outline" size={18} color={colors.onSurfaceSecondary} />
        <Text style={styles.value}>{display(value)}</Text>
      </Pressable>
      {Platform.OS === "ios" ? (
        <Modal transparent visible={show} animationType="slide" onRequestClose={() => setShow(false)}>
          <Pressable style={styles.backdrop} onPress={() => setShow(false)} />
          <View style={styles.iosSheet}>
            <View style={styles.iosHeader}>
              <Text style={styles.iosTitle}>{label}</Text>
              <Pressable onPress={() => setShow(false)}><Text style={styles.iosDone}>Selesai</Text></Pressable>
            </View>
            <DateTimePicker value={parse(value)} mode="date" display="spinner" onChange={handleChange} />
          </View>
        </Modal>
      ) : (
        show && <DateTimePicker value={parse(value)} mode="date" display="default" onChange={handleChange} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurface, marginBottom: spacing.xs },
  field: {
    minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, backgroundColor: colors.surface,
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
  },
  value: { fontSize: 16, color: colors.onSurface, flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)" },
  iosSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  iosHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  iosTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  iosDone: { fontSize: 16, fontWeight: "700", color: colors.brandPrimary },
});