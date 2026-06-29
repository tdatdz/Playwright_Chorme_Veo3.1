# Kiến trúc AI Provider Center

Tài liệu này mô tả kiến trúc cốt lõi của tính năng AI Provider Center, bao gồm quản lý trạng thái, adapter kết nối và cấu trúc dữ liệu.

## 1. Thành phần Cốt lõi (Core Components)

### Catalog Tĩnh (`config/ai-provider-catalog.json`)
Là nguồn cung cấp danh sách thẻ Preset cho người dùng (OpenAI, Gemini, Claude, 9Router, LM Studio). 
Chứa các trường cơ bản như: `catalogId`, `family`, `adapter`, `authMode`, `recommendedModels`. File này được theo dõi bởi Git.

### Storage Động (`config/ai-providers.json`)
Lưu cấu hình thực tế của người dùng. Cấu trúc lưu trữ (Provider Schema) có dạng:
- `id`: Định danh duy nhất (VD: `provider_1234_abcd`). Sinh ngẫu nhiên mỗi khi tạo mới.
- `catalogId`: ID ánh xạ về thẻ Catalog để nhóm trên giao diện.
- `adapter`: Logic handler (`openai-compatible` hoặc `anthropic-native`).
- `apiKey` / `oauthToken`: Private Key. **TUYỆT ĐỐI KHÔNG lộ về Frontend**.

### Logic Layer (`src/ai-provider-adapters.js`)
Tránh đưa logic kết nối API vào file xử lý Route chung (`app-server.js`). Adapter chịu trách nhiệm 100% logic kết nối:
- `testModels(provider)`: Trả về danh sách model có thể dùng.
- `generate(provider, request)`: Gọi AI tạo response.
- Xử lý mã lỗi (401, 403, 404, ECONNREFUSED) ra các thông báo thân thiện cho user.

## 2. Luồng bảo mật (Security Flow)

1. Client (Frontend) gửi request lấy danh sách `GET /api/ai/providers`.
2. Hàm `getMaskedProviders()` ở Store sẽ che (mask) toàn bộ key/token thành định dạng `sk-****abcd`.
3. Khi Client muốn Sửa (Edit) một provider: Nếu gửi key là chuỗi `****` hoặc rỗng, Backend Store tự đối chiếu với file JSON và lấy lại Key gốc ghép vào để lưu.
4. Quá trình sinh Prompt (Generate) hoặc Test: Client chỉ gửi `providerId`. Backend Load Key gốc từ `config/ai-providers.json`, chọn đúng `adapter`, build headers và bắn lên API của AI Provider.

## 3. Giao diện (Frontend)
- Các cấu hình (Settings) thuộc 1 Family sẽ được gom lại dưới 1 Card Catalog để không bị lặp Card.
- Có 3 nguồn Model trong giao diện Setup:
  1. **Detected Models**: Quét thành công từ `testModels`.
  2. **Recommended Models**: Dữ liệu fallback từ Catalog Preset.
  3. **Manual Input**: User tự gõ tay.
