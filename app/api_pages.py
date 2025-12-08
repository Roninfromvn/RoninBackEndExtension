from fastapi import APIRouter, Depends, Header
from sqlmodel import Session, select, func
from typing import List, Optional
from pydantic import BaseModel, Field
from datetime import datetime, timedelta
import json
import os

from app.database import get_session
from app.models import Page, PageConfig, Folder, PageHealth  # Import thêm PageHealth
from app.telegram_service import send_telegram_alert
from app.api_auth import get_optional_user
from app.models_auth import User

router = APIRouter()

# --- Output Schemas ---
class PageOutput(BaseModel):
    page_id: str
    page_name: str
    avatar_url: Optional[str] = None
    folder_ids: List[str] = []
    followers: int = 0
    reach_7d: int = 0
    note: Optional[str] = None
    has_recommendation: bool = True


class ConfigUpdate(BaseModel):
    folder_ids: Optional[List[str]] = None
    note: Optional[str] = None


# --- Endpoints ---

@router.get("/", response_model=List[PageOutput])
def get_all_pages(
    session: Session = Depends(get_session),
    current_user: Optional[User] = Depends(get_optional_user),
    x_ronin_key: str = Header(None)
):
    """
    Trả về danh sách Page hoạt động (Có cả POST và STORY).
    - Extension (API Key): Trả về tất cả pages
    - Dashboard ADMIN: Trả về tất cả pages
    - Dashboard EMPLOYEE/ANALYST: Chỉ trả về pages được assign
    """
    
    # Determine if we need to filter by user's accessible pages
    filter_by_user_pages = False
    user_page_ids: List[str] = []
    
    # Check if request has valid API Key (Extension) -> no filter
    API_KEY = os.getenv("API_KEY", "DITCONMETHANGPHAPLEDITCONMETHANGPHAPLE")
    has_valid_api_key = (x_ronin_key == API_KEY)
    
    if not has_valid_api_key and current_user and current_user.role != "ADMIN":
        # Dashboard user (non-admin) -> filter by assigned pages
        filter_by_user_pages = True
        user_page_ids = current_user.accessible_page_ids
        if not user_page_ids:
            return []  # No pages assigned
    
    # 1. Lấy dữ liệu Page + Config
    results = session.exec(select(Page, PageConfig).join(PageConfig, isouter=True)).all()
    
    # 2. Lấy map tên Folder để check loại (Dùng cho logic lọc)
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
            if "_POST" in fname: has_post = True   # Check thoáng hơn một chút
            if "_STORY" in fname: has_story = True
        
        # 4. CHỈ LẤY PAGE ĐỦ ĐIỀU KIỆN
        if has_post and has_story:
            # 4.5 CHECK USER PERMISSION
            if filter_by_user_pages and page.page_id not in user_page_ids:
                continue  # Skip pages not assigned to user
            # --- LOGIC MỚI: Lấy Stats ---
            # Lấy record sức khỏe mới nhất để lấy followers
            health_record = session.exec(
                select(PageHealth)
                .where(PageHealth.page_id == page.page_id)
                .order_by(PageHealth.record_date.desc())
            ).first()

            followers_count = health_record.followers_total if health_record else 0
            
            # Tính tổng reach 7 ngày (giống Analytics)
            date_cutoff = datetime.now().date() - timedelta(days=7)
            reach_7d_result = session.exec(
                select(func.sum(PageHealth.total_reach))
                .where(PageHealth.page_id == page.page_id)
                .where(PageHealth.record_date >= date_cutoff)
            ).first()
            reach_7d_count = reach_7d_result or 0
            # -----------------------------

            output.append({
                "page_id": page.page_id,
                "page_name": page.page_name or "Unknown Page",
                "avatar_url": page.avatar_url,
                "folder_ids": f_ids,
                "followers": followers_count,
                "reach_7d": reach_7d_count,
                "note": config.note if config else None,
                "has_recommendation": config.has_recommendation if config else True
            })
            
    # Sort mặc định theo Followers giảm dần để nhìn thấy Page lớn trước
    output.sort(key=lambda x: x['followers'], reverse=True)
            
    return output

@router.patch("/{page_id}/config")
def update_page_config(page_id: str, data: ConfigUpdate, session: Session = Depends(get_session)):
    """Cập nhật config nguồn"""
    config = session.get(PageConfig, page_id)
    if not config:
        config = PageConfig(page_id=page_id)
    
    # Lưu dạng JSON string để đồng bộ với cách Extension đọc
    if data.folder_ids is not None:
        config.folder_ids = json.dumps(data.folder_ids)
    if data.note is not None:
        config.note = data.note
    session.add(config)
    session.commit()
    return {"status": "success"}

# ... (Giữ nguyên phần PageInput và create_pages_bulk ở dưới)

class PageInput(BaseModel):
    page_id: str = Field(alias="id")
    page_name: str = Field(alias="name")
    avatar_url: Optional[str] = Field(default=None, alias="avatarUrl")
    isCurrent: Optional[bool] = False

    class Config:
        populate_by_name = True

@router.post("/bulk-create")
def create_pages_bulk(pages: List[PageInput], session: Session = Depends(get_session)):
    count_new = 0
    count_updated = 0
    
    for p in pages:
        db_page = session.get(Page, p.page_id)
        if db_page:
            if p.page_name: db_page.page_name = p.page_name
            if p.avatar_url: db_page.avatar_url = p.avatar_url
            session.add(db_page)
            count_updated += 1
        else:
            new_page = Page(
                page_id=p.page_id,
                page_name=p.page_name or "Unnamed Page",
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


# app/api_pages.py

class PageStatusInput(BaseModel):
    page_id: str
    page_name: Optional[str] = None
    recommendation_status: str # "eligible", "ineligible"...

@router.post("/update-status")
def update_page_status_api(data: PageStatusInput, session: Session = Depends(get_session)):
    # 1. Tìm Config
    config = session.get(PageConfig, data.page_id)
    if not config:
        config = PageConfig(page_id=data.page_id)
        config.current_reco_status = "UNKNOWN"

    # 2. Lấy trạng thái CŨ và MỚI
    old_status = config.current_reco_status or "UNKNOWN"
    new_status = data.recommendation_status
    
    page_name = data.page_name or (config.page.page_name if config.page else data.page_id)

    # 3. LOGIC SO SÁNH & BÁO ĐỘNG
    alert_msg = None

    # Trường hợp: Đang XANH/UNKNOWN -> Chuyển sang ĐỎ (Mất đề xuất)
    if new_status in ["ineligible", "restricted"] and old_status not in ["ineligible", "restricted"]:
        alert_msg = (
            f"🚨 <b>CẢNH BÁO MẤT ĐỀ XUẤT!</b>\n\n"
            f"Page: <b>{page_name}</b>\n"
            f"ID: <code>{data.page_id}</code>\n"
            f"Trạng thái cũ: {old_status}\n"
            f"Trạng thái mới: ❌ <b>{new_status.upper()}</b>\n"
            f"<i>Hãy vào kiểm tra ngay!</i>"
        )

    # Trường hợp: Đang ĐỎ -> Chuyển sang XANH (Được thả)
    elif new_status == "eligible" and old_status in ["ineligible", "restricted"]:
        alert_msg = (
            f"✅ <b>TIN VUI: PAGE ĐÃ XANH LẠI!</b>\n\n"
            f"Page: <b>{page_name}</b>\n"
            f"ID: <code>{data.page_id}</code>\n"
            f"Tình trạng: 🟢 <b>Có đề xuất (Eligible)</b>"
        )

    # 4. Gửi Telegram (Nếu có thông báo)
    if alert_msg:
        # Gửi bất đồng bộ hoặc gọi trực tiếp (ở đây gọi trực tiếp cho đơn giản)
        send_telegram_alert(alert_msg)

    # 5. Cập nhật DB
    config.current_reco_status = new_status
    config.has_recommendation = (new_status == "eligible")
    
    session.add(config)
    session.commit()
    
    return {"status": "success", "alert": bool(alert_msg)}