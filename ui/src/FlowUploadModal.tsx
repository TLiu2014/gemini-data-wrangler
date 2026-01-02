import { useState } from 'react';
import { useTheme } from './ThemeProvider';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onReplace: () => void;
  onAddSideBySide: () => void;
  existingStagesCount: number;
}

export function FlowUploadModal({ isOpen, onClose, onReplace, onAddSideBySide, existingStagesCount }: Props) {
  const { themeConfig } = useTheme();
  const [rememberChoice, setRememberChoice] = useState(false);

  const handleReplace = () => {
    if (rememberChoice) {
      localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'replace' }));
      // Disable "ask before load" so dialog won't show next time
      localStorage.setItem('flow_upload_ask_before', 'false');
    }
    onReplace();
    onClose();
  };

  const handleAddSideBySide = () => {
    if (rememberChoice) {
      localStorage.setItem('flow_upload_preference', JSON.stringify({ action: 'add' }));
      // Disable "ask before load" so dialog won't show next time
      localStorage.setItem('flow_upload_ask_before', 'false');
    }
    onAddSideBySide();
    onClose();
  };


  const handleCancel = () => {
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000
    }}
    onClick={handleCancel}
    >
      <div style={{
        background: themeConfig.colors.surface,
        borderRadius: '12px',
        padding: '24px',
        maxWidth: '500px',
        width: '90%',
        boxShadow: themeConfig.shadows.lg,
        border: `1px solid ${themeConfig.colors.border}`
      }}
      onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{
          margin: '0 0 16px 0',
          fontSize: '18px',
          fontWeight: '600',
          color: themeConfig.colors.text
        }}>
          Flow Image Detected
        </h3>
        
        <p style={{
          margin: '0 0 20px 0',
          fontSize: '14px',
          color: themeConfig.colors.textSecondary,
          lineHeight: '1.6'
        }}>
          {existingStagesCount > 0 
            ? `You currently have ${existingStagesCount} stage(s) in your flow. What would you like to do with the new flow?`
            : 'A new flow has been detected. What would you like to do?'}
        </p>
        <p style={{
          margin: '0 0 20px 0',
          fontSize: '12px',
          color: themeConfig.colors.textTertiary,
          fontStyle: 'italic'
        }}>
          You can change this preference anytime in Settings
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
          <button
            onClick={handleReplace}
            style={{
              padding: '12px 16px',
              background: themeConfig.colors.primary,
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              textAlign: 'left',
              transition: 'background 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '0.9';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
          >
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Replace Current Flow</div>
            <div style={{ fontSize: '12px', opacity: 0.9 }}>
              Clear the canvas and load the new flow
            </div>
          </button>

          <button
            onClick={handleAddSideBySide}
            style={{
              padding: '12px 16px',
              background: themeConfig.colors.surfaceElevated,
              color: themeConfig.colors.text,
              border: `1px solid ${themeConfig.colors.border}`,
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px',
              fontWeight: '500',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = themeConfig.colors.primary + '10';
              e.currentTarget.style.borderColor = themeConfig.colors.primary;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
              e.currentTarget.style.borderColor = themeConfig.colors.border;
            }}
          >
            <div style={{ fontWeight: '600', marginBottom: '4px' }}>Add as New Flow (Side-by-Side)</div>
            <div style={{ fontSize: '12px', opacity: 0.8 }}>
              Keep existing flow and add new flow next to it
            </div>
          </button>
        </div>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '16px',
          padding: '12px',
          background: themeConfig.colors.surfaceElevated,
          borderRadius: '8px'
        }}>
          <input
            type="checkbox"
            id="remember-choice"
            checked={rememberChoice}
            onChange={(e) => setRememberChoice(e.target.checked)}
            style={{
              cursor: 'pointer'
            }}
          />
          <label
            htmlFor="remember-choice"
            style={{
              fontSize: '13px',
              color: themeConfig.colors.textSecondary,
              cursor: 'pointer'
            }}
          >
            Remember my choice (don't ask next time)
          </label>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button
            onClick={handleCancel}
            style={{
              padding: '8px 16px',
              background: 'transparent',
              color: themeConfig.colors.textSecondary,
              border: `1px solid ${themeConfig.colors.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
            }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

