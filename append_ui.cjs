const fs = require('fs');
let code = fs.readFileSync('public/app.js', 'utf8');

const newCode = `
window.openModelSelectionForProvider = async function(id) {
  const p = aiState.providers.find(x => x.id === id);
  if (!p) return;
  
  elements.aiProviderListState.hidden = true;
  elements.aiProviderWizardState.hidden = false;
  if(elements.aiProviderAddStep1State) elements.aiProviderAddStep1State.hidden = true;
  elements.aiProviderErrorBox.hidden = true;
  elements.aiProviderModelSelectState.hidden = false;
  elements.aiProviderModelSelect.innerHTML = '<option disabled>Đang tải danh sách model...</option>';
  document.querySelector('#aiProviderModelSearch').value = '';
  document.querySelector('#aiProviderManualModel').value = p.defaultModel || '';
  editingProviderId = id;
  
  try {
    const res = await fetch('/api/ai/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId: id })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to fetch models');
    
    if (data.models && data.models.length > 0) {
      elements.aiProviderModelSelect.innerHTML = data.models.map(m => 
        '<option value="' + m.id + '" ' + (m.id === p.defaultModel ? 'selected' : '') + '>' + escapeHtml(m.id) + '</option>'
      ).join('');
    } else {
      elements.aiProviderModelSelect.innerHTML = '<option disabled>Không tìm thấy model nào. Vui lòng nhập thủ công.</option>';
    }
  } catch (e) {
    elements.aiProviderModelSelect.innerHTML = '<option disabled>Lỗi: ' + escapeHtml(e.message) + '</option>';
  }
};

if (elements.finishAiWizardBtn) {
  elements.finishAiWizardBtn.addEventListener('click', async () => {
    if (!editingProviderId) return;
    const manual = document.querySelector('#aiProviderManualModel').value.trim();
    const selected = elements.aiProviderModelSelect.value;
    const defaultModel = manual || selected;
    
    if (!defaultModel) {
      alert('Vui lòng chọn hoặc nhập tên model.');
      return;
    }
    
    elements.finishAiWizardBtn.disabled = true;
    elements.finishAiWizardBtn.textContent = 'Đang lưu...';
    try {
      const res = await fetch('/api/ai/providers/' + editingProviderId + '/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel })
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to update model');
      }
      
      await loadAiProviders();
      renderAiProviderCenter();
      
      elements.aiProviderWizardState.hidden = true;
      elements.aiProviderListState.hidden = false;
      editingProviderId = null;
    } catch(e) {
      alert('Lỗi khi lưu: ' + e.message);
    } finally {
      elements.finishAiWizardBtn.disabled = false;
      elements.finishAiWizardBtn.textContent = 'Save Connection';
    }
  });
}
`;

if (!code.includes('openModelSelectionForProvider = async function')) {
  code += newCode;
  fs.writeFileSync('public/app.js', code);
  console.log('Appended model UI logic');
}
