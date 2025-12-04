# app/api_dashboard.py
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse  # Proxy ảnh Drive
from sqlmodel import Session, select, func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

from app.database import get_session, engine
# [QUAN TRỌNG] Thêm FolderCaption vào dòng import này
from app.models import Folder, Image, FolderCaption
from app.sync_service import sync_folder_structure, sync_images_in_folder, sync_all_folders
from app.drive_service import download_image_from_drive

router = APIRouter()

# --- Output Schemas ---
class FolderStats(BaseModel):
    id: str
    name: str
    clean_name: str
    type: str # POST | STORY | OTHER
    created_time: Optional[str] = None
    image_count: int

class ImageItem(BaseModel):
    id: str
    name: str
    thumbnail_link: Optional[str]
    created_time: Optional[str]

# --- Endpoints Xem Dữ Liệu ---
@router.get("/folders", response_model=List[FolderStats])
def dashboard_get_folders(session: Session = Depends(get_session)):
    statement = (
        select(Folder, func.count(Image.id).label("count"))
        .join(Image, isouter=True)
        .group_by(Folder.id)
        .order_by(Folder.name)
    )
    results = session.exec(statement).all()
    output = []
    for folder, count in results:
        # Logic phân loại tên
        upper = (folder.name or "").upper()
        f_type = "POST" if upper.endswith("_POST") else "STORY" if upper.endswith("_STORY") else "OTHER"
        clean = folder.name.replace("_POST", "").replace("_STORY", "").replace("_", " ").strip()
        
        output.append({
            "id": folder.id, "name": folder.name, "clean_name": clean, "type": f_type,
            "created_time": folder.created_time.isoformat() if folder.created_time else None,
            "image_count": count
        })
    return output

@router.get("/folder/{folder_id}/images", response_model=List[ImageItem])
def dashboard_get_images(folder_id: str, page: int = 1, page_size: int = 50, session: Session = Depends(get_session)):
    offset = (page - 1) * page_size
    statement = select(Image).where(Image.folder_id == folder_id).order_by(Image.created_time.desc()).offset(offset).limit(page_size)
    images = session.exec(statement).all()
    return [{
        "id": i.id, "name": i.name, "thumbnail_link": i.thumbnail_link,
        "created_time": i.created_time.isoformat() if i.created_time else None
    } for i in images]

# --- Endpoints Sync ---
@router.post("/sync/structure")
def trigger_sync_structure(session: Session = Depends(get_session)):
    sync_folder_structure(session)
    return {"status": "success", "message": "Đã đồng bộ cấu trúc Folder"}

@router.post("/sync/folder/{folder_id}")
def trigger_sync_folder(folder_id: str, session: Session = Depends(get_session)):
    if not session.get(Folder, folder_id): raise HTTPException(404, "Folder not found")
    return {"status": "success", "data": sync_images_in_folder(session, folder_id)}

@router.post("/sync/all")
def trigger_sync_all(background_tasks: BackgroundTasks):
    def _bg():
        with Session(engine) as s: sync_all_folders(s)
    background_tasks.add_task(_bg)
    return {"status": "started", "message": "Sync All đang chạy ngầm..."}


# --- API MỚI: PROXY ẢNH DRIVE ---
@router.get("/proxy-image/{file_id}")
def proxy_drive_image(file_id: str):
    """
    Backend lấy ảnh từ Drive và stream thẳng về trình duyệt.
    Không lưu file vào ổ cứng.
    """
    image_stream = download_image_from_drive(file_id)

    if not image_stream:
        # Trả về ảnh rỗng hoặc lỗi nếu không tải được
        raise HTTPException(status_code=404, detail="Image not found on Drive")

    # Reset con trỏ file về đầu để đọc
    image_stream.seek(0)

    # Trả về dạng stream (giả sử là image/jpeg cho phổ biến, trình duyệt tự hiểu)
    return StreamingResponse(image_stream, media_type="image/jpeg")

# --- PHẦN MỚI: QUẢN LÝ CAPTION ---

class CaptionInput(BaseModel):
    captions: List[str]


@router.get("/folder/{folder_id}/captions")
def get_folder_captions(folder_id: str, session: Session = Depends(get_session)):
    """Lấy danh sách caption hiện tại của folder"""
    fc = session.get(FolderCaption, folder_id)
    # Trả về mảng rỗng nếu chưa có
    return {"captions": fc.captions if fc else []}


@router.post("/folder/{folder_id}/captions")
def save_folder_captions(folder_id: str, data: CaptionInput, session: Session = Depends(get_session)):
    """Lưu (Ghi đè) danh sách caption"""
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(404, "Folder not found")
        
    fc = session.get(FolderCaption, folder_id)
    if not fc:
        # Nếu chưa có thì tạo mới
        fc = FolderCaption(folder_id=folder_id, folder_name=folder.name, captions=[])
        session.add(fc)
    
    # Lọc bỏ dòng trống và update
    clean_captions = [c.strip() for c in data.captions if c.strip()]
    fc.captions = clean_captions
    fc.updated_at = datetime.utcnow()
    
    session.add(fc)
    session.commit()
    
    return {"status": "success", "count": len(clean_captions)}

# --- ENDPOINT MỚI: TỔNG HỢP CHO FRONTEND ---
@router.get("/folder/{folder_id}/detail")
def get_full_folder_detail(folder_id: str, session: Session = Depends(get_session)):
    """API tổng hợp phục vụ Ronin Dashboard Detail View"""
    # 1. Lấy thông tin Folder
    folder = session.get(Folder, folder_id)
    if not folder:
        raise HTTPException(404, "Folder not found")
        
    # 2. Đếm số lượng ảnh
    image_count = session.exec(select(func.count(Image.id)).where(Image.folder_id == folder_id)).one()
    
    # 3. Lấy danh sách ảnh (Limit 60 để load nhanh trang đầu)
    images = session.exec(
        select(Image)
        .where(Image.folder_id == folder_id)
        .order_by(Image.created_time.desc())
        .limit(60)
    ).all()
    
    # 4. Lấy Captions
    fc = session.get(FolderCaption, folder_id)
    captions = fc.captions if fc else []

    # 5. Phân loại
    upper_name = (folder.name or "").upper()
    f_type = "POST" if upper_name.endswith("_POST") else "STORY" if upper_name.endswith("_STORY") else "OTHER"
    
    # 6. Trả về format đúng với types/index.ts của Frontend
    return {
        "id": folder.id,
        "name": folder.name,
        "type": f_type,
        "image_count": image_count,
        "last_synced_at": folder.created_time,
        "tags": [], # Hiện tại chưa có tags trong DB
        "note": "", # Hiện tại chưa có note trong DB
        "images": [
            {
                "id": img.id,
                "thumbnail_link": img.thumbnail_link,
                "created_at": img.created_time
            } for img in images
        ],
        "captions": captions
    }