import { X } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import type { TableData } from './types';
import { useState, useRef, useEffect } from 'react';

interface Props {
  tables: TableData[];
  activeTableId: string | null;
  onTableSelect: (tableId: string) => void;
  onTableClose: (tableId: string) => void;
}

export function TableTabs({ tables, activeTableId, onTableSelect, onTableClose }: Props) {
  const { themeConfig } = useTheme();
  const [showLeftFade, setShowLeftFade] = useState(false);
  const [showRightFade, setShowRightFade] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const checkScroll = () => {
      setShowLeftFade(container.scrollLeft > 0);
      setShowRightFade(container.scrollLeft < container.scrollWidth - container.clientWidth - 1);
    };

    checkScroll();
    container.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);

    return () => {
      container.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [tables]);

  // Scroll to active tab when activeTableId changes
  useEffect(() => {
    if (!activeTableId) return;
    
    const activeTabElement = tabRefs.current.get(activeTableId);
    const container = scrollContainerRef.current;
    
    if (activeTabElement && container) {
      // Calculate the position to scroll to
      const tabLeft = activeTabElement.offsetLeft;
      const tabWidth = activeTabElement.offsetWidth;
      const containerWidth = container.clientWidth;
      const containerScrollLeft = container.scrollLeft;
      
      // Calculate if the tab is fully visible
      const tabRight = tabLeft + tabWidth;
      const visibleLeft = containerScrollLeft;
      const visibleRight = containerScrollLeft + containerWidth;
      
      // Scroll to center the tab if it's not fully visible
      if (tabLeft < visibleLeft || tabRight > visibleRight) {
        const scrollTo = tabLeft - (containerWidth / 2) + (tabWidth / 2);
        container.scrollTo({
          left: Math.max(0, scrollTo),
          behavior: 'smooth'
        });
      }
    }
  }, [activeTableId]);

  if (tables.length === 0) return null;

  return (
    <div style={{ 
      position: 'relative',
      marginBottom: '16px'
    }}>
      {/* Left fade gradient */}
      {showLeftFade && (
        <div style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: '32px',
          background: `linear-gradient(to right, ${themeConfig.colors.background}, transparent)`,
          pointerEvents: 'none',
          zIndex: 1
        }} />
      )}
      
      {/* Right fade gradient */}
      {showRightFade && (
        <div style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: '32px',
          background: `linear-gradient(to left, ${themeConfig.colors.background}, transparent)`,
          pointerEvents: 'none',
          zIndex: 1
        }} />
      )}

      <div 
        ref={scrollContainerRef}
        style={{ 
          display: 'flex', 
          gap: '4px', 
          borderBottom: `2px solid ${themeConfig.colors.border}`,
          overflowX: 'auto',
          scrollbarWidth: 'thin',
          scrollbarColor: `${themeConfig.colors.border} transparent`
        }}
      >
        {tables.map((table) => (
          <div
            key={table.id}
            ref={(el) => {
              if (el) {
                tabRefs.current.set(table.id, el);
              } else {
                tabRefs.current.delete(table.id);
              }
            }}
            onClick={() => onTableSelect(table.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 16px',
              cursor: 'pointer',
              borderBottom: activeTableId === table.id ? `2px solid ${themeConfig.colors.primary}` : '2px solid transparent',
              background: activeTableId === table.id ? `${themeConfig.colors.primary}15` : 'transparent',
              color: activeTableId === table.id ? themeConfig.colors.primary : themeConfig.colors.textSecondary,
              fontWeight: activeTableId === table.id ? '600' : '400',
              whiteSpace: 'nowrap',
              position: 'relative',
              marginBottom: '-2px',
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onTableSelect(table.id);
              }
            }}
          >
            <span>{table.name}</span>
            <span style={{ fontSize: '12px', color: themeConfig.colors.textTertiary }}>({table.rows.length} rows)</span>
            {tables.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onTableClose(table.id);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px',
                  display: 'flex',
                  alignItems: 'center',
                  color: themeConfig.colors.textTertiary,
                  borderRadius: '4px',
                  transition: 'all 0.2s',
                  outline: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = `${themeConfig.colors.error}20`;
                  e.currentTarget.style.color = themeConfig.colors.error;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = themeConfig.colors.textTertiary;
                }}
                onFocus={(e) => {
                  e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                  e.currentTarget.style.outlineOffset = '2px';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = 'none';
                }}
                tabIndex={0}
                aria-label={`Close ${table.name}`}
              >
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

