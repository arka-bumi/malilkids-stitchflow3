import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const TOKEN_KEY = "penjahit_token";
export const USER_KEY = "penjahit_user";

async function authHeader() {
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function req(path: string, opts: RequestInit = {}) {
  const headers: any = { "Content-Type": "application/json", ...(await authHeader()), ...(opts.headers || {}) };
  const res = await fetch(`${BASE}/api${path}`, { ...opts, headers });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (!res.ok) {
    const msg = data?.detail || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export const api = {
  login: (nama: string, pin: string) =>
    req("/auth/login", { method: "POST", body: JSON.stringify({ nama, pin }) }),
  adminLogin: (username: string, password: string) =>
    req("/auth/admin-login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: () => req("/auth/me"),

  getMaster: () => req("/master-data"),

  createRecord: (payload: any) => req("/records", { method: "POST", body: JSON.stringify(payload) }),
  updateRecord: (id: string, payload: any) => req(`/records/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  listRecords: (tanggal?: string) => req(`/records${tanggal ? `?tanggal=${tanggal}` : ""}`),
  deleteRecord: (id: string) => req(`/records/${id}`, { method: "DELETE" }),

  // Admin
  listPenjahit: () => req("/admin/penjahit"),
  createPenjahit: (nama: string, pin: string, tim: string) =>
    req("/admin/penjahit", { method: "POST", body: JSON.stringify({ nama, pin, tim }) }),
  updatePenjahit: (id: string, patch: any) =>
    req(`/admin/penjahit/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deletePenjahit: (id: string) => req(`/admin/penjahit/${id}`, { method: "DELETE" }),

  listAdmins: () => req("/admin/admins"),
  createAdmin: (username: string, password: string, nama?: string) =>
    req("/admin/admins", { method: "POST", body: JSON.stringify({ username, password, nama }) }),
  deleteAdmin: (id: string) => req(`/admin/admins/${id}`, { method: "DELETE" }),

  adminRecords: (params: { tanggal?: string; tim?: string; user_id?: string; is_synced?: boolean }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== "") q.append(k, String(v)); });
    return req(`/admin/records${q.toString() ? `?${q.toString()}` : ""}`);
  },
  adminSummary: (tanggal?: string) => req(`/admin/summary${tanggal ? `?tanggal=${tanggal}` : ""}`),

  getSheetConfig: () => req("/admin/sheet-config"),
  setSheetConfig: (payload: any) => req("/admin/sheet-config", { method: "POST", body: JSON.stringify(payload) }),
  syncRecords: (include_resync: boolean = false) =>
    req(`/admin/sync-records?include_resync=${include_resync}`, { method: "POST" }),
  syncPreview: (include_resync: boolean = false) =>
    req(`/admin/sync-preview?include_resync=${include_resync}`),
  syncMaster: () => req("/admin/sync-master", { method: "POST" }),
};

export async function saveAuth(token: string, user: any) {
  await AsyncStorage.setItem(TOKEN_KEY, token);
  await AsyncStorage.setItem(USER_KEY, JSON.stringify(user));
}
export async function clearAuth() {
  await AsyncStorage.removeItem(TOKEN_KEY);
  await AsyncStorage.removeItem(USER_KEY);
}
  export async function getStoredUser() {
    const u = await AsyncStorage.getItem(USER_KEY);
    if (!u || u === "undefined") {
        return null;
    }
    return JSON.parse(u);
}
