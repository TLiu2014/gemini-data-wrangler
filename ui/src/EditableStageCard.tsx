import { useState, useEffect } from 'react';
import { Save, X } from 'lucide-react';
import { useTheme } from './ThemeProvider';
import type { TransformationStage, JoinType, FilterOperator, UnionType } from './types';
import { getStageIcon, getStageColor } from './TransformationStages';
// import { validateStage } from './promptGenerator'; // Not used

interface Props {
  stage: TransformationStage | null; // null means new stage
  tables: Array<{ id: string; name: string; schema?: any[] }>;
  onSave: (stage: TransformationStage) => Promise<void> | void;
  onCancel: () => void;
  onDelete?: (stageId: string) => void;
}

export function EditableStageCard({ stage, tables, onSave, onCancel, onDelete }: Props) {
  const { themeConfig } = useTheme();
  const [type, setType] = useState<TransformationStage['type']>(stage?.type || 'FILTER');
  const [description, setDescription] = useState(stage?.description || '');
  const [data, setData] = useState<any>(stage?.data || {});
  const [validationErrors, setValidationErrors] = useState<Record<string, boolean>>({});
  
  // When the stage prop changes, reset local state to match the stage
  // This ensures we always start with the current stage values when editing
  useEffect(() => {
    if (stage) {
      // Reset to stage values - this ensures we don't carry over stale state
      setType(stage.type);
      setDescription(stage.description);
      setData(stage.data || {});
      setValidationErrors({});
    }
  }, [stage?.id]); // Only reset when stage ID changes (i.e., different stage)

  const color = getStageColor(type);

  // Validate individual fields (currently unused but kept for future use)
  /*
  const validateField = (fieldName: string, value: any): boolean => {
    switch (type) {
      case 'JOIN':
        if (fieldName === 'leftTable' || fieldName === 'rightTable' || fieldName === 'leftKey' || fieldName === 'rightKey') {
          return !!(value && value.toString().trim());
        }
        break;
      case 'FILTER':
        if (fieldName === 'table' || fieldName === 'column' || fieldName === 'operator' || fieldName === 'value') {
          return !!(value && (typeof value === 'string' ? value.trim() : value !== ''));
        }
        break;
      case 'UNION':
        if (fieldName === 'tables') {
          return !!(value && Array.isArray(value) && value.length > 0);
        }
        break;
      case 'GROUP':
        if (fieldName === 'groupBy') {
          return !!(value && Array.isArray(value) && value.length > 0);
        }
        break;
      case 'SELECT':
        if (fieldName === 'columns') {
          return !!(value && Array.isArray(value) && value.length > 0);
        }
        break;
      case 'SORT':
        if (fieldName === 'orderBy') {
          return !!(value && Array.isArray(value) && value.length > 0);
        }
        break;
      case 'CUSTOM':
        if (fieldName === 'sql') {
          return !!(value && value.toString().trim());
        }
        break;
    }
    return true;
  };
  */

  const checkValidation = () => {
    const errors: Record<string, boolean> = {};
    
    // Description is optional, so we don't validate it

    switch (type) {
      case 'JOIN':
        if (!data.leftTable) errors.leftTable = true;
        if (!data.rightTable) errors.rightTable = true;
        if (!data.leftKey) errors.leftKey = true;
        if (!data.rightKey) errors.rightKey = true;
        break;
      case 'FILTER':
        if (!data.table) errors.table = true;
        if (!data.column) errors.column = true;
        if (!data.operator) errors.operator = true;
        if (data.value === undefined || data.value === '') errors.value = true;
        break;
      case 'UNION':
        if (!data.tables || data.tables.length === 0) errors.tables = true;
        break;
      case 'GROUP':
        if (!data.groupBy || data.groupBy.length === 0) errors.groupBy = true;
        break;
      case 'SELECT':
        if (!data.columns || data.columns.length === 0) errors.columns = true;
        break;
      case 'SORT':
        if (!data.orderBy || data.orderBy.length === 0) errors.orderBy = true;
        break;
      case 'CUSTOM':
        if (!data.sql || !data.sql.trim()) errors.sql = true;
        break;
    }

    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    // Check validation and show errors
    if (!checkValidation()) {
      return;
    }
    
    const newStage: TransformationStage = {
      id: stage?.id || `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      description,
      timestamp: stage?.timestamp || new Date(),
      data
    };
    
    try {
      await onSave(newStage);
      setValidationErrors({});
    } catch (error) {
      console.error('Error saving stage:', error);
      // Error handling is done in parent component
    }
  };

  const handleCancel = () => {
    // Call parent's cancel handler to exit edit mode
    onCancel();
  };

  const renderTypeSpecificFields = () => {
    switch (type) {
      case 'JOIN':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Join Type
              </label>
              <select
                value={data.joinType || 'INNER'}
                onChange={(e) => setData({ ...data, joinType: e.target.value as JoinType })}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="INNER">INNER</option>
                <option value="LEFT">LEFT</option>
                <option value="RIGHT">RIGHT</option>
                <option value="FULL OUTER">FULL OUTER</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Left Table <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              <select
                value={data.leftTable || ''}
                onChange={(e) => {
                  setData({ ...data, leftTable: e.target.value, leftKey: '' }); // Clear leftKey when leftTable changes
                  if (validationErrors.leftTable) {
                    setValidationErrors({ ...validationErrors, leftTable: false });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${validationErrors.leftTable ? themeConfig.colors.error : themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="">Select table</option>
                {tables.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Right Table <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              <select
                value={data.rightTable || ''}
                onChange={(e) => {
                  setData({ ...data, rightTable: e.target.value, rightKey: '' }); // Clear rightKey when rightTable changes
                  if (validationErrors.rightTable) {
                    setValidationErrors({ ...validationErrors, rightTable: false });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${validationErrors.rightTable ? themeConfig.colors.error : themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="">Select table</option>
                {tables.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Left Key <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              {data.leftTable ? (() => {
                const selectedTable = tables.find(t => t.name === data.leftTable);
                const columns = selectedTable?.schema?.map((col: any) => col.column_name || col.name) || [];
                return (
                  <select
                    value={data.leftKey || ''}
                    onChange={(e) => {
                      setData({ ...data, leftKey: e.target.value });
                      if (validationErrors.leftKey) {
                        setValidationErrors({ ...validationErrors, leftKey: false });
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '6px',
                      borderRadius: '4px',
                      border: `1px solid ${validationErrors.leftKey ? themeConfig.colors.error : themeConfig.colors.border}`,
                      background: themeConfig.colors.surfaceElevated,
                      color: themeConfig.colors.text,
                      fontSize: '12px'
                    }}
                  >
                    <option value="">Select column</option>
                    {columns.map((col: string) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                );
              })() : (
                <input
                  type="text"
                  value={data.leftKey || ''}
                  onChange={(e) => {
                    setData({ ...data, leftKey: e.target.value });
                    if (validationErrors.leftKey) {
                      setValidationErrors({ ...validationErrors, leftKey: false });
                    }
                  }}
                  placeholder="Select left table first"
                  disabled
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '4px',
                    border: `1px solid ${validationErrors.leftKey ? themeConfig.colors.error : themeConfig.colors.border}`,
                    background: themeConfig.colors.surface,
                    color: themeConfig.colors.textTertiary,
                    fontSize: '12px',
                    cursor: 'not-allowed'
                  }}
                />
              )}
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Right Key <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              {data.rightTable ? (() => {
                const selectedTable = tables.find(t => t.name === data.rightTable);
                const columns = selectedTable?.schema?.map((col: any) => col.column_name || col.name) || [];
                return (
                  <select
                    value={data.rightKey || ''}
                    onChange={(e) => {
                      setData({ ...data, rightKey: e.target.value });
                      if (validationErrors.rightKey) {
                        setValidationErrors({ ...validationErrors, rightKey: false });
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '6px',
                      borderRadius: '4px',
                      border: `1px solid ${validationErrors.rightKey ? themeConfig.colors.error : themeConfig.colors.border}`,
                      background: themeConfig.colors.surfaceElevated,
                      color: themeConfig.colors.text,
                      fontSize: '12px'
                    }}
                  >
                    <option value="">Select column</option>
                    {columns.map((col: string) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                );
              })() : (
                <input
                  type="text"
                  value={data.rightKey || ''}
                  onChange={(e) => {
                    setData({ ...data, rightKey: e.target.value });
                    if (validationErrors.rightKey) {
                      setValidationErrors({ ...validationErrors, rightKey: false });
                    }
                  }}
                  placeholder="Select right table first"
                  disabled
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '4px',
                    border: `1px solid ${validationErrors.rightKey ? themeConfig.colors.error : themeConfig.colors.border}`,
                    background: themeConfig.colors.surface,
                    color: themeConfig.colors.textTertiary,
                    fontSize: '12px',
                    cursor: 'not-allowed'
                  }}
                />
              )}
            </div>
          </div>
        );

      case 'FILTER':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Table <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              <select
                value={data.table || ''}
                onChange={(e) => {
                  setData({ ...data, table: e.target.value, column: '' }); // Clear column when table changes
                  if (validationErrors.table) {
                    setValidationErrors({ ...validationErrors, table: false });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${validationErrors.table ? themeConfig.colors.error : themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="">Select table</option>
                {tables.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Column <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              {data.table ? (() => {
                const selectedTable = tables.find(t => t.name === data.table);
                const columns = selectedTable?.schema?.map((col: any) => col.column_name || col.name) || [];
                return (
                  <select
                    value={data.column || ''}
                    onChange={(e) => {
                      setData({ ...data, column: e.target.value });
                      if (validationErrors.column) {
                        setValidationErrors({ ...validationErrors, column: false });
                      }
                    }}
                    style={{
                      width: '100%',
                      padding: '6px',
                      borderRadius: '4px',
                      border: `1px solid ${validationErrors.column ? themeConfig.colors.error : themeConfig.colors.border}`,
                      background: themeConfig.colors.surfaceElevated,
                      color: themeConfig.colors.text,
                      fontSize: '12px'
                    }}
                  >
                    <option value="">Select column</option>
                    {columns.map((col: string) => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                );
              })() : (
                <input
                  type="text"
                  value={data.column || ''}
                  onChange={(e) => {
                    setData({ ...data, column: e.target.value });
                    if (validationErrors.column) {
                      setValidationErrors({ ...validationErrors, column: false });
                    }
                  }}
                  placeholder="Select table first"
                  disabled
                  style={{
                    width: '100%',
                    padding: '6px',
                    borderRadius: '4px',
                    border: `1px solid ${validationErrors.column ? themeConfig.colors.error : themeConfig.colors.border}`,
                    background: themeConfig.colors.surface,
                    color: themeConfig.colors.textTertiary,
                    fontSize: '12px',
                    cursor: 'not-allowed'
                  }}
                />
              )}
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Operator <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              <select
                value={data.operator || '='}
                onChange={(e) => {
                  setData({ ...data, operator: e.target.value as FilterOperator });
                  if (validationErrors.operator) {
                    setValidationErrors({ ...validationErrors, operator: false });
                  }
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${validationErrors.operator ? themeConfig.colors.error : themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="=">=</option>
                <option value="!=">!=</option>
                <option value=">">&gt;</option>
                <option value="<">&lt;</option>
                <option value=">=">&gt;=</option>
                <option value="<=">&lt;=</option>
                <option value="LIKE">LIKE</option>
                <option value="IN">IN</option>
                <option value="NOT IN">NOT IN</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Value <span style={{ color: themeConfig.colors.error }}>*</span>
              </label>
              <input
                type="text"
                value={data.value || ''}
                onChange={(e) => {
                  setData({ ...data, value: e.target.value });
                  if (validationErrors.value) {
                    setValidationErrors({ ...validationErrors, value: false });
                  }
                }}
                placeholder="Filter value"
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${validationErrors.value ? themeConfig.colors.error : themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              />
            </div>
          </div>
        );

      case 'UNION':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Union Type
              </label>
              <select
                value={data.unionType || 'UNION'}
                onChange={(e) => setData({ ...data, unionType: e.target.value as UnionType })}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="UNION">UNION</option>
                <option value="UNION ALL">UNION ALL</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Tables (comma-separated)
              </label>
              <input
                type="text"
                value={data.tables?.join(', ') || ''}
                onChange={(e) => setData({ ...data, tables: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                placeholder="table1, table2"
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div 
      style={{
        background: themeConfig.colors.surfaceElevated,
        border: `2px solid ${color}`,
        borderRadius: '8px',
        padding: '12px',
        position: 'relative',
        zIndex: 1,
        boxShadow: themeConfig.shadows.sm
      }}
      onMouseDown={(e) => {
        // Prevent node drag when clicking on form elements
        const target = e.target as HTMLElement;
        const isFormElement = target.tagName === 'INPUT' || 
                             target.tagName === 'SELECT' || 
                             target.tagName === 'TEXTAREA' ||
                             target.tagName === 'BUTTON' ||
                             target.closest('button') !== null;
        if (isFormElement) {
          e.stopPropagation();
        }
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          background: color,
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0
        }}>
          {getStageIcon(type)}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Type
              </label>
              <select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as TransformationStage['type']);
                  setData({});
                }}
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              >
                <option value="JOIN">JOIN</option>
                <option value="UNION">UNION</option>
                <option value="FILTER">FILTER</option>
                <option value="GROUP">GROUP</option>
                <option value="SELECT">SELECT</option>
                <option value="SORT">SORT</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: '11px', color: themeConfig.colors.textSecondary, display: 'block', marginBottom: '4px' }}>
                Description <span style={{ fontSize: '10px', color: themeConfig.colors.textTertiary }}>(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this transformation (optional)"
                style={{
                  width: '100%',
                  padding: '6px',
                  borderRadius: '4px',
                  border: `1px solid ${themeConfig.colors.border}`,
                  background: themeConfig.colors.surfaceElevated,
                  color: themeConfig.colors.text,
                  fontSize: '12px'
                }}
              />
            </div>
            {renderTypeSpecificFields()}
            <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleSave();
                }}
                type="button"
                style={{
                  padding: '6px 12px',
                  background: themeConfig.colors.primary,
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontWeight: '500'
                }}
              >
                <Save size={12} />
                Save
              </button>
              {stage && onDelete && (
                <button
                  onClick={() => {
                    if (stage.id && onDelete) {
                      onDelete(stage.id);
                    }
                  }}
                  style={{
                    padding: '6px 12px',
                    background: themeConfig.colors.error,
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  Delete
                </button>
              )}
              <button
                onClick={handleCancel}
                style={{
                  padding: '6px 12px',
                  background: themeConfig.colors.surface,
                  color: themeConfig.colors.text,
                  border: `1px solid ${themeConfig.colors.border}`,
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                <X size={12} />
                Cancel
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

