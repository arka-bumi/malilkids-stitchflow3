import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform, Modal } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing } from "../theme/colors";

type Props = {
  label: string;
  value: string; // HH:mm
  onChange: (v: string) => void;
  testID?: string;
  required?: boolean;
};

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }
function toDate(v: string): Date {
  const d = new Date();
  if (v && /^\d{1,2}:\d{2}$/.test(v)) {
    const [h, m] = v.split(":").map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
}

export function TimeField({ label, value, onChange, testID, required }: Props) {
  const [show, setShow] = useState(false);

  const handleChange = (_e: any, selected?: Date) => {
    if (Platform.OS !== "ios") setShow(false);
    if (selected) onChange(`${pad(selected.getHours())}:${pad(selected.getMinutes())}`);
  };

  // --- JIKA DIBUKA DI BROWSER WEB ---
  if (Platform.OS === "web") {
    return (
      <View style={{ flex: 1 }}>
        <Text style={styles.label}>
          {label} {required && <Text style={{ color: colors.error }}>*</Text>}
        </Text>
        <View style={styles.field}>
          <Ionicons name="time-outline" size={18} color={colors.onSurfaceSecondary} />
          <input
            type="time"
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
    <View style={{ flex: 1 }}>
      <Text style={styles.label}>
        {label} {required && <Text style={{ color: colors.error }}>*</Text>}
      </Text>
      <Pressable style={styles.field} onPress={() => setShow(true)} testID={testID}>
        <Ionicons name="time-outline" size={18} color={colors.onSurfaceSecondary} />
        <Text style={[styles.value, !value && { color: colors.muted }]}>{value || "--:--"}</Text>
      </Pressable>

      {Platform.OS === "ios" ? (
        <Modal transparent visible={show} animationType="slide" onRequestClose={() => setShow(false)}>
          <Pressable style={styles.backdrop} onPress={() => setShow(false)} />
          <View style={styles.iosSheet}>
            <View style={styles.iosHeader}>
              <Text style={styles.iosTitle}>{label}</Text>
              <Pressable onPress={() => setShow(false)}>
                <Text style={styles.iosDone}>Selesai</Text>
              </Pressable>
            </View>
            <DateTimePicker
              value={toDate(value)}
              mode="time"
              display="spinner"
              onChange={handleChange}
              is24Hour
            />
          </View>
        </Modal>
      ) : (
        show && (
          <DateTimePicker
            value={toDate(value)}
            mode="time"
            display="default"
            onChange={handleChange}
            is24Hour
          />
        )
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
  iosHeader: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  iosTitle: { fontSize: 16, fontWeight: "700", color: colors.onSurface },
  iosDone: { fontSize: 16, fontWeight: "700", color: colors.brandPrimary },
});