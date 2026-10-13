MUST READ rule.md
# RULES.md — Quy tắc làm việc nhóm RideShift (C1SE.48)

> **Đọc hết file này trước khi viết dòng code đầu tiên.**
> PR đầu tiên của bạn phải có dòng: *"Tôi đã đọc và cam kết tuân theo RULES.md"*.

## ⚡ Nguyên tắc số 0

> **AI code được, nhưng bạn là người chịu trách nhiệm.**
> Mọi dòng code được merge đều mang tên bạn. Khi bảo vệ, hội đồng hỏi *"đoạn này hoạt động thế nào? vì sao chọn cách này?"* — bạn phải trả lời được. **Không hiểu = không được merge.**

---

## 1. Bốn điều cấm tuyệt đối (vi phạm = revert ngay lập tức)

| # | Điều cấm | Lý do |
|---|----------|-------|
| 1 | **Push thẳng vào nhánh `main`** | `main` phải luôn chạy được — bất cứ lúc nào cũng phải demo được cho hội đồng |
| 2 | **Commit `.env`, key, mật khẩu, DSN, token** | Repo đã lên GitHub — lộ secret là mất cả hệ thống. Lỡ tay commit thì **báo nhóm NGAY + đổi key ngay** (xóa commit không đủ, history vẫn còn) |
| 3 | **DROP / ALTER / TRUNCATE bảng, đổi schema DB khi chưa có sự đồng ý của nhóm** | Database là tài sản chung — đổi schema làm gãy backend của tất cả mọi người |
| 4 | **Force push / sửa lịch sử commit trên nhánh dùng chung** | Gãy history = vô tình xóa code của người khác |

---

## 2. Quy trình Git cho 1 task

**Nhánh & commit:**
- Tên nhánh: `feat/<ten-task>`, `fix/<ten-task>`, `docs/<ten-task>`, `db/<ten-task>` — không dấu, gạch ngang. Ví dụ: `feat/login-user`.
- Trước khi bắt đầu task: `git pull origin main`, tạo nhánh mới từ `main` mới nhất. Làm lâu quá 2 ngày thì merge `main` về nhánh mình 1 lần để tránh xung đột dồn cuối.
- Commit message: `Task <số>: <mô tả ngắn>` (không dấu). Một commit = một việc. Commit nhỏ, thường xuyên — đừng 3 ngày mới commit một lần 800 dòng.
- Cấm commit: `node_modules/`, `.next/`, file binary lớn, dump DB, ảnh chụp màn hình không liên quan, file config cá nhân.

**Pull Request:**
- 1 PR = 1 task. PR thay đổi quá ~400 dòng nên tách nhỏ thành nhiều PR.
- Tiêu đề PR: `[Task <số>] <mô tả>`.
- Mô tả PR bắt buộc có 3 phần: **(1)** làm gì, **(2)** cách kiểm chứng — các bước để người khác tự chạy thử, **(3)** ảnh chụp màn hình nếu sửa UI. *Sửa UI không có ảnh = không review.*
- Cần **≥ 1 người review và approve** trước khi merge. Đây cũng là điểm cộng rubric phần làm việc nhóm.
- Merge bằng merge commit hoặc squash — không rebase nhánh chung. Sau merge: xóa nhánh feature.

---

## 3. Vibe code an toàn — 9 điều khi làm việc cùng AI

1. **Không commit code bạn không giải thích được.** Trước khi commit, tự hỏi: *"Nếu hội đồng hỏi về đoạn này, tôi trả lời sao?"*
2. **Không cài package AI gợi ý khi chưa kiểm chứng.** AI bịa tên thư viện rất giỏi (hallucination). Kiểm tra package có tồn tại thật không (trang npm/PyPI), còn được maintain không, có đủ người dùng không — rồi đề xuất nhóm duyệt (mục 4).
3. **Không dán nguyên file 500 dòng AI tạo ra đè lên file đang có.** Yêu cầu AI sửa đúng phần cần sửa; đọc kỹ diff trước khi commit.
4. **Không dán secret/key/mật khẩu/DSN vào prompt AI** hay công cụ online.
5. **Chạy lint + tự chạy thử app trước khi mở PR.** Code "trông hợp lý" chưa đủ — phải chạy được bằng tay.
6. **AI tạo dữ liệu mẫu → bắt buộc gắn nhãn DEMO.** Không bao giờ để dữ liệu bịa trông giống dữ liệu đo thật (bài học AQI: lớp AQI chỉ là demo nên phải dán nhãn DEMO ở mọi chỗ hiển thị).
7. **Kết quả sai lệch so với trước đó → DỪNG và hỏi nhóm**, đừng bảo AI "fix tiếp" rồi vỡ thêm.
8. **Một phiên AI = một phạm vi nhỏ.** Đừng yêu cầu "làm luôn tính năng X + Y + Z" trong một lần — tách task, tách PR.
9. **Prompt tốt là tài liệu.** Prompt viết rõ ràng cho AI nên được lưu tóm tắt vào worklog — đó chính là tài liệu thiết kế miễn phí.

---

## 4. Stack công nghệ — được phép & cấm

**Chuẩn dự án (được phép dùng):**
- Frontend: Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui + Lucide icons.
- Backend: FastAPI (Python) trong `mini-services/fastapi-backend/`.
- Database: PostgreSQL + PostGIS.
- Gói quản lý: bun hoặc npm cho frontend, pip cho backend.

**Cấm:**
- Thêm framework/thư viện lớn mới (UI kit khác, ORM khác, DB khác, state management khác…) khi chưa được nhóm đồng ý — đề xuất qua nhóm chat kèm lý do và link package.
- Chuyển TypeScript sang JavaScript; lạm dụng `any` để "cho nhanh".
- Tự viết lại component mà shadcn/ui đã có sẵn.
- Đổi cấu trúc thư mục, đổi tên file dùng chung mà không thông báo.

---

## 5. Phân khu vực file — ai được sửa gì

**Khu vực dùng chung — sửa phải thông báo trước trong nhóm chat:**
- Schema DB (`prisma/`, các file SQL migration), backend API (`mini-services/fastapi-backend/`) — vì sửa làm ảnh hưởng interface cho mọi người.
- `docs/` — lưu ý: sửa file `docs/*.md` xong phải chạy lại script build docs để cập nhật tab **Tài liệu** trong app.
- `worklog.md`, `RULES.md`, file cấu hình gốc (`package.json`, `tsconfig.json`, Caddyfile, Dockerfile, docker-compose.yml…).

**Khu vực theo feature — tự do trong phạm vi được giao:**
- Ai nhận task nào thì code trong component/thư mục của feature đó.
- Cần sửa file của người khác: bình luận trong PR của họ, **không tự sửa dùm** trong PR của mình.

---

## 6. Database & dữ liệu

- Không DROP/TRUNCATE/ALTER khi chưa có đồng thuận; không đụng thư mục dữ liệu nội bộ (`pgdata/`, `db/custom.db`).
- Migration/schema mới phải có file SQL (hoặc script) trong repo để người khác dựng lại DB từ đầu được.
- Dữ liệu demo/mô phỏng phải: **(1)** tên file/bảng/ghi chú nói rõ là demo, **(2)** gắn nhãn DEMO trên UI nếu hiển thị cho người dùng.
- Số liệu trong dashboard phải khai báo nguồn (bảng nào, bao nhiêu dòng, lấy lúc nào) — không "chém" số đẹp.
- Không hardcode đường dẫn tuyệt đối hay `localhost:PORT` trong code dùng chung — cấu hình qua biến môi trường; giữ file `.env.example` cập nhật khi thêm biến mới.

---

## 7. Bảo mật & dữ liệu người dùng — mục chấm điểm, đừng mất điểm oan

- Mật khẩu: **bắt buộc hash bằng bcrypt hoặc argon2** — không bao giờ plaintext, không MD5/SHA thuần. Dòng dữ liệu trong DB phải thấy `$2b$…` hoặc `$argon2id$…`.
- Không log mật khẩu, token, thông tin cá nhân vào console, log file, hay bảng `system_logs`.
- Session/cookie: HttpOnly + Secure + SameSite, có thời hạn, đăng xuất phải thu hồi được.
- Guest không lưu gì; Registered user lưu **tối thiểu** thông tin; lịch sử hành trình chỉ lưu khi người dùng đồng ý; phải có chức năng xóa tài khoản/xóa dữ liệu.
- API quản trị phải kiểm tra quyền ở **backend**, không chỉ ẩn nút ở frontend.
- Có giới hạn số lần thử đăng nhập sai (chống dò mật khẩu).

---

## 8. Giao diện — quy ước UI/UX

- Toàn bộ text hiển thị cho người dùng: **tiếng Việt có dấu đầy đủ**. Tên biến/hàm/comment: tiếng Anh.
- Dùng component shadcn/ui có sẵn; màu theo token (`bg-primary`, `text-primary`…); không tự trộn màu lộn xộn.
- Mobile-first: mọi tính năng phải dùng được trên màn hình điện thoại.
- Ba trạng thái không được bỏ: **loading** (spinner/skeleton), **error** (thông báo rõ), **empty** (danh sách rỗng có thông điệp).
- Footer bám đáy màn hình; danh sách dài phải có `max-height` + scroll + thanh cuộn đẹp.

---

## 9. Definition of Done — task chỉ được gọi là XONG khi

- [ ] Lint sạch (`bun run lint` hoặc `npm run lint`).
- [ ] Tự chạy thử tính năng bằng tay từ đầu đến cuối (không phải "AI bảo là chạy được").
- [ ] Không phá tính năng cũ (mở thử vài tính năng chính trước khi PR).
- [ ] Trong diff không có secret, `console.log`/`print` debug thừa, code chết, đường dẫn cá nhân.
- [ ] Commit đúng format, push lên nhánh riêng, PR có mô tả + ảnh (nếu sửa UI).
- [ ] Đã append vào `worklog.md` (template mục 10).

---

## 10. worklog.md — nhật ký dùng chung (bắt buộc)

Trước khi làm task: đọc vài entry cuối của `worklog.md` để biết người trước đã làm gì — tránh làm trùng, làm sai hướng.

Sau khi XONG task: **append (không ghi đè)** vào cuối `worklog.md` theo đúng template:

```markdown
---
Task ID: <số task, ví dụ 47; nhiều người song song thì 47-a, 47-b>
Agent: <tên bạn>
Task: <mô tả task được giao>

Work Log:
- <bước cụ thể 1>
- <bước cụ thể 2>

Stage Summary:
- <kết quả chính / quyết định quan trọng / artifact tạo ra>
```

---

## 11. Checklist tự soi trước khi mở PR (lỗi vibe code kinh điển)

- [ ] Có file nào trong diff mà tôi không biết vì sao nó bị đổi? → revert file đó.
- [ ] Có package nào mới cài mà nhóm chưa duyệt? → gỡ hoặc xin duyệt.
- [ ] Có secret hay đường dẫn máy cá nhân (`C:\Users\…`, `/home/…`) sót trong code? → xóa, chuyển sang biến môi trường.
- [ ] Còn `console.log` / `print` debug? → xóa.
- [ ] UI có vỡ trên điện thoại không? → thử responsive.
- [ ] Text UI có lẫn lộn tiếng Anh – tiếng Việt? → thống nhất tiếng Việt.
- [ ] Tôi có giải thích được từng phần chính trong diff không? → không thì hỏi lại AI hoặc người giúp.

---

## 12. Khi bế tắc

1. Tự xử lý tối đa 45–60 phút (hỏi AI, đọc log, đọc `worklog.md`).
2. Không được thì hỏi nhóm, kèm đủ 3 thứ: **ảnh/lỗi log đầy đủ + đã thử những gì + nhánh/commit đang chạy**.
3. Không âm thầm bỏ task mà không báo — task treo làm người khác chặn chân.
4. Tranh chấp kỹ thuật (kiến trúc, schema, thư viện): leader quyết sau khi nghe ý kiến — không ai tự ý "vibe" theo ý riêng.

---

*File này là "hiến pháp" của nhóm: đề xuất sửa RULES.md qua PR và phải được leader approve.*
*RULES.md v1.0 — 13/10/2026 — C1SE.48 RideShift*
