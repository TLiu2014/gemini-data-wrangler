import { useState } from 'react';
import { Key, Check } from 'lucide-react';

interface Props {
  onApiKeySet: (apiKey: string) => void;
  currentApiKey: string | null;
}

export function ApiKeyInput({ onApiKeySet, currentApiKey }: Props) {
  const [apiKey, setApiKey] = useState(currentApiKey || '');
  const [isVisible, setIsVisible] = useState(false);
  const [isValid, setIsValid] = useState(!!currentApiKey);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.trim()) {
      onApiKeySet(apiKey.trim());
      setIsValid(true);
      setIsVisible(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setApiKey(e.target.value);
    setIsValid(false);
  };

  if (!isVisible && currentApiKey) {
    return (
      <div style={{ position: 'relative', zIndex: 10 }}>
        <button
          onClick={() => setIsVisible(true)}
          style={{
            padding: '8px 12px',
            background: '#10b981',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '14px'
          }}
        >
          <Check size={16} />
          API Key Set
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', zIndex: 10, background: 'white', padding: '12px', borderRadius: '8px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', minWidth: '300px' }}>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '12px', color: '#666', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Key size={14} />
            Gemini API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={handleChange}
            placeholder="Enter your API key"
            style={{
              padding: '8px 12px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              fontSize: '14px',
              width: '250px',
              outline: 'none'
            }}
          />
        </div>
        <button
          type="submit"
          disabled={!apiKey.trim()}
          style={{
            padding: '8px 16px',
            background: apiKey.trim() ? '#2563eb' : '#ccc',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: apiKey.trim() ? 'pointer' : 'not-allowed',
            fontSize: '14px',
            marginTop: '20px'
          }}
        >
          Set
        </button>
        {currentApiKey && (
          <button
            type="button"
            onClick={() => setIsVisible(false)}
            style={{
              padding: '8px 12px',
              background: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              marginTop: '20px'
            }}
          >
            Cancel
          </button>
        )}
      </form>
      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px', maxWidth: '300px' }}>
        Get your API key from{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>
          Google AI Studio
        </a>
      </div>
    </div>
  );
}

