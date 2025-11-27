# app/models.py
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, JSON, Text
from datetime import datetime

# 1. Bảng Page (Đã cập nhật các field mới)
class Page(SQLModel, table=True):
    __tablename__ = "pages"
    page_id: str = Field(primary_key=True)
    # Lưu ý: Bạn đã đổi 'name' -> 'page_name'
    page_name: Optional[str] = None 
    status: Optional[str] = None
    avatar_url: Optional[str] = None
    
    config: Optional["PageConfig"] = Relationship(back_populates="page")

# 2. Bảng PageConfig (Đã thêm schedule, enabled, posts_per_slot)
class PageConfig(SQLModel, table=True):
    __tablename__ = "page_configs"
    
    # Khóa chính
    page_id: str = Field(primary_key=True, foreign_key="pages.page_id")
    
    # 1. Nguồn nội dung
    folder_ids: Optional[str] = None 

    # 2. Quy mô Page (QUAN TRỌNG: Phải khai báo ở đây Code mới hiểu)
    page_scale: str = Field(default="SMALL")

    # 3. Trạng thái Đề xuất
    has_recommendation: bool = Field(default=True)

    # 4. Ghi chú
    note: Optional[str] = Field(default=None, sa_column=Column(Text))

    # Quan hệ
    page: Optional[Page] = Relationship(back_populates="config")
    
# 3. Bảng Folder
class Folder(SQLModel, table=True):
    __tablename__ = "folders"
    id: str = Field(primary_key=True)
    name: str
    parent_id: Optional[str] = None
    created_time: Optional[datetime] = None
    
    images: List["Image"] = Relationship(back_populates="folder")
    caption_data: Optional["FolderCaption"] = Relationship(back_populates="folder")

# 4. Bảng Image
class Image(SQLModel, table=True):
    __tablename__ = "images"
    id: str = Field(primary_key=True)
    name: str
    mime_type: Optional[str] = None
    thumbnail_link: Optional[str] = None
    created_time: Optional[datetime] = None
    folder_id: Optional[str] = Field(default=None, foreign_key="folders.id")
    
    folder: Optional[Folder] = Relationship(back_populates="images")

# 5. Bảng FolderCaption (Đã fix JSON)
class FolderCaption(SQLModel, table=True):
    __tablename__ = "folder_captions"
    folder_id: str = Field(primary_key=True, foreign_key="folders.id")
    folder_name: Optional[str] = None
    
    captions: List[str] = Field(default=[], sa_column=Column(JSON)) 
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    folder: Optional[Folder] = Relationship(back_populates="caption_data")

# 6. Swipe Link
class SwipeLink(SQLModel, table=True):
    __tablename__ = "swipe_links"
    id: str = Field(primary_key=True)
    link: str = Field(sa_column=Column(Text))
    title: Optional[str] = None
    is_active: bool = True
    
    usages: List["SwipeLinkUsage"] = Relationship(back_populates="link")

# 7. Swipe Link Usage
class SwipeLinkUsage(SQLModel, table=True):
    __tablename__ = "swipe_link_usages"
    id: Optional[int] = Field(default=None, primary_key=True)
    page_id: str = Field(foreign_key="pages.page_id")
    swipe_link_id: str = Field(foreign_key="swipe_links.id")
    
    link: SwipeLink = Relationship(back_populates="usages")

# ANALYTICS & INSIGHTS (Time-Series)

# 8. Sức khỏe Page theo ngày (Lưu lịch sử biến động)
class PageHealth(SQLModel, table=True):
    __tablename__ = "analytics_page_health"
    
    # Khóa chính phức hợp (Composite Key) giả lập
    # Lưu ý: SQLModel chưa hỗ trợ composite PK trực tiếp tốt, nên ta dùng ID tự tăng
    # và đặt UniqueConstraint ở mức DB (sẽ xử lý sau nếu cần).
    id: Optional[int] = Field(default=None, primary_key=True)
    
    page_id: str = Field(foreign_key="pages.page_id", index=True)
    record_date: datetime = Field(index=True)  # Ngày ghi nhận (YYYY-MM-DD)
    
    # Chỉ số Tăng trưởng (Growth)
    followers_total: int = Field(default=0)
    followers_new: int = Field(default=0)
    unfollows: int = Field(default=0)
    net_follows: int = Field(default=0)
    
    # Chỉ số Hiệu suất (Performance)
    total_reach: int = Field(default=0)       # Reach toàn trang trong ngày
    total_interaction: int = Field(default=0) # Tổng tương tác
    link_clicks: int = Field(default=0)       # Tổng click link
    
    # Quan hệ
    page: Optional[Page] = Relationship()

# 9. Metadata Bài viết (Lưu thông tin tĩnh, chỉ tạo 1 lần)
class PostMeta(SQLModel, table=True):
    __tablename__ = "analytics_post_meta"
    
    post_id: str = Field(primary_key=True)
    page_id: str = Field(foreign_key="pages.page_id", index=True)
    
    created_time: datetime = Field(index=True) # Thời gian đăng bài gốc
    
    post_type: Optional[str] = None        # PHOTO, VIDEO, ALBUM, STATUS...
    permalink: Optional[str] = None        # Link gốc bài viết
    caption_snippet: Optional[str] = None  # 50 ký tự đầu để nhận diện nội dung
    
    # Quan hệ
    metrics: List["PostMetric"] = Relationship(back_populates="post_meta")

# 10. Chỉ số Bài viết (Lưu Snapshot biến động)
class PostMetric(SQLModel, table=True):
    __tablename__ = "analytics_post_metric"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    post_id: str = Field(foreign_key="analytics_post_meta.post_id", index=True)
    
    updated_at: datetime = Field(default_factory=datetime.utcnow) # Thời điểm quét
    
    # Các chỉ số Engagement (Analyst cần cái này để tính tỷ lệ)
    reach: int = Field(default=0)
    impressions: int = Field(default=0)
    
    reactions: int = Field(default=0)
    comments: int = Field(default=0)
    shares: int = Field(default=0)
    clicks: int = Field(default=0)     # Tổng click (ảnh + link)
    other_clicks: int = Field(default=0) # Click tiêu đề/xem thêm...
    
    # Cờ đánh dấu để tối ưu hiệu năng quét
    is_final: bool = Field(default=False) # Nếu bài > 7 ngày -> True -> Extension sẽ bỏ qua không quét nữa
    
    post_meta: Optional[PostMeta] = Relationship(back_populates="metrics")