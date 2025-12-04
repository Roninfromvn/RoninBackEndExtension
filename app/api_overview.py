from fastapi import APIRouter, Depends
from sqlmodel import Session, select, func
from datetime import datetime, timedelta
from typing import List, Optional
from pydantic import BaseModel

from app.database import get_session
from app.models import Page, PageHealth, PostMeta

router = APIRouter()

# ======================
#  Pydantic Output Model
# ======================

class TopPage(BaseModel):
    page_id: str
    page_name: Optional[str] = "Unknown Page"
    avatar_url: Optional[str] = None
    followers: int = 0
    reach_24h: int = 0
    interactions_24h: int = 0
    status: Optional[str] = None
    last_post_time: Optional[str] = None
    is_critical: bool = False

class OverviewMetrics(BaseModel):
    # 24h metrics
    total_clicks_24h: int = 0
    total_reach_24h: int = 0
    total_followers_24h: int = 0
    total_interactions_24h: int = 0

    # latest (current health)
    total_followers_latest: int = 0
    total_reach_latest: int = 0
    total_interactions_latest: int = 0

    # page health counts
    active_pages_count: int = 0
    critical_pages_count: int = 0
    total_pages: int = 0


class DashboardOverview(BaseModel):
    metrics: OverviewMetrics
    top_performers: List[TopPage]


# ======================
#  MAIN API ENDPOINT
# ======================

@router.get("/", response_model=DashboardOverview)
def get_dashboard_overview(session: Session = Depends(get_session)):

    # 1. Lấy tất cả Pages
    pages = session.exec(select(Page)).all()

    # Ngưỡng tính critical (3 ngày)
    critical_threshold = datetime.utcnow() - timedelta(days=3)

    metrics_24h = {
        "clicks": 0, "reach": 0, "followers": 0, "interactions": 0
    }
    metrics_latest = {
        "followers": 0, "reach": 0, "interactions": 0
    }

    # Lấy record của 24h qua
    yesterday = datetime.utcnow() - timedelta(days=1)

    # Query tổng 24h từ PageHealth
    sum_24h = session.exec(
        select(
            func.sum(PageHealth.link_clicks),
            func.sum(PageHealth.total_reach),
            func.sum(PageHealth.followers_total),
            func.sum(PageHealth.total_interaction)
        )
        .where(PageHealth.record_date >= yesterday)
    ).first()

    metrics_24h["clicks"] = sum_24h[0] or 0
    metrics_24h["reach"] = sum_24h[1] or 0
    metrics_24h["followers"] = sum_24h[2] or 0
    metrics_24h["interactions"] = sum_24h[3] or 0

    # 2. Xử lý từng Page
    active_count = 0
    critical_count = 0
    top_pages_buffer = []

    for page in pages:
        # Check Active theo Page.status
        if page.status == "ACTIVE":
            active_count += 1

        # Check Critical theo last_post_time
        is_critical = False
        # (Logic check time string của bạn)
        if hasattr(page, 'last_post_time') and page.last_post_time:
            try:
                # Xử lý string ISO có thể chứa 'Z'
                last_post_dt = datetime.fromisoformat(str(page.last_post_time).replace("Z", "+00:00"))
                if last_post_dt < critical_threshold:
                    is_critical = True
            except:
                pass

        # Check Critical nâng cao: Có bài viết nào trong bảng PostMeta 3 ngày qua không?
        has_post_recent = session.exec(
            select(func.count(PostMeta.post_id))
            .where(PostMeta.page_id == page.page_id)
            .where(PostMeta.created_time >= critical_threshold)
        ).one()

        if has_post_recent == 0:
            is_critical = True
        
        if is_critical:
            critical_count += 1

        # Lấy health mới nhất của từng page
        latest_health = session.exec(
            select(PageHealth)
            .where(PageHealth.page_id == page.page_id)
            .order_by(PageHealth.record_date.desc())
        ).first()

        followers_curr = latest_health.followers_total if latest_health else (page.followers or 0)
        reach_curr = latest_health.total_reach if latest_health else 0
        interact_curr = latest_health.total_interaction if latest_health else 0

        # Cộng dồn chỉ số hiện tại (Latest Metrics)
        metrics_latest["followers"] += followers_curr
        metrics_latest["reach"] += reach_curr
        metrics_latest["interactions"] += interact_curr

        # Build entry cho Top Performers
        top_pages_buffer.append({
            "page_id": page.page_id,
            "page_name": page.page_name or "Unnamed",
            "avatar_url": page.avatar_url,
            "followers": followers_curr,
            "reach_24h": reach_curr, # Tạm dùng reach mới nhất làm đại diện
            "interactions_24h": interact_curr,
            "status": page.status,
            "last_post_time": str(page.last_post_time) if hasattr(page, 'last_post_time') else None,
            "is_critical": is_critical,
            "sort_key": reach_curr
        })

    # Sort top pages
    top_pages_buffer.sort(key=lambda p: p["sort_key"], reverse=True)
    
    top_pages = [
        TopPage(
            page_id=p["page_id"],
            page_name=p["page_name"],
            avatar_url=p["avatar_url"],
            followers=p["followers"],
            reach_24h=p["reach_24h"],
            interactions_24h=p["interactions_24h"],
            status=p["status"],
            last_post_time=p["last_post_time"],
            is_critical=p["is_critical"]
        )
        for p in top_pages_buffer[:5]
    ]

    return DashboardOverview(
        metrics=OverviewMetrics(
            total_clicks_24h=metrics_24h["clicks"],
            total_reach_24h=metrics_24h["reach"],
            total_followers_24h=metrics_24h["followers"],
            total_interactions_24h=metrics_24h["interactions"],

            total_followers_latest=metrics_latest["followers"],
            total_reach_latest=metrics_latest["reach"],
            total_interactions_latest=metrics_latest["interactions"],

            active_pages_count=active_count,
            critical_pages_count=critical_count,
            total_pages=len(pages),
        ),
        top_performers=top_pages
    )