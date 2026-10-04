# RideShift — Document Map

> Kiểm kê toàn bộ `docs/` ngày 04/10/2026. Trạng thái: 🟢 cập nhật · 🟡 cũ một phần · 🔴 đã lệch so với repo hiện tại.

## Nhóm A — Tài liệu chính thức (capstone submission, đóng băng theo version)

| Tài liệu | Nội dung | Mục đích | Trạng thái |
|---|---|---|---|
| `project-documents/0_C1SE48_ProposalDocument_v1.0.pdf` (65 tr.) | Proposal: problem, 10 objectives, FR-01…15, NFR-01…22, scope, stack, kiến trúc ngữ cảnh, rủi ro, 15 deliverables | **Nguồn yêu cầu gốc** — căn cứ nghiệm thu cấp cao | 🟢 gốc; 🔴 trang bìa sai tên mentor ("Huy, Truong Dinh" = trùng tên thành viên) |
| `project-documents/1_C1SE48_ProjectPlan_v1.0.pdf` (26 tr.) | Sprint 0 + 7 sprint (21/08→06/12/2026), 1.500 giờ, ngân sách 193,55M VND, risk register, 16 deliverable folders, DoD | Lịch trình + phạm vi giao | 🟢 thân bài; 🔴 trang bìa ghi "End 26Dec2026" mâu thuẫn với thân bài 06/12 |
| `project-documents/2_C1SE48_ProductBacklog_v1.0.docx` | 35 PBI chia 6 nhóm, priority + story point + sprint | Danh sách feature ưu tiên | 🟢; 🔴 hyperlink email SM ẩn (`ddolanh0@gmail.com`) khác text hiển thị |
| `project-documents/3_C1SE48_UserStory_v1.0.docx` | 35 US + acceptance criteria chi tiết (US-01…US-35) | **Chuẩn nghiệm thu cấp feature** | 🟢 |
| `project-documents/C1SE48_ProposalDocument_v1.0.docx` | Bản DOCX của proposal | Nguồn chỉnh sửa | 🟢 (trùng nội dung PDF) |

## Nhóm B — Tài liệu kỹ thuật nội bộ (living docs, đối chiếu proposal)

| Tài liệu | Nội dung | Mục đích | Trạng thái |
|---|---|---|---|
| `architecture.md` | Kiến trúc logical + audit proposal §12, luồng analyze 9 bước, rủi ro→mitigation, audit 35 US (đã sửa 14 lệch) | Hiểu hệ thống + chứng minh khớp proposal | 🟡 phần luồng đúng; 🔴 path `mini-services/`, embedded-postgres, gateway — **layout sandbox không còn tồn tại** |
| `db.md` | 11 bảng, dual-mode PostGIS, seed, pipeline, mapping US→bảng | Hiểu schema + data | 🟡 schema đúng; 🔴 §6 ghi "2 zones + 7 rules" — seed thực tế 1 zone active + 2 rules |
| `tech-stack.md` | Audit 15/15 dòng stack §10 | Chứng minh khớp công nghệ | 🟡 tương tự (path cũ) |
| `BACKUP.md` | 4 lớp backup + cơ chế self-heal (keepalive → ensure-backend.sh) | Chống mất dữ liệu sandbox | 🔴 phụ thuộc `scripts/`, `db/pg-snapshot-latest.sql` — không tồn tại trong repo này |
| `TECHNICAL_SPEC.md` | Đặc tả kỹ thuật từ proposal (F1–F12, 36 stories, testing seams) | Căn cứ gap-closure | 🟢 mới (04/10); cần remap sang US-IDs |
| `DOCUMENT_MAP.md` | File này | Bản đồ tài liệu | 🟢 |

## Nhóm C — Dữ liệu nguồn

| Tài liệu | Nội dung | Mục đích |
|---|---|---|
| `data-sources/quy_dinh_vanh_dai_1.txt` | **Chính sách chính thức**: cấm xe máy xăng trong Vành đai 1, 24/7, hiệu lực 01/07/2026; ô tô cá nhân KHÔNG cấm (chỉ phí); thí điểm cuốn chiếu từ Hoàn Kiếm | Nguồn sự thật cho `policy_rule` |
| `data-sources/Hà Nội (phường xã) - 34.geojson` | 126 đơn vị hành chính cấp xã/phường (sáp nhập 2025): mã, tên, dân số, diện tích, mật độ | Lớp nền bản đồ 3D (`frontend/public/data/hanoi-wards.geojson` = cùng 126 features) |

## Nhóm D — Tư liệu / công cụ

| Tài liệu | Nội dung | Mục đích | Trạng thái |
|---|---|---|---|
| `db-erd.html` + `db-erd.png` | ERD 11 bảng, 3 FK cứng + tham chiếu logic | Tài liệu thiết kế DB (Deliverable) | 🟡 đúng cấu trúc; 🔴 header PNG ghi path cũ `mini-services/...` |
| `db-schema.sql` | Schema + comment mapping US | Bản export chú thích | 🟡 bản copy thứ 3 của schema (chỉ khác comment) — rủi ro drift |
| `shot_erd.py` | Playwright render ERD PNG | Regenerate ERD | 🟢 |
| `prototypes/RideShift_HaNoi_2Layers.html` | Demo GIS 2 lớp (Leaflet standalone) | UI prototype sớm (Deliverable UI_Design) | 🟢 historical |

## Mâu thuẫn / drift đã phát hiện (tóm tắt)

1. **Ngày kết thúc**: Plan bìa 26/12/2026 vs thân bài + Proposal 06/12/2026.
2. **Tên mentor** trang bìa proposal: "Huy, Truong Dinh" (trùng tên thành viên) vs "Nguyen Dang Quang Huy".
3. **Liên hệ Scrum Master**: hyperlink ẩn `ddolanh0@gmail.com` vs text `dangminhnhat1654@gmail.com`; tel lệch giữa các tài liệu.
4. **Layout repo**: 3 living docs mô tả `mini-services/`, `scripts/ensure-backend.sh`, embedded-postgres — tất cả không tồn tại; compose thực tế `build: ./backend`.
5. **Seed data**: db.md "2 zones + 7 rules" vs seed 1 zone active (Vành đai 1) + 2 rules (xe xăng banned 24/7, ô tô conditional "chỉ phí").
6. **Khung giờ cấm**: ảnh minh họa proposal 06:00–22:00 vs txt chính thức + seed 24/7.
7. **Ngày hiệu lực 01/07/2026** chỉ nằm trong description text — schema không có cột effective date.
8. **Impact Estimator**: Objective 8 liệt kê 6 trường so sánh vs US-12 AC chỉ yêu cầu 3 (time/cost/compliance).
9. **Dataset**: docs ghi Kaggle 25.590 dòng "đã mất khi sandbox reset"; repo hiện 2.400 dòng scaffold.
