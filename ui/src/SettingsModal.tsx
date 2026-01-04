import { X } from 'lucide-react';
import { ApiKeyInput } from './ApiKeyInput';
import { useTheme } from './ThemeProvider';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  apiKey: string | null;
  onApiKeySet: (key: string) => void;
  hasDefaultApiKey?: boolean;
  showVisualizationPresets: boolean;
  onToggleVisualizationPresets: (value: boolean) => void;
  flowUploadAction: 'replace' | 'add';
  onFlowUploadActionChange: (action: 'replace' | 'add') => void;
  askBeforeLoad: boolean;
  onAskBeforeLoadChange: (value: boolean) => void;
}

export function SettingsModal({
  isOpen,
  onClose,
  apiKey,
  onApiKeySet,
  hasDefaultApiKey = false,
  showVisualizationPresets,
  onToggleVisualizationPresets,
  flowUploadAction,
  onFlowUploadActionChange,
  askBeforeLoad,
  onAskBeforeLoadChange
}: Props) {
  const { themeConfig } = useTheme();

  if (!isOpen) return null;

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div 
        style={{
          background: themeConfig.colors.surfaceElevated,
          borderRadius: '8px',
          boxShadow: themeConfig.shadows.xl,
          border: `1px solid ${themeConfig.colors.border}`,
          maxWidth: '600px',
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          position: 'relative'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '20px 24px',
          borderBottom: `1px solid ${themeConfig.colors.border}`,
          position: 'sticky',
          top: 0,
          background: themeConfig.colors.surfaceElevated,
          zIndex: 1
        }}>
          <h2 style={{
            margin: 0,
            fontSize: '18px',
            fontWeight: '600',
            color: themeConfig.colors.text,
            lineHeight: '1.5'
          }}>
            Settings
          </h2>
          <button
            onClick={onClose}
            style={{
              padding: '8px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              color: themeConfig.colors.textSecondary,
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              transition: 'background 0.2s',
              outline: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = themeConfig.colors.surface;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
            onFocus={(e) => {
              e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
              e.currentTarget.style.outlineOffset = '2px';
            }}
            onBlur={(e) => {
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={0}
            aria-label="Close settings"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '24px' }}>
          <ApiKeyInput 
            onApiKeySet={(key) => {
              onApiKeySet(key);
              onClose();
            }} 
            currentApiKey={apiKey} 
            hasDefaultApiKey={hasDefaultApiKey} 
          />
          
          {/* Visualization Presets Toggle */}
          <div style={{ 
            marginTop: '24px', 
            paddingTop: '24px', 
            borderTop: `1px solid ${themeConfig.colors.border}` 
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontSize: '14px',
              color: themeConfig.colors.text,
              lineHeight: '1.5'
            }}>
              <span>Show Visualization Presets</span>
              <input
                type="checkbox"
                checked={showVisualizationPresets}
                onChange={(e) => onToggleVisualizationPresets(e.target.checked)}
                style={{
                  width: '18px',
                  height: '18px',
                  cursor: 'pointer',
                  accentColor: themeConfig.colors.primary
                }}
              />
            </label>
            <p style={{
              margin: '8px 0 0 0',
              fontSize: '12px',
              color: themeConfig.colors.textSecondary,
              lineHeight: '1.5'
            }}>
              Toggle visibility of visualization preset buttons
            </p>
          </div>

          {/* Flow Upload Settings */}
          <div style={{ 
            marginTop: '24px', 
            paddingTop: '24px', 
            borderTop: `1px solid ${themeConfig.colors.border}` 
          }}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{
                fontSize: '14px',
                fontWeight: '500',
                color: themeConfig.colors.text,
                display: 'block',
                marginBottom: '12px',
                lineHeight: '1.5'
              }}>
                When uploading a flow image:
              </label>
              
              <div style={{ marginBottom: '16px' }}>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: themeConfig.colors.text,
                  marginBottom: '8px',
                  lineHeight: '1.5'
                }}>
                  <input
                    type="radio"
                    name="flow-upload-action"
                    value="replace"
                    checked={flowUploadAction === 'replace'}
                    onChange={() => {
                      localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'replace' }));
                      onFlowUploadActionChange('replace');
                    }}
                    style={{
                      cursor: 'pointer',
                      accentColor: themeConfig.colors.primary
                    }}
                  />
                  <span>Replace current flow (default)</span>
                </label>
                <label style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: themeConfig.colors.text,
                  lineHeight: '1.5'
                }}>
                  <input
                    type="radio"
                    name="flow-upload-action"
                    value="add"
                    checked={flowUploadAction === 'add'}
                    onChange={() => {
                      localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'add' }));
                      onFlowUploadActionChange('add');
                    }}
                    style={{
                      cursor: 'pointer',
                      accentColor: themeConfig.colors.primary
                    }}
                  />
                  <span>Add as new flow (side-by-side)</span>
                </label>
              </div>

              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontSize: '14px',
                color: themeConfig.colors.text,
                marginTop: '12px',
                lineHeight: '1.5'
              }}>
                <span>Show confirmation dialog when loading flow</span>
                <input
                  type="checkbox"
                  checked={askBeforeLoad}
                  onChange={(e) => {
                    localStorage.setItem('flow_upload_ask_before', String(e.target.checked));
                    onAskBeforeLoadChange(e.target.checked);
                  }}
                  style={{
                    width: '18px',
                    height: '18px',
                    cursor: 'pointer',
                    accentColor: themeConfig.colors.primary
                  }}
                />
              </label>
              <p style={{
                margin: '8px 0 0 0',
                fontSize: '12px',
                color: themeConfig.colors.textSecondary,
                lineHeight: '1.5'
              }}>
                If checked, a confirmation dialog will appear before processing flow images. If unchecked, the saved preference will be used automatically.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

