import React, { useState } from 'react';
import { Send, Sparkles, Loader2, Upload, MessageSquare } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useTheme } from './ThemeProvider';

interface Props {
  schema: any[]; // The column definitions (available for future use)
  onTransform: (userPrompt: string) => Promise<void>;
  isProcessing: boolean;
  externalPrompt?: string; // Prompt from external source (e.g., stage panel)
  onPromptChange?: (prompt: string) => void; // Callback when prompt changes
  onImageUpload?: (file: File) => Promise<void>; // Callback for image upload
  explanation?: string; // Natural language explanation from Gemini
  status?: string; // Status message for processing
  hasExistingFlow?: boolean; // Whether there are existing tables or stages
}

export function SmartTransform({ onTransform, isProcessing, externalPrompt, onPromptChange, onImageUpload, explanation, status, hasExistingFlow }: Props) {
  const { themeConfig } = useTheme();
  const [prompt, setPrompt] = useState('');
  const [activeTab, setActiveTab] = useState<'chat' | 'upload'>('chat');
  const [isImageProcessing, setIsImageProcessing] = useState(false);
  
  // Sync with external prompt changes
  React.useEffect(() => {
    if (externalPrompt !== undefined && externalPrompt !== prompt) {
      setPrompt(externalPrompt);
    }
  }, [externalPrompt]);

  // Image upload dropzone
  const { getRootProps: getImageRootProps, getInputProps: getImageInputProps } = useDropzone({
    onDrop: async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0 || !onImageUpload) return;
      
      const imageFile = acceptedFiles[0];
      if (!imageFile.type.startsWith('image/')) {
        return;
      }

      setIsImageProcessing(true);
      try {
        await onImageUpload(imageFile);
      } finally {
        setIsImageProcessing(false);
      }
    },
    multiple: false,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp']
    },
    disabled: isImageProcessing || isProcessing
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    onTransform(prompt); // Send prompt to parent
    setPrompt('');
  };

  return (
    <div style={{ 
      margin: '16px 0', 
      padding: '16px', 
      background: themeConfig.colors.surfaceElevated, 
      borderRadius: '8px', 
      border: `1px solid ${themeConfig.colors.border}`,
      boxShadow: themeConfig.shadows.sm
    }}>
      <h3 style={{ 
        margin: '0 0 12px 0', 
        display: 'flex', 
        alignItems: 'center', 
        gap: '8px',
        color: themeConfig.colors.text,
        fontSize: '16px',
        fontWeight: '600',
        lineHeight: '1.5'
      }}>
        <Sparkles size={18} style={{ color: themeConfig.colors.primary }} /> 
        Ask Gemini 3 to Transform
      </h3>
      
      {/* Tab View */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ display: 'flex', gap: '4px', borderBottom: `1px solid ${themeConfig.colors.border}` }}>
          <button
            onClick={() => setActiveTab('chat')}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'chat' ? `2px solid ${themeConfig.colors.primary}` : '2px solid transparent',
              color: activeTab === 'chat' ? themeConfig.colors.primary : themeConfig.colors.textSecondary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'chat' ? '600' : '400',
              transition: 'all 0.2s',
              outline: 'none'
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
              e.currentTarget.style.outlineOffset = '2px';
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={0}
          >
            <MessageSquare size={16} />
            Chat
          </button>
          <button
            onClick={() => setActiveTab('upload')}
            style={{
              padding: '10px 16px',
              background: 'transparent',
              border: 'none',
              borderBottom: activeTab === 'upload' ? `2px solid ${themeConfig.colors.primary}` : '2px solid transparent',
              color: activeTab === 'upload' ? themeConfig.colors.primary : themeConfig.colors.textSecondary,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              fontWeight: activeTab === 'upload' ? '600' : '400',
              transition: 'all 0.2s',
              outline: 'none'
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
              e.currentTarget.style.outlineOffset = '2px';
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={0}
          >
            <Upload size={16} />
            Upload Image
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === 'chat' && (
          <div style={{ marginTop: '16px' }}>
            <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
        <input 
          type="text" 
          value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value);
                  onPromptChange?.(e.target.value);
                }}
          placeholder="e.g. 'Filter for sales over $500 and group by City'" 
                style={{ 
                  flex: 1, 
                  padding: '12px 16px', 
                  borderRadius: '8px', 
                  border: `1px solid ${themeConfig.colors.border}`,
                  background: themeConfig.colors.surface,
                  color: themeConfig.colors.text,
                  fontSize: '14px',
                  lineHeight: '1.5',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = themeConfig.colors.primary;
                  e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                  e.currentTarget.style.outlineOffset = '2px';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = themeConfig.colors.border;
                  e.currentTarget.style.outline = 'none';
                }}
        />
        <button 
          type="submit" 
                disabled={isProcessing || isImageProcessing || !prompt.trim()}
                style={{ 
                  padding: '12px 24px', 
                  background: (isProcessing || isImageProcessing || !prompt.trim()) ? themeConfig.colors.secondary : themeConfig.colors.primary, 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '8px', 
                  cursor: (isProcessing || isImageProcessing || !prompt.trim()) ? 'not-allowed' : 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '8px',
                  fontWeight: '500',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  transition: 'background 0.2s',
                  outline: 'none'
                }}
                onFocus={(e) => {
                  if (!isProcessing && !isImageProcessing && prompt.trim()) {
                    e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                    e.currentTarget.style.outlineOffset = '2px';
                  }
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = 'none';
                }}
              >
                {(isProcessing || isImageProcessing) ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={16} />}
                {(isProcessing || isImageProcessing) ? 'Processing...' : 'Go'}
        </button>
      </form>

      {/* Quick Suggestions */}
            <div style={{ marginTop: '12px', display: 'flex', gap: '8px', fontSize: '12px', flexWrap: 'wrap', lineHeight: '1.5' }}>
              <span style={{ color: themeConfig.colors.textSecondary }}>Try:</span>
        {['Calculate total revenue per month', 'Find top 5 customers', 'Filter rows where status is active'].map(txt => (
          <button 
            key={txt} 
                  onClick={() => onTransform(txt)}
                  style={{ 
                    border: `1px solid ${themeConfig.colors.border}`, 
                    background: themeConfig.colors.surface, 
                    cursor: 'pointer', 
                    borderRadius: '8px', 
                    padding: '4px 12px',
                    fontSize: '12px',
                    color: themeConfig.colors.text,
                    transition: 'all 0.2s',
                    outline: 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                    e.currentTarget.style.borderColor = themeConfig.colors.primary;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.surface;
                    e.currentTarget.style.borderColor = themeConfig.colors.border;
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                    e.currentTarget.style.outlineOffset = '2px';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.outline = 'none';
                  }}
                  tabIndex={0}
          >
            {txt}
          </button>
        ))}
      </div>
          </div>
        )}

        {activeTab === 'upload' && (
          <div style={{ marginTop: '16px' }}>
            <div {...(isImageProcessing || isProcessing ? {} : getImageRootProps())} style={{ 
              border: `1px dashed ${themeConfig.colors.border}`, 
              padding: '32px', 
              textAlign: 'center', 
              cursor: (isImageProcessing || isProcessing) ? 'not-allowed' : 'pointer', 
              borderRadius: '8px', 
              background: (isImageProcessing || isProcessing) ? themeConfig.colors.surface : themeConfig.colors.surface,
              opacity: (isImageProcessing || isProcessing) ? 0.7 : 1,
              transition: 'all 0.2s',
              outline: 'none',
              pointerEvents: (isImageProcessing || isProcessing) ? 'none' : 'auto'
            }}
            onMouseEnter={(e) => {
              if (!isImageProcessing && !isProcessing) {
                e.currentTarget.style.borderColor = themeConfig.colors.primary;
                e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
              }
            }}
            onMouseLeave={(e) => {
              if (!isImageProcessing && !isProcessing) {
                e.currentTarget.style.borderColor = themeConfig.colors.border;
                e.currentTarget.style.background = themeConfig.colors.surface;
              }
            }}
            onFocus={(e) => {
              if (!isImageProcessing && !isProcessing) {
                e.currentTarget.style.borderColor = themeConfig.colors.primary;
                e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                e.currentTarget.style.outlineOffset = '2px';
              }
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.border;
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={(isImageProcessing || isProcessing) ? -1 : 0}
            >
              <input {...getImageInputProps()} />
              
              {/* Progress indicator - shown when processing */}
              {(isImageProcessing || isProcessing) && (
                <div style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '12px' }}>
                    <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', color: themeConfig.colors.primary }} />
                    <div style={{ textAlign: 'left' }}>
                      <div style={{
                        fontSize: '14px',
                        color: themeConfig.colors.text,
                        fontWeight: '600',
                        marginBottom: '4px',
                        lineHeight: '1.5'
                      }}>
                        {isImageProcessing ? 'Analyzing image...' : 'Processing...'}
                      </div>
                      {status && (
                        <div style={{
                          fontSize: '12px',
                          color: themeConfig.colors.textSecondary,
                          lineHeight: '1.5'
                        }}>
                          {status}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Progress bar - Indeterminate animation */}
                  <div style={{
                    width: '100%',
                    height: '4px',
                    background: themeConfig.colors.border,
                    borderRadius: '2px',
                    overflow: 'hidden',
                    position: 'relative'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: '-100%',
                      height: '100%',
                      width: '100%',
                      background: `linear-gradient(90deg, transparent, ${themeConfig.colors.primary}, transparent)`,
                      borderRadius: '2px',
                      animation: 'progress 1.5s ease-in-out infinite'
                    }} />
                  </div>
                </div>
              )}
              
              {/* Upload field content - always visible */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={(isImageProcessing || isProcessing) ? themeConfig.colors.textSecondary : themeConfig.colors.primary} strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <circle cx="8.5" cy="8.5" r="1.5" />
                  <polyline points="21 15 16 10 5 21" />
                </svg>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: (isImageProcessing || isProcessing) ? themeConfig.colors.textSecondary : themeConfig.colors.primary, lineHeight: '1.5' }}>
                  Upload Image
                </p>
              </div>
              <p style={{ fontSize: '12px', color: themeConfig.colors.textSecondary, marginTop: '4px', marginBottom: 0, lineHeight: '1.5' }}>
                Upload an image of:<br/>
                • A <strong>data table</strong> (spreadsheet, CSV preview) - Gemini will extract the data and load it<br/>
                • A <strong>stage flow diagram</strong> - Gemini will recreate the flow<br/>
                • A <strong>database schema</strong> - Gemini will analyze the structure
                {hasExistingFlow && (
                  <span style={{ display: 'block', marginTop: '8px', color: themeConfig.colors.success, fontWeight: '600' }}>
                    💡 Gemini will automatically find connections with your existing flow!
                  </span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Progress Indicator - Only show for chat processing, not image processing */}
      {isProcessing && !isImageProcessing && (
        <div style={{ marginTop: '16px', marginBottom: explanation ? '16px' : '0' }}>
          <div style={{
            padding: '12px 16px',
            background: themeConfig.colors.surfaceElevated,
            borderRadius: '8px',
            border: `1px solid ${themeConfig.colors.border}`
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '8px'
            }}>
              <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: themeConfig.colors.primary }} />
              <div style={{ flex: 1 }}>
                <div style={{
                  fontSize: '14px',
                  color: themeConfig.colors.text,
                  fontWeight: '500',
                  marginBottom: '4px',
                  lineHeight: '1.5'
                }}>
                  Processing...
                </div>
                {status && (
                  <div style={{
                    fontSize: '12px',
                    color: themeConfig.colors.textSecondary,
                    lineHeight: '1.5'
                  }}>
                    {status}
                  </div>
                )}
              </div>
            </div>
            {/* Progress bar - Indeterminate animation */}
            <div style={{
              width: '100%',
              height: '4px',
              background: themeConfig.colors.border,
              borderRadius: '2px',
              overflow: 'hidden',
              position: 'relative'
            }}>
              <div style={{
                position: 'absolute',
                top: 0,
                left: '-100%',
                height: '100%',
                width: '100%',
                background: `linear-gradient(90deg, transparent, ${themeConfig.colors.primary}, transparent)`,
                borderRadius: '2px',
                animation: 'progress 1.5s ease-in-out infinite'
              }} />
            </div>
          </div>
        </div>
      )}

      {/* Explanation Text Area */}
      {explanation && (
        <div style={{ marginTop: '16px' }}>
          <div style={{
            padding: '16px',
            background: themeConfig.colors.surfaceElevated,
            borderRadius: '8px',
            border: `1px solid ${themeConfig.colors.border}`,
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            <div style={{
              fontSize: '12px',
              color: themeConfig.colors.textSecondary,
              marginBottom: '8px',
              fontWeight: '600',
              lineHeight: '1.5',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Explanation:
            </div>
            <div style={{
              fontSize: '14px',
              color: themeConfig.colors.text,
              lineHeight: '1.5',
              whiteSpace: 'pre-wrap'
            }}>
              {explanation}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}