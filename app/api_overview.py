# app/api_overview.py
from fastapi import APIRouter, Depends
from sqlmodel import Session, select, func, text
from datetime import datetime, timedelta
from typing import List
from pydantic import BaseModel

from app.database import get_session
from app.models import Page, PageHealth, PostMeta

router = APIRouter()

# --- Output Schema ---
class OverviewStats(BaseModel):
    # Widget 1: Money Metrics
    total_clicks: int = 0
    total_reach: int = 0
    total_followers: int = 0
    
    # Widget 2: Health
    active_pages: int = 0
    critical_pages: int = 0 # Số page > 3 ngày ko đăng
    
    # Widget 3: Top Performers (Top 5)
    top_pages: List[dict] = []

@router.get("/", response_model=OverviewStats)
def get_dashboard_overview(session: Session = Depends(get_session)):
    # 1. TÍNH TỔNG CLICK & REACH & FOLLOWERS (24h qua)
    # Logic: Lấy record PageHealth mới nhất của mỗi page
    # (Tạm thời sum toàn bộ bảng PageHealth để demo, tối ưu sau)
    
    # Ngày hôm qua
    yesterday = datetime.utcnow().date() - timedelta(days=1)
    
    # Query tổng
    stats_query = session.exec(
        select(
            func.sum(PageHealth.link_clicks),
            func.sum(PageHealth.total_reach),
            func.sum(PageHealth.followers_total)
        )
        # .where(func.date(PageHealth.record_date) >= yesterday) # Mở comment khi có dữ liệu thật
    ).first()
    
    total_clicks = stats_query[0] or 0
    total_reach = stats_query[1] or 0
    total_followers = stats_query[2] or 0

    # 2. TÍNH SỐ PAGE LỖI (CRITICAL)
    # Page nào không có PostMeta trong 3 ngày qua -> Lỗi
    three_days_ago = datetime.utcnow() - timedelta(days=3)
    
    # Đếm tổng page
    total_pages_count = session.exec(select(func.count(Page.page_id))).one()
    
    # Đếm số page CÓ đăng bài trong 3 ngày qua
    active_pages_count = session.exec(
        select(func.count(func.distinct(PostMeta.page_id)))
        .where(PostMeta.created_time >= three_days_ago)
    ).one()
    
    critical_count = total_pages_count - active_pages_count
    # Fix âm (nếu data lỗi)
    if critical_count < 0: critical_count = 0

    # 3. TOP PERFORMERS (Giả lập lấy top theo follower)
    # Thực tế sẽ join với PageHealth để lấy growth
    top_pages_query = session.exec(
        select(Page)
        .limit(5)
    ).all()
    
    top_list = []
    for p in top_pages_query:
        top_list.append({
            "name": p.page_name,
            "avatar": p.avatar_url,
            "value": 1000 # Fake số liệu tăng trưởng để demo UI
        })

    return {
        "total_clicks": total_clicks,
        "total_reach": total_reach,
        "total_followers": total_followers,
        "active_pages": active_pages_count,
        "critical_pages": critical_count,
        "top_pages": top_list
    }