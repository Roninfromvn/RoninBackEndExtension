# app/sync_service.py
import time
import os
from typing import Dict
from sqlmodel import Session, select, delete
from datetime import datetime
from dotenv import load_dotenv

from app.models import Folder, Image
from app.drive_service import get_drive_service

load_dotenv()

# --- HELPER: Lấy danh sách file từ Drive (Tối ưu) ---
def fetch_all_files_from_drive(service, folder_id: str) -> Dict[str, dict]:
    query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
    fields = "nextPageToken, files(id, name, thumbnailLink, createdTime, mimeType)"
    drive_files = {}
    page_token = None
    
    while True:
        try:
            response = service.files().list(q=query, fields=fields, pageSize=1000, pageToken=page_token).execute()
            for f in response.get('files', []):
                drive_files[f['id']] = {
                    "name": f.get('name'),
                    "thumbnail": f.get('thumbnailLink'),
                    "mime": f.get('mimeType'),
                    "created": f.get('createdTime')
                }
            page_token = response.get('nextPageToken')
            if not page_token: break
        except Exception as e:
            print(f"⚠️ Lỗi fetch Drive (Folder {folder_id}): {e}")
            break
    return drive_files

# ======================================================
# PHA 1: ĐỒNG BỘ CẤU TRÚC (FOLDERS)
# ======================================================
def sync_folder_structure(session: Session):
    """Đồng bộ danh sách Folder: Thêm mới, Xóa cũ, Cập nhật tên."""
    root_id = os.getenv("GOOGLE_DRIVE_ROOT_FOLDER_ID")
    if not root_id:
        print("⚠️ Lỗi: Thiếu Root ID trong .env")
        return

    print(f"🏗️ [Phase 1] Sync Structure từ Root: {root_id}...")
    service = get_drive_service()
    
    # 1. Lấy Drive Data
    drive_folders_map = {}
    try:
        query = f"'{root_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        response = service.files().list(q=query, fields="files(id, name, createdTime)", pageSize=1000).execute()
        for f in response.get('files', []):
            drive_folders_map[f['id']] = f
    except Exception as e:
        print(f"❌ [Phase 1] Lỗi Drive API: {e}")
        return

    drive_ids = set(drive_folders_map.keys())

    # 2. Lấy DB Data (Chỉ lấy folder thuộc root này)
    db_folders = session.exec(select(Folder).where(Folder.parent_id == root_id)).all()
    db_map = {f.id: f for f in db_folders}
    db_ids = set(db_map.keys())

    # 3. Tính toán chênh lệch
    ids_to_insert = drive_ids - db_ids
    ids_to_delete = db_ids - drive_ids
    
    # Check đổi tên
    ids_to_check = drive_ids.intersection(db_ids)
    count_update = 0
    for fid in ids_to_check:
        new_name = drive_folders_map[fid]['name']
        if db_map[fid].name != new_name:
            db_map[fid].name = new_name
            session.add(db_map[fid])
            count_update += 1

    # 4. Thực thi
    # A. Xóa Folder rác (Xóa cả ảnh bên trong)
    if ids_to_delete:
        delete_ids = list(ids_to_delete)
        session.exec(delete(Image).where(Image.folder_id.in_(delete_ids))) # Xóa ảnh trước
        session.exec(delete(Folder).where(Folder.id.in_(delete_ids)))      # Xóa folder sau

    # B. Thêm Folder mới
    if ids_to_insert:
        new_folders = []
        for fid in ids_to_insert:
            info = drive_folders_map[fid]
            created_at = None
            if info.get('createdTime'):
                try: created_at = datetime.fromisoformat(info['createdTime'].replace("Z", "+00:00"))
                except: pass
            
            new_folders.append(Folder(id=fid, name=info['name'], parent_id=root_id, created_time=created_at))
        session.bulk_save_objects(new_folders)

    session.commit()
    print(f"   📊 Kết quả: +{len(ids_to_insert)} mới | -{len(ids_to_delete)} xóa | ✏️ {count_update} đổi tên")

# ======================================================
# PHA 2: ĐỒNG BỘ NỘI DUNG (IMAGES)
# ======================================================
def sync_images_in_folder(session: Session, folder_id: str):
    start_time = time.time()
    service = get_drive_service()
    
    # 1. Drive Data
    drive_map = fetch_all_files_from_drive(service, folder_id)
    drive_ids = set(drive_map.keys())
    
    # 2. DB Data
    db_ids = set(session.exec(select(Image.id).where(Image.folder_id == folder_id)).all())
    
    # 3. Diff
    ids_to_insert = drive_ids - db_ids
    ids_to_delete = db_ids - drive_ids
    
    # 4. Action
    if ids_to_delete:
        delete_list = list(ids_to_delete)
        for i in range(0, len(delete_list), 1000): # Chunk 1000 để tránh lỗi SQL
            chunk = delete_list[i:i+1000]
            session.exec(delete(Image).where(Image.id.in_(chunk)))
    
    if ids_to_insert:
        new_objects = []
        for fid in ids_to_insert:
            info = drive_map[fid]
            created_dt = None
            if info['created']:
                try: created_dt = datetime.fromisoformat(info['created'].replace("Z", "+00:00"))
                except: pass

            img = Image(
                id=fid, name=info['name'], thumbnail_link=info['thumbnail'],
                mime_type=info['mime'], created_time=created_dt, folder_id=folder_id
            )
            new_objects.append(img)
        session.bulk_save_objects(new_objects)

    session.commit()
    return {
        "inserted": len(ids_to_insert),
        "deleted": len(ids_to_delete),
        "total": len(drive_ids),
        "duration": round(time.time() - start_time, 2)
    }

# ======================================================
# SYNC ALL (TUẦN TỰ)
# ======================================================
def sync_all_folders(session: Session):
    print("🚀 START SYNC ALL...")
    sync_folder_structure(session) # Pha 1
    
    folders = session.exec(select(Folder)).all() # Pha 2
    results = []
    
    print(f"\n📸 [Phase 2] Quét ảnh cho {len(folders)} folders...")
    for f in folders:
        try:
            res = sync_images_in_folder(session, f.id)
            print(f"   📂 {f.name}: +{res['inserted']} | -{res['deleted']} ({res['duration']}s)")
            results.append({**res, "folder": f.name})
        except Exception as e:
            print(f"   ❌ Lỗi folder {f.name}: {e}")
        time.sleep(0.5)
        
    print("🏁 DONE.")
    return results