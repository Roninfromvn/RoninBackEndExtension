from sqlmodel import Session, select
from app.models import Folder, Image
from app.drive_service import get_drive_service
from datetime import datetime

def sync_images_in_folder(session: Session, folder_id: str):
    """
    Đồng bộ toàn diện: Thêm mới, Cập nhật và XÓA file rác.
    """
    drive_service = get_drive_service()
    
    # --- BƯỚC 1: LẤY DANH SÁCH THỰC TẾ TỪ DRIVE ---
    print(f"   --> Đang tải danh sách từ Google Drive...")
    query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false"
    
    drive_files_map = {} # Dùng dict để tra cứu cho nhanh: { "file_id": file_data }
    page_token = None
    
    try:
        while True:
            response = drive_service.files().list(
                q=query,
                fields="nextPageToken, files(id, name, mimeType, thumbnailLink, createdTime)",
                pageSize=1000,
                pageToken=page_token
            ).execute()
            
            files = response.get('files', [])
            for f in files:
                drive_files_map[f['id']] = f
                
            page_token = response.get('nextPageToken')
            if not page_token:
                break
    except Exception as e:
        print(f"   ❌ Lỗi khi gọi Google API: {e}")
        return 0, 0 # Trả về 0 update, 0 delete
    
    # --- BƯỚC 2: CẬP NHẬT / THÊM MỚI VÀO DB (UPSERT) ---
    upsert_count = 0
    for file_id, file_data in drive_files_map.items():
        # Xử lý thời gian
        created_at = None
        if file_data.get('createdTime'):
            try:
                dt_str = file_data.get('createdTime').replace('Z', '+00:00')
                created_at = datetime.fromisoformat(dt_str)
            except: pass

        img = Image(
            id=file_id,
            name=file_data.get('name'),
            mime_type=file_data.get('mimeType'),
            thumbnail_link=file_data.get('thumbnailLink'),
            created_time=created_at,
            folder_id=folder_id
        )
        session.merge(img)
        upsert_count += 1
    
    # --- BƯỚC 3: XỬ LÝ XÓA (DELETE) ---
    # Lấy tất cả ảnh mà DB đang nghĩ là thuộc folder này
    db_images = session.exec(select(Image).where(Image.folder_id == folder_id)).all()
    
    delete_count = 0
    for db_img in db_images:
        # Nếu ảnh trong DB không nằm trong danh sách vừa lấy từ Drive
        if db_img.id not in drive_files_map:
            print(f"   🗑️ Phát hiện ảnh đã bị xóa/di chuyển: {db_img.name} ({db_img.id}) -> Xóa khỏi DB.")
            session.delete(db_img)
            delete_count += 1

    session.commit()
    
    return upsert_count, delete_count