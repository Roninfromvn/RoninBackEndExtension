from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timedelta

# Import DB & Models
from app.database import get_session
from app.models import PageHealth, PostMeta, PostMetric

# Khởi tạo Router (thay vì app = FastAPI)
router = APIRouter()

# --- 1. Input Schemas (Chuyển hết Pydantic class sang đây) ---
class PageHealthInput(BaseModel):
    page_id: str
    record_date: str # YYYY-MM-DD
    followers_total: int = 0
    followers_new: int = 0
    unfollows: int = 0
    net_follows: int = 0
    total_reach: int = 0
    total_interaction: int = 0
    link_clicks: int = 0

class PostMetaInput(BaseModel):
    post_id: str
    page_id: str
    created_time: str # ISO String
    post_type: Optional[str] = "UNKNOWN"
    permalink: Optional[str] = None
    caption_snippet: Optional[str] = None

class PostMetricInput(BaseModel):
    post_id: str
    reach: int = 0
    impressions: int = 0
    reactions: int = 0
    comments: int = 0
    shares: int = 0
    clicks: int = 0
    other_clicks: int = 0
    is_final: bool = False

class CheckSyncInput(BaseModel):
    page_id: str

# --- 2. API Endpoints (Thay @app.post bằng @router.post) ---

@router.post("/sync/page-health")
def sync_page_health(data: PageHealthInput, session: Session = Depends(get_session)):
    try:
        r_date = datetime.fromisoformat(data.record_date).date()
    except:
        r_date = datetime.utcnow().date()

    existing = session.exec(
        select(PageHealth)
        .where(PageHealth.page_id == data.page_id)
        .where(func.date(PageHealth.record_date) == r_date)
    ).first()

    if existing:
        existing.followers_total = data.followers_total
        existing.followers_new = data.followers_new
        existing.unfollows = data.unfollows
        existing.net_follows = data.net_follows
        existing.total_reach = data.total_reach
        existing.total_interaction = data.total_interaction
        existing.link_clicks = data.link_clicks
        session.add(existing)
    else:
        new_record = PageHealth(
            page_id=data.page_id,
            record_date=r_date,
            followers_total=data.followers_total,
            followers_new=data.followers_new,
            unfollows=data.unfollows,
            net_follows=data.net_follows,
            total_reach=data.total_reach,
            total_interaction=data.total_interaction,
            link_clicks=data.link_clicks
        )
        session.add(new_record)
    
    session.commit()
    return {"success": True, "msg": f"Đã sync Page Health ngày {r_date}"}

@router.post("/sync/posts")
def sync_posts_metadata(posts: List[PostMetaInput], session: Session = Depends(get_session)):
    count_new = 0
    for p in posts:
        exists = session.get(PostMeta, p.post_id)
        if not exists:
            try:
                c_time = datetime.fromisoformat(p.created_time.replace("Z", "+00:00"))
            except:
                c_time = datetime.utcnow()

            new_meta = PostMeta(
                post_id=p.post_id,
                page_id=p.page_id,
                created_time=c_time,
                post_type=p.post_type,
                permalink=p.permalink,
                caption_snippet=p.caption_snippet
            )
            session.add(new_meta)
            count_new += 1
            
    session.commit()
    return {"success": True, "new_posts": count_new}

@router.post("/sync/post-metrics")
def sync_post_metrics(metrics: List[PostMetricInput], session: Session = Depends(get_session)):
    count = 0
    for m in metrics:
        if not session.get(PostMeta, m.post_id):
            continue 

        new_metric = PostMetric(
            post_id=m.post_id,
            updated_at=datetime.utcnow(),
            reach=m.reach,
            impressions=m.impressions,
            reactions=m.reactions,
            comments=m.comments,
            shares=m.shares,
            clicks=m.clicks,
            other_clicks=m.other_clicks,
            is_final=m.is_final
        )
        session.add(new_metric)
        count += 1
        
    session.commit()
    return {"success": True, "msg": f"Đã lưu {count} metrics"}

@router.post("/sync/check-gaps")
def check_sync_gaps(data: CheckSyncInput, session: Session = Depends(get_session)):
    from app.models import PageConfig, Folder # Import lười để tránh vòng lặp
    
    # A. Kiểm tra Điều kiện Folder (Post + Story)
    config = session.get(PageConfig, data.page_id)
    # Nếu chưa config hoặc không có folder -> Loại
    if not config or not config.folder_ids:
        return {"eligible": False, "reason": "No config"}
    
    # Parse JSON folder_ids
    import json
    try:
        f_ids = json.loads(config.folder_ids) if isinstance(config.folder_ids, str) else config.folder_ids
    except:
        f_ids = []
        
    if not f_ids:
        return {"eligible": False, "reason": "No folders"}

    # Query DB để xem tên các folder này có đúng chuẩn không
    folders = session.exec(select(Folder).where(Folder.id.in_(f_ids))).all()
    
    has_post = any(f.name.upper().endswith("_POST") for f in folders)
    has_story = any(f.name.upper().endswith("_STORY") for f in folders)
    
    # Điều kiện bắt buộc: Phải có cả POST và STORY
    if not (has_post and has_story):
        return {"eligible": False, "reason": "Missing POST or STORY folder"}

    # B. Tìm các ngày thiếu dữ liệu trong 14 ngày qua (Trừ hôm nay)
    missing_dates = []
    today = datetime.utcnow().date()
    
    # Lấy danh sách ngày đã có data trong DB
    existing_records = session.exec(
        select(PageHealth.record_date)
        .where(PageHealth.page_id == data.page_id)
        .where(PageHealth.record_date >= today - timedelta(days=15))
    ).all()
    
    # Convert sang set string (YYYY-MM-DD) để so sánh
    existing_set = set()
    for d in existing_records:
        if isinstance(d, datetime) or hasattr(d, 'strftime'):
            existing_set.add(d.strftime("%Y-%m-%d"))
        elif isinstance(d, str): # Phòng hờ DB trả về string
            existing_set.add(d)

    # Quét 14 ngày trước (từ hôm qua -1 trở về)
    for i in range(1, 15):
        check_date = today - timedelta(days=i)
        date_str = check_date.strftime("%Y-%m-%d")
        
        if date_str not in existing_set:
            missing_dates.append(date_str)
            
    return {
        "eligible": True,
        "missing_dates": missing_dates # Extension sẽ dựa vào list này để chạy
    }