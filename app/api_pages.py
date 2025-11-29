from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from typing import List, Optional
from pydantic import BaseModel
import json

from app.database import get_session
from app.models import Page, PageConfig, Folder

router = APIRouter()

# --- Output Schemas ---
class PageOutput(BaseModel):
    page_id: str
    page_name: str
    avatar_url: Optional[str] = None
    folder_ids: List[str] = []
    followers: int = 0
    reach_yesterday: int = 0

class ConfigUpdate(BaseModel):
    folder_ids: List[str]

# --- Endpoints ---

@router.get("/", response_model=List[PageOutput])
def get_all_pages(session: Session = Depends(get_session)):
    """Chỉ trả về các Page ĐÃ CẤU HÌNH ĐỦ (Có cả POST và STORY)"""
    
    # 1. Lấy dữ liệu Page + Config
    results = session.exec(select(Page, PageConfig).join(PageConfig, isouter=True)).all()
    
    # 2. Lấy map tên Folder để check loại
    all_folders = session.exec(select(Folder)).all()
    folder_map = {f.id: (f.name or "").upper() for f in all_folders}

    output = []
    for page, config in results:
        # Parse Config
        f_ids = []
        if config and config.folder_ids:
            try:
                # Xử lý cả trường hợp là string JSON hoặc list sẵn
                f_ids = json.loads(config.folder_ids) if isinstance(config.folder_ids, str) else config.folder_ids
            except:
                f_ids = []

        # 3. KIỂM TRA ĐIỀU KIỆN (Post + Story)
        has_post = False
        has_story = False
        
        for fid in f_ids:
            fname = folder_map.get(fid, "")
            if fname.endswith("_POST"): has_post = True
            if fname.endswith("_STORY"): has_story = True
        
        # 4. CHỈ LẤY PAGE ĐỦ ĐIỀU KIỆN
        if has_post and has_story:
            output.append({
                "page_id": page.page_id,
                "page_name": page.page_name or "Unknown Page",
                "avatar_url": page.avatar_url,
                "folder_ids": f_ids,
                "followers": 0, # Placeholder
                "reach_yesterday": 0 # Placeholder
            })
            
    return output

@router.patch("/{page_id}/config")
def update_page_config(page_id: str, data: ConfigUpdate, session: Session = Depends(get_session)):
    """Cập nhật config nguồn"""
    config = session.get(PageConfig, page_id)
    if not config:
        config = PageConfig(page_id=page_id)
    
    # Lưu dạng JSON string để đồng bộ với cách Extension đọc
    config.folder_ids = json.dumps(data.folder_ids)
    session.add(config)
    session.commit()
    return {"status": "success"}

class PageInput(BaseModel):
    page_id: str
    page_name: str
    avatar_url: Optional[str] = None
    # Các field khác có thể optional
    isCurrent: Optional[bool] = False

@router.post("/bulk-create")
def create_pages_bulk(pages: List[PageInput], session: Session = Depends(get_session)):
    """
    API nhận danh sách Page từ Extension và thực hiện UPSERT (Cập nhật hoặc Tạo mới).
    """
    count_new = 0
    count_updated = 0
    
    for p in pages:
        # 1. Tìm xem page này đã có trong DB chưa
        db_page = session.get(Page, p.page_id)
        
        if db_page:
            # 2. NẾU CÓ RỒI -> CẬP NHẬT (Đây là cái bạn cần)
            db_page.page_name = p.page_name
            db_page.avatar_url = p.avatar_url
            # db_page.status = "ACTIVE" # Có thể update thêm trạng thái nếu muốn
            session.add(db_page)
            count_updated += 1
        else:
            # 3. NẾU CHƯA CÓ -> TẠO MỚI
            new_page = Page(
                page_id=p.page_id,
                page_name=p.page_name,
                avatar_url=p.avatar_url,
                status="NEW"
            )
            session.add(new_page)
            count_new += 1
            
    session.commit()
    return {
        "status": "success",
        "message": f"Synced {len(pages)} pages",
        "details": {"new": count_new, "updated": count_updated}
    }