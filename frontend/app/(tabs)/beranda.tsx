import React, { useCallback, useMemo, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl, ActivityIndicator, Modal, Alert, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, radius, spacing } from "@/src/theme/colors";
import { api, getStoredUser } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { coverageCheck, findGaps, fmtMin, fromMin, isWeekend, shiftRange, toMin, todayISO } from "@/src/utils/shift";

export default function Beranda() {
  const router = useRouter();
  const toast = useToast();
  const [user, setUser] = useState<any>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [inspection, setInspection] = useState<any>(null);

  const load = async () => {
    try {
      const u = await getStoredUser();
      setUser(u);
      const data = await api.listRecords(todayISO());
      setRecords(data || []);
    } catch (e) {
      setRecords([]);
    } finally { setLoading(false); setRefreshing(false); }
  };

  useFocusEffect(useCallback(() => { load(); }, []));

  const sorted = useMemo(() => [...records].sort((a, b) => (toMin(a.waktu_mulai) || 0) - (toMin(b.waktu_mulai) || 0)), [records]);
  const gaps = useMemo(() => findGaps(sorted), [sorted]);
  const hasIstirahat = sorted.some((r) => r.type === "istirahat");
  const shortShift = isWeekend(todayISO());

  const totalUtama = sorted.reduce((a, e) => a + (e.aktivitas_utama ? Math.max(0, (toMin(e.waktu_selesai) || 0) - (toMin(e.waktu_mulai) || 0)) : 0), 0);
  const totalOutput = sorted.reduce((a, e) => a + (e.jumlah_per_aktivitas || 0), 0);

  const lastEnd = sorted.length ? sorted[sorted.length - 1].waktu_selesai : null;

  const openForm = (mode: "reguler" | "khusus_pagi" | "khusus_malam", suggestStart?: string | null) => {
    router.push({ pathname: "/form-record", params: { mode, suggest_start: suggestStart || "" } });
  };

  const addIstirahat = async () => {
    if (hasIstirahat) return toast.show("Istirahat hanya bisa 1x per hari", "error");
    if (!lastEnd) return toast.show("Buat entri pertama dulu sebelum Istirahat", "error");
    const startMin = toMin(lastEnd)!;
    const endMin = Math.min(startMin + 60, 24 * 60);
    const last = sorted[sorted.length - 1];
    try {
      await api.createRecord({
        tanggal: todayISO(),
        kode_produksi: last.kode_produksi,
        jenis_produk: last.jenis_produk,
        motif: last.motif,
        size: last.size,
        mode: "reguler",
        type: "istirahat",
        aktivitas_utama: null,
        waktu_mulai: fromMin(startMin),
        waktu_selesai: fromMin(endMin),
        aktivitas_lain_list: [{ nama: "Istirahat", waktu_mulai: fromMin(startMin), waktu_selesai: fromMin(endMin) }],
      });
      toast.show("Istirahat 1 jam ditambahkan", "success");
      load();
    } catch (e: any) { toast.show(e.message || "Gagal", "error"); }
  };

  const inspect = () => {
    const c = coverageCheck(sorted, todayISO());
    setInspection(c);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.hello}>Halo,</Text>
          <Text style={styles.name}>{user?.nama || "Penjahit"}</Text>
          <Text style={styles.team}>Tim {user?.tim}</Text>
        </View>
        <View style={styles.badge}>
          <Ionicons name="calendar" size={14} color={colors.brandPrimary} />
          <Text style={styles.badgeText}>
            {new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brandPrimary} />}
      >
        {loading ? (
          <ActivityIndicator color={colors.brandPrimary} style={{ marginTop: spacing.xl }} />
        ) : (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statCard}><Ionicons name="time" size={22} color={colors.brandPrimary} /><Text style={styles.statValue}>{fmtMin(totalUtama)}</Text><Text style={styles.statLabel}>Waktu Kerja</Text></View>
              <View style={styles.statCard}><Ionicons name="cube" size={22} color={colors.brandSecondary} /><Text style={styles.statValue}>{totalOutput}</Text><Text style={styles.statLabel}>Total Output</Text></View>
            </View>

            <View style={styles.shiftInfo}>
              <Ionicons name="information-circle" size={16} color={colors.info} />
              <Text style={styles.shiftInfoText}>
                Shift {shortShift ? "Weekend" : "Weekday"}: {shiftRange(todayISO()).start} - {shiftRange(todayISO()).end}
                {gaps.length > 0 && <Text style={{ color: colors.warning, fontWeight: "700" }}> · {gaps.length} gap terdeteksi</Text>}
              </Text>
            </View>

            {/* Tambah Inputan Khusus (Pagi/Pre-shift) */}
            <Pressable style={styles.specialTop} onPress={() => openForm("khusus_pagi", null)} testID="btn-khusus-pagi">
              <Ionicons name="sunny" size={18} color={colors.warning} />
              <Text style={styles.specialText}>Tambah Inputan Khusus (Pre-Shift)</Text>
              <Ionicons name="add" size={20} color={colors.warning} />
            </Pressable>

            {sorted.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Ionicons name="clipboard-outline" size={48} color={colors.muted} />
                <Text style={styles.emptyText}>Belum ada aktivitas hari ini.</Text>
                <Text style={styles.emptySub}>Tekan tombol Input Pekerjaan untuk mulai mencatat.</Text>
              </View>
            ) : (
              sorted.map((r, idx) => {
                const prevEnd = idx > 0 ? toMin(sorted[idx - 1].waktu_selesai) : null;
                const curStart = toMin(r.waktu_mulai);
                const gapWarn = prevEnd !== null && curStart !== null && curStart > prevEnd;
                return <RecordCard key={r.id} record={r} gapWarn={gapWarn} expanded={!!expanded[r.id]} onToggle={() => setExpanded((s) => ({ ...s, [r.id]: !s[r.id] }))} onReload={load} />;
              })
            )}

            {/* Tambah Lembur Malam */}
            <Pressable style={styles.specialBottom} onPress={() => openForm("khusus_malam", lastEnd || null)} testID="btn-khusus-malam">
              <Ionicons name="moon" size={18} color={colors.info} />
              <Text style={styles.specialText}>Tambah Lembur Malam (Post-Shift)</Text>
              <Ionicons name="add" size={20} color={colors.info} />
            </Pressable>

            <View style={styles.actionsRow}>
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.brandPrimary }]} onPress={() => openForm("reguler", lastEnd)} testID="btn-input">
                <Ionicons name="hammer" size={18} color="#fff" />
                <Text style={styles.actionText}>Input Pekerjaan Reguler</Text>
              </Pressable>
              <Pressable style={[styles.actionBtn, { backgroundColor: colors.info }]} onPress={() => router.push({ pathname: "/form-lain", params: { suggest_start: lastEnd || "" } })} testID="btn-input-lain">
                <Ionicons name="cafe-outline" size={18} color="#fff" />
                <Text style={styles.actionText}>Input Aktivitas Lain</Text>
              </Pressable>
            </View>

            <Pressable
              style={[styles.actionFull, { backgroundColor: hasIstirahat ? colors.muted : colors.brandSecondary }]}
              onPress={addIstirahat} disabled={hasIstirahat} testID="btn-istirahat"
            >
              <Ionicons name="cafe" size={20} color="#fff" />
              <Text style={styles.actionText}>{hasIstirahat ? "Istirahat Sudah Diambil" : "Istirahat (1 jam otomatis)"}</Text>
            </Pressable>

            <Pressable style={styles.inspectBtn} onPress={inspect} testID="btn-inspect">
              <Ionicons name="checkmark-done-circle" size={20} color="#fff" />
              <Text style={styles.inspectText}>Cek Input Pekerjaan Hari Ini</Text>
            </Pressable>
          </>
        )}
      </ScrollView>

      <InspectionModal visible={!!inspection} data={inspection} onClose={() => setInspection(null)} shortShift={shortShift} />
    </SafeAreaView>
  );
}

function RecordCard({ record, gapWarn, expanded, onToggle, onReload }: any) {
  const router = useRouter();
  const toast = useToast();
  const isIstirahat = record.type === "istirahat";
  const modeLabel = record.mode === "khusus_pagi" ? "Khusus Pagi" : record.mode === "khusus_malam" ? "Lembur" : null;
  const del = async () => {
    // --- KHUSUS WEB: Gunakan window.confirm bawaan browser ---
    if (Platform.OS === "web") {
      const msg = `Hapus record?\n${record.aktivitas_utama || record.aktivitas_lain_list?.[0]?.nama} (${record.waktu_mulai}-${record.waktu_selesai})`;
      const confirmed = window.confirm(msg);
      if (confirmed) {
        try { 
          await api.deleteRecord(record.id); 
          toast.show("Terhapus", "success"); 
          onReload(); 
        }
        catch (e: any) { toast.show(e.message, "error"); }
      }
      return;
    }

    // --- KHUSUS MOBILE (APK / Expo Go) ---
    Alert.alert("Hapus record?", `${record.aktivitas_utama || record.aktivitas_lain_list?.[0]?.nama} (${record.waktu_mulai}-${record.waktu_selesai})`, [
      { text: "Batal", style: "cancel" },
      { text: "Hapus", style: "destructive", onPress: async () => {
        try { await api.deleteRecord(record.id); toast.show("Terhapus", "success"); onReload(); }
        catch (e: any) { toast.show(e.message, "error"); }
      } },
    ]);
  };

  return (
    <Pressable
      style={[styles.card, gapWarn && styles.cardWarn, isIstirahat && styles.cardIstirahat]}
      onPress={onToggle} testID={`card-${record.id}`}
    >
      <View style={styles.cardHead}>
        <View style={styles.timePill}><Text style={styles.timePillText}>{record.waktu_mulai} - {record.waktu_selesai}</Text></View>
        {modeLabel && <View style={styles.modePill}><Text style={styles.modePillText}>{modeLabel}</Text></View>}
        {isIstirahat && <View style={[styles.modePill, { backgroundColor: colors.brandSecondary }]}><Text style={[styles.modePillText, { color: "#fff" }]}>Istirahat</Text></View>}
        {record.is_synced && <Ionicons name="cloud-done" size={16} color={colors.success} style={{ marginLeft: "auto", marginRight: 4 }} />}
        <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={22} color={colors.muted} />
      </View>
      <Text style={styles.cardTitle}>{record.aktivitas_utama || record.aktivitas_lain_list?.[0]?.nama || "-"}</Text>
      <Text style={styles.cardMeta}>{record.kode_produksi} · {record.jenis_produk} · {record.motif}{record.size ? ` · ${record.size}` : ""}</Text>
      {gapWarn && (
        <View style={styles.warnBanner}>
          <Ionicons name="warning" size={14} color={colors.warning} />
          <Text style={styles.warnText}>Ada gap sebelum record ini</Text>
        </View>
      )}
      {expanded && (
        <View style={styles.expandBody}>
          {record.aktivitas_utama && (
            <View style={styles.detailRow}><Text style={styles.detailLabel}>Batch/Selesai:</Text><Text style={styles.detailValue}>{record.jumlah_per_batch ?? "-"} / {record.jumlah_per_aktivitas ?? "-"}</Text></View>
          )}
          {(record.aktivitas_lain_list || []).length > 0 && (
            <>
              <Text style={styles.subTitle}>Aktivitas Lain ({(record.aktivitas_lain_list || []).length}):</Text>
              {(record.aktivitas_lain_list || []).map((l: any, i: number) => (
                <View key={i} style={styles.lainRow}>
                  <Ionicons name="ellipse" size={6} color={colors.brandSecondary} />
                  <Text style={styles.lainName}>{l.nama}</Text>
                  <Text style={styles.lainTime}>{l.waktu_mulai} - {l.waktu_selesai}</Text>
                </View>
              ))}
            </>
          )}
          {!record.is_synced && (
            <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
              <Pressable style={[styles.smallBtn, { backgroundColor: colors.brandPrimary }]} onPress={() => router.push({ pathname: record.type === "utama" ? "/form-record" : "/form-lain", params: { edit_id: record.id } })} testID={`edit-${record.id}`}>
                <Ionicons name="create" size={16} color="#fff" />
                <Text style={styles.smallBtnText}>Edit</Text>
              </Pressable>
              <Pressable 
                style={[
                  styles.smallBtn, 
                  { backgroundColor: colors.error },
                  Platform.OS === "web" && ({ cursor: "pointer" } as any)
                ]} 
                onPress={del} 
                testID={`del-${record.id}`}
              >
                <Ionicons name="trash" size={16} color="#fff" />
                <Text style={styles.smallBtnText}>Hapus</Text>
              </Pressable>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

function InspectionModal({ visible, data, onClose, shortShift }: any) {
  if (!data) return null;
  const items = [
    { ok: data.continuousCoverage, label: `Total coverage shift (${shortShift ? "08:00-15:00" : "08:15-17:15"})`, actual: data.continuousCoverage ? "Lengkap tanpa gap" : "Belum lengkap / ada gap" },
    { ok: data.gaps.length === 0, label: "Tidak ada gap antar record", actual: data.gaps.length ? `${data.gaps.length} gap` : "OK" },
    { ok: !data.needsIstirahat, label: "Istirahat 1x sudah ada", actual: data.needsIstirahat ? "Belum" : "Sudah" },
    { ok: !data.outOfShift, label: "Terdapat record di luar jam reguler", actual: data.outOfShift ? "Ada (Pre-Shift / Lembur)" : "Tidak ada", info: true },
  ];
  const allOK = items.every((i) => i.ok || i.info);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.inspectSheet}>
        <View style={styles.inspectHead}>
          <Ionicons name={allOK ? "checkmark-circle" : "alert-circle"} size={28} color={allOK ? colors.success : colors.warning} />
          <Text style={styles.inspectTitle}>{allOK ? "Input Lengkap" : "Perlu Dilengkapi"}</Text>
          <Pressable onPress={onClose} hitSlop={10} testID="inspect-close"><Ionicons name="close" size={26} color={colors.onSurface} /></Pressable>
        </View>
        {items.map((it: any, i: number) => (
          <View key={i} style={styles.inspectItem}>
            <Ionicons name={it.info ? "information-circle" : (it.ok ? "checkmark-circle" : "close-circle")} size={20} color={it.info ? colors.info : (it.ok ? colors.success : colors.error)} />
            <View style={{ flex: 1 }}>
              <Text style={styles.inspectLabel}>{it.label}</Text>
              <Text style={styles.inspectActual}>{it.actual}</Text>
            </View>
          </View>
        ))}
        {data.gaps.length > 0 && (
          <View style={{ padding: spacing.lg, backgroundColor: colors.surfaceSecondary }}>
            <Text style={{ fontWeight: "700", marginBottom: 4 }}>Gap terdeteksi:</Text>
            {data.gaps.map((g: any, i: number) => (
              <Text key={i} style={{ color: colors.warning, fontSize: 13 }}>• {g.from} → {g.to}</Text>
            ))}
          </View>
        )}
        <Text style={styles.inspectFoot}>Data tetap tersimpan di riwayat. Ini hanya audit coverage shift.</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.surfaceSecondary },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", padding: spacing.lg, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  hello: { color: colors.muted, fontSize: 13 },
  name: { fontSize: 22, fontWeight: "800", color: colors.onSurface, marginTop: 2 },
  team: { fontSize: 12, color: colors.brandPrimary, fontWeight: "600", marginTop: 2 },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.brandTertiary, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill },
  badgeText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "700" },
  statsRow: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  statCard: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 4, borderWidth: 1, borderColor: colors.border },
  statValue: { fontSize: 20, fontWeight: "800", color: colors.onSurface },
  statLabel: { fontSize: 12, color: colors.muted },
  shiftInfo: { flexDirection: "row", alignItems: "center", gap: 6, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  shiftInfoText: { fontSize: 12, color: colors.onSurface, flex: 1 },
  specialTop: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: "#FFF9EC", borderWidth: 1, borderColor: colors.warning, borderStyle: "dashed", borderRadius: radius.md, marginBottom: spacing.md },
  specialBottom: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, backgroundColor: "#EBEEF3", borderWidth: 1, borderColor: colors.info, borderStyle: "dashed", borderRadius: radius.md, marginTop: spacing.sm, marginBottom: spacing.md },
  specialText: { flex: 1, fontWeight: "700", color: colors.onSurface, fontSize: 13 },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardWarn: { borderColor: colors.warning, borderWidth: 2 },
  cardIstirahat: { backgroundColor: "#FFF4F0" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 },
  timePill: { backgroundColor: colors.brandPrimary, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  timePillText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  modePill: { backgroundColor: colors.warning, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill },
  modePillText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  cardTitle: { fontWeight: "700", color: colors.onSurface, fontSize: 15 },
  cardMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  warnBanner: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm, padding: 6, backgroundColor: "#FFF3E0", borderRadius: radius.sm },
  warnText: { color: colors.warning, fontSize: 11, fontWeight: "600" },
  expandBody: { marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  detailRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  detailLabel: { color: colors.muted, fontSize: 12 },
  detailValue: { color: colors.onSurface, fontWeight: "600", fontSize: 12 },
  subTitle: { fontWeight: "700", color: colors.onSurface, marginTop: spacing.sm, marginBottom: 4, fontSize: 12 },
  lainRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 },
  lainName: { flex: 1, color: colors.onSurface, fontSize: 13 },
  lainTime: { color: colors.muted, fontSize: 12 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.md },
  smallBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  emptyWrap: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  emptyText: { fontSize: 15, fontWeight: "600", color: colors.onSurface, marginTop: spacing.sm },
  emptySub: { fontSize: 13, color: colors.muted, marginTop: 4, textAlign: "center" },
  actionsRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  actionFull: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 52, borderRadius: radius.md, marginTop: spacing.sm },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 56, borderRadius: radius.md },
  actionText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  inspectBtn: { marginTop: spacing.md, height: 56, borderRadius: radius.md, backgroundColor: colors.info, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  inspectText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  inspectSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, position: "absolute", bottom: 0, left: 0, right: 0 },
  inspectHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  inspectTitle: { fontSize: 17, fontWeight: "800", color: colors.onSurface, flex: 1 },
  inspectItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.divider },
  inspectLabel: { fontWeight: "600", color: colors.onSurface, fontSize: 14 },
  inspectActual: { color: colors.muted, fontSize: 12, marginTop: 2 },
  inspectFoot: { padding: spacing.lg, fontSize: 12, color: colors.muted, textAlign: "center", paddingBottom: spacing["2xl"] },
});
