# app/sync_service.py

import logging
from typing import Dict, List, Optional
from datetime import datetime
from sqlmodel import Session, select

from app.models import Folder, Image
from app.drive_service import get_drive_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def parse_drive_datetime(iso_string: Optional[str]) -> Optional[datetime]:
    if not iso_string:
        return None

    try:
        return datetime.fromisoformat(iso_string.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return None


def sync_folder_structure(session: Session, root_folder_name: str = "RONIN_CMS") -> Dict:
    try:
        service = get_drive_service()

        # Tìm folder gốc
        query = (
            "mimeType='application/vnd.google-apps.folder' "
            f"and name='{root_folder_name}' and trashed=false"
        )
        res = service.files().list(q=query, fields="files(id, name)").execute()
        items = res.get("files", [])

        if not items:
            return {"success": False, "message": f"Folder {root_folder_name} not found"}

        parent_id = items[0]["id"]

        all_folders = []
        page_token = None

        # Liệt kê tất cả folder con
        while True:
            q_sub = (
                f"'{parent_id}' in parents AND "
                "mimeType='application/vnd.google-apps.folder' AND trashed=false"
            )

            res = service.files().list(
                q=q_sub,
                fields="nextPageToken, files(id,name,createdTime)",
                pageSize=1000,
                pageToken=page_token,
            ).execute()

            all_folders.extend(res.get("files", []))
            page_token = res.get("nextPageToken")

            if not page_token:
                break

        drive_ids = {f["id"] for f in all_folders}
        db_folders = session.exec(select(Folder)).all()
        db_ids = {f.id for f in db_folders}

        db_map = {f.id: f for f in db_folders}

        new, updated, deleted = 0, 0, 0

        # Thêm / cập nhật
        for f in all_folders:
            dbf = db_map.get(f["id"])

            if not dbf:
                dbf = Folder(
                    id=f["id"],
                    name=f["name"],
                    created_time=parse_drive_datetime(f.get("createdTime")),
                )
                session.add(dbf)
                new += 1
            else:
                if dbf.name != f["name"]:
                    dbf.name = f["name"]
                    session.add(dbf)
                    updated += 1

        # Xóa folder không còn tồn tại
        for folder_id in db_ids - drive_ids:
            session.delete(db_map[folder_id])
            deleted += 1

        session.commit()

        return {
            "success": True,
            "total_folders": len(all_folders),
            "new_folders": new,
            "updated_folders": updated,
            "deleted_folders": deleted,
        }

    except Exception as e:
        session.rollback()
        return {"success": False, "error": str(e)}


def sync_images_in_folder(session: Session, folder_id: str) -> Dict:
    """
    → CHỈ LÀM VIỆC VỚI METADATA
    → KHÔNG TẠO FILE LOCAL
    → KHÔNG TẢI FILE
    → KHÔNG XOÁ FILE
    """
    try:
        service = get_drive_service()

        query = (
            f"'{folder_id}' in parents and mimeType contains 'image/' and trashed=false"
        )

        all_files = []
        page_token = None

        while True:
            res = service.files().list(
                q=query,
                fields="nextPageToken, files(id,name,mimeType,thumbnailLink,createdTime)",
                pageSize=1000,
                pageToken=page_token,
            ).execute()

            all_files.extend(res.get("files", []))
            page_token = res.get("nextPageToken")

            if not page_token:
                break

        drive_ids = {f["id"] for f in all_files}
        drive_map = {f["id"]: f for f in all_files}

        db_imgs = session.exec(select(Image).where(Image.folder_id == folder_id)).all()
        db_ids = {img.id for img in db_imgs}
        db_map = {img.id: img for img in db_imgs}

        new_db, updated_db, deleted_db = 0, 0, 0

        # Insert / Update metadata
        for f in all_files:
            db_img = db_map.get(f["id"])

            if not db_img:
                db_img = Image(
                    id=f["id"],
                    name=f["name"],
                    folder_id=folder_id,
                    mime_type=f.get("mimeType"),
                    thumbnail_link=f.get("thumbnailLink"),
                    created_time=parse_drive_datetime(f.get("createdTime")),
                )
                session.add(db_img)
                new_db += 1
            else:
                changed = False

                if db_img.name != f["name"]:
                    db_img.name = f["name"]
                    changed = True

                if db_img.mime_type != f.get("mimeType"):
                    db_img.mime_type = f.get("mimeType")
                    changed = True

                if db_img.thumbnail_link != f.get("thumbnailLink"):
                    db_img.thumbnail_link = f.get("thumbnailLink")
                    changed = True

                if not db_img.created_time and f.get("createdTime"):
                    db_img.created_time = parse_drive_datetime(f.get("createdTime"))
                    changed = True

                if changed:
                    session.add(db_img)
                    updated_db += 1

        # Delete metadata không còn trên Drive
        for img_id in db_ids - drive_ids:
            session.delete(db_map[img_id])
            deleted_db += 1

        session.commit()

        return {
            "success": True,
            "folder_id": folder_id,
            "total_images": len(all_files),
            "new_db_records": new_db,
            "updated_db_records": updated_db,
            "deleted_db_records": deleted_db,
        }

    except Exception as e:
        session.rollback()
        return {"success": False, "folder_id": folder_id, "error": str(e)}


def sync_all_folders(session: Session) -> List[Dict]:
    logger.info("🔄 BẮT ĐẦU SYNC TOÀN BỘ (metadata only)")

    folder_res = sync_folder_structure(session)

    if not folder_res.get("success"):
        return [folder_res]

    folders = session.exec(select(Folder)).all()
    results = [folder_res]

    for folder in folders:
        res = sync_images_in_folder(session, folder.id)
        results.append(res)

    return results
