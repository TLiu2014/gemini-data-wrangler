import { X } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import type { TableData } from './types';
import { useState, useEffect } from 'react';
import { Tabs, Tab, Box, IconButton } from '@mui/material';

interface Props {
  tables: TableData[];
  activeTableId: string | null;
  onTableSelect: (tableId: string) => void;
  onTableClose: (tableId: string) => void;
}

export function TableTabs({ tables, activeTableId, onTableSelect, onTableClose }: Props) {
  const { themeConfig } = useTheme();
  const [value, setValue] = useState(activeTableId || '');

  // Update value when activeTableId changes externally
  useEffect(() => {
    if (activeTableId !== value) {
      setValue(activeTableId || '');
    }
  }, [activeTableId, value]);

  const handleChange = (_event: React.SyntheticEvent, newValue: string) => {
    setValue(newValue);
    onTableSelect(newValue);
  };

  if (tables.length === 0) return null;

  return (
    <Box sx={{ 
      position: 'relative',
      marginBottom: '16px',
      width: '100%'
    }}>
      <Tabs
        value={value}
        onChange={handleChange}
        variant="scrollable"
        scrollButtons="auto"
        allowScrollButtonsMobile
        sx={{
          borderBottom: `1px solid ${themeConfig.colors.border}`,
          minHeight: '48px',
          '& .MuiTabs-scrollButtons': {
            color: themeConfig.colors.textSecondary,
            '&.Mui-disabled': {
              opacity: 0.3,
            },
          },
          '& .MuiTabs-indicator': {
            backgroundColor: themeConfig.colors.primary,
            height: '2px',
          },
        }}
      >
        {tables.map((table) => (
          <Tab
            key={table.id}
            value={table.id}
            label={
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px',
                whiteSpace: 'nowrap'
              }}>
                <span>{table.name}</span>
                <span style={{ 
                  fontSize: '12px', 
                  color: themeConfig.colors.textTertiary,
                  fontWeight: 'normal'
                }}>
                  ({table.rows.length} rows)
                </span>
                {tables.length > 1 && (
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTableClose(table.id);
                    }}
                    sx={{
                      padding: '2px',
                      marginLeft: '4px',
                      color: themeConfig.colors.textTertiary,
                      '&:hover': {
                        backgroundColor: `${themeConfig.colors.error}20`,
                        color: themeConfig.colors.error,
                      },
                      width: '20px',
                      height: '20px',
                    }}
                    aria-label={`Close ${table.name}`}
                  >
                    <X size={14} />
                  </IconButton>
                )}
              </Box>
            }
            sx={{
              color: themeConfig.colors.textSecondary,
              fontSize: '14px',
              fontWeight: activeTableId === table.id ? 600 : 400,
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
            }}
          />
        ))}
      </Tabs>
    </Box>
  );
}
