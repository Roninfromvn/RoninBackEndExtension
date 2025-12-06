# init_admin.py
"""
Script to create the initial admin user
Run: python init_admin.py
"""
import os
import sys
import bcrypt
from sqlmodel import Session, select
from dotenv import load_dotenv

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

load_dotenv()

from app.database import engine
from app.models_auth import User

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()

def create_admin():
    # Get credentials from env or use defaults
    username = os.getenv("ADMIN_USERNAME", "admin")
    password = os.getenv("ADMIN_PASSWORD", "admin123")
    
    with Session(engine) as session:
        # Check if admin exists
        existing = session.exec(select(User).where(User.username == username)).first()
        if existing:
            print(f"❌ User '{username}' already exists!")
            return
        
        # Create admin
        admin = User(
            username=username,
            password_hash=hash_password(password),
            role="ADMIN",
            is_active=True
        )
        session.add(admin)
        session.commit()
        
        print(f"✅ Admin user created!")
        print(f"   Username: {username}")
        print(f"   Password: {password}")
        print(f"   Role: ADMIN")
        print()
        print("⚠️  Change the password after first login!")

if __name__ == "__main__":
    create_admin()
