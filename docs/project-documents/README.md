# Tài liệu dự án nhóm (bản lưu tại repo)

> **Mục đích:** bản sao các tài liệu nhóm từ thư mục `upload/` (sandbox) vào repo để
> **không mất khi sandbox bị reset** — phiên trước đã từng mất bộ dữ liệu Kaggle vì chỉ
> nằm ngoài project. Khi có tài liệu mới trong `upload/`, copy vào đây rồi commit.

## Danh sách tài liệu

| File | Phiên bản | Ngày nạp | Vai trò |
|---|---|---|---|
| `0_C1SE48_ProposalDocument_v1.0.pdf` | v1.0 | 07/10 | Đề cương đồ án (bản nộp) |
| `C1SE48_ProposalDocument_v1.0.docx` | v1.0 | 07/10 | Đề cương bản Word có thể sửa — **hiện CHỈ còn trong repo** (upload đã mất) |
| `1_C1SE48_ProjectPlan_v1.0.pdf` | v1.0 | 07/10 | Kế hoạch dự án |
| `2_C1SE48_ProductBacklog_v1.0.docx` | v1.0 | 07/10 | Product backlog |
| `2_C1SE48_ProductBacklog_v2.0.docx` | **v2.0 (mới nhất)** | 18/10 | Product backlog cập nhật |
| `3_C1SE48_UserStory_v1.0.docx` | v1.0 | 07/10 | User stories |
| `3_C1SE48_UserStory_v2.0.docx` | **v2.0 (mới nhất)** | 18/10 | User stories cập nhật |
| `DB FINAL.pdf` | — | 18/10 | **Nguồn chân lý thiết kế CSDL** (16 trang): 6 schema nghiệp vụ + kiểu hình học; là cơ sở của đợt tái cấu trúc 24 bảng/6 schema và chuyển 10 cột sang PostGIS GEOMETRY |

## Ảnh chụp (tham khảo trao đổi nhóm — `screenshots/`)

| File | Nội dung |
|---|---|
| `pasted_image_1792298666466.png` | **ERD nhóm (dbdiagram.io) — nguồn thiết kế 24 bảng** dùng cho Task 57 (tái cấu trúc DB) |
| `pasted_image_1792295043408.png`, `…5055451.png`, `…5126048.png`, `…5135337.png` | Ảnh chụp trạng thái DB/schema khi báo lỗi "schema lạ, 11 bảng" (18/10) |
| `pasted_image_1791025434609.png` | Ảnh chụp giao diện bản đồ/lớp Hà Nội (03/10) |
| `pasted_image_1791092976924.png` | Ảnh chụp giao diện (04/10) |
| `pasted_image_1790840595207.png` | Ảnh chụp màn hình đầu (01/10) |
| `pasted_image_1791031558815.png`, `…1569256.png` | Ảnh trùng nhau (bản sao) |

## Tài liệu cùng chủ đề nằm ở thư mục khác

- `docs/data-sources/Hà Nội (phường xã) - 34.geojson` — ranh giới phường/xã Hà Nội
- `docs/data-sources/quy_dinh_vanh_dai_1.txt` — quy định Vành đai 1 (số hóa)
- `docs/prototypes/RideShift_HaNoi_2Layers.html` — prototype bản đồ 2 lớp
- `backend/data/dataHN.csv` — bộ khảo sát Kaggle "Vehicle at Ha Noi" 25.590 dòng (Deliverable #11)

**Cố ý KHÔNG lưu:** `upload/C1SE48_RideShift.zip` (bản export cũ 05/10, trùng lặp với
`download/C1SE48_RideShift.zip` hiện hành — tránh nhầm phiên).
