import React, { useCallback, useMemo, useState } from "react";
import { View, Text, TextInput, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Modal } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import { colors, radius, spacing } from "@/src/theme/colors";
import { api } from "@/src/api/client";
import { useToast } from "@/src/components/Toast";
import { Dropdown } from "@/src/components/Dropdown";
import { TimeField } from "@/src/components/TimeField";
import { todayISO, toMin, findGapAgainstPrevious } from "@/src/utils/shift";
import { storage } from "@/src/utils/storage";

const LAINNYA = "Lainnya:";
const LAST_KODE_KEY = "last_kode_produksi";

export default function FormRecord() {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ mode?: string; suggest_start?: string; edit_id?: string }>();
  const editMode = !!params.edit_id;
  const mode = (params.mode as any) || "reguler";

  const [master, setMaster] = useState<any>({ kode_produksi: [], tahapan_by_produk: {}, aktivitas_lain: [] });
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [gapWarn, setGapWarn] = useState<{ prevEnd: string; newStart: string } | null>(null);
  const [todaysRecords, setTodaysRecords] = useState<any[]>([]);
  const [lastKode, setLastKode] = useState("");

  const [kodeProduksi, setKodeProduksi] = useState("");
  const [jenisProduk, setJenisProduk] = useState("");
  const [motif, setMotif] = useState("");
  const [size, setSize] = useState("");
  const [aktivitasUtama, setAktivitasUtama] = useState("");
  const [customTahapan, setCustomTahapan] = useState("");
  const [jumlahBatch, setJumlahBatch] = useState("");
  const [jumlahAktivitas, setJumlahAktivitas] = useState("");
  const [waktuMulai, setWaktuMulai] = useState(params.suggest_start || "");
  const [waktuSelesai, setWaktuSelesai] = useState("");
  const [lainList, setLainList] = useState<{ nama: string; customNama?: string; waktu_mulai: string; waktu_selesai: string }[]>([]);

  const kodeOptions = useMemo(() => master.kode_produksi.map((k: any) => k.kode).filter(Boolean), [master.kode_produksi]);
  const tahapanOptions = useMemo(() => (jenisProduk ? [...(master.tahapan_by_produk[jenisProduk] || []), LAINNYA] : []), [jenisProduk, master.tahapan_by_produk]);
  const isCustomTahapan = aktivitasUtama === LAINNYA;
  // Coba tambah aktivitas lainnya di dropdown, tapi tetap bisa ketik manual. Jadi gabungan antara master list + custom input.
  const lainOptions = useMemo(() => [...(master.aktivitas_lain || []), LAINNYA], [master.aktivitas_lain]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        try {
          const [m, todays, savedKode] = await Promise.all([
            api.getMaster(),
            api.listRecords(todayISO()),
            storage.getItem(LAST_KODE_KEY, ""),
          ]);
          if (!active) return;
          setMaster(m);
          setTodaysRecords(todays || []);
          setLastKode(savedKode || "");
          if (editMode && params.edit_id) {
            const found = (todays || []).find((r: any) => r.id === params.edit_id);
            if (found) {
              setKodeProduksi(found.kode_produksi);
              setJenisProduk(found.jenis_produk);
              setMotif(found.motif);
              setSize(found.size || "");
              const opts: string[] = m.tahapan_by_produk?.[found.jenis_produk] || [];
              if (found.aktivitas_utama && !opts.includes(found.aktivitas_utama)) {
                setAktivitasUtama(LAINNYA);
                setCustomTahapan(found.aktivitas_utama);
              } else {
                setAktivitasUtama(found.aktivitas_utama || "");
              }
              setJumlahBatch(found.jumlah_per_batch != null ? String(found.jumlah_per_batch) : "");
              setJumlahAktivitas(found.jumlah_per_aktivitas != null ? String(found.jumlah_per_aktivitas) : "");
              setWaktuMulai(found.waktu_mulai);
              setWaktuSelesai(found.waktu_selesai);
              setLainList(found.aktivitas_lain_list || []);
            }
          }
        } catch (e: any) { toast.show(e.message || "Gagal memuat", "error"); }
        finally { if (active) setLoading(false); }
      })();
      return () => { active = false; };
    }, [params.edit_id])
  );

  // When Kode Produksi selected → auto-fill
  const onSelectKode = (kode: string) => {
    setKodeProduksi(kode);
    const found = master.kode_produksi.find((k: any) => k.kode === kode);
    if (found) {
      setJenisProduk(found.jenis_produk || "");
      setMotif(found.motif || "");
      setSize(found.size || "");
      setAktivitasUtama(""); // reset because tahapan changes
      setCustomTahapan("");
    }
  };

  const addLain = () => setLainList([...lainList, { nama: "", customNama: "", waktu_mulai: waktuMulai || "", waktu_selesai: waktuSelesai || "" }]);
  const updateLain = (idx: number, patch: Partial<{ nama: string; customNama?: string; waktu_mulai: string; waktu_selesai: string }>) =>
    setLainList(lainList.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const removeLain = (idx: number) => setLainList(lainList.filter((_, i) => i !== idx));

  const doSubmit = async (ignoreGap: boolean) => {
    if (!kodeProduksi) return toast.show("Pilih Kode Produksi", "error");
    if (!jenisProduk || !motif) return toast.show("Jenis Produk & Motif harus terisi", "error");
    const finalAktivitasUtama = isCustomTahapan ? customTahapan.trim() : aktivitasUtama;
    if (!finalAktivitasUtama) return toast.show(isCustomTahapan ? "Isi nama tahapan kustom" : "Pilih Aktivitas Utama", "error");
    if (!waktuMulai || !waktuSelesai) return toast.show("Isi Waktu Mulai/Selesai", "error");
    if ((toMin(waktuSelesai) || 0) <= (toMin(waktuMulai) || 0)) return toast.show("Waktu Selesai harus > Mulai", "error");

    for (const l of lainList) {
      if (!l.nama || !l.waktu_mulai || !l.waktu_selesai) return toast.show("Lengkapi semua Aktivitas Lain", "error");
      if ((toMin(l.waktu_selesai) || 0) <= (toMin(l.waktu_mulai) || 0)) return toast.show(`Waktu '${l.nama}' tidak valid`, "error");
    }

    // Validasi agar antar Aktivitas Lain tidak saling tumpang tindih (overlap)
    for (let i = 0; i < lainList.length; i++) {
      const a = lainList[i];
      const aStart = toMin(a.waktu_mulai) || 0;
      const aEnd = toMin(a.waktu_selesai) || 0;
      for (let j = i + 1; j < lainList.length; j++) {
        const b = lainList[j];
        const bStart = toMin(b.waktu_mulai) || 0;
        const bEnd = toMin(b.waktu_selesai) || 0;
        
        // Logika overlap: aStart < bEnd dan bStart < aEnd
        if (aStart < bEnd && bStart < aEnd) {
          const namaA = a.nama === LAINNYA ? (a.customNama || "Aktivitas Lain") : a.nama;
          const namaB = b.nama === LAINNYA ? (b.customNama || "Aktivitas Lain") : b.nama;
          return toast.show(`Waktu bertabrakan antara '${namaA}' dan '${namaB}'`, "error");
        }
      }
    }

    // Real-time gap check (non-blocking)
    if (!editMode && !ignoreGap) {
      const otherRecords = todaysRecords.filter((r) => !editMode || r.id !== params.edit_id);
      const gap = findGapAgainstPrevious(otherRecords, waktuMulai);
      if (gap) { setGapWarn(gap); return; }
    }

    setSubmitting(true);
    try {
      const payload = {
        tanggal: todayISO(),
        kode_produksi: kodeProduksi,
        jenis_produk: jenisProduk,
        motif,
        size: size || null,
        mode,
        type: "utama",
        aktivitas_utama: finalAktivitasUtama,
        jumlah_per_batch: jumlahBatch ? parseInt(jumlahBatch) : null,
        jumlah_per_aktivitas: jumlahAktivitas ? parseInt(jumlahAktivitas) : null,
        waktu_mulai: waktuMulai,
        waktu_selesai: waktuSelesai,
        aktivitas_lain_list: lainList.map((l) => ({
          nama: l.nama === LAINNYA ? (l.customNama || "").trim() : l.nama,
          waktu_mulai: l.waktu_mulai,
          waktu_selesai: l.waktu_selesai,
        })),
      };
      if (editMode && params.edit_id) {
        await api.updateRecord(params.edit_id, payload);
      } else {
        await api.createRecord(payload);
      }
      await storage.setItem(LAST_KODE_KEY, kodeProduksi);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show("Tersimpan", "success");
      setGapWarn(null);
      router.back();
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      toast.show(e.message || "Gagal menyimpan", "error");
    } finally { setSubmitting(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brandPrimary} /></View>;

  const modeLabel = mode === "khusus_pagi" ? "Input Khusus (Pre-Shift)" : mode === "khusus_malam" ? "Lembur Malam" : editMode ? "Edit Record" : "Input Pekerjaan Reguler";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary }} edges={["top"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} testID="btn-back"><Ionicons name="arrow-back" size={26} color={colors.onSurface} /></Pressable>
        <Text style={styles.title}>{modeLabel}</Text>
        <View style={{ width: 26 }} />
      </View>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.section}>Data Produk</Text>
            <Dropdown label="Kode Produksi" required value={kodeProduksi} options={kodeOptions} onChange={onSelectKode} testID="dd-kode" />
            {!!lastKode && lastKode !== kodeProduksi && (
              <Pressable style={styles.reuseRow} onPress={() => onSelectKode(lastKode)} testID="checkbox-reuse-kode">
                <Ionicons name="square-outline" size={18} color={colors.brandPrimary} />
                <Text style={styles.reuseText}>Kode produksi sebelumnya: {lastKode}</Text>
              </Pressable>
            )}
            {kodeProduksi && (
              <View style={styles.autoFillBox}>
                <Ionicons name="information-circle" size={14} color={colors.info} />
                <Text style={styles.autoFillText}>Auto-fill: {jenisProduk || "-"} · {motif || "-"}{size ? ` · ${size}` : ""}</Text>
              </View>
            )}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Aktivitas Utama</Text>
            <Dropdown label={jenisProduk ? `Tahapan (${jenisProduk})` : "Tahapan"} required value={aktivitasUtama}
              options={tahapanOptions} onChange={setAktivitasUtama}
              placeholder={jenisProduk ? "Pilih tahapan" : "Pilih Kode Produksi dulu"} testID="dd-tahapan" />
            {isCustomTahapan && (
              <>
                <Text style={styles.label}>Ketik Tahapan Kustom *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Contoh: Quality Check, dll"
                  placeholderTextColor={colors.muted}
                  value={customTahapan}
                  onChangeText={setCustomTahapan}
                  autoCapitalize="sentences"
                  testID="input-custom-tahapan"
                />
                <Text style={styles.hint}>Entri kustom tidak akan menambah dropdown master.</Text>
              </>
            )}
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Jumlah Per Batch</Text>
                <TextInput style={styles.input} placeholder="Ex: 10" placeholderTextColor={colors.muted} keyboardType="numeric" value={jumlahBatch} onChangeText={setJumlahBatch} testID="input-batch" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Jumlah Selesai</Text>
                <TextInput style={styles.input} placeholder="Ex: 10" placeholderTextColor={colors.muted} keyboardType="numeric" value={jumlahAktivitas} onChangeText={setJumlahAktivitas} testID="input-jumlah" />
              </View>
            </View>
            <View style={styles.row2}>
              <TimeField label="Waktu Mulai" required value={waktuMulai} onChange={setWaktuMulai} testID="time-mulai" />
              <TimeField label="Waktu Selesai" required value={waktuSelesai} onChange={setWaktuSelesai} testID="time-selesai" />
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>Aktivitas Lain ({lainList.length})</Text>
              <Pressable onPress={addLain} style={styles.addLainBtn} testID="btn-add-lain">
                <Ionicons name="add-circle" size={18} color={colors.brandPrimary} />
                <Text style={styles.addLainText}>Tambah</Text>
              </Pressable>
            </View>
            {lainList.length === 0 && <Text style={styles.hint}>Belum ada. Tekan Tambah untuk mencatat aktivitas lain yang berbarengan.</Text>}
            {lainList.map((l, i) => {
              const isItemCustom = l.nama === LAINNYA;

              return (
                <View key={i} style={styles.lainCard}>
                 <View style={styles.lainHead}>
                  <Text style={styles.lainIdx}>#{i + 1}</Text>
                  <Pressable onPress={() => removeLain(i)} hitSlop={10} testID={`btn-rm-lain-${i}`}>
                    <Ionicons name="trash" size={18} color={colors.error} />
                  </Pressable>
               </View>
              <Dropdown 
                label="Aktivitas" 
                required 
                value={l.nama} 
                options={lainOptions}
                onChange={(v) => updateLain(i, { nama: v })} 
                testID={`dd-lain-${i}`} 
             />
             {isItemCustom && (
               <>
                <Text style={styles.label}>Ketik Aktivitas Kustom *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Contoh: Meeting, Rapat harian, dll"
                  placeholderTextColor={colors.muted}
                  value={l.customNama || ""}
                  onChangeText={(txt) => updateLain(i, { customNama: txt })}
                  autoCapitalize="sentences"
                  testID={`input-custom-lain-${i}`}
                />
                <Text style={styles.hint}>Entri kustom tidak akan menambah dropdown master.</Text>
              </>
            )}
            <View style={styles.row2}>
              <TimeField label="Mulai" required value={l.waktu_mulai} onChange={(v) => updateLain(i, { waktu_mulai: v })} testID={`time-lain-mulai-${i}`} />
              <TimeField label="Selesai" required value={l.waktu_selesai} onChange={(v) => updateLain(i, { waktu_selesai: v })} testID={`time-lain-selesai-${i}`} />
            </View>
          </View>
        );
      })}
          </View>
        </ScrollView>

        <View style={[styles.stickyBar, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <Pressable style={[styles.saveBtn, mode !== "reguler" && { backgroundColor: colors.warning }]} onPress={() => doSubmit(false)} disabled={submitting} testID="btn-save">
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <><Ionicons name="checkmark-circle" size={22} color="#fff" /><Text style={styles.saveText}>{editMode ? "Update" : "Simpan Entri"}</Text></>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={!!gapWarn} transparent animationType="fade" onRequestClose={() => setGapWarn(null)}>
        <Pressable style={styles.gapBackdrop} onPress={() => setGapWarn(null)} />
        <View style={styles.gapModal}>
          <Ionicons name="warning" size={40} color={colors.warning} />
          <Text style={styles.gapTitle}>Waktu tidak berurutan</Text>
          <Text style={styles.gapDesc}>
            Ada gap antara record sebelumnya (selesai {gapWarn?.prevEnd}) dengan waktu mulai record ini ({gapWarn?.newStart}).
          </Text>
          <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg }}>
            <Pressable style={[styles.gapBtn, { backgroundColor: colors.surfaceSecondary }]} onPress={() => setGapWarn(null)} testID="gap-fix">
              <Text style={styles.gapBtnText}>Perbaiki</Text>
            </Pressable>
            <Pressable style={[styles.gapBtn, { backgroundColor: colors.warning }]} onPress={() => { setGapWarn(null); doSubmit(true); }} testID="gap-continue">
              <Text style={[styles.gapBtnText, { color: "#fff" }]}>OK, Lanjutkan</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.divider },
  title: { fontSize: 17, fontWeight: "700", color: colors.onSurface },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.lg, borderWidth: 1, borderColor: colors.border },
  section: { fontSize: 12, fontWeight: "700", color: colors.brandPrimary, marginBottom: spacing.md, textTransform: "uppercase", letterSpacing: 0.5 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  addLainBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  addLainText: { color: colors.brandPrimary, fontWeight: "700", fontSize: 13 },
  hint: { color: colors.muted, fontSize: 12, fontStyle: "italic" },
  label: { fontSize: 13, fontWeight: "600", color: colors.onSurface, marginBottom: spacing.xs, marginTop: spacing.sm },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, paddingHorizontal: spacing.md, fontSize: 16, color: colors.onSurface, marginBottom: spacing.md, backgroundColor: colors.surface },
  row2: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.md },
  autoFillBox: { flexDirection: "row", alignItems: "center", gap: 4, padding: 8, backgroundColor: colors.brandTertiary, borderRadius: radius.sm, marginTop: 4 },
  autoFillText: { color: colors.info, fontSize: 12, fontWeight: "600", flex: 1 },
  reuseRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, marginBottom: spacing.xs },
  reuseText: { color: colors.brandPrimary, fontSize: 12, fontWeight: "600", flex: 1 },
  lainCard: { padding: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, marginBottom: spacing.sm },
  lainHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  lainIdx: { fontWeight: "700", color: colors.brandSecondary },
  stickyBar: { position: "absolute", bottom: 0, left: 0, right: 0, padding: spacing.lg, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  saveBtn: { height: 56, borderRadius: radius.md, backgroundColor: colors.brandPrimary, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm },
  saveText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  gapBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)" },
  gapModal: { position: "absolute", top: "30%", left: spacing.xl, right: spacing.xl, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, alignItems: "center" },
  gapTitle: { fontSize: 18, fontWeight: "800", color: colors.onSurface, marginTop: spacing.sm },
  gapDesc: { fontSize: 13, color: colors.muted, textAlign: "center", marginTop: spacing.sm, lineHeight: 20 },
  gapBtn: { flex: 1, paddingVertical: spacing.md, borderRadius: radius.md, alignItems: "center" },
  gapBtnText: { fontWeight: "700", color: colors.onSurface },
});
