from fastapi import FastAPI, APIRouter, HTTPException, Depends, Header
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
import asyncio
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Any, Literal
import uuid
from datetime import datetime, timezone, timedelta
import bcrypt
import jwt

from google.oauth2 import service_account
from googleapiclient.discovery import build

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ.get('JWT_SECRET', 'penjahit-super-secret-change-me')
JWT_ALGO = 'HS256'

app = FastAPI()
api_router = APIRouter(prefix="/api")

logger = logging.getLogger(__name__)

# ---------- Models ----------
class LoginBody(BaseModel):
    nama: str
    pin: str

class AdminLoginBody(BaseModel):
    username: str
    password: str

class CreatePenjahitBody(BaseModel):
    nama: str
    pin: str
    tim: str

class UpdatePenjahitBody(BaseModel):
    tim: Optional[str] = None
    active: Optional[bool] = None
    pin: Optional[str] = None

class CreateAdminBody(BaseModel):
    username: str
    password: str
    nama: Optional[str] = None

class AktivitasLainItem(BaseModel):
    nama: str
    waktu_mulai: str
    waktu_selesai: str

class RecordCreate(BaseModel):
    tanggal: Optional[str] = None  # server sets today if empty
    kode_produksi: str
    jenis_produk: str
    motif: str
    size: Optional[str] = None
    mode: Literal["reguler", "khusus_pagi", "khusus_malam"] = "reguler"
    type: Literal["utama", "lain_saja", "istirahat"] = "utama"
    aktivitas_utama: Optional[str] = None
    jumlah_per_batch: Optional[int] = None
    jumlah_per_aktivitas: Optional[int] = None
    waktu_mulai: str
    waktu_selesai: str
    aktivitas_lain_list: List[AktivitasLainItem] = []

class RecordUpdate(BaseModel):
    kode_produksi: Optional[str] = None
    jenis_produk: Optional[str] = None
    motif: Optional[str] = None
    size: Optional[str] = None
    aktivitas_utama: Optional[str] = None
    jumlah_per_batch: Optional[int] = None
    jumlah_per_aktivitas: Optional[int] = None
    waktu_mulai: Optional[str] = None
    waktu_selesai: Optional[str] = None
    aktivitas_lain_list: Optional[List[AktivitasLainItem]] = None

class SheetConfig(BaseModel):
    spreadsheet_id: str
    service_account_json: str
    sheet_name: Optional[str] = "Sheet1"
    master_kode_tab: Optional[str] = "Kode Produksi"
    master_tahapan_tab: Optional[str] = "Tahapan Standar"
    master_lain_tab: Optional[str] = "Aktivitas Lain"

# ---------- Helpers ----------
def hash_pw(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()

def verify_pw(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False

def make_token(user_id: str, role: str) -> str:
    return jwt.encode(
        {"sub": user_id, "role": role, "iat": datetime.now(timezone.utc).timestamp()},
        JWT_SECRET, algorithm=JWT_ALGO,
    )

async def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "pin_hash": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if user.get("role") == "penjahit" and user.get("active") is False:
        raise HTTPException(status_code=403, detail="Akun nonaktif. Hubungi admin.")
    user["role"] = payload.get("role", user.get("role", "penjahit"))
    return user

async def require_admin(user = Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user

async def require_super_admin(user = Depends(get_current_user)):
    if user.get("role") != "admin" or not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Hanya Super Admin yang dapat mengelola admin")
    return user

def tm(t: Optional[str]) -> Optional[int]:
    if not t or not isinstance(t, str) or ":" not in t:
        return None
    try:
        hh, mm = t.split(":")
        v = int(hh) * 60 + int(mm)
        return v if 0 <= v <= 24 * 60 else None
    except Exception:
        return None

def overlap(a1: int, a2: int, b1: int, b2: int) -> bool:
    return a1 < b2 and b1 < a2

# ---------- Google Sheets Sync ----------
SHEET_HEADERS = [
    "Nama", "Kode Produksi", "Tanggal", "Tim", "Jenis Produk", "Motif", "Size",
    "Aktivitas Utama", "Jumlah Per Batch", "Jumlah Per Aktivitas",
    "Waktu Mulai", "Waktu Selesai",
    "Aktivitas Lain", "Waktu Mulai Lain", "Waktu Selesai Lain",
]

def _fmt_tanggal(iso: str) -> str:
    # store display like "4 Januari 2026"
    try:
        y, m, d = iso.split("-")
        bulan = ["", "Januari", "Februari", "Maret", "April", "Mei", "Juni",
                 "Juli", "Agustus", "September", "Oktober", "November", "Desember"]
        return f"{int(d)} {bulan[int(m)]} {y}"
    except Exception:
        return iso

def _record_to_rows(r: dict) -> List[list]:
    """Duplicate the utama row per aktivitas_lain, or 1 row when no lain."""
    lains = r.get("aktivitas_lain_list") or []
    base = [
        r.get("nama", ""),
        r.get("kode_produksi", ""),
        _fmt_tanggal(r.get("tanggal", "")),
        r.get("tim", ""),
        r.get("jenis_produk", ""),
        r.get("motif", ""),
        r.get("size", "") or "",
        r.get("aktivitas_utama") or "",
        r.get("jumlah_per_batch") if r.get("jumlah_per_batch") is not None else "",
        r.get("jumlah_per_aktivitas") if r.get("jumlah_per_aktivitas") is not None else "",
        r.get("waktu_mulai", "") if r.get("aktivitas_utama") else "",
        r.get("waktu_selesai", "") if r.get("aktivitas_utama") else "",
    ]
    if not lains:
        return [base + ["", "", ""]]
    rows = []
    for l in lains:
        rows.append(base + [l.get("nama", ""), l.get("waktu_mulai", ""), l.get("waktu_selesai", "")])
    return rows

def _get_service_sync(sa_json_str: str):
    info = json.loads(sa_json_str)
    creds = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/spreadsheets"]
    )
    return build('sheets', 'v4', credentials=creds, cache_discovery=False)

def _ensure_headers_sync(service, spreadsheet_id: str, sheet_name: str):
    try:
        res = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id, range=f"{sheet_name}!A1:O1"
        ).execute()
        values = res.get("values", [])
        if not values or values[0] != SHEET_HEADERS:
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{sheet_name}!A1:O1",
                valueInputOption="RAW",
                body={"values": [SHEET_HEADERS]},
            ).execute()
    except Exception as e:
        logger.error(f"Ensure headers failed: {e}")

def _append_rows_sync(sa_json_str: str, spreadsheet_id: str, sheet_name: str, rows: List[list]):
    service = _get_service_sync(sa_json_str)
    _ensure_headers_sync(service, spreadsheet_id, sheet_name)
    service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:O",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()

def _read_sheet_sync(sa_json_str: str, spreadsheet_id: str, range_: str) -> List[list]:
    service = _get_service_sync(sa_json_str)
    res = service.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=range_).execute()
    return res.get("values", [])

async def _sync_records_to_sheet(records: List[dict]) -> tuple[int, int]:
    cfg = await db.sheet_config.find_one({"id": "default"}, {"_id": 0})
    if not cfg or not cfg.get("service_account_json"):
        return 0, len(records)
    rows: List[list] = []
    for r in records:
        rows.extend(_record_to_rows(r))
    if not rows:
        return 0, 0
    try:
        await asyncio.to_thread(
            _append_rows_sync,
            cfg["service_account_json"], cfg["spreadsheet_id"],
            cfg.get("sheet_name") or "Sheet1", rows,
        )
        return len(records), 0
    except Exception as e:
        logger.error(f"Sync failed: {e}")
        return 0, len(records)

# ---------- Auto Purge (synced records older than 12h) ----------
async def _purge_synced():
    cutoff = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
    await db.records.delete_many({"is_synced": True, "synced_at": {"$lt": cutoff}})

# ---------- Auth ----------
@api_router.post("/auth/login")
async def login(body: LoginBody):
    nama_norm = body.nama.strip()
    user = await db.users.find_one({"nama_lower": nama_norm.lower(), "role": "penjahit"})
    if not user or not verify_pw(body.pin, user["pin_hash"]):
        raise HTTPException(status_code=401, detail="Nama atau PIN salah")
    if user.get("active") is False:
        raise HTTPException(status_code=403, detail="Akun nonaktif. Hubungi admin.")
    token = make_token(user["id"], "penjahit")
    return {"token": token, "user": {"id": user["id"], "nama": user["nama"], "tim": user["tim"], "role": "penjahit"}}

@api_router.post("/auth/admin-login")
async def admin_login(body: AdminLoginBody):
    admin = await db.users.find_one({"username": body.username.strip().lower(), "role": "admin"})
    if not admin or not verify_pw(body.password, admin["password_hash"]):
        raise HTTPException(status_code=401, detail="Username atau password salah")
    token = make_token(admin["id"], "admin")
    return {"token": token, "user": {"id": admin["id"], "nama": admin.get("nama", "Admin"), "role": "admin", "is_super_admin": bool(admin.get("is_super_admin"))}}

@api_router.get("/auth/me")
async def me(user = Depends(get_current_user)):
    return user

# ---------- Master Data ----------
@api_router.get("/master-data")
async def get_master_data(user = Depends(get_current_user)):
    kode_docs = await db.kode_produksi.find({}, {"_id": 0}).to_list(5000)
    tahapan_docs = await db.tahapan_standar.find({}, {"_id": 0}).to_list(5000)
    lain_docs = await db.master_data.find({"type": "aktivitas_lain"}, {"_id": 0}).to_list(500)
    tim_docs = await db.master_data.find({"type": "tim"}, {"_id": 0}).to_list(500)

    tahapan_by_produk: dict = {}
    for t in tahapan_docs:
        jp = t.get("jenis_produk")
        if not jp:
            continue
        tahapan_by_produk.setdefault(jp, []).append(t.get("tahapan"))
    for k in tahapan_by_produk:
        tahapan_by_produk[k] = sorted(set(x for x in tahapan_by_produk[k] if x))

    return {
        "kode_produksi": kode_docs,
        "tahapan_by_produk": tahapan_by_produk,
        "aktivitas_lain": sorted(set(d["value"] for d in lain_docs)),
        "tim": sorted(set(d["value"] for d in tim_docs)),
    }

# ---------- Penjahit management (Admin only) ----------
@api_router.get("/admin/penjahit")
async def list_penjahit(admin = Depends(require_admin)):
    docs = await db.users.find({"role": "penjahit"}, {"_id": 0, "pin_hash": 0}).to_list(500)
    return docs

@api_router.post("/admin/penjahit")
async def create_penjahit(body: CreatePenjahitBody, admin = Depends(require_admin)):
    nama_norm = body.nama.strip()
    if len(nama_norm) < 2:
        raise HTTPException(status_code=400, detail="Nama minimal 2 karakter")
    if not (body.pin.isdigit() and 4 <= len(body.pin) <= 6):
        raise HTTPException(status_code=400, detail="PIN harus 4-6 digit angka")
    existing = await db.users.find_one({"nama_lower": nama_norm.lower(), "role": "penjahit"})
    if existing:
        raise HTTPException(status_code=400, detail="Nama sudah terdaftar")
    user = {
        "id": str(uuid.uuid4()),
        "nama": nama_norm,
        "nama_lower": nama_norm.lower(),
        "tim": body.tim.strip(),
        "role": "penjahit",
        "active": True,
        "pin_hash": hash_pw(body.pin),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(user)
    tim_val = body.tim.strip()
    await db.master_data.update_one(
        {"type": "tim", "value_lower": tim_val.lower()},
        {"$setOnInsert": {"id": str(uuid.uuid4()), "type": "tim", "value": tim_val, "value_lower": tim_val.lower()}},
        upsert=True,
    )
    user.pop("pin_hash", None)
    user.pop("_id", None)
    return user

@api_router.patch("/admin/penjahit/{user_id}")
async def update_penjahit(user_id: str, body: UpdatePenjahitBody, admin = Depends(require_admin)):
    update: dict = {}
    if body.tim is not None:
        update["tim"] = body.tim.strip()
    if body.active is not None:
        update["active"] = body.active
    if body.pin is not None:
        if not (body.pin.isdigit() and 4 <= len(body.pin) <= 6):
            raise HTTPException(status_code=400, detail="PIN harus 4-6 digit angka")
        update["pin_hash"] = hash_pw(body.pin)
    if not update:
        raise HTTPException(status_code=400, detail="Tidak ada perubahan")
    res = await db.users.update_one({"id": user_id, "role": "penjahit"}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Penjahit tidak ditemukan")
    return {"ok": True}

@api_router.delete("/admin/penjahit/{user_id}")
async def delete_penjahit(user_id: str, admin = Depends(require_admin)):
    res = await db.users.delete_one({"id": user_id, "role": "penjahit"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Penjahit tidak ditemukan")
    return {"ok": True}

# ---------- Admin management (Super Admin only) ----------
@api_router.get("/admin/admins")
async def list_admins(admin = Depends(require_super_admin)):
    docs = await db.users.find({"role": "admin"}, {"_id": 0, "password_hash": 0}).to_list(50)
    return docs

@api_router.post("/admin/admins")
async def create_admin(body: CreateAdminBody, admin = Depends(require_super_admin)):
    uname = body.username.strip().lower()
    if len(uname) < 3:
        raise HTTPException(status_code=400, detail="Username minimal 3 karakter")
    if len(body.password) < 6:
        raise HTTPException(status_code=400, detail="Password minimal 6 karakter")
    if await db.users.find_one({"username": uname, "role": "admin"}):
        raise HTTPException(status_code=400, detail="Username sudah dipakai")
    a = {
        "id": str(uuid.uuid4()),
        "username": uname,
        "nama": (body.nama or body.username).strip(),
        "role": "admin",
        "is_super_admin": False,
        "password_hash": hash_pw(body.password),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.users.insert_one(a)
    a.pop("password_hash", None); a.pop("_id", None)
    return a

@api_router.delete("/admin/admins/{admin_id}")
async def delete_admin(admin_id: str, admin = Depends(require_super_admin)):
    count = await db.users.count_documents({"role": "admin"})
    if count <= 1:
        raise HTTPException(status_code=400, detail="Minimal harus ada 1 admin")
    if admin_id == admin["id"]:
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun sendiri")
    target = await db.users.find_one({"id": admin_id, "role": "admin"})
    if target and target.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Tidak bisa menghapus akun Super Admin")
    res = await db.users.delete_one({"id": admin_id, "role": "admin"})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Admin tidak ditemukan")
    return {"ok": True}

# ---------- Records ----------
def _today_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")

def _validate_record_times(r: dict):
        us = tm(r.get("waktu_mulai")); ue = tm(r.get("waktu_selesai"))
        if us is None or ue is None:
            raise HTTPException(status_code=400, detail="Waktu Mulai/Selesai tidak valid")
        if ue <= us:
            raise HTTPException(status_code=400, detail="Waktu Selesai harus lebih besar dari Waktu Mulai")
        
        lains = r.get("aktivitas_lain_list") or []
        
        # Validasi antar aktivitas lain agar tidak saling tumpang tindih
        for i in range(len(lains)):
            for j in range(i + 1, len(lains)):
                li = lains[i]; lj = lains[j]
                lis = tm(li.get("waktu_mulai")); lie = tm(li.get("waktu_selesai"))
                ljs = tm(lj.get("waktu_mulai")); lje = tm(lj.get("waktu_selesai"))
                if lis is not None and lie is not None and ljs is not None and lje is not None:
                    if overlap(lis, lie, ljs, lje):
                        raise HTTPException(
                            status_code=400,
                            detail=f"Waktu Aktivitas Lain '{li.get('nama','')}' bertabrakan dengan '{lj.get('nama','')}'"
                        )

        # For lain_saja, aktivitas_lain_list items align with record time; skip inner-range check
        if r.get("type") == "lain_saja":
            return
        for l in lains:
            ls = tm(l.get("waktu_mulai")); le = tm(l.get("waktu_selesai"))
            if ls is None or le is None or le <= ls:
                raise HTTPException(status_code=400, detail=f"Waktu Aktivitas Lain '{l.get('nama','')}' tidak valid")
            if ls < us or le > ue:
                raise HTTPException(status_code=400, detail=f"Aktivitas Lain '{l.get('nama','')}' harus di dalam durasi Aktivitas Utama")

async def _check_overlap_with_existing(user_id: str, tanggal: str, record: dict, exclude_id: Optional[str] = None):
    us = tm(record.get("waktu_mulai")); ue = tm(record.get("waktu_selesai"))
    if us is None or ue is None:
        return
    is_lain = record.get("type") == "lain_saja"
    q = {"user_id": user_id, "tanggal": tanggal}
    # lain_saja overlaps only with other lain_saja (can be concurrent with utama)
    # utama/istirahat overlaps with other utama/istirahat only
    q["type"] = "lain_saja" if is_lain else {"$in": ["utama", "istirahat"]}
    if exclude_id:
        q["id"] = {"$ne": exclude_id}
    existing = await db.records.find(q, {"_id": 0}).to_list(500)
    for e in existing:
        es = tm(e.get("waktu_mulai")); ee = tm(e.get("waktu_selesai"))
        if es is None or ee is None:
            continue
        if overlap(us, ue, es, ee):
            label = e.get("aktivitas_utama") or (e.get("aktivitas_lain_list") or [{}])[0].get("nama", "Record")
            raise HTTPException(
                status_code=400,
                detail=f"Waktu bertabrakan dengan entri: {label} ({e.get('waktu_mulai')}-{e.get('waktu_selesai')})",
            )

@api_router.post("/records")
async def create_record(body: RecordCreate, user = Depends(get_current_user)):
    tanggal = body.tanggal or _today_iso()
    if body.type == "utama" and not body.aktivitas_utama:
        raise HTTPException(status_code=400, detail="Aktivitas Utama wajib diisi")
    if body.type == "lain_saja" and not body.aktivitas_lain_list:
        raise HTTPException(status_code=400, detail="Aktivitas Lain wajib diisi")
    rec = {
        "id": str(uuid.uuid4()),
        "user_id": user["id"],
        "nama": user["nama"],
        "tim": user["tim"],
        "tanggal": tanggal,
        "kode_produksi": body.kode_produksi.strip(),
        "jenis_produk": body.jenis_produk,
        "motif": body.motif,
        "size": body.size,
        "mode": body.mode,
        "type": body.type,
        "aktivitas_utama": body.aktivitas_utama if body.type == "utama" else None,
        "jumlah_per_batch": body.jumlah_per_batch if body.type == "utama" else None,
        "jumlah_per_aktivitas": body.jumlah_per_aktivitas if body.type == "utama" else None,
        "waktu_mulai": body.waktu_mulai,
        "waktu_selesai": body.waktu_selesai,
        "aktivitas_lain_list": [l.dict() for l in (body.aktivitas_lain_list or [])],
        "is_synced": False,
        "synced_at": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _validate_record_times(rec)
    await _check_overlap_with_existing(user["id"], tanggal, rec)
    if body.type == "istirahat":
        exists = await db.records.find_one({"user_id": user["id"], "tanggal": tanggal, "type": "istirahat"})
        if exists:
            raise HTTPException(status_code=400, detail="Istirahat hanya bisa 1x per hari")
    await db.records.insert_one(dict(rec))
    rec.pop("_id", None)
    return rec

@api_router.patch("/records/{rid}")
async def update_record(rid: str, body: RecordUpdate, user = Depends(get_current_user)):
    existing = await db.records.find_one({"id": rid, "user_id": user["id"]}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Record tidak ditemukan")
    if existing.get("is_synced"):
        raise HTTPException(status_code=400, detail="Record sudah disinkron. Tidak bisa diedit.")
    merged = {**existing}
    for k, v in body.dict(exclude_none=True).items():
        if k == "aktivitas_lain_list" and v is not None:
            merged[k] = [x if isinstance(x, dict) else x.dict() for x in v]
        else:
            merged[k] = v
    merged["updated_at"] = datetime.now(timezone.utc).isoformat()
    _validate_record_times(merged)
    await _check_overlap_with_existing(user["id"], existing["tanggal"], merged, exclude_id=rid)
    await db.records.update_one({"id": rid}, {"$set": {k: merged[k] for k in [
        "kode_produksi","jenis_produk","motif","size","aktivitas_utama",
        "jumlah_per_batch","jumlah_per_aktivitas","waktu_mulai","waktu_selesai",
        "aktivitas_lain_list","updated_at"
    ]}})
    return merged

@api_router.get("/records")
async def list_records(tanggal: Optional[str] = None, user = Depends(get_current_user)):
    await _purge_synced()
    q: dict = {"user_id": user["id"]}
    if tanggal:
        q["tanggal"] = tanggal
    docs = await db.records.find(q, {"_id": 0}).sort("waktu_mulai", 1).to_list(500)
    return docs

@api_router.delete("/records/{rid}")
async def delete_record(rid: str, user = Depends(get_current_user)):
    q = {"id": rid}
    if user.get("role") != "admin":
        q["user_id"] = user["id"]
        # penjahit cannot delete synced
        r = await db.records.find_one(q)
        if r and r.get("is_synced"):
            raise HTTPException(status_code=400, detail="Record sudah disinkron, tidak bisa dihapus")
    res = await db.records.delete_one(q)
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Record tidak ditemukan")
    return {"ok": True}

# ---------- Admin: records ----------
@api_router.get("/admin/records")
async def admin_records(
    tanggal: Optional[str] = None, tim: Optional[str] = None, user_id: Optional[str] = None,
    is_synced: Optional[bool] = None,
    admin = Depends(require_admin),
):
    q: dict = {}
    if tanggal: q["tanggal"] = tanggal
    if tim: q["tim"] = tim
    if user_id: q["user_id"] = user_id
    if is_synced is not None: q["is_synced"] = is_synced
    docs = await db.records.find(q, {"_id": 0}).sort([("tanggal", -1), ("waktu_mulai", 1)]).to_list(3000)
    return docs

@api_router.get("/admin/summary")
async def admin_summary(tanggal: Optional[str] = None, admin = Depends(require_admin)):
    q: dict = {}
    if tanggal: q["tanggal"] = tanggal
    docs = await db.records.find(q, {"_id": 0}).to_list(5000)
    total_utama = 0; total_lain = 0; total_out = 0
    per_p: dict = {}
    for d in docs:
        um = 0
        if d.get("aktivitas_utama"):
            um = max(0, (tm(d.get("waktu_selesai")) or 0) - (tm(d.get("waktu_mulai")) or 0))
        lm = 0
        for l in d.get("aktivitas_lain_list") or []:
            lm += max(0, (tm(l.get("waktu_selesai")) or 0) - (tm(l.get("waktu_mulai")) or 0))
        if d.get("type") == "lain_saja":
            lm = max(0, (tm(d.get("waktu_selesai")) or 0) - (tm(d.get("waktu_mulai")) or 0))
        total_utama += um; total_lain += lm
        if d.get("jumlah_per_aktivitas"):
            total_out += int(d["jumlah_per_aktivitas"])
        key = d.get("user_id") or d.get("nama")
        p = per_p.setdefault(key, {"nama": d.get("nama"), "tim": d.get("tim"),
                                   "menit_utama": 0, "menit_lain": 0, "output": 0, "records": 0})
        p["menit_utama"] += um; p["menit_lain"] += lm
        if d.get("jumlah_per_aktivitas"):
            p["output"] += int(d["jumlah_per_aktivitas"])
        p["records"] += 1
    return {
        "total_records": len(docs),
        "total_menit_utama": total_utama,
        "total_menit_lain": total_lain,
        "total_output": total_out,
        "per_penjahit": list(per_p.values()),
    }

# ---------- Admin: Sheet Config ----------
@api_router.get("/admin/sheet-config")
async def get_sheet_config(admin = Depends(require_admin)):
    cfg = await db.sheet_config.find_one({"id": "default"}, {"_id": 0, "service_account_json": 0})
    if not cfg:
        return {"configured": False}
    return {"configured": True, **{k: cfg.get(k) for k in
             ["spreadsheet_id", "sheet_name", "master_kode_tab", "master_tahapan_tab", "master_lain_tab"]}}

@api_router.post("/admin/sheet-config")
async def set_sheet_config(body: SheetConfig, admin = Depends(require_admin)):
    try:
        info = json.loads(body.service_account_json)
        if not info.get("client_email") or not info.get("private_key"):
            raise ValueError()
    except Exception:
        raise HTTPException(status_code=400, detail="Service account JSON tidak valid")
    await db.sheet_config.update_one(
        {"id": "default"},
        {"$set": {
            "id": "default",
            "spreadsheet_id": body.spreadsheet_id.strip(),
            "service_account_json": body.service_account_json,
            "sheet_name": body.sheet_name or "Sheet1",
            "master_kode_tab": body.master_kode_tab or "Kode Produksi",
            "master_tahapan_tab": body.master_tahapan_tab or "Tahapan Standar",
            "master_lain_tab": body.master_lain_tab or "Aktivitas Lain",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }}, upsert=True,
    )
    return {"ok": True}

# ---------- Admin: Sync ----------
def _detect_user_gaps(records: List[dict]) -> dict:
    """Group by (user_id, tanggal), find gaps per group. Return {nama: [{tanggal, gaps: [{from,to}]}]}"""
    groups: dict = {}
    for r in records:
        key = (r.get("user_id"), r.get("tanggal"))
        groups.setdefault(key, []).append(r)
    result: dict = {}
    for (uid, tanggal), items in groups.items():
        sorted_items = sorted(items, key=lambda x: tm(x.get("waktu_mulai")) or 0)
        gaps = []
        for i in range(1, len(sorted_items)):
            prev_end = tm(sorted_items[i - 1].get("waktu_selesai"))
            cur_start = tm(sorted_items[i].get("waktu_mulai"))
            if prev_end is not None and cur_start is not None and cur_start > prev_end:
                gaps.append({"from": sorted_items[i - 1].get("waktu_selesai"), "to": sorted_items[i].get("waktu_mulai")})
        if gaps:
            nama = items[0].get("nama", "?")
            result.setdefault(nama, []).append({"tanggal": tanggal, "gaps": gaps})
    return result

@api_router.get("/admin/sync-preview")
async def sync_preview(include_resync: bool = False, admin = Depends(require_admin)):
    """Preview what will be synced. Returns new count, resync count (if enabled), and users_with_gaps."""
    unsynced = await db.records.find({"is_synced": {"$ne": True}}, {"_id": 0}).to_list(3000)
    resync = []
    if include_resync:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
        resync = await db.records.find(
            {"is_synced": True, "synced_at": {"$gte": cutoff}}, {"_id": 0}
        ).to_list(3000)
    all_records = unsynced + resync
    users_with_gaps_dict = _detect_user_gaps(all_records)
    users_with_gaps = [{"nama": k, "entries": v} for k, v in users_with_gaps_dict.items()]
    return {
        "new_count": len(unsynced),
        "resync_count": len(resync),
        "users_with_gaps": users_with_gaps,
    }

@api_router.post("/admin/sync-records")
async def sync_records(include_resync: bool = False, force: bool = False, admin = Depends(require_admin)):
    """Push records to Google Sheet. If include_resync=true, also re-append records synced <12h ago."""
    cfg = await db.sheet_config.find_one({"id": "default"}, {"_id": 0})
    if not cfg:
        raise HTTPException(status_code=400, detail="Google Sheet belum dikonfigurasi")
    unsynced = await db.records.find({"is_synced": {"$ne": True}}, {"_id": 0}).sort("waktu_mulai", 1).to_list(3000)
    resync_records: List[dict] = []
    if include_resync:
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=12)).isoformat()
        resync_records = await db.records.find(
            {"is_synced": True, "synced_at": {"$gte": cutoff}}, {"_id": 0}
        ).sort("waktu_mulai", 1).to_list(3000)

    all_records = unsynced + resync_records
    if not all_records:
        await _purge_synced()
        return {"synced": 0, "resynced": 0, "failed": 0}

    # Sort export payload: Date asc -> Worker Name (A-Z) -> Start Time asc
    all_records.sort(key=lambda r: (r.get("tanggal") or "", (r.get("nama") or "").lower(), tm(r.get("waktu_mulai")) or 0))

    ok, fail = await _sync_records_to_sheet(all_records)
    if ok:
        now = datetime.now(timezone.utc).isoformat()
        ids = [r["id"] for r in all_records]
        await db.records.update_many(
            {"id": {"$in": ids}},
            {"$set": {"is_synced": True, "synced_at": now}},
        )
    await _purge_synced()
    return {"synced": len(unsynced) if ok else 0, "resynced": len(resync_records) if ok else 0, "failed": fail}

@api_router.post("/admin/sync-master")
async def sync_master(admin = Depends(require_admin)):
    """Pull Kode Produksi + Tahapan Standar + Aktivitas Lain from GSheet tabs."""
    cfg = await db.sheet_config.find_one({"id": "default"}, {"_id": 0})
    if not cfg:
        raise HTTPException(status_code=400, detail="Google Sheet belum dikonfigurasi")
    sa = cfg["service_account_json"]; sid = cfg["spreadsheet_id"]
    kode_tab = cfg.get("master_kode_tab") or "Kode Produksi"
    tahap_tab = cfg.get("master_tahapan_tab") or "Tahapan Standar"
    lain_tab = cfg.get("master_lain_tab") or "Aktivitas Lain"
    kode_rows: List[list] = []
    tahap_rows: List[list] = []
    lain_rows: List[list] = []
    try:
        kode_rows = await asyncio.to_thread(_read_sheet_sync, sa, sid, f"{kode_tab}!A:D")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal baca tab '{kode_tab}': {e}")
    try:
        tahap_rows = await asyncio.to_thread(_read_sheet_sync, sa, sid, f"{tahap_tab}!A:B")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Gagal baca tab '{tahap_tab}': {e}")
    try:
        lain_rows = await asyncio.to_thread(_read_sheet_sync, sa, sid, f"{lain_tab}!A:A")
    except Exception:
        # Aktivitas Lain tab is optional — if missing keep existing defaults
        lain_rows = []

    kode_docs = []
    for i, row in enumerate(kode_rows):
        if i == 0 or not row or not row[0]: continue
        kode_docs.append({
            "id": str(uuid.uuid4()),
            "kode": (row[0] or "").strip(),
            "jenis_produk": (row[1] or "").strip() if len(row) > 1 else "",
            "motif": (row[2] or "").strip() if len(row) > 2 else "",
            "size": (row[3] or "").strip() if len(row) > 3 else "",
        })
    await db.kode_produksi.delete_many({})
    if kode_docs:
        await db.kode_produksi.insert_many(kode_docs)

    tahap_docs = []
    for i, row in enumerate(tahap_rows):
        if i == 0 or not row or len(row) < 2 or not row[0] or not row[1]: continue
        tahap_docs.append({
            "id": str(uuid.uuid4()),
            "jenis_produk": (row[0] or "").strip(),
            "tahapan": (row[1] or "").strip(),
        })
    await db.tahapan_standar.delete_many({})
    if tahap_docs:
        await db.tahapan_standar.insert_many(tahap_docs)

    # Aktivitas Lain
    lain_count = 0
    if lain_rows:
        await db.master_data.delete_many({"type": "aktivitas_lain"})
        for i, row in enumerate(lain_rows):
            if i == 0 or not row or not row[0]: continue
            v = (row[0] or "").strip()
            if not v: continue
            await db.master_data.update_one(
                {"type": "aktivitas_lain", "value_lower": v.lower()},
                {"$setOnInsert": {"id": str(uuid.uuid4()), "type": "aktivitas_lain", "value": v, "value_lower": v.lower()}},
                upsert=True,
            )
            lain_count += 1

    return {
        "kode_produksi_count": len(kode_docs),
        "tahapan_count": len(tahap_docs),
        "aktivitas_lain_count": lain_count,
    }

@api_router.get("/")
async def root():
    return {"message": "Penjahit Tracker API v2"}

# ---------- Seed ----------
DEFAULT_LAIN = ["Ke Toilet", "Makan", "Sholat", "Istirahat", "Bantu Numpuk", "Ambil Bahan", "Menulis"]

async def seed_data():
    existing_super = await db.users.find_one({"role": "admin", "is_super_admin": True})
    if not existing_super:
        legacy = await db.users.find_one({"role": "admin", "username": "admin"}) \
            or await db.users.find_one({"role": "admin"}, sort=[("created_at", 1)])
        target = {
            "username": "super admin da",
            "nama": "Super Admin DA",
            "password_hash": hash_pw("aYoanalisa123*"),
            "is_super_admin": True,
        }
        if legacy:
            await db.users.update_one({"id": legacy["id"]}, {"$set": target})
            logger.info("Migrated/promoted existing admin to Super Admin DA")
        else:
            await db.users.insert_one({
                "id": str(uuid.uuid4()),
                "role": "admin",
                "created_at": datetime.now(timezone.utc).isoformat(),
                **target,
            })
            logger.info("Seeded Super Admin DA")
    for v in DEFAULT_LAIN:
        await db.master_data.update_one(
            {"type": "aktivitas_lain", "value_lower": v.lower()},
            {"$setOnInsert": {"id": str(uuid.uuid4()), "type": "aktivitas_lain", "value": v, "value_lower": v.lower()}},
            upsert=True,
        )

app.include_router(api_router)
app.add_middleware(
    CORSMiddleware, allow_credentials=True, allow_origins=["*"],
    allow_methods=["*"], allow_headers=["*"],
)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')

@app.on_event("startup")
async def on_startup():
    await seed_data()

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
