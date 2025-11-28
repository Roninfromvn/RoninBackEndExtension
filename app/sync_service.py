# app/sync_service.py
import time
import os
from typing import List, Set, Dict
from sqlmodel import Session, select, delete
from datetime import datetime
from dotenv import load_dotenv

from app.models import Folder, Image
from app.drive_service import get_drive_service

# Load biến môi trường
load_dotenv()

# ======================================================
# PHA 1: ĐỒNG BỘ CẤU TRÚC (FOLDERS)
# ======================================================
def sync_folder_structure(session: Session):
    """
    Đảm bảo DB có đúng danh sách folder như trên Drive.
    Xử lý cả 2 chiều: THÊM folder mới và XÓA folder cũ.
    """
    root_id = os.getenv("GOOGLE_DRIVE_ROOT_FOLDER_ID")
    if not root_id:
        print("⚠️ [Phase 1] Lỗi: Thiếu Root ID trong .env")
        return

    print(f"🏗️ [Phase 1] Đang đồng bộ cấu trúc Folder từ Root: {root_id}...")
    service = get_drive_service()
    
    # 1. Lấy danh sách Folder trên Drive (Set A)
    drive_folders_map = {}
    try:
        query = f"'{root_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        response = service.files().list(
            q=query,
            fields="files(id, name, createdTime)",
            pageSize=1000
        ).execute()
        
        for f in response.get('files', []):
            drive_folders_map[f['id']] = f
            
    except Exception as e:
        print(f"❌ [Phase 1] Lỗi gọi Google API: {e}")
        return

    drive_ids = set(drive_folders_map.keys())

    # 2. Lấy danh sách Folder trong DB (Set B)
    # Lưu ý: Chỉ lấy những folder thuộc Root ID này (để tránh xóa nhầm folder hệ thống khác nếu có)
    db_folders = session.exec(select(Folder).where(Folder.parent_id == root_id)).all()
    db_ids = set(f.id for f in db_folders)

    # 3. Tính toán chênh lệch
    ids_to_insert = drive_ids - db_ids
    ids_to_delete = db_ids - drive_ids

    print(f"   📊 Folder: +{len(ids_to_insert)} mới | -{len(ids_to_delete)} xóa")

    # 4. Thực thi
    
    # A. XÓA FOLDER RÁC (Khi xóa Folder, phải xóa luôn ảnh thuộc về nó)
    if ids_to_delete:
        # Bước A1: Xóa ảnh trước (Clean up orphan images)
        statement_img = delete(Image).where(Image.folder_id.in_(list(ids_to_delete)))
        session.exec(statement_img)
        
        # Bước A2: Xóa folder
        statement_folder = delete(Folder).where(Folder.id.in_(list(ids_to_delete)))
        session.exec(statement_folder)
        print(f"   🗑️ Đã xóa {len(ids_to_delete)} folder rác và toàn bộ ảnh bên trong.")

    # B. THÊM FOLDER MỚI
    if ids_to_insert:
        new_folders = []
        for fid in ids_to_insert:
            info = drive_folders_map[fid]
            # Parse time
            created_at = None
            if info.get('createdTime'):
                try: created_at = datetime.fromisoformat(info['createdTime'].replace("Z", "+00:00"))
                except: pass
            
            new_f = Folder(
                id=fid,
                name=info['name'],
                parent_id=root_id,
                created_time=created_at
            )
            new_folders.append(new_f)
        
        session.bulk_save_objects(new_folders)
        print(f"   ✅ Đã thêm {len(new_folders)} folder mới.")

    session.commit()


# ======================================================
# PHA 2: ĐỒNG BỘ NỘI DUNG (IMAGES)
# ======================================================

# Helper function
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
        # Batch delete 1000 items
        delete_list = list(ids_to_delete)
        for i in range(0, len(delete_list), 1000):
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
                id=fid,
                name=info['name'],
                thumbnail_link=info['thumbnail'],
                mime_type=info['mime'],
                created_time=created_dt,
                folder_id=folder_id
            )
            new_objects.append(img)
        session.bulk_save_objects(new_objects)

    session.commit()
    duration = time.time() - start_time
    
    return {
        "inserted": len(ids_to_insert),
        "deleted": len(ids_to_delete),
        "total": len(drive_ids),
        "duration": round(duration, 2)
    }

# ======================================================
# CHỨC NĂNG TỔNG HỢP (MAIN ENTRY POINT)
# ======================================================
def sync_all_folders(session: Session):
    print("🚀 BẮT ĐẦU QUY TRÌNH SYNC TOÀN DIỆN...")
    
    # BƯỚC 1: Cấu trúc (Folders)
    sync_folder_structure(session)
    
    # BƯỚC 2: Nội dung (Images)
    # Lấy lại danh sách folder sau khi đã sync ở bước 1
    folders = session.exec(select(Folder)).all()
    results = []
    
    print(f"\n📸 [Phase 2] Bắt đầu quét ảnh cho {len(folders)} folders...")
    
    for f in folders:
        print(f"\n📂 [{f.name}]")
        try:
            res = sync_images_in_folder(session, f.id)
            print(f"   ✅ +{res['inserted']} | -{res['deleted']} | Tổng: {res['total']} (trong {res['duration']}s)")
            results.append({**res, "folder": f.name, "folder_id": f.id})
        except Exception as e:
            print(f"   ❌ Lỗi: {e}")
        
        time.sleep(0.5) # Tránh Rate Limit
        
    print("\n🏁 HOÀN TẤT TOÀN BỘ.")
    return results