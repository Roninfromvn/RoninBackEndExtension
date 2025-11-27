from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select, func
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

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