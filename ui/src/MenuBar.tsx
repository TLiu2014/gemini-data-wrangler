import { Moon, Sun, Settings, X } from 'lucide-react';
import { ApiKeyInput } from './ApiKeyInput';
import { useTheme } from './ThemeProvider';
import { useState, useEffect, useRef } from 'react';

interface Props {
  apiKey: string | null;
  onApiKeySet: (key: string) => void;
  status: string;
  tablesCount: number;
  stagesCount: number;
  hasDefaultApiKey?: boolean;
  showVisualizationPresets: boolean;
  onToggleVisualizationPresets: (value: boolean) => void;
}

export function MenuBar({ 
  apiKey, 
  onApiKeySet, 
  status, 
  tablesCount, 
  stagesCount, 
  hasDefaultApiKey = false,
  showVisualizationPresets,
  onToggleVisualizationPresets
}: Props) {
  const { theme, themeConfig, toggleTheme } = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  
  // State for flow upload preferences
  const [flowUploadAction, setFlowUploadAction] = useState<'replace' | 'add'>(() => {
    const saved = localStorage.getItem('flow_upload_preference');
    if (!saved) {
      // Set default preference if not exists
      localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'replace' }));
      return 'replace'; // Default to replace
    }
    const pref = JSON.parse(saved);
    return pref.action === 'add' ? 'add' : 'replace';
  });
  const [askBeforeLoad, setAskBeforeLoad] = useState(() => {
    const saved = localStorage.getItem('flow_upload_ask_before');
    if (saved === null) {
      // Set default to true if not exists
      localStorage.setItem('flow_upload_ask_before', 'true');
      return true; // Default to ask before load
    }
    return saved === 'true';
  });

  // Listen for storage changes to update state
  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('flow_upload_preference');
      if (saved) {
        const pref = JSON.parse(saved);
        setFlowUploadAction(pref.action === 'add' ? 'add' : 'replace');
      } else {
        setFlowUploadAction('replace');
      }
      setAskBeforeLoad(localStorage.getItem('flow_upload_ask_before') === 'true');
    };

    window.addEventListener('storage', handleStorageChange);
    // Also listen for custom events (when localStorage is changed in same window)
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  // Close settings when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target as Node)) {
        // Check if click is not on the settings button
        const target = event.target as HTMLElement;
        if (!target.closest('button[title="Settings"]')) {
          setShowSettings(false);
        }
      }
    };

    if (showSettings) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showSettings]);

  return (
    <div style={{
      background: themeConfig.colors.geminiGradient,
      borderBottom: `1px solid ${themeConfig.colors.border}`,
      padding: '12px 20px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      zIndex: 1000,
      boxShadow: themeConfig.shadows.md
    }}>
      {/* Left side - Title and status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: 1 }}>
        <h1 style={{ 
          margin: 0, 
          fontSize: '20px', 
          fontWeight: '600', 
          color: 'white'
        }}>
          Gemini 3 Data Agent
        </h1>
        <div style={{ 
          display: 'flex', 
          gap: '16px', 
          alignItems: 'center',
          fontSize: '13px',
          color: 'rgba(255, 255, 255, 0.9)'
        }}>
          <span>
            <strong>Status:</strong> {status}
          </span>
          {tablesCount > 0 && (
            <span>
              <strong>Tables:</strong> {tablesCount}
            </span>
          )}
          {stagesCount > 0 && (
            <span>
              <strong>Stages:</strong> {stagesCount}
            </span>
          )}
        </div>
      </div>

      {/* Right side - Settings and Theme Toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
        <button
          onClick={() => setShowSettings(!showSettings)}
          style={{
            padding: '8px',
            background: showSettings ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            if (!showSettings) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
            }
          }}
          onMouseLeave={(e) => {
            if (!showSettings) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
            }
          }}
          title="Settings"
        >
          <Settings size={18} />
        </button>
        <button
          onClick={toggleTheme}
          style={{
            padding: '8px',
            background: 'rgba(255, 255, 255, 0.2)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            transition: 'all 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)';
          }}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        {/* Settings Panel - Appears below status bar */}
        {showSettings && (
          <div 
            ref={settingsRef}
            style={{
              position: 'absolute',
              right: 0,
              top: 'calc(100% + 16px)',
              zIndex: 999,
              background: themeConfig.colors.surfaceElevated,
              padding: '16px',
              borderRadius: '8px',
              boxShadow: themeConfig.shadows.lg,
              minWidth: '350px',
              border: `1px solid ${themeConfig.colors.border}`
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: themeConfig.colors.text }}>Settings</h3>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  padding: '4px',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: themeConfig.colors.textSecondary,
                  display: 'flex',
                  alignItems: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>
            <ApiKeyInput 
              onApiKeySet={(key) => {
                onApiKeySet(key);
                setShowSettings(false);
              }} 
              currentApiKey={apiKey} 
              hasDefaultApiKey={hasDefaultApiKey} 
            />
            
            {/* Visualization Presets Toggle */}
            <div style={{ 
              marginTop: '16px', 
              paddingTop: '16px', 
              borderTop: `1px solid ${themeConfig.colors.border}` 
            }}>
              <label style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                fontSize: '14px',
                color: themeConfig.colors.text
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
                color: themeConfig.colors.textSecondary
              }}>
                Toggle visibility of visualization preset buttons
              </p>
            </div>

            {/* Flow Upload Settings */}
            <div style={{ 
              marginTop: '16px', 
              paddingTop: '16px', 
              borderTop: `1px solid ${themeConfig.colors.border}` 
            }}>
              <div style={{ marginBottom: '12px' }}>
                <label style={{
                  fontSize: '14px',
                  fontWeight: '500',
                  color: themeConfig.colors.text,
                  display: 'block',
                  marginBottom: '8px'
                }}>
                  When uploading a flow image:
                </label>
                
                <div style={{ marginBottom: '12px' }}>
                  <label style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    color: themeConfig.colors.text,
                    marginBottom: '4px'
                  }}>
                    <input
                      type="radio"
                      name="flow-upload-action"
                      value="replace"
                      checked={flowUploadAction === 'replace'}
                      onChange={() => {
                        localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'replace' }));
                        setFlowUploadAction('replace');
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
                    fontSize: '13px',
                    color: themeConfig.colors.text
                  }}>
                    <input
                      type="radio"
                      name="flow-upload-action"
                      value="add"
                      checked={flowUploadAction === 'add'}
                      onChange={() => {
                        localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'add' }));
                        setFlowUploadAction('add');
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
                  fontSize: '13px',
                  color: themeConfig.colors.text,
                  marginTop: '8px'
                }}>
                  <span>Show confirmation dialog when loading flow</span>
                  <input
                    type="checkbox"
                    checked={askBeforeLoad}
                    onChange={(e) => {
                      localStorage.setItem('flow_upload_ask_before', String(e.target.checked));
                      setAskBeforeLoad(e.target.checked);
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
                  color: themeConfig.colors.textSecondary
                }}>
                  If checked, a confirmation dialog will appear before processing flow images. If unchecked, the saved preference will be used automatically.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

