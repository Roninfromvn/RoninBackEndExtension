# TÀI LIỆU THIẾT KẾ: RONIN HYBRID MODE (CLOUD + LOCAL)

**Phiên bản:** 3.0  
**Ngày cập nhật:** 2024-12-08

---

## 1. MỤC TIÊU

Thêm khả năng **lấy content từ Local** song song với Cloud (Google Drive) hiện tại.

| Mode | Nguồn ảnh | Use case |
|------|-----------|----------|
| **Cloud Mode** (hiện tại) | Google Drive | Chạy trên VPS, không có ảnh local |
| **Local Mode** (thêm mới) | Folder trên máy tính | Chạy trên máy nhân viên |

---

## 2. THAY ĐỔI TỔNG QUAN

### 2.1. Backend (Cloud)

**Thêm mới:**
- Hệ thống **User Account** (username/password)
- User có thể:
  - Đăng nhập **Dashboard** → xem Analytics của các Page được assign
  - Đăng nhập **Agent (Windows)** → config Local Mode

### 2.2. Agent (Windows App - MỚI)

- Ứng dụng chạy trên máy nhân viên
- Đăng nhập bằng tài khoản từ Backend
- Hiển thị danh sách **Page được assign**
- Cho phép config từng Page:
  - Folder POST path
  - Folder STORY path
- Lưu config vào **SQLite local** (`agent.db`)
- Serve API `localhost:3333` cho Extension

### 2.3. Extension

**Thêm mới:**
- Tab **LocalPilot** (giống AutoPilot, đổi endpoint sang `localhost:3333`)

---

## 3. LUỒNG HOẠT ĐỘNG

### 3.1. Cloud Mode (giữ nguyên)

```
Extension (AutoPilot) 
    → Backend /api/post/{page_id}
    → Query DB: PageConfig → Folder → random Image
    → Lấy Caption từ FolderCaption (theo folder)
    → Trả image_url + caption
    → Extension fetch ảnh từ Drive proxy
    → Đăng FB
```

### 3.2. Local Mode (thêm mới)

```
Extension (LocalPilot)
    → Agent localhost:3333/api/post/{page_id}
    → Query agent.db: PageConfig → folder_path
    → Scan folder → random 1 file ảnh
    → Đọc captions.txt trong folder → random 1 caption
    → Trả image (base64 hoặc URL) + caption
    → Extension đăng FB
```

---

## 4. CHI TIẾT KỸ THUẬT

### 4.1. Backend - User Account

**Database:**
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'user',  -- 'admin' hoặc 'user'
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE page_assignments (
    user_id INTEGER REFERENCES users(id),
    page_id VARCHAR(50) REFERENCES pages(page_id),
    PRIMARY KEY (user_id, page_id)
);
```

**API:**
```
POST /api/auth/login
Body: { username, password }
Response: { token, user_id, role }

GET /api/auth/my-pages
Header: Authorization: Bearer {token}
Response: [
    { page_id: "123", page_name: "Page A" },
    { page_id: "456", page_name: "Page B" }
]
```

### 4.2. Agent (Windows App)

**Chức năng:**
1. **Login Screen:** Nhập username/password → gọi Backend `/api/auth/login`
2. **Main Screen:** 
   - Hiển thị danh sách Page được assign (từ `/api/auth/my-pages`)
   - Cho phép config từng Page:
     - `Folder POST`: Chọn folder chứa ảnh cho Feed
     - `Folder STORY`: Chọn folder chứa ảnh cho Story
   - Nhập **danh sách Link** (cho Story swipe-up)
3. **Local Server:** Chạy FastAPI trên `localhost:3333`

**Local Database (`agent.db`):**
```sql
-- Config folder cho từng Page
CREATE TABLE page_folder_config (
    page_id TEXT PRIMARY KEY,
    folder_post_path TEXT,
    folder_story_path TEXT
);

-- Pool link cho Story (dùng chung)
CREATE TABLE swipe_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link TEXT NOT NULL
);
```

**Caption:** Đọc từ file `captions.txt` trong folder, mỗi dòng 1 caption.

```
D:\Images\Giay_POST\
  ├── img_001.jpg
  ├── img_002.jpg
  └── captions.txt   ← Agent đọc file này
```

**API Local:**
```
GET /api/post/{page_id}
Response: {
    "type": "POST",
    "page_id": "123",
    "image_url": "http://localhost:3333/images/abc.jpg",  
    // hoặc "image_base64": "data:image/jpeg;base64,..."
    "caption": "Random caption từ captions.txt"
}

GET /api/story/{page_id}
Response: {
    "type": "STORY",
    "page_id": "123",
    "image_url": "...",
    "swipe_link": "Random link từ pool"
}

GET /api/health
Response: { "status": "ok" }
```

### 4.3. Extension - LocalPilot Tab

**Logic:** Clone từ AutoPilot, thay đổi:

```typescript
// AutoPilot (Cloud)
const BACKEND_URL = "https://api.roninfromvn.pp.ua";
const endpoint = `${BACKEND_URL}/api/post/${pageId}`;

// LocalPilot (Local)
const AGENT_URL = "http://localhost:3333";
const endpoint = `${AGENT_URL}/api/post/${pageId}`;
```

**UI:**
- Hiển thị trạng thái Agent: "Connected" / "Disconnected"
- Nếu Agent không chạy → disable các nút, hiển thị hướng dẫn

---

## 5. ROADMAP

### Phase 1: Backend User System (1-2 ngày)
- [ ] Tạo bảng `users`, `page_assignments`
- [ ] API `/auth/login`, `/auth/my-pages`
- [ ] Dashboard: Trang quản lý User + gán Page

### Phase 2: Agent Windows App (3-4 ngày)
- [ ] Setup project Python + UI (CustomTkinter/Flet)
- [ ] Login screen
- [ ] Main screen: list pages + config folders
- [ ] Local SQLite database
- [ ] FastAPI server localhost:3333
- [ ] Đóng gói .exe (PyInstaller)

### Phase 3: Extension LocalPilot (1-2 ngày)
- [ ] Thêm tab LocalPilot
- [ ] Health check Agent
- [ ] Logic gọi API local

### Phase 4: Testing (1-2 ngày)
- [ ] Test Cloud Mode không bị ảnh hưởng
- [ ] Test Local Mode end-to-end
- [ ] Test edge cases (folder rỗng, Agent tắt...)

---

## 6. TÓM TẮT

| Thành phần | Thay đổi |
|------------|----------|
| **Backend** | Thêm User + Page Assignment |
| **Dashboard** | Thêm trang quản lý User |
| **Agent** | Tạo mới (Windows app) |
| **Extension** | Thêm tab LocalPilot |

| | Cloud Mode | Local Mode |
|--|------------|------------|
| Ảnh | Google Drive | Local Folder |
| Caption | DB: `FolderCaption` | File: `folder/captions.txt` |
| Link (Story) | DB: `SwipeLink` | Agent DB: `swipe_links` |
| Endpoint | `BACKEND_URL` | `localhost:3333` |
