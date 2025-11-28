# app/sync_service.py
import time
from typing import List, Set, Dict
from sqlmodel import Session, select, delete
from app.models import Folder, Image
from app.drive_service import get_drive_service

# --- PHẦN 1: HELPER LẤY DỮ LIỆU DRIVE (Tối ưu tốc độ) ---
def fetch_all_files_from_drive(service, folder_id: str) -> Dict[str, dict]:
    """
    Lấy toàn bộ file trong folder Drive.
    Trả về Dictionary: { "file_id": { "name": "...", "thumbnail": "..." } }
    Dùng Pagination để lấy không giới hạn số lượng.
    """
    query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
    # Chỉ lấy 3 trường cần thiết để nhẹ gánh băng thông
    fields = "nextPageToken, files(id, name, thumbnailLink)"
    
    drive_files = {}
    page_token = None
    
    while True:
        try:
            response = service.files().list(
                q=query,
                fields=fields,
                pageSize=1000, # Lấy tối đa mỗi lần gọi
                pageToken=page_token
            ).execute()
            
            for f in response.get('files', []):
                drive_files[f['id']] = {
                    "name": f.get('name'),
                    "thumbnail": f.get('thumbnailLink')
                }
                
            page_token = response.get('nextPageToken')
            if not page_token:
                break
        except Exception as e:
            print(f"⚠️ Lỗi fetch Drive (Folder {folder_id}): {e}")
            break
            
    return drive_files

# --- PHẦN 2: LOGIC SYNC CỐT LÕI (Set Comparison) ---
def sync_images_in_folder(session: Session, folder_id: str):
    """
    Đồng bộ 1 Folder theo chiến thuật So sánh Tập hợp.
    """
    start_time = time.time()
    service = get_drive_service()
    
    print(f"   📥 [1/3] Đang tải danh sách từ Drive...")
    # 1. Lấy tập dữ liệu từ Drive (Set A)
    drive_map = fetch_all_files_from_drive(service, folder_id)
    drive_ids = set(drive_map.keys())
    
    print(f"   💾 [2/3] Đang lấy dữ liệu từ DB...")
    # 2. Lấy tập dữ liệu từ DB (Set B)
    # Chỉ select cột ID để tiết kiệm RAM
    db_ids = set(session.exec(select(Image.id).where(Image.folder_id == folder_id)).all())
    
    # 3. Tính toán chênh lệch (Set Operations) - Cực nhanh
    ids_to_insert = drive_ids - db_ids  # Có trên Drive, chưa có DB
    ids_to_delete = db_ids - drive_ids  # Có trên DB, đã mất trên Drive
    
    # ids_to_update = drive_ids.intersection(db_ids) # (Optional) Dành cho việc update thumbnail link
    
    print(f"   ⚙️ [3/3] Xử lý: +{len(ids_to_insert)} mới | -{len(ids_to_delete)} xóa")

    # 4. Thực thi Bulk Action
    
    # A. XÓA (Bulk Delete)
    if ids_to_delete:
        # Chia nhỏ ra xóa nếu danh sách quá lớn (tránh lỗi SQL limit)
        chunk_size = 1000
        delete_list = list(ids_to_delete)
        for i in range(0, len(delete_list), chunk_size):
            chunk = delete_list[i:i + chunk_size]
            statement = delete(Image).where(Image.id.in_(chunk))
            session.exec(statement)
    
    # B. THÊM MỚI (Bulk Insert)
    if ids_to_insert:
        new_objects = []
        for fid in ids_to_insert:
            info = drive_map[fid]
            img = Image(
                id=fid,
                name=info['name'],
                thumbnail_link=info['thumbnail'],
                folder_id=folder_id
                # mime_type và created_time tạm bỏ qua để tăng tốc, hoặc fetch kỹ hơn nếu cần
            )
            new_objects.append(img)
        
        # Lưu một cục xuống DB
        session.bulk_save_objects(new_objects)

    # C. UPDATE (Optional - Cập nhật thumbnail link cho ảnh cũ)
    # Phần này nếu làm kỹ sẽ chậm, tạm thời bỏ qua như bạn yêu cầu.
    # Nếu muốn update: session.exec(update(Image)...)

    session.commit()
    duration = time.time() - start_time
    return {
        "inserted": len(ids_to_insert),
        "deleted": len(ids_to_delete),
        "total_active": len(drive_ids),
        "duration": round(duration, 2)
    }

# --- PHẦN 3: SYNC TOÀN BỘ (Chạy tuần tự) ---
def sync_all_folders(session: Session):
    """
    Quét lần lượt các folder trong DB.
    """
    folders = session.exec(select(Folder)).all()
    results = []
    
    print(f"🚀 Bắt đầu Sync All ({len(folders)} folders)...")
    
    for f in folders:
        # Bỏ qua các folder chưa có tên chuẩn (VD: Root) nếu cần
        print(f"\n📂 Sync Folder: {f.name} ({f.id})")
        try:
            res = sync_images_in_folder(session, f.id)
            print(f"   ✅ Xong trong {res['duration']}s")
            results.append({**res, "folder": f.name})
        except Exception as e:
            print(f"   ❌ Lỗi: {e}")
        
        # Nghỉ 1 chút để server và Google không bị quá tải
        time.sleep(0.5)
        
    return results