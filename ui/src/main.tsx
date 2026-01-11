import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider as MuiThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import './index.css'
import App from './App.tsx'
import { ThemeProvider, useTheme } from './ThemeProvider.tsx'
import type { ReactNode } from 'react'

// MUI Theme wrapper component
function MuiThemeWrapper({ children }: { children: ReactNode }) {
  const { themeConfig } = useTheme();
  
  const muiTheme = createTheme({
    palette: {
      mode: themeConfig.name === 'dark' ? 'dark' : 'light',
      primary: {
        main: themeConfig.colors.primary,
        dark: themeConfig.colors.primaryDark,
      },
      secondary: {
        main: themeConfig.colors.secondary,
      },
      error: {
        main: themeConfig.colors.error,
      },
      success: {
        main: themeConfig.colors.success,
      },
      warning: {
        main: themeConfig.colors.warning,
      },
      info: {
        main: themeConfig.colors.info,
      },
      background: {
        default: themeConfig.colors.background,
        paper: themeConfig.colors.surface,
      },
      text: {
        primary: themeConfig.colors.text,
        secondary: themeConfig.colors.textSecondary,
      },
      divider: themeConfig.colors.border,
    },
    components: {
      MuiTabs: {
        styleOverrides: {
          root: {
            borderBottom: `1px solid ${themeConfig.colors.border}`,
            minHeight: '48px',
          },
          indicator: {
            backgroundColor: themeConfig.colors.primary,
            height: '2px',
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            color: themeConfig.colors.textSecondary,
            fontSize: '14px',
            fontWeight: 400,
            textTransform: 'none',
            minHeight: '48px',
            padding: '10px 16px',
            '&.Mui-selected': {
              color: themeConfig.colors.primary,
              fontWeight: 600,
            },
            '&:hover': {
              color: themeConfig.colors.primary,
            },
          },
        },
      },
    },
  });

  return (
    <MuiThemeProvider theme={muiTheme}>
      <CssBaseline />
      {children}
    </MuiThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <MuiThemeWrapper>
        <App />
      </MuiThemeWrapper>
    </ThemeProvider>
  </StrictMode>,
)
