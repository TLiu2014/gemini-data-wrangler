import { useTheme } from './ThemeProvider';
import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({ icon, title, description, action }: Props) {
  const { themeConfig } = useTheme();
  
  return (
    <div style={{
      padding: '48px 24px',
      textAlign: 'center',
      background: themeConfig.colors.surfaceElevated,
      borderRadius: '8px',
      border: `1px solid ${themeConfig.colors.border}`,
      margin: '16px 0'
    }}>
      {icon && (
        <div style={{
          marginBottom: '16px',
          display: 'flex',
          justifyContent: 'center',
          color: themeConfig.colors.textSecondary
        }}>
          {icon}
        </div>
      )}
      <h3 style={{
        margin: '0 0 8px 0',
        fontSize: '16px',
        fontWeight: '600',
        color: themeConfig.colors.text
      }}>
        {title}
      </h3>
      {description && (
        <p style={{
          margin: '0 0 16px 0',
          fontSize: '14px',
          color: themeConfig.colors.textSecondary,
          lineHeight: '1.5'
        }}>
          {description}
        </p>
      )}
      {action && (
        <div style={{ marginTop: '16px' }}>
          {action}
        </div>
      )}
    </div>
  );
}

