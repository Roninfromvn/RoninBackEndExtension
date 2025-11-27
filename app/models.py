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