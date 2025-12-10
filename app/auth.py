# app/auth.py
import os
from fastapi import Header, HTTPException

async def verify_api_key(x_ronin_key: str = Header(None)):
    """
    Middleware kiểm tra API key từ header X-Ronin-Key
    """
    API_KEY = os.getenv("RONIN_API_KEY")
    if not API_KEY:
        raise RuntimeError("❌ RONIN_API_KEY must be set in .env!")
    
    if not x_ronin_key:
        raise HTTPException(
            status_code=403, 
            detail="Missing API Key. Please provide X-Ronin-Key header"
        )
    
    if x_ronin_key != API_KEY:
        raise HTTPException(
            status_code=403, 
            detail="Invalid API Key"
        )
    
    return True