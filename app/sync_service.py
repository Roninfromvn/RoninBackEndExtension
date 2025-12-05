# app/sync_service.py

import os
import logging
from typing import Dict, List, Optional
from datetime import datetime
from sqlmodel import Session, select

from app.models import Folder, Image
from app.drive_service import get_drive_service, download_image_from_drive

# Đường dẫn gốc để lưu ảnh
STATIC_DIR = "static_images"

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def parse_drive_datetime(iso_string: Optional[str]) -> Optional[datetime]:
    """
    Parse datetime từ Google Drive ISO format
    
    Drive format: "2024-09-15T14:23:45.123Z"
    
    Args:
        iso_string: ISO datetime string từ Drive
        
    Returns:
        datetime object hoặc None nếu invalid
    """
    if not iso_string:
        return None
    
    try:
        # Replace 'Z' với '+00:00' để parse UTC
        return datetime.fromisoformat(iso_string.replace('Z', '+00:00'))
    except (ValueError, AttributeError) as e:
        logger.warning(f"⚠️ Không parse được datetime: {iso_string} - {e}")
        return None


def ensure_extension(filename: str, mime_type: str) -> str:
    """
    Đảm bảo file có extension đúng
    
    Args:
        filename: Tên file gốc
        mime_type: MIME type từ Drive
        
    Returns:
        Filename với extension hợp lệ
    """
    # Nếu đã có extension hợp lệ, giữ nguyên
    if filename.lower().endswith(('.jpg', '.jpeg', '.png', '.gif', '.webp')):
        return filename
    
    # Thêm extension theo mime_type
    ext_map = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp'
    }
    
    ext = ext_map.get(mime_type, '.jpg')  # Default .jpg
    return f"{filename}{ext}"


def sync_folder_structure(session: Session, root_folder_name: str = "RONIN_CMS") -> Dict:
    """
    Quét các thư mục từ Drive và lưu vào DB (Folder table)
    
    ✅ THÊM MỚI: Folders từ Drive
    ✅ CẬP NHẬT: Tên folder nếu đổi
    ✅ XÓA: Folders không còn trên Drive (CASCADE xóa images)
    
    Args:
        session: Database session
        root_folder_name: Tên folder gốc trên Drive
        
    Returns:
        Dict với thống kê sync
    """
    try:
        service = get_drive_service()

        # 1. Tìm folder gốc RONIN_CMS
        query = f"mimeType='application/vnd.google-apps.folder' and name='{root_folder_name}' and trashed=false"
        results = service.files().list(q=query, fields="files(id, name)").execute()
        items = results.get("files", [])

        if not items:
            logger.warning(f"⚠️ Không tìm thấy folder {root_folder_name} trên Drive!")
            return {
                "success": False,
                "message": f"Folder {root_folder_name} not found"
            }

        parent_id = items[0]["id"]
        logger.info(f"✅ Tìm thấy folder gốc: {root_folder_name} (ID: {parent_id})")

        # 2. Liệt kê các folder con với PAGINATION
        all_folders = []
        page_token = None
        
        while True:
            q_sub = f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
            results = service.files().list(
                q=q_sub,
                fields="nextPageToken, files(id, name, createdTime)",
                pageSize=1000,  # Max allowed
                pageToken=page_token
            ).execute()
            
            folders = results.get("files", [])
            all_folders.extend(folders)
            
            page_token = results.get("nextPageToken")
            if not page_token:
                break
            
            logger.info(f"📄 Đã load {len(all_folders)} folders...")

        logger.info(f"📊 Tổng số folders: {len(all_folders)}")

        # 3. Lấy danh sách folder IDs từ Drive và DB
        drive_folder_ids = {f["id"] for f in all_folders}
        
        db_folders = session.exec(select(Folder)).all()
        db_folder_ids = {f.id for f in db_folders}
        db_folder_map = {f.id: f for f in db_folders}

        new_count = 0
        updated_count = 0
        deleted_count = 0

        # 4. THÊM MỚI hoặc CẬP NHẬT folders
        for f in all_folders:
            db_folder = db_folder_map.get(f["id"])
            
            if not db_folder:
                # Thêm mới
                db_folder = Folder(
                    id=f["id"],
                    name=f["name"],
                    created_time=parse_drive_datetime(f.get("createdTime"))
                )
                session.add(db_folder)
                new_count += 1
                logger.info(f"➕ Thêm folder mới: {f['name']}")
            else:
                # Cập nhật nếu tên thay đổi
                if db_folder.name != f["name"]:
                    db_folder.name = f["name"]
                    session.add(db_folder)
                    updated_count += 1
                    logger.info(f"🔄 Cập nhật folder: {f['name']}")

        # 5. XÓA folders không còn tồn tại trên Drive
        folders_to_delete = db_folder_ids - drive_folder_ids
        
        for folder_id in folders_to_delete:
            db_folder = db_folder_map.get(folder_id)
            if db_folder:
                logger.info(f"🗑️ Xóa folder: {db_folder.name} (không còn trên Drive)")
                
                # Xóa tất cả images trong folder
                images_in_folder = session.exec(
                    select(Image).where(Image.folder_id == folder_id)
                ).all()
                
                for img in images_in_folder:
                    # Xóa file local nếu tồn tại
                    local_file_path = os.path.join(STATIC_DIR, folder_id, img.name)
                    if os.path.exists(local_file_path):
                        try:
                            os.remove(local_file_path)
                            logger.debug(f"  🗑️ Xóa file: {img.name}")
                        except Exception as e:
                            logger.warning(f"  ⚠️ Không xóa được file {img.name}: {e}")
                    
                    session.delete(img)
                
                # Xóa folder record
                session.delete(db_folder)
                deleted_count += 1
                
                # Xóa thư mục local nếu tồn tại
                local_folder_path = os.path.join(STATIC_DIR, folder_id)
                if os.path.exists(local_folder_path):
                    try:
                        if not os.listdir(local_folder_path):  # Nếu rỗng
                            os.rmdir(local_folder_path)
                            logger.debug(f"  🗑️ Xóa thư mục local rỗng")
                    except Exception as e:
                        logger.warning(f"  ⚠️ Không xóa được thư mục: {e}")

        session.commit()
        
        result = {
            "success": True,
            "total_folders": len(all_folders),
            "new_folders": new_count,
            "updated_folders": updated_count,
            "deleted_folders": deleted_count
        }
        
        logger.info(f"✅ Sync folders hoàn tất: {result}")
        return result

    except Exception as e:
        logger.error(f"❌ Lỗi sync folder structure: {str(e)}", exc_info=True)
        session.rollback()
        return {
            "success": False,
            "error": str(e)
        }


def sync_images_in_folder(session: Session, folder_id: str) -> Dict:
    """
    Sync ảnh trong một folder cụ thể
    
    ✅ THÊM MỚI: Ảnh từ Drive
    ✅ CẬP NHẬT: Thông tin ảnh đã có (name, created_time, mime_type)
    ✅ XÓA: Ảnh không còn trên Drive
    ✅ DOWNLOAD: File về local nếu chưa có
    
    Args:
        session: Database session
        folder_id: Google Drive folder ID
        
    Returns:
        Dict với thống kê sync
    """
    try:
        service = get_drive_service()

        # Tạo thư mục local
        local_folder_path = os.path.join(STATIC_DIR, folder_id)
        os.makedirs(local_folder_path, exist_ok=True)

        # 1. Query lấy ảnh với PAGINATION
        # ✅ GIỮ NGUYÊN: mimeType contains 'image/' (ĐÚNG!)
        query = f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false"
        
        all_files = []
        page_token = None
        
        while True:
            results = service.files().list(
                q=query,
                fields="nextPageToken, files(id, name, mimeType, thumbnailLink, createdTime)",
                pageSize=1000,  # Max allowed
                pageToken=page_token
            ).execute()
            
            files = results.get("files", [])
            all_files.extend(files)
            
            page_token = results.get("nextPageToken")
            if not page_token:
                break
            
            logger.debug(f"📄 Đã load {len(all_files)} ảnh...")

        logger.info(f"📊 Tổng số ảnh trong folder: {len(all_files)}")

        # 2. Lấy danh sách image IDs từ Drive và DB
        drive_image_ids = {f["id"] for f in all_files}
        drive_image_map = {f["id"]: f for f in all_files}
        
        db_images = session.exec(
            select(Image).where(Image.folder_id == folder_id)
        ).all()
        db_image_ids = {img.id for img in db_images}
        db_image_map = {img.id: img for img in db_images}

        synced_count = 0
        updated_count = 0
        deleted_count = 0
        downloaded_count = 0

        # 3. THÊM MỚI hoặc CẬP NHẬT ảnh
        for f in all_files:
            # ✅ GIỮ NGUYÊN tên từ Drive (KHÔNG tự thêm extension)
            drive_name = f["name"]
            
            db_img = db_image_map.get(f["id"])
            
            if not db_img:
                # Thêm mới
                db_img = Image(
                    id=f["id"],
                    name=drive_name,  # ✅ Tên gốc từ Drive
                    folder_id=folder_id,
                    mime_type=f.get("mimeType"),
                    thumbnail_link=f.get("thumbnailLink"),
                    created_time=parse_drive_datetime(f.get("createdTime"))
                )
                session.add(db_img)
                synced_count += 1
                logger.debug(f"➕ Thêm ảnh mới: {drive_name}")
            else:
                # Cập nhật nếu có thay đổi
                changed = False
                
                if db_img.name != drive_name:
                    # Đổi tên file local nếu Drive đổi tên
                    old_path = os.path.join(local_folder_path, db_img.name)
                    new_path = os.path.join(local_folder_path, drive_name)
                    
                    renamed = False
                    if os.path.exists(old_path) and not os.path.exists(new_path):
                        try:
                            os.rename(old_path, new_path)
                            renamed = True
                            logger.info(f"📝 Đổi tên file: {db_img.name} → {drive_name}")
                        except Exception as e:
                            logger.warning(f"⚠️ Không đổi tên được: {e}")
                    
                    # Chỉ update DB nếu rename thành công hoặc file cũ không tồn tại
                    if renamed or not os.path.exists(old_path):
                        db_img.name = drive_name
                        changed = True
                
                if db_img.mime_type != f.get("mimeType"):
                    db_img.mime_type = f.get("mimeType")
                    changed = True
                
                if db_img.thumbnail_link != f.get("thumbnailLink"):
                    db_img.thumbnail_link = f.get("thumbnailLink")
                    changed = True
                
                # Update created_time nếu chưa có
                if not db_img.created_time and f.get("createdTime"):
                    db_img.created_time = parse_drive_datetime(f.get("createdTime"))
                    changed = True
                
                if changed:
                    session.add(db_img)
                    updated_count += 1

        session.commit()
        logger.info(f"💾 Đã sync DB: {synced_count} mới, {updated_count} cập nhật")
        images_to_delete = db_image_ids - drive_image_ids
        
        for img_id in images_to_delete:
            db_img = db_image_map.get(img_id)
            if db_img:
                logger.info(f"🗑️ Xóa ảnh: {db_img.name} (không còn trên Drive)")
                
                # Xóa file local
                local_file_path = os.path.join(local_folder_path, db_img.name)
                if os.path.exists(local_file_path):
                    try:
                        os.remove(local_file_path)
                        logger.debug(f"  🗑️ Đã xóa file local")
                    except Exception as e:
                        logger.warning(f"  ⚠️ Không xóa được file: {e}")
                
                # Xóa record trong DB
                session.delete(db_img)
                deleted_count += 1
        
        # 5. DOWNLOAD files về local (chỉ file chưa có)
        # ✅ Dùng ensure_extension CHỈ cho local filename, KHÔNG lưu DB
        files_to_download = []
        for f in all_files:
            drive_name = f["name"]
            
            # Normalize local filename (thêm extension nếu thiếu)
            local_filename = ensure_extension(drive_name, f.get("mimeType", "image/jpeg"))
            file_path = os.path.join(local_folder_path, local_filename)
            
            if not os.path.exists(file_path):
                files_to_download.append((f["id"], local_filename))
        
        logger.info(f"📥 Cần tải về: {len(files_to_download)} file")

        for file_id, filename in files_to_download:
            try:
                logger.info(f"⬇️ Đang tải: {filename}...")
                file_stream = download_image_from_drive(file_id)
                
                if file_stream:
                    file_path = os.path.join(local_folder_path, filename)
                    with open(file_path, "wb") as local_file:
                        local_file.write(file_stream.getbuffer())
                    downloaded_count += 1
                    logger.info(f"✅ Đã tải: {filename}")
                else:
                    logger.error(f"❌ Không thể tải: {filename}")
            except Exception as e:
                logger.error(f"❌ Lỗi tải {filename}: {str(e)}")

        # Commit tất cả thay đổi một lần cuối
        session.commit()
        
        if deleted_count > 0:
            logger.info(f"🗑️ Đã xóa {deleted_count} ảnh khỏi DB và local")

        result = {
            "success": True,
            "folder_id": folder_id,
            "total_images": len(all_files),
            "new_db_records": synced_count,
            "updated_db_records": updated_count,
            "deleted_db_records": deleted_count,
            "downloaded_files": downloaded_count,
            "skipped_files": len(all_files) - len(files_to_download)
        }
        
        logger.info(f"✅ Sync folder hoàn tất: {result}")
        return result

    except Exception as e:
        logger.error(f"❌ Lỗi sync images trong folder {folder_id}: {str(e)}", exc_info=True)
        session.rollback()
        return {
            "success": False,
            "folder_id": folder_id,
            "error": str(e)
        }


def sync_all_folders(session: Session) -> List[Dict]:
    """
    Sync tất cả folders và images
    
    FLOW:
    1. Sync folder structure trước (thêm/xóa/cập nhật folders)
    2. Sync images trong từng folder
    
    Returns:
        List các kết quả sync
    """
    logger.info("🔄 ============================================")
    logger.info("🔄 BẮT ĐẦU SYNC TẤT CẢ FOLDERS VÀ IMAGES")
    logger.info("🔄 ============================================")
    
    # BƯỚC 1: Sync folder structure
    logger.info("📁 BƯỚC 1: Đang sync cấu trúc folders...")
    folder_sync_result = sync_folder_structure(session)
    
    if not folder_sync_result.get("success"):
        logger.error("❌ Lỗi khi sync folder structure, dừng lại!")
        return [folder_sync_result]
    
    logger.info(f"""
    ✅ Hoàn thành sync folders:
    - Thêm mới: {folder_sync_result.get('new_folders', 0)}
    - Cập nhật: {folder_sync_result.get('updated_folders', 0)}
    - Xóa: {folder_sync_result.get('deleted_folders', 0)}
    """)
    
    # BƯỚC 2: Sync images trong từng folder
    logger.info("🖼️ BƯỚC 2: Đang sync images trong từng folder...")
    folders = session.exec(select(Folder)).all()
    logger.info(f"📁 Tổng số folders cần sync: {len(folders)}")
    
    results = [folder_sync_result]
    
    for i, folder in enumerate(folders, 1):
        logger.info(f"📁 [{i}/{len(folders)}] Đang sync folder: {folder.name} (ID: {folder.id})")
        result = sync_images_in_folder(session, folder.id)
        results.append(result)
    
    # Tổng hợp thống kê
    total_images = sum(r.get("total_images", 0) for r in results if "total_images" in r)
    total_downloaded = sum(r.get("downloaded_files", 0) for r in results if "downloaded_files" in r)
    total_new_db = sum(r.get("new_db_records", 0) for r in results if "new_db_records" in r)
    total_updated_db = sum(r.get("updated_db_records", 0) for r in results if "updated_db_records" in r)
    total_deleted_db = sum(r.get("deleted_db_records", 0) for r in results if "deleted_db_records" in r)
    
    logger.info(f"""
    ✅ ✅ ✅ HOÀN TẤT SYNC TẤT CẢ ✅ ✅ ✅
    
    📊 FOLDERS:
    - Folders hiện có: {len(folders)}
    - Thêm mới: {folder_sync_result.get('new_folders', 0)}
    - Cập nhật: {folder_sync_result.get('updated_folders', 0)}
    - Xóa: {folder_sync_result.get('deleted_folders', 0)}
    
    📊 IMAGES:
    - Tổng ảnh: {total_images}
    - Ảnh mới trong DB: {total_new_db}
    - Ảnh cập nhật: {total_updated_db}
    - Ảnh xóa: {total_deleted_db}
    - File đã tải về: {total_downloaded}
    """)
    
    return results