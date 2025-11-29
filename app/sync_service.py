# app/sync_service.py

import os
from sqlmodel import Session, select

from app.models import Folder, Image
from app.drive_service import get_drive_service, download_image_from_drive

# Đường dẫn gốc để lưu ảnh
STATIC_DIR = "static_images"


def sync_folder_structure(session: Session):
    """Quét các thư mục từ Drive và lưu vào DB (Folder table)"""
    service = get_drive_service()

    # Tìm folder gốc RONIN_CMS (Bạn cần ID của folder gốc hoặc query theo tên)
    # Ở đây giả sử query theo tên để tìm folder mẹ
    query = "mimeType='application/vnd.google-apps.folder' and name='RONIN_CMS' and trashed=false"
    results = service.files().list(q=query, fields="files(id, name)").execute()
    items = results.get("files", [])

    if not items:
        print("⚠️ Không tìm thấy folder RONIN_CMS trên Drive!")
        return

    parent_id = items[0]["id"]

    # Liệt kê các folder con (Mèo, Gái xinh...)
    q_sub = (
        f"'{parent_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false"
    )
    folders = (
        service.files()
        .list(q=q_sub, fields="files(id, name, createdTime)")
        .execute()
        .get("files", [])
    )

    for f in folders:
        # Check DB
        db_folder = session.get(Folder, f["id"])
        if not db_folder:
            db_folder = Folder(id=f["id"], name=f["name"])
            session.add(db_folder)
        else:
            db_folder.name = f["name"]
            session.add(db_folder)

    session.commit()
    print(f"✅ Đã sync {len(folders)} folders.")


def sync_images_in_folder(session: Session, folder_id: str):
    """
    1. Lấy list ảnh từ Drive trong folder_id
    2. Lưu vào DB
    3. Tải file về local disk (static_images/{folder_id}/{filename})
    """

    service = get_drive_service()

    # Tạo thư mục local tương ứng với folder_id
    local_folder_path = os.path.join(STATIC_DIR, folder_id)
    os.makedirs(local_folder_path, exist_ok=True)

    # Query lấy ảnh
    query = (
        f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false"
    )
    results = (
        service.files()
        .list(
            q=query,
            fields="files(id, name, thumbnailLink, createdTime)",
            pageSize=100,  # Lấy 100 ảnh mỗi lần sync cho nhanh
        )
        .execute()
    )

    files = results.get("files", [])
    synced_count = 0
    downloaded_count = 0

    for f in files:
        # 1. Update DB
        db_img = session.get(Image, f["id"])
        if not db_img:
            db_img = Image(
                id=f["id"],
                name=f["name"],
                folder_id=folder_id,
                thumbnail_link=f.get("thumbnailLink"),
            )
            session.add(db_img)
            synced_count += 1

        # 2. Xử lý tải file về Local (QUAN TRỌNG)
        file_path = os.path.join(local_folder_path, f["name"])

        # Chỉ tải nếu file chưa tồn tại trên ổ cứng
        if not os.path.exists(file_path):
            print(f"⬇️ Đang tải: {f['name']}...")
            file_stream = download_image_from_drive(f["id"])

            if file_stream:
                with open(file_path, "wb") as local_file:
                    local_file.write(file_stream.getbuffer())
                downloaded_count += 1
            else:
                print(f"❌ Lỗi tải file: {f['name']}")

    session.commit()
    return {
        "folder_id": folder_id,
        "total_images": len(files),
        "new_db_records": synced_count,
        "downloaded_files": downloaded_count,
    }


def sync_all_folders(session: Session):
    folders = session.exec(select(Folder)).all()
    for folder in folders:
        sync_images_in_folder(session, folder.id)