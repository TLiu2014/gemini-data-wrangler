import { AlertCircle } from 'lucide-react';
import { useTheme } from './ThemeProvider';

interface Props {
  message: string;
  onClose?: () => void;
}

export function ErrorMessage({ message, onClose }: Props) {
  const { themeConfig } = useTheme();
  
  return (
    <div style={{
      padding: '12px 16px',
      background: `${themeConfig.colors.error}15`, // 15 = ~8% opacity
      border: `1px solid ${themeConfig.colors.error}`,
      borderRadius: '8px',
      color: themeConfig.colors.error,
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '12px'
    }}>
      <AlertCircle size={18} style={{ flexShrink: 0, marginTop: '2px' }} />
      <div style={{ flex: 1 }}>
        <strong style={{ display: 'block', marginBottom: '4px' }}>Error:</strong>
        <div>{message}</div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            color: themeConfig.colors.error,
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            borderRadius: '4px',
            transition: 'background 0.2s'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = `${themeConfig.colors.error}20`;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          aria-label="Close error"
        >
          ×
        </button>
      )}
    </div>
  );
}

