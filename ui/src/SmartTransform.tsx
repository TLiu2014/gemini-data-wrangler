import { useState } from 'react';
import { Send, Sparkles, Loader2 } from 'lucide-react';

interface Props {
  schema: any[]; // The column definitions
  onTransform: (userPrompt: string) => Promise<void>;
  isProcessing: boolean;
}

export function SmartTransform({ schema, onTransform, isProcessing }: Props) {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onTransform(prompt); // Send prompt to parent
    setPrompt('');
  };

  return (
    <div style={{ margin: '20px 0', padding: '15px', background: '#f0f4ff', borderRadius: '8px', border: '1px solid #d0d7de' }}>
      <h3 style={{ margin: '0 0 10px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Sparkles size={18} color="#4b6cb7" /> 
        Ask Gemini 3 to Transform
      </h3>
      
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. 'Filter for sales over $500 and group by City'" 
          style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
        />
        <button 
          type="submit" 
          disabled={isProcessing}
          style={{ padding: '10px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
        >
          {isProcessing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
          Go
        </button>
      </form>

      {/* Quick Suggestions */}
      <div style={{ marginTop: '10px', display: 'flex', gap: '8px', fontSize: '12px' }}>
        <span style={{ color: '#666' }}>Try:</span>
        {['Calculate total revenue per month', 'Find top 5 customers', 'Filter rows where status is active'].map(txt => (
          <button 
            key={txt} 
            onClick={() => onTransform(txt)}
            style={{ border: '1px solid #ddd', background: 'white', cursor: 'pointer', borderRadius: '12px', padding: '2px 8px' }}
          >
            {txt}
          </button>
        ))}
      </div>
    </div>
  );
}