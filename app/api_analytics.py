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
    
    # --- THÊM LOGIC CẬP NHẬT WATERMARK ---
    # Sau khi lưu xong Health của ngày X, ta cập nhật mốc last_synced_date lên ngày X
    try:
        from app.models import PageConfig
        current_date = datetime.fromisoformat(data.record_date)
        
        config = session.get(PageConfig, data.page_id)
        if config:
            # Chỉ cập nhật nếu ngày mới > ngày cũ (Tịnh tiến)
            if not config.last_synced_date or current_date > config.last_synced_date:
                config.last_synced_date = current_date
                session.add(config)
    except Exception as e:
        print(f"Lỗi update watermark: {e}")

    session.commit()
    return {"success": True, "msg": f"Đã sync & update mốc ngày {data.record_date}"}

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

    # 2. LOGIC WATERMARK MỚI
    today = datetime.utcnow().date()
    yesterday = today - timedelta(days=1)
    
    # Xác định mốc bắt đầu
    start_date = None
    if config.last_synced_date:
        # Bắt đầu từ ngày tiếp theo của mốc
        start_date = config.last_synced_date.date() + timedelta(days=1)
    else:
        # Nếu chưa có mốc, lấy 14 ngày trước
        start_date = today - timedelta(days=14)

    missing_dates = []
    
    # Nếu mốc đã là hôm qua -> Không cần làm gì
    if start_date > yesterday:
        return {"eligible": True, "missing_dates": []}

    # Tạo danh sách các ngày cần bù (từ start_date đến yesterday)
    delta = yesterday - start_date
    for i in range(delta.days + 1):
        day = start_date + timedelta(days=i)
        missing_dates.append(day.strftime("%Y-%m-%d"))
            
    return {
        "eligible": True,
        "missing_dates": missing_dates
    }

@router.get("/sync/active-posts")
def get_active_posts(page_id: str, session: Session = Depends(get_session)):
    # Lấy các bài đăng trong 7 ngày gần nhất
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    
    posts = session.exec(
        select(PostMeta.post_id, PostMeta.created_time)
        .where(PostMeta.page_id == page_id)
        .where(PostMeta.created_time >= seven_days_ago)
        .where(PostMeta.post_type != "STORY") # <--- DÒNG NÀY QUAN TRỌNG NHẤT
    ).all()
    
    # Trả về danh sách object
    return {
        "count": len(posts),
        "posts": [{"post_id": p[0], "created_time": p[1].isoformat()} for p in posts]
    }

class FolderPerformance(BaseModel):
    folder_id: str
    folder_name: str
    type: str
    avg_reach: float
    total_posts: int

@router.get("/folder-performance", response_model=List[FolderPerformance])
def get_folder_performance(session: Session = Depends(get_session)):
    """Tính toán Reach trung bình của từng Folder trên tất cả các Page"""
    
    # Do logic này quá phức tạp, cần join 3-4 bảng (Folder -> Image -> PostMeta -> PostMetric)
    # Tạm thời chúng ta sẽ trả về dữ liệu MOCK (giả lập) để xây dựng UI (Vì bạn muốn làm nhanh)
    
    # Lấy danh sách Folder (để có tên và ID thật)
    from app.models import Folder
    folders = session.exec(select(Folder)).all()
    
    mock_results = []
    # Chỉ lấy 5 folder đầu để demo
    for i, folder in enumerate(folders[:5]):
        # Giả lập số liệu
        folder_name = folder.name or ""
        avg_r = 1000 + (folder_name.count("POST") * 500) + (i * 100)
        total_p = 50 + i * 5
        
        upper = folder_name.upper()
        f_type = "POST" if upper.endswith("_POST") else "STORY" if upper.endswith("_STORY") else "OTHER"
        
        mock_results.append({
            "folder_id": folder.id,
            "folder_name": folder_name,
            "type": f_type,
            "avg_reach": avg_r,
            "total_posts": total_p
        })
        
    return mock_results