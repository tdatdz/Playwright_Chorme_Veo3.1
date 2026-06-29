// src/ai-provider-adapters.js

export const adapters = {
  'openai-compatible': {
    async testModels(provider) {
      if (!provider.baseUrl) throw new Error('Endpoint URL is required');
      
      const headers = { 'Content-Type': 'application/json' };
      if (provider.authMode === 'api_key' && provider.apiKey) {
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
      } else if (provider.authMode === 'oauth' && provider.oauthToken) {
        headers['Authorization'] = `Bearer ${provider.oauthToken}`;
      }
      
      let url = `${provider.baseUrl}/models`;
      try {
        const response = await fetch(url, { headers, timeout: 15000 });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new Error('Invalid API Key / Token or access denied (401/403).');
          if (response.status === 404) throw new Error('Endpoint not found (404). Ensure Base URL is correct.');
          throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        const models = [];
        if (data && data.data && Array.isArray(data.data)) {
          models.push(...data.data.map(m => m.id));
        } else if (data && Array.isArray(data)) {
          models.push(...data.map(m => m.id || m.name || m));
        }
        
        return { ok: true, models, rawProvider: 'openai-compatible' };
      } catch (e) {
        if (e.cause?.code === 'ECONNREFUSED' || e.message.includes('ECONNREFUSED')) {
          throw new Error('Connection refused. Is the local endpoint running?');
        }
        throw new Error(e.message || 'Network timeout or invalid response');
      }
    },
    
    async generate(provider, request) {
      if (!provider.baseUrl) throw new Error('Endpoint URL is required');
      if (!request.model) throw new Error('Model is required');
      if (!request.input) throw new Error('Input text is required');
      
      const headers = { 'Content-Type': 'application/json' };
      if (provider.authMode === 'api_key' && provider.apiKey) {
        headers['Authorization'] = `Bearer ${provider.apiKey}`;
      } else if (provider.authMode === 'oauth' && provider.oauthToken) {
        headers['Authorization'] = `Bearer ${provider.oauthToken}`;
      }
      
      const url = `${provider.baseUrl}/chat/completions`;
      const payload = {
        model: request.model,
        messages: [{ role: 'user', content: request.input }],
        temperature: request.options?.temperature ?? 0.7
      };
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          timeout: 60000
        });
        
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new Error('Invalid API Key / Token.');
          if (response.status === 429) throw new Error('Rate limit exceeded / Out of quota.');
          throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        const text = data.choices?.[0]?.message?.content || data.choices?.[0]?.text;
        
        if (!text) throw new Error('Model returned empty output');
        
        return { ok: true, text, usage: data.usage || null };
      } catch (e) {
        if (e.cause?.code === 'ECONNREFUSED' || e.message.includes('ECONNREFUSED')) {
          throw new Error('Connection refused. Is the local endpoint running?');
        }
        throw new Error(e.message || 'Generation failed');
      }
    }
  },
  
  'anthropic-native': {
    async testModels(provider) {
      if (!provider.baseUrl) throw new Error('Endpoint URL is required');
      
      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey || ''
      };
      
      let url = `${provider.baseUrl}/v1/models`;
      try {
        const response = await fetch(url, { headers, timeout: 15000 });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new Error('Invalid API Key / Token or access denied (401/403).');
          if (response.status === 404) {
            // Anthropic doesn't officially document /v1/models consistently, so we allow it to fail softly by just returning empty models.
            return { ok: true, models: [], rawProvider: 'anthropic-native', error: 'Models list endpoint not found, but proceeding.' };
          }
          throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        const models = (data && data.data) ? data.data.map(m => m.id) : [];
        
        return { ok: true, models, rawProvider: 'anthropic-native' };
      } catch (e) {
        // Soft fail for Anthropic model list
        console.warn('Anthropic native test models soft fail:', e.message);
        return { ok: true, models: [], rawProvider: 'anthropic-native', error: e.message };
      }
    },
    
    async generate(provider, request) {
      if (!provider.baseUrl) throw new Error('Endpoint URL is required');
      if (!request.model) throw new Error('Model is required');
      if (!request.input) throw new Error('Input text is required');
      
      const headers = {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': provider.apiKey || ''
      };
      
      const url = `${provider.baseUrl}/v1/messages`;
      const payload = {
        model: request.model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: request.input }]
      };
      
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          timeout: 60000
        });
        
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new Error('Invalid API Key / Token.');
          if (response.status === 429) throw new Error('Rate limit exceeded / Out of quota.');
          throw new Error(`HTTP Error: ${response.status}`);
        }
        
        const data = await response.json();
        let text = '';
        if (data.content && Array.isArray(data.content)) {
          text = data.content.map(b => b.text).join('');
        }
        
        if (!text) throw new Error('Model returned empty output');
        
        return { ok: true, text, usage: data.usage || null };
      } catch (e) {
        throw new Error(e.message || 'Generation failed');
      }
    }
  }
};
