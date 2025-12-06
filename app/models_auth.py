# app/models_auth.py
"""
Authentication models - User and UserPageAccess
"""
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Text
from datetime import datetime


class UserPageAccess(SQLModel, table=True):
    """Many-to-many relationship: User <-> Page"""
    __tablename__ = "user_page_access"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="users.id", index=True)
    page_id: str = Field(foreign_key="pages.page_id", index=True)
    assigned_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    user: Optional["User"] = Relationship(back_populates="page_access")


class User(SQLModel, table=True):
    """Dashboard user with role-based access"""
    __tablename__ = "users"
    
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(unique=True, index=True)
    password_hash: str = Field(sa_column=Column(Text))
    
    # Role: ADMIN (full access) or ANALYST (page-specific access)
    role: str = Field(default="ANALYST")
    
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    # Relationships
    page_access: List[UserPageAccess] = Relationship(back_populates="user")
    
    @property
    def accessible_page_ids(self) -> List[str]:
        """Get list of page_ids this user can access"""
        return [pa.page_id for pa in self.page_access]
