# RideShift — Smart Transport Transition Advisor

Miền nghiệp vụ: tư vấn chuyển dịch phương tiện cho người đi lại trong khu vực hạn chế
phát thải thấp (LEZ) tại Hà Nội — khuyến nghị phương tiện dựa trên đa tiêu chí, và đo
lượng việc người dùng có thực sự chuyển phương tiện hay không.

## Ngôn ngữ chung

**Chuyến đi (Trip)**:
Một yêu cầu tư vấn: điểm đi, điểm đến, mục đích, giờ khởi hành và phương tiện hiện có của người dùng.
_Avoid_: journey, ride, hành trình

**Bản ghi chuyến đi (Trip Record)**:
Bản.snapshot được lưu ngay khi hệ thống phân tích một Chuyến đi; sau đó ghi nhận lựa chọn cuối của người dùng.
_Avoid_: lịch sử chuyến đi, trip history

**Mục đích chuyến đi (Trip Purpose)**:
Lý do đi lại: đi làm, đi học, mua sắm, giải trí, khác — ảnh hưởng cách chấm điểm tính tiện lợi.

## Phương tiện

**Phương tiện (Transport Mode)**:
Một loại hình di chuyển được hệ thống tư vấn (xe máy xăng, xe máy điện, xe buýt, metro, xe đạp…), mang theo các thông số mặc định: tốc độ, chi phí, phát thải CO₂, tính tiếp cận, tính tiện lợi.
_Avoid_: vehicle, xe, mode

**Phương tiện hiện tại (Current Mode)**:
Phương tiện người dùng khai báo đang dùng cho Chuyến đi (trường `vehicleId` trong yêu cầu). Đây là điểm so sánh để đo chuyển dịch.
_Avoid_: vehicle (khi nói riêng về phương tiện của người dùng), xe của tôi

**Phương tiện được khuyến nghị (Recommended Mode)**:
Phương tiện đứng đầu bảng xếp hạng sau khi chấm điểm đa tiêu chí cho Chuyến đi.
_Avoid_: top mode, best mode

**Phương tiện được chọn (Chosen Mode)**:
Phương tiện người dùng thực sự chọn sau khi xem khuyến nghị; có thể trống nếu không chọn.
_Avoid_: lựa chọn cuối

**Chuyển dịch phương tiện (Mode Shift)**:
Sự kiện người dùng chọn một Phương tiện khác với Phương tiện hiện tại — kết quả nghiệp vụ cốt lõi mà sản phẩm muốn tạo ra và đo lường.
_Avoid_: switched, transition (riêng lẻ), chuyển đổi

## Vùng và quy định

**Vùng phát thải thấp (LEZ Zone)**:
Một vùng địa lý hình polygon có áp đặt hạn chế phương tiện; được định nghĩa bằng tọa độ đỉnh.
_Avoid_: zone (trơn), vành đai (vành đai chỉ là tên một vùng cụ thể), phường (phường là đơn vị hành chính dùng để vẽ nền bản đồ 3D, không phải thực thể quy định)

**Quy định hạn chế (Policy Rule)**:
Ràng buộc gắn một Loại phương tiện với một Vùng phát thải thấp: loại hạn chế, điều kiện, khung giờ và ngày trong tuần áp dụng.
_Avoid_: restriction (trơn), luật, rule set

**Loại hạn chế (Restriction Type)**:
Cấm hẳn (banned) hoặc có điều kiện (conditional).

## Hai bộ ba trạng thái — đừng trộn lẫn

**Trạng thái không gian (Route Status)**:
Vị trí của lộ trình so với một Vùng: ngoài vùng (outside) · đi ngang qua (partial) · nằm trong (within).
_Avoid_: compliance (khi nói về lộ trình)

**Trạng thái tuân thủ (Mode Compliance)**:
Tình trạng của một Phương tiện đối với các Vùng mà lộ trình đi qua: được phép (compliant, xanh) · bị hạn chế có điều kiện (conditionally restricted, vàng) · bị cấm (not permitted, đỏ).
_Avoid_: banned (dùng cho Loại hạn chế, không dùng cho trạng thái), status (trơn)

## Chấm điểm

**Tiêu chí (Criterion)**:
Một trong bảy đại lượng cố định dùng để chấm điểm: thời gian di chuyển, chi phí, tuân thủ LEZ, tính tiếp cận, tính tiện lợi, môi trường, xu hướng. Thời gian và chi phí là tiêu chí "càng thấp càng tốt".
_Avoid_: factor, yếu tố

**Trọng số (Criterion Weight)**:
Phần trăm quan trọng của một Tiêu chí do quản trị viên cấu hình; toàn bộ các trọng số phải cộng đúng 100%.
_Avoid_: weight config

**Khuyến nghị (Recommendation)**:
Kết quả chấm điểm đa tiêu chí cho một Phương tiện trong một Chuyến đi: điểm gần-giải-pháp-tối ưu (0..1), thứ hạng và mức đóng góp của từng Tiêu chí.
_Avoid_: result, ranking (ranking là thứ tự, không phải từng kết quả)

**Xu hướng (Trend)**:
Hướng chuyển dịch sử dụng thực tế của một Phương tiện theo tháng, suy ra từ dữ liệu khảo sát; càng cao càng đang được đón nhận.
_Avoid_: trend index (khi nói khái niệm)

**Điểm giao thông công cộng (Transit Location)**:
Điểm dừng đỗ cố định (bus, metro, BRT) dùng để đánh giá tính tiếp cận của các phương tiện.
_Avoid_: location (trơn), bến, trạm

## Quản trị

**Quản trị viên (Admin)**:
Người vận hành hệ thống: cấu hình vùng, quy định, phương tiện, trọng số và xem phân tích.
_Avoid_: user, người dùng (người dùng tư vấn chuyến đi là danh nghĩa, không có tài khoản)
