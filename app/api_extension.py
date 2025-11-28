# app/api_extension.py
from fastapi import APIRouter, Depends, HTTPException, Response
from sqlmodel import Session
from app.database import get_session
from app.drive_service import download_image_from_drive
from app.content_service import generate_regular_post, generate_story_post

router = APIRouter()

@router.get("/image/{file_id}")
def get_image_proxy(file_id: str):
    image_stream = download_image_from_drive(file_id)
    if not image_stream: raise HTTPException(404, "Image not found on Drive")
    header = image_stream.read(4)
    image_stream.seek(0)
    mime = "image/jpeg"
    if header.startswith(b'\x89PNG'): mime = "image/png"
    elif header.startswith(b'GIF8'): mime = "image/gif"
    elif header.startswith(b'RIFF') and b'WEBP' in image_stream.read(12): 
        image_stream.seek(0); mime = "image/webp"
    else: image_stream.seek(0)
    return Response(content=image_stream.read(), media_type=mime)

@router.get("/post/{page_id}")
def get_post(page_id: str, session: Session = Depends(get_session)):
    res = generate_regular_post(session, page_id)
    if "error" in res: raise HTTPException(404, res["error"])
    return res

@router.get("/story/{page_id}")
def get_story(page_id: str, session: Session = Depends(get_session)):
    res = generate_story_post(session, page_id)
    if "error" in res: raise HTTPException(404, res["error"])
    return res