"""
Stats API for Facebook Page Analytics Dashboard
Provides page ranking, detail views, and top posts analysis
"""
from datetime import date, datetime, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, text
from pydantic import BaseModel

from app.database import get_session

router = APIRouter()

# ============================================================================
# RESPONSE MODELS
# ============================================================================

class PageRankingItem(BaseModel):
    page_id: str
    page_name: str
    status: Optional[str] = None
    followers_total: int = 0
    followers_delta: int = 0
    reach: int = 0
    impressions: int = 0
    clicks: int = 0
    engagement: int = 0
    ctr: float = 0.0
    reach_percentile: float = 0.0
    clicks_percentile: float = 0.0
    impressions_percentile: float = 0.0
    engagement_percentile: float = 0.0

class PageRankingResponse(BaseModel):
    meta: Dict[str, Any]
    data: List[PageRankingItem]

class TimeseriesPoint(BaseModel):
    date: str
    reach: int = 0
    impressions: int = 0
    clicks: int = 0
    engagement: int = 0

class TopPost(BaseModel):
    post_id: str
    caption_snippet: Optional[str] = None
    created_time: Optional[datetime] = None
    reach: int = 0
    impressions: int = 0
    clicks: int = 0
    engagement: int = 0
    ctr: float = 0.0
    permalink: Optional[str] = None

class PageDetailResponse(BaseModel):
    page_id: str
    page_name: str
    status: Optional[str] = None
    followers_total: int = 0
    followers_delta: int = 0
    timeseries: List[TimeseriesPoint] = []
    top_posts: List[TopPost] = []
    summary: Dict[str, int] = {}

class TopPostsResponse(BaseModel):
    meta: Dict[str, Any]
    data: List[TopPost]

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_default_date_range() -> tuple:
    """Get default Last 7 days range"""
    end = date.today()
    start = end - timedelta(days=6)  # 7 days inclusive
    return start, end

def get_active_pages_cte() -> str:
    """Returns SQL CTE for active pages logic - pages with both _POST and _STORY folders"""
    return """
    active_pages AS (
        SELECT p.page_id, p.page_name, p.status
        FROM pages p
        JOIN page_configs pc ON pc.page_id = p.page_id
        WHERE pc.folder_ids IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(pc.folder_ids::jsonb) AS fid
            JOIN folders f ON f.id::text = fid
            WHERE f.name ILIKE '%_POST%'
            LIMIT 1
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(pc.folder_ids::jsonb) AS fid2
            JOIN folders f2 ON f2.id::text = fid2
            WHERE f2.name ILIKE '%_STORY%'
            LIMIT 1
          )
    )
    """

# ============================================================================
# ENDPOINT 1: PAGE RANKING
# ============================================================================

@router.get("/pages", response_model=PageRankingResponse)
def get_page_ranking(
    start: Optional[str] = Query(None, description="Start date YYYY-MM-DD"),
    end: Optional[str] = Query(None, description="End date YYYY-MM-DD"),
    sort: str = Query("reach.desc", description="Sort format: metric.asc|desc"),
    page: int = Query(1, ge=1),
    per: int = Query(50, ge=1, le=200),
    # --- CÁC THAM SỐ MỚI CHO FILTER ---
    search: Optional[str] = Query(None, description="Search by name or ID"),
    status: Optional[str] = Query("ALL", description="Filter by status: ACTIVE, RESTRICTED, DIE"),
    size: Optional[str] = Query("ALL", description="Filter by size: SMALL, MEDIUM, LARGE"),
    session: Session = Depends(get_session)
):
    """Get ranked list of active pages with metrics, percentiles and filters"""
    # 1. Xử lý Date Range
    if start and end:
        try:
            start_date = date.fromisoformat(start)
            end_date = date.fromisoformat(end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    else:
        start_date, end_date = get_default_date_range()
    
    # 2. Xử lý Sort
    sort_parts = sort.split(".")
    if len(sort_parts) != 2:
        sort_metric = "reach"
        sort_direction = "DESC"
    else:
        sort_metric, sort_dir = sort_parts
        sort_direction = "DESC" if sort_dir.lower() == "desc" else "ASC"
    
    offset = (page - 1) * per
    
    # 3. Chuẩn bị Filter Params cho SQL
    # Logic Active Page CTE (giữ nguyên logic _POST và _STORY)
    active_pages_cte = """
    active_pages AS (
        SELECT p.page_id, p.page_name, p.status
        FROM pages p
        JOIN page_configs pc ON pc.page_id = p.page_id
        WHERE pc.folder_ids IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(pc.folder_ids::jsonb) AS fid
            JOIN folders f ON f.id::text = fid
            WHERE f.name ILIKE '%_POST%'
            LIMIT 1
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(pc.folder_ids::jsonb) AS fid2
            JOIN folders f2 ON f2.id::text = fid2
            WHERE f2.name ILIKE '%_STORY%'
            LIMIT 1
          )
          AND (
              :search IS NULL OR 
              p.page_name ILIKE ('%' || :search || '%') OR 
              p.page_id ILIKE ('%' || :search || '%')
          )
          AND (
              :status_filter = 'ALL' OR 
              p.status = :status_filter
          )
    )
    """
    
    # 4. QUERY CHÍNH (Đã update active_pages để lọc sớm search/status)
    query_str = f"""
    WITH {active_pages_cte},
    post_snapshots AS (
        SELECT DISTINCT ON (am.page_id, pm.post_id, ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date)
            pm.post_id,
            am.page_id,
            ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date AS day_local,
            pm.reach, pm.impressions, pm.clicks,
            COALESCE(pm.reactions, 0) + COALESCE(pm.comments, 0) + COALESCE(pm.shares, 0) AS engagement_value
        FROM analytics_post_metric pm
        JOIN analytics_post_meta am ON am.post_id = pm.post_id
        WHERE ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date BETWEEN :start_date AND :end_date
        ORDER BY am.page_id, pm.post_id, day_local, pm.updated_at DESC
    ),
    page_health_agg AS (
        SELECT
            page_id,
            SUM(total_reach) AS total_reach,
            SUM(total_interaction) AS total_interaction,
            SUM(link_clicks) AS total_link_clicks
        FROM analytics_page_health
        WHERE record_date BETWEEN :start_date AND :end_date
        GROUP BY page_id
    ),
    page_metrics AS (
        SELECT
            ap.page_id,
            ap.page_name,
            ap.status,
            COALESCE(pha.total_reach, 0)::bigint AS reach,
            COALESCE(SUM(ps.impressions), 0)::bigint AS impressions,
            COALESCE(pha.total_link_clicks, 0)::bigint AS clicks,
            COALESCE(pha.total_interaction, 0)::bigint AS engagement
        FROM active_pages ap
        LEFT JOIN post_snapshots ps ON ps.page_id = ap.page_id
        LEFT JOIN page_health_agg pha ON pha.page_id = ap.page_id
        GROUP BY ap.page_id, ap.page_name, ap.status, pha.total_reach, pha.total_interaction, pha.total_link_clicks
    ),
    with_percentiles AS (
        SELECT
            pm.*,
            COALESCE((cume_dist() OVER (ORDER BY pm.reach DESC) * 100), 0)::numeric(5,2) AS reach_percentile,
            COALESCE((cume_dist() OVER (ORDER BY pm.impressions DESC) * 100), 0)::numeric(5,2) AS impressions_percentile,
            COALESCE((cume_dist() OVER (ORDER BY pm.clicks DESC) * 100), 0)::numeric(5,2) AS clicks_percentile,
            COALESCE((cume_dist() OVER (ORDER BY pm.engagement DESC) * 100), 0)::numeric(5,2) AS engagement_percentile,
            CASE 
                WHEN pm.reach > 0 THEN (pm.clicks::numeric / NULLIF(pm.reach, 0) * 100)
                ELSE 0 
            END AS ctr
        FROM page_metrics pm
    ),
    with_followers AS (
        SELECT
            wp.*,
            COALESCE(end_snap.followers_total, 0) AS followers_total,
            COALESCE(end_snap.followers_total, 0) - COALESCE(start_snap.followers_total, 0) AS followers_delta
        FROM with_percentiles wp
        LEFT JOIN LATERAL (
            SELECT followers_total
            FROM analytics_page_health
            WHERE page_id = wp.page_id
                AND record_date <= :start_date
            ORDER BY record_date DESC
            LIMIT 1
        ) start_snap ON true
        LEFT JOIN LATERAL (
            SELECT followers_total
            FROM analytics_page_health
            WHERE page_id = wp.page_id
                AND record_date <= :end_date
            ORDER BY record_date DESC
            LIMIT 1
        ) end_snap ON true
    ),
    final_filtered AS (
        SELECT * FROM with_followers
        WHERE 
            (:size_filter = 'ALL') OR
            (:size_filter = 'SMALL' AND followers_total < 10000) OR
            (:size_filter = 'MEDIUM' AND followers_total >= 10000 AND followers_total < 100000) OR
            (:size_filter = 'LARGE' AND followers_total >= 100000)
    )
    SELECT 
        *,
        COUNT(*) OVER() AS total_count
    FROM final_filtered
    ORDER BY {sort_metric} {sort_direction}
    LIMIT :per OFFSET :offset
    """

    # Thực thi Query
    result = session.exec(text(query_str), params={
        "start_date": start_date,
        "end_date": end_date,
        "per": per,
        "offset": offset,
        "search": search,
        "status_filter": status or "ALL",
        "size_filter": size or "ALL"
    })
    
    rows = result.fetchall()
    
    if not rows:
        return PageRankingResponse(meta={"page": page, "per": per, "total": 0}, data=[])
    
    total = rows[0].total_count if rows else 0
    
    data = [
        PageRankingItem(
            page_id=row.page_id,
            page_name=row.page_name or "Unknown",
            status=row.status,
            followers_total=row.followers_total or 0,
            followers_delta=row.followers_delta or 0,
            reach=row.reach or 0,
            impressions=row.impressions or 0,
            clicks=row.clicks or 0,
            engagement=row.engagement or 0,
            ctr=float(row.ctr or 0),
            reach_percentile=float(row.reach_percentile or 0),
            clicks_percentile=float(row.clicks_percentile or 0),
            impressions_percentile=float(row.impressions_percentile or 0),
            engagement_percentile=float(row.engagement_percentile or 0)
        )
        for row in rows
    ]
    
    return PageRankingResponse(meta={"page": page, "per": per, "total": total}, data=data)

# ============================================================================
# ENDPOINT 2: PAGE DETAIL
# ============================================================================

@router.get("/pages/{page_id}", response_model=PageDetailResponse)
def get_page_detail(
    page_id: str,
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    session: Session = Depends(get_session)
):
    """Get detailed view of a single page with timeseries and top posts"""
    # Parse dates
    if start and end:
        try:
            start_date = date.fromisoformat(start)
            end_date = date.fromisoformat(end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    else:
        start_date, end_date = get_default_date_range()
    
    # Get page info
    page_query = text("SELECT page_id, page_name, status FROM pages WHERE page_id = :page_id")
    page_result = session.exec(page_query, params={"page_id": page_id})
    page_row = page_result.fetchone()
    
    if not page_row:
        raise HTTPException(status_code=404, detail="Page not found")
    
    # Get timeseries - aggregate per day
    timeseries_query = text("""
        WITH daily_data AS (
            SELECT DISTINCT ON (pm.post_id, ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date)
                ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date AS day_local,
                pm.reach, pm.impressions, pm.clicks,
                COALESCE(pm.reactions, 0) + COALESCE(pm.comments, 0) + COALESCE(pm.shares, 0) AS engagement_value
            FROM analytics_post_metric pm
            JOIN analytics_post_meta am ON am.post_id = pm.post_id
            WHERE am.page_id = :page_id
                AND ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date BETWEEN :start_date AND :end_date
            ORDER BY pm.post_id, day_local, pm.updated_at DESC
        )
        SELECT
            day_local as date,
            COALESCE(SUM(reach), 0) AS reach,
            COALESCE(SUM(impressions), 0) AS impressions,
            COALESCE(SUM(clicks), 0) AS clicks,
            COALESCE(SUM(engagement_value), 0) AS engagement
        FROM daily_data
        GROUP BY day_local
        ORDER BY day_local ASC
    """)
    
    timeseries_result = session.exec(timeseries_query, params={
        "page_id": page_id, 
        "start_date": start_date, 
        "end_date": end_date
    })
    
    timeseries = [
        TimeseriesPoint(
            date=str(row.date),
            reach=row.reach or 0,
            impressions=row.impressions or 0,
            clicks=row.clicks or 0,
            engagement=row.engagement or 0
        )
        for row in timeseries_result.fetchall()
    ]
    
    # Summary
    summary = {
        "reach": sum(t.reach for t in timeseries),
        "impressions": sum(t.impressions for t in timeseries),
        "clicks": sum(t.clicks for t in timeseries),
        "engagement": sum(t.engagement for t in timeseries)
    }
    
    # Top 10 posts - SUM over 7-day window (not just latest snapshot)
    top_posts_query = text("""
        WITH post_daily_snapshots AS (
            SELECT DISTINCT ON (pm.post_id, ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date)
                pm.post_id,
                ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date AS day_local,
                pm.reach, pm.impressions, pm.clicks,
                COALESCE(pm.reactions, 0) + COALESCE(pm.comments, 0) + COALESCE(pm.shares, 0) AS engagement_value,
                am.caption_snippet,
                am.created_time,
                am.permalink
            FROM analytics_post_metric pm
            JOIN analytics_post_meta am ON am.post_id = pm.post_id
            WHERE am.page_id = :page_id
                AND ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date BETWEEN :start_date AND :end_date
            ORDER BY pm.post_id, day_local, pm.updated_at DESC
        ),
        post_aggregated AS (
            SELECT
                post_id,
                MAX(caption_snippet) AS caption_snippet,
                MAX(created_time) AS created_time,
                MAX(permalink) AS permalink,
                SUM(COALESCE(reach, 0)) AS reach,
                SUM(COALESCE(impressions, 0)) AS impressions,
                SUM(COALESCE(clicks, 0)) AS clicks,
                SUM(COALESCE(engagement_value, 0)) AS engagement
            FROM post_daily_snapshots
            GROUP BY post_id
        )
        SELECT * FROM post_aggregated
        ORDER BY clicks DESC NULLS LAST
        LIMIT 10
    """)
    
    top_posts_result = session.exec(top_posts_query, params={
        "page_id": page_id, 
        "start_date": start_date, 
        "end_date": end_date
    })
    
    top_posts = [
        TopPost(
            post_id=row.post_id,
            caption_snippet=row.caption_snippet,
            created_time=row.created_time,
            reach=row.reach or 0,
            impressions=row.impressions or 0,
            clicks=row.clicks or 0,
            engagement=row.engagement or 0,
            ctr=round((row.clicks / row.impressions * 100), 2) if row.impressions and row.impressions > 0 else 0.0,
            permalink=row.permalink
        )
        for row in top_posts_result.fetchall()
    ]
    
    # Followers
    followers_query = text("""
        SELECT
            COALESCE((SELECT followers_total FROM analytics_page_health 
                      WHERE page_id = :page_id AND record_date <= :end_date 
                      ORDER BY record_date DESC LIMIT 1), 0) AS followers_end,
            COALESCE((SELECT followers_total FROM analytics_page_health 
                      WHERE page_id = :page_id AND record_date <= :start_date 
                      ORDER BY record_date DESC LIMIT 1), 0) AS followers_start
    """)
    
    followers_result = session.exec(followers_query, params={
        "page_id": page_id, 
        "start_date": start_date, 
        "end_date": end_date
    })
    followers_row = followers_result.fetchone()
    
    followers_total = followers_row.followers_end if followers_row else 0
    followers_delta = (followers_row.followers_end - followers_row.followers_start) if followers_row else 0
    
    return PageDetailResponse(
        page_id=page_row.page_id,
        page_name=page_row.page_name or "Unknown",
        status=page_row.status,
        followers_total=followers_total,
        followers_delta=followers_delta,
        timeseries=timeseries,
        top_posts=top_posts,
        summary=summary
    )

# ============================================================================
# ENDPOINT 3: TOP POSTS (Paginated)
# ============================================================================

@router.get("/pages/{page_id}/top-posts", response_model=TopPostsResponse)
def get_top_posts(
    page_id: str,
    metric: str = Query("clicks", description="Sort by: reach|impressions|clicks|engagement"),
    start: Optional[str] = Query(None),
    end: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    session: Session = Depends(get_session)
):
    """Get paginated top posts for a page sorted by specified metric"""
    # Validate metric
    valid_metrics = {"reach", "impressions", "clicks", "engagement"}
    if metric not in valid_metrics:
        raise HTTPException(status_code=400, detail=f"Invalid metric. Use: {valid_metrics}")
    
    # Parse dates
    if start and end:
        try:
            start_date = date.fromisoformat(start)
            end_date = date.fromisoformat(end)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format")
    else:
        start_date, end_date = get_default_date_range()
    
    # SUM over 7-day window (not just latest snapshot)
    query = text(f"""
        WITH post_daily_snapshots AS (
            SELECT DISTINCT ON (pm.post_id, ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date)
                pm.post_id,
                ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date AS day_local,
                pm.reach, pm.impressions, pm.clicks,
                COALESCE(pm.reactions, 0) + COALESCE(pm.comments, 0) + COALESCE(pm.shares, 0) AS engagement_value,
                am.caption_snippet,
                am.created_time,
                am.permalink
            FROM analytics_post_metric pm
            JOIN analytics_post_meta am ON am.post_id = pm.post_id
            WHERE am.page_id = :page_id
                AND ((pm.updated_at AT TIME ZONE 'UTC') + INTERVAL '7 hours')::date BETWEEN :start_date AND :end_date
            ORDER BY pm.post_id, day_local, pm.updated_at DESC
        ),
        post_aggregated AS (
            SELECT
                post_id,
                MAX(caption_snippet) AS caption_snippet,
                MAX(created_time) AS created_time,
                MAX(permalink) AS permalink,
                SUM(COALESCE(reach, 0)) AS reach,
                SUM(COALESCE(impressions, 0)) AS impressions,
                SUM(COALESCE(clicks, 0)) AS clicks,
                SUM(COALESCE(engagement_value, 0)) AS engagement
            FROM post_daily_snapshots
            GROUP BY post_id
        )
        SELECT 
            *,
            COUNT(*) OVER() AS total_count
        FROM post_aggregated
        ORDER BY {metric} DESC NULLS LAST
        LIMIT :limit OFFSET :offset
    """)
    
    result = session.exec(query, params={
        "page_id": page_id,
        "start_date": start_date,
        "end_date": end_date,
        "limit": limit,
        "offset": offset
    })
    
    rows = result.fetchall()
    
    if not rows:
        return TopPostsResponse(meta={"limit": limit, "offset": offset, "total": 0}, data=[])
    
    total = rows[0].total_count if rows else 0
    
    data = [
        TopPost(
            post_id=row.post_id,
            caption_snippet=row.caption_snippet,
            created_time=row.created_time,
            reach=row.reach or 0,
            impressions=row.impressions or 0,
            clicks=row.clicks or 0,
            engagement=row.engagement or 0,
            ctr=round((row.clicks / row.impressions * 100), 2) if row.impressions and row.impressions > 0 else 0.0,
            permalink=row.permalink
        )
        for row in rows
    ]
    
    return TopPostsResponse(meta={"limit": limit, "offset": offset, "total": total}, data=data)
