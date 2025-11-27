from sqlmodel import create_engine, Session
from dotenv import load_dotenv
import os

# Load biến môi trường từ file .env
load_dotenv()

database_url = os.getenv("DATABASE_URL")

# Tạo engine kết nối
engine = create_engine(database_url, echo=False) # echo=True nếu muốn xem log SQL

def get_session():
    with Session(engine) as session:
        yield session