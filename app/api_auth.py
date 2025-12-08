# app/api_auth.py
"""
Authentication API endpoints
- POST /api/auth/login - Login with username/password
- GET /api/auth/me - Get current user info
- POST /api/auth/logout - Logout (invalidate token)
"""
import os
import bcrypt
import jwt
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Header
from pydantic import BaseModel
from sqlmodel import Session, select

from app.database import get_session
from app.models_auth import User, UserPageAccess

router = APIRouter()

# Config
JWT_SECRET = os.getenv("JWT_SECRET", "ronin-super-secret-key-change-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_DAYS = 7


# Request/Response models
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    old_password: str
    new_password: str


class LoginResponse(BaseModel):
    token: str
    user: dict


class UserResponse(BaseModel):
    id: int
    username: str
    role: str
    accessible_page_ids: list[str]


# Helper functions
def hash_password(password: str) -> str:
    """Hash password using bcrypt"""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    return bcrypt.checkpw(password.encode(), hashed.encode())


def create_token(user_id: int) -> str:
    """Create JWT token with 7-day expiry"""
    payload = {
        "user_id": user_id,
        "exp": datetime.utcnow() + timedelta(days=JWT_EXPIRE_DAYS),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """Decode and validate JWT token"""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None


# Dependency: Get current user from token
async def get_current_user(
    authorization: str = Header(None),
    session: Session = Depends(get_session)
) -> User:
    """Extract user from Authorization header"""
    if not authorization:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    
    # Support both "Bearer <token>" and just "<token>"
    token = authorization.replace("Bearer ", "") if authorization.startswith("Bearer ") else authorization
    
    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    user = session.get(User, payload["user_id"])
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    
    # Load page access relationships
    statement = select(UserPageAccess).where(UserPageAccess.user_id == user.id)
    user.page_access = list(session.exec(statement))
    
    return user


# Optional: Get user if token provided, None otherwise
async def get_optional_user(
    authorization: str = Header(None),
    session: Session = Depends(get_session)
) -> Optional[User]:
    """Get user if token provided, None otherwise (for dual-mode endpoints)"""
    if not authorization:
        return None
    try:
        return await get_current_user(authorization, session)
    except HTTPException:
        return None


# Endpoints
@router.post("/auth/login", response_model=LoginResponse)
async def login(request: LoginRequest, session: Session = Depends(get_session)):
    """Login with username and password"""
    # Find user
    statement = select(User).where(User.username == request.username)
    user = session.exec(statement).first()
    
    if not user:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    if not user.is_active:
        raise HTTPException(status_code=401, detail="Account is disabled")
    
    if not verify_password(request.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    
    # Load page access
    statement = select(UserPageAccess).where(UserPageAccess.user_id == user.id)
    user.page_access = list(session.exec(statement))
    
    # Create token
    token = create_token(user.id)
    
    return LoginResponse(
        token=token,
        user={
            "id": user.id,
            "username": user.username,
            "role": user.role,
            "accessible_page_ids": user.accessible_page_ids
        }
    )


@router.get("/auth/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    """Get current logged-in user info"""
    return UserResponse(
        id=user.id,
        username=user.username,
        role=user.role,
        accessible_page_ids=user.accessible_page_ids
    )


@router.post("/auth/logout")
async def logout():
    """Logout - client should discard token"""
    # JWT is stateless, so just return success
    # Client is responsible for removing the token
    return {"message": "Logged out successfully"}


@router.post("/auth/change-password")
async def change_password(
    request: ChangePasswordRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user)
):
    """Change current user's password"""
    if not verify_password(request.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect old password")
    
    user.password_hash = hash_password(request.new_password)
    session.add(user)
    session.commit()
    
    return {"message": "Password updated successfully"}



# Thêm vào cuối file app/api_auth.py
from app.auth import verify_api_key

async def verify_stats_access(
    user: Optional[User] = Depends(get_optional_user),
    x_ronin_key: str = Header(None)
):
    """
    Cho phép truy cập nếu:
    1. Có User đăng nhập (từ Dashboard)
    2. HOẶC có API Key đúng (từ Extension)
    """
    # Case 1: Dashboard User
    if user:
        return user
    
    # Case 2: Extension (API Key)
    # Tự verify key thủ công vì verify_api_key gốc raise lỗi luôn
    import os
    API_KEY = os.getenv("API_KEY", "DITCONMETHANGPHAPLEDITCONMETHANGPHAPLE")
    if x_ronin_key == API_KEY:
        return None # Valid system key (no specific user)

    # Không thỏa mãn cả 2 -> Chặn
    raise HTTPException(
        status_code=401, 
        detail="Unauthorized: Requires Login or API Key"
    )


# ========== ADMIN: User Management ==========

class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: str = "EMPLOYEE"  # ADMIN, ANALYST, EMPLOYEE


class UpdateUserRequest(BaseModel):
    role: Optional[str] = None
    is_active: Optional[bool] = None


# Dependency: Require Admin role
async def require_admin(user: User = Depends(get_current_user)):
    if user.role != "ADMIN":
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


# List all users
@router.get("/admin/users")
async def list_users(
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    users = session.exec(select(User)).all()
    result = []
    for u in users:
        # Load page access
        accesses = session.exec(
            select(UserPageAccess).where(UserPageAccess.user_id == u.id)
        ).all()
        result.append({
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "is_active": u.is_active,
            "page_count": len(accesses)
        })
    return result


# Create new user
@router.post("/admin/users")
async def create_user(
    request: CreateUserRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    # Validate role
    valid_roles = ["ADMIN", "ANALYST", "EMPLOYEE"]
    if request.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Use: {valid_roles}")
    
    # Check duplicate username
    existing = session.exec(select(User).where(User.username == request.username)).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    # Create user
    user = User(
        username=request.username,
        password_hash=hash_password(request.password),
        role=request.role,
        is_active=True
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    
    return {"id": user.id, "username": user.username, "role": user.role}


# Update user
@router.patch("/admin/users/{user_id}")
async def update_user(
    user_id: int,
    request: UpdateUserRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if request.role is not None:
        valid_roles = ["ADMIN", "ANALYST", "EMPLOYEE"]
        if request.role not in valid_roles:
            raise HTTPException(status_code=400, detail=f"Invalid role. Use: {valid_roles}")
        user.role = request.role
    
    if request.is_active is not None:
        user.is_active = request.is_active
    
    session.add(user)
    session.commit()
    
    return {"id": user.id, "username": user.username, "role": user.role, "is_active": user.is_active}


# Delete user
@router.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Prevent self-delete
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    
    # Delete page access first
    accesses = session.exec(select(UserPageAccess).where(UserPageAccess.user_id == user_id)).all()
    for access in accesses:
        session.delete(access)
    
    session.delete(user)
    session.commit()
    
    return {"message": f"User {user.username} deleted"}


# ========== ADMIN: Page Assignment ==========

class AssignPagesRequest(BaseModel):
    page_ids: list[str]


# Get user's assigned pages
@router.get("/admin/users/{user_id}/pages")
async def get_user_pages(
    user_id: int,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    accesses = session.exec(
        select(UserPageAccess).where(UserPageAccess.user_id == user_id)
    ).all()
    
    return {
        "user_id": user_id,
        "username": user.username,
        "page_ids": [a.page_id for a in accesses]
    }


# Assign pages to user (replace all)
@router.put("/admin/users/{user_id}/pages")
async def assign_pages(
    user_id: int,
    request: AssignPagesRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Clear old assignments
    old_accesses = session.exec(
        select(UserPageAccess).where(UserPageAccess.user_id == user_id)
    ).all()
    for access in old_accesses:
        session.delete(access)
    
    # Add new assignments
    for page_id in request.page_ids:
        access = UserPageAccess(user_id=user_id, page_id=page_id)
        session.add(access)
    
    session.commit()
    
    return {
        "user_id": user_id,
        "assigned_pages": request.page_ids,
        "count": len(request.page_ids)
    }


# Add single page to user
@router.post("/admin/users/{user_id}/pages/{page_id}")
async def add_page_to_user(
    user_id: int,
    page_id: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Check if already assigned
    existing = session.exec(
        select(UserPageAccess).where(
            UserPageAccess.user_id == user_id,
            UserPageAccess.page_id == page_id
        )
    ).first()
    
    if existing:
        return {"message": "Page already assigned"}
    
    access = UserPageAccess(user_id=user_id, page_id=page_id)
    session.add(access)
    session.commit()
    
    return {"message": f"Page {page_id} assigned to user {user.username}"}


# Remove single page from user
@router.delete("/admin/users/{user_id}/pages/{page_id}")
async def remove_page_from_user(
    user_id: int,
    page_id: str,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin)
):
    access = session.exec(
        select(UserPageAccess).where(
            UserPageAccess.user_id == user_id,
            UserPageAccess.page_id == page_id
        )
    ).first()
    
    if not access:
        raise HTTPException(status_code=404, detail="Assignment not found")
    
    session.delete(access)
    session.commit()
    
    return {"message": f"Page {page_id} removed from user"}