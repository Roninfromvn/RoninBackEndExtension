from typing import Optional, List, Dict, Any
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, JSON, Text
from datetime import datetime

# --- GIỮ NGUYÊN CÁC BẢNG PAGE, PAGECONFIG, FOLDER, IMAGE ---
class Page(SQLModel, table=True):
    __tablename__ = "pages"
    page_id: str = Field(primary_key=True)
    name: Optional[str] = None
    page_name: Optional[str] = None
    status: Optional[str] = None
    avatar_url: Optional[str] = None
    config: Optional["PageConfig"] = Relationship(back_populates="page")

class PageConfig(SQLModel, table=True):
    __tablename__ = "page_configs"
    page_id: str = Field(primary_key=True, foreign_key="pages.page_id")
    enabled: bool = Field(default=True)
    folder_ids: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    schedule: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    posts_per_slot: int = Field(default=1)
    caption_by_folder: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    default_caption: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    page: Optional[Page] = Relationship(back_populates="config")

class Folder(SQLModel, table=True):
    __tablename__ = "folders"
    id: str = Field(primary_key=True)
    name: str
    parent_id: Optional[str] = None
    created_time: Optional[datetime] = None
    
    images: List["Image"] = Relationship(back_populates="folder")
    # Quan hệ 1-1: Một folder có 1 dòng chứa danh sách caption
    caption_data: Optional["FolderCaption"] = Relationship(back_populates="folder")

class Image(SQLModel, table=True):
    __tablename__ = "images"
    id: str = Field(primary_key=True)
    name: str
    mime_type: Optional[str] = None
    thumbnail_link: Optional[str] = None
    created_time: Optional[datetime] = None
    folder_id: Optional[str] = Field(default=None, foreign_key="folders.id")
    folder: Optional[Folder] = Relationship(back_populates="images")

# --- SỬA LẠI 2 BẢNG BÊN DƯỚI ---

# 5. Bảng Caption (Sửa đổi lớn: folder_id là PK, captions là JSON)
class FolderCaption(SQLModel, table=True):
    __tablename__ = "folder_captions"
    # Dựa vào data bạn gửi, folder_id đóng vai trò khóa chính
    folder_id: str = Field(primary_key=True, foreign_key="folders.id")
    folder_name: Optional[str] = None
    
    # Map cột jsonb sang List[str] của Python
    captions: List[str] = Field(default=[], sa_column=Column(JSON)) 
    
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    
    folder: Optional[Folder] = Relationship(back_populates="caption_data")

# 6. Swipe Link (Sửa id thành str, url thành link)
class SwipeLink(SQLModel, table=True):
    __tablename__ = "swipe_links"
    id: str = Field(primary_key=True) # Sửa thành String
    link: str = Field(sa_column=Column(Text)) # Dùng tên cột là link
    title: Optional[str] = None
    is_active: bool = True
    
    usages: List["SwipeLinkUsage"] = Relationship(back_populates="link")

class SwipeLinkUsage(SQLModel, table=True):
    __tablename__ = "swipe_link_usages"
    id: Optional[int] = Field(default=None, primary_key=True)
    page_id: str = Field(foreign_key="pages.page_id")
    swipe_link_id: str = Field(foreign_key="swipe_links.id") # Sửa thành String cho khớp
    
    link: SwipeLink = Relationship(back_populates="usages")