# Flow Keyframe Bot

Bot Playwright điều khiển Google Flow theo mô hình **dạy một lần, chạy bằng
một keyframe JSON**.

## Dashboard có Observer Log

```powershell
npm run app
```

Mở `http://127.0.0.1:3210`. Dashboard cung cấp nút mở Chrome, nạp cookie,
record/stop, replay an toàn, Commit, Force repeat và reset registry. Mọi action
Playwright cùng kết quả safety guard được phát thời gian thực vào Observer Log.

Bảng Batch Creation Timeline được lưu tự động tại
`artifacts/batch/project.json`; thêm/xóa hàng, prompt, lựa chọn, mode, model,
tỷ lệ và số lượng vẫn còn sau reload. Reference PNG/JPEG/WebP tối đa 8 MB được
lưu local trong `artifacts/batch/references/`. Bấm một thumbnail để xem ảnh
gốc trong lightbox; có nút đổi ảnh và xóa ảnh local (xóa cần xác nhận).

`◉ Test Flow` chạy dry-run: tự mở Chrome/Flow nếu cần, quan sát DOM, kiểm tra
composer, mode, model, tỷ lệ, số lượng, Reference picker và Generate nhưng
không upload, không nhập prompt và không tiêu lượt tạo. `▶ Run` chạy adapter
Playwright thật sau một hộp xác nhận sử dụng lượt:

- mỗi click/fill/upload đều có `[OBSERVE]` trước `[ACTION]` và viền thao tác;
- control đã đúng trạng thái được bỏ qua bằng `[GUARD]`, không click lặp;
- popup, cảnh báo quota/lỗi hoặc UI còn thay đổi sẽ chặn action;
- prompt và thiết lập được đọc lại để xác minh trước Generate;
- job `running`/`done` bị chặn gửi trùng; bấm `↻` trên đúng dòng để chủ động
  cho phép chạy lại;
- mỗi lần bấm Generate, runner chờ một `data-tile-id` mới và gắn tile đó với
  đúng dòng; sau đó gửi ngay dòng tiếp theo để các tile render song song trong
  cùng project;
- Flow có thể lặp cùng một `data-tile-id` ở wrapper và phần tử ảnh con; runner
  khử trùng theo ID trước khi đếm, không coi hai DOM node là hai kết quả;
- Observer đọc phần trăm của tất cả tile đang chạy. Khi tile có ảnh hoàn chỉnh,
  runner tải ảnh bằng chính phiên đăng nhập Playwright và chuyển dòng sang
  `XONG`.

Adapter trực tiếp hiện hỗ trợ **Image** với Nano Banana Pro/Nano Banana 2.
Mỗi lần Run tạo thư mục riêng trong `OutPut/` theo mẫu
`DD.MM.YYYY_HH.mm` (nếu trùng phút sẽ thêm `_02`, `_03`), lưu ảnh với tên theo
mã dòng và kèm `manifest.json` để đối chiếu prompt, tile ID, tiến độ và đường
dẫn file. Ảnh đã tải xuất hiện trực tiếp trong cột Result.

Runner chỉ gửi song song về mặt render: thao tác nhập prompt/Generate phải diễn
ra tuần tự vài giây trên một composer, còn các generation job chạy đồng thời
trên server Flow. Thanh công cụ có `Delay gửi` 1.5/2.5/4/6 giây; mặc định
2.5 giây và chỉ bắt đầu đếm sau khi Flow đã trả về tile ID mới. Đây là cách
tránh tranh chấp DOM mà vẫn đạt batch song song.

## Chuẩn hóa kịch bản và Master JSON

Tab **Chuẩn hóa kịch bản** có hai bước:

1. Lưu prompt phân tích tối đa 6 ảnh, Visual DNA đã chốt và Character DNA.
2. Nhập loại phim, ngôn ngữ, các chế độ giữ nguyên kịch bản/kể chuyện/cho phép
   chữ và toàn bộ câu chuyện.

`Local Director` chia từng câu hoặc đoạn dài thành scene, tính duration và
timestamp liên tục, đồng thời tạo đúng schema `scene`, `srt`, `duration`,
`timestamp`, ba `prompts` và ba `v2_prompts`. Đây là compiler xác định để dựng
timeline, không phải LLM dịch hoặc suy luận. Với kịch bản cần dịch và viết prompt
tiếng Anh tinh tế, chọn **Google AI Studio — copy/paste JSON**: app tạo
master-instruction, mở AI Studio và chờ người dùng dán JSON đã kiểm tra trở lại.

Nút **Kích hoạt chạy AI Studio FLOW** xác minh Master JSON, mở một tab Flow mới,
tự bấm **Dự án mới**, chuyển prompt theo scene vào Timeline rồi chạy batch theo
thứ tự `S{scene}.{prompt}`. Thanh `FLOW PROJECTS` trên Timeline hiển thị các
project đang mở; nút `+` tạo tab/project riêng và click một tab sẽ đưa Chrome
đến đúng project đó.

## Ghi thao tác như macro

Đây là chế độ phù hợp khi muốn bot nhớ nguyên chuỗi click/nhập liệu. Mở sẵn
project Flow ở trạng thái bắt đầu, sau đó đặt một tên ngắn cho quy trình:

```powershell
npm run record -- tao-video-keyframe
```

Khi banner đỏ `RECORDING` xuất hiện, thao tác Flow hoàn toàn bình thường. Mỗi
control vừa được ghi sẽ nháy viền xanh. Terminal hiển thị số thứ tự thao tác.
Quay lại terminal và nhấn `Enter` để kết thúc; recipe được lưu trong
`artifacts/recipes/tao-video-keyframe.json`.

Chạy lại chỉ bằng tên:

```powershell
npm run replay -- tao-video-keyframe
```

Replay mặc định chạy ở chế độ an toàn và sẽ từ chối các bước upload,
Generate/Create/Delete. Sau khi đọc recipe và chắc chắn đúng file/prompt, cho
phép side effect bằng:

```powershell
npm run replay -- tao-video-keyframe --commit
```

### Safety controller

Trước mỗi bước, runner:

- gắn `MutationObserver` vào vùng UI chứa control và chỉ tiếp tục khi DOM đã
  yên; Observer Log phát dòng `[OBSERVE]` trước `[ACTION]`;
- kiểm tra đang ở đúng màn hình Flow home hay project;
- dừng nếu có dialog/modal lạ che luồng;
- dừng nếu Flow hiện lỗi, hết quota, giới hạn hoặc “try again”;
- bỏ qua fill/select/mode/tab nếu trạng thái mong muốn đã có sẵn;
- không tự retry click có side effect;
- xác minh file upload tồn tại và không rỗng;
- khóa Upload/Generate/Create/Delete nếu thiếu `--commit`;
- ghi journal trước Generate/Create/Delete để lần chạy lại không vô tình tạo
  trùng khi kết quả lần trước chưa rõ;
- khi lệch trạng thái, dừng ngay và lưu ảnh cùng metadata trong
  `artifacts/failures/`.

Runner không tự đóng popup lạ vì hành động đó có thể che mất cảnh báo quan
trọng. Đây là chủ ý “fail closed”: thà dừng để kiểm tra còn hơn đoán và click
tiếp.

Nếu đã kiểm tra trực tiếp trên Flow và thực sự muốn lặp lại side effect có cùng
recipe, prompt và file, dùng cả hai cờ:

```powershell
npm run replay -- tao-video-keyframe --commit --force-repeat
```

Recorder ghi click, text/contenteditable, select và upload. Do trình duyệt
không cho trang web đọc đường dẫn file thật, bước upload dùng biến
`${startFrame}`; sửa biến này trong recipe trước khi replay.

Prompt đã nhập được lưu cục bộ trong recipe. Thư mục `artifacts/` đã bị
`.gitignore`, nhưng vẫn không nên ghi mật khẩu hoặc dữ liệu nhạy cảm trong lúc
record.

## Vì sao không “train toàn bộ nút” bằng AI?

Flow là ứng dụng động: menu, dialog và control chỉ xuất hiện theo trạng thái.
Một ảnh chụp hoặc một lần quét không thể thấy “toàn bộ nút”. Huấn luyện nhận
dạng ảnh cho từng nút cũng dễ hỏng khi đổi ngôn ngữ, kích thước cửa sổ hoặc
theme.

Thiết kế này lưu mỗi control theo thứ tự ưu tiên:

1. `data-testid`/thuộc tính kiểm thử nếu có.
2. ARIA role + accessible name.
3. Label, placeholder, title hoặc text.
4. CSS và vị trí tương đối chỉ làm dự phòng.

## Cài và mở Chrome dành riêng cho bot

```powershell
npm install
npm run chrome:start
```

Đăng nhập Google một lần trong cửa sổ Chrome mới. Profile này nằm ở
`.chrome-profile` và tách khỏi profile Chrome cá nhân.

> Chrome thông thường phải được khởi động với remote debugging thì Playwright
> mới kết nối được. Chrome 136+ còn yêu cầu `--user-data-dir` không phải profile
> mặc định, nên không nên cố chiếm quyền cửa sổ Chrome cá nhân đang mở.

Kiểm tra kết nối:

```powershell
npm run doctor
```

## Đăng nhập bằng cookie hoặc thủ công

Điền cookie đã export theo định dạng JSON của Playwright/Cookie-Editor vào:

`config/cookies.json`

Có thể dán trực tiếp toàn bộ mảng JSON do Cookie Editor export; importer hỗ trợ
`expirationDate`, `sameSite` và các domain `labs.google`/Google. Xem cấu trúc
tại `config/cookies.example.json`. Sau đó chạy:

```powershell
npm run auth
```

Bot chỉ nhận cookie thuộc miền Google, không in tên hoặc giá trị cookie ra log,
và reload tab Flow sau khi nhập. File thật `config/cookies.json` đã nằm trong
`.gitignore`; không gửi file này cho người khác hoặc commit lên Git.

Nếu file thiếu, rỗng hoặc chỉ chứa placeholder, lệnh `auth` sẽ yêu cầu đăng
nhập thủ công trong cửa sổ Chrome dành riêng. Phiên đăng nhập thủ công được lưu
trong `.chrome-profile`, nên thường chỉ cần làm một lần.

Cookie có thể hết hạn, bị Google thu hồi hoặc yêu cầu xác minh lại. Không nên
coi cookie là mật khẩu lâu dài và không nên copy cookie từ nguồn không tin cậy.

## Dạy bot các control cần dùng

Trong dự án này, “train” không phải huấn luyện model AI. Nó chỉ là bước bạn
đặt một tên nghiệp vụ ổn định cho control DOM, ví dụ nút trên màn hình được lưu
thành `flow.generate`. Việc này làm một lần hoặc làm lại khi Flow đổi giao diện.

```powershell
npm run train
```

Trong tab Flow, giữ `Alt` và click vào control. Click thật bị chặn; hộp thoại
sẽ yêu cầu tên nghiệp vụ. Với recipe mẫu, đặt đúng năm tên sau:

- `flow.mode.video`
- `flow.video.frames_to_video`
- `flow.video.start_frame`
- `flow.prompt`
- `flow.generate`

Control được lưu ở `artifacts/flow-ui-registry.json`. Không cần dạy các nút
không thuộc luồng “một ảnh đầu vào → một video”.

Flow có control ẩn theo trạng thái. Hãy mở menu/dialog bằng thao tác bình
thường, sau đó mới giữ `Alt` và click để dạy control vừa xuất hiện.

Với keyframe mẫu, nên dùng guided trainer để không phải tự nhập tên:

```powershell
npm run train:keyframe
```

Hãy mở sẵn một project Flow trước khi chạy. Overlay sẽ lần lượt hiển thị tên
control đang cần; giữ `Alt` và click đúng control để chọn ứng viên, sau đó nhấn
`Enter` để lưu hoặc `Escape` để chọn lại. Click bình thường vẫn dùng được để mở
menu hoặc chuyển trạng thái nhằm làm control tiếp theo xuất hiện.

Nếu chọn nhầm nhiều control, backup và reset registry bằng:

```powershell
npm run train:reset
```

## Quét để chẩn đoán

```powershell
npm run scan
```

Lệnh tạo:

- `artifacts/flow-controls-scan.json`
- `artifacts/flow-controls-scan.png`

Quét chỉ là inventory control đang hiển thị, không tự click khám phá UI.

## Chạy một keyframe

Sửa `variables.startFrame` và `variables.prompt` trong
`examples/keyframe.image-to-video.json`, rồi chạy:

```powershell
npm run run:keyframe
```

Mỗi bước chỉ gọi một tên nghiệp vụ trong registry. Khi Flow đổi giao diện,
chỉ cần dạy lại control bị hỏng; không phải sửa toàn bộ kịch bản.

### Viền xanh trước khi thao tác

Khi runner đã tìm thấy control, nó tự cuộn control vào màn hình và hiện viền
xanh nhấp nháy cùng tên hành động khoảng 900 ms trước khi click/fill/upload.
Đây là lớp hiển thị thao tác giống clip tham khảo; nó không phải bước train.

Có thể chỉnh thời gian quan sát:

```powershell
$env:FLOW_ACTION_DELAY_MS=1500
npm run run:keyframe
```

Đặt `FLOW_SHOW_ACTIONS=0` nếu muốn tắt viền để bot chạy nhanh hơn.

## Giới hạn có chủ ý

- Recipe đầu tiên chỉ làm **video từ một start frame**.
- Bot chưa tự bấm CAPTCHA, đăng nhập, mua gói hoặc vượt giới hạn của Flow.
- `connectOverCDP` tiện để tái sử dụng phiên đăng nhập nhưng kém đầy đủ hơn
  kết nối Playwright native; vì vậy runner dùng locator chuẩn và kiểm tra trạng
  thái hiển thị trước khi thao tác.
