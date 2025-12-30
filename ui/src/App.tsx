import { useState, useEffect, Component } from 'react';
import type { ReactNode } from 'react';
import { initDB } from './db';
import { SmartTransform } from './SmartTransform';
import { DynamicChart } from './DynamicChart';
import { EnhancedVisualizations } from './EnhancedVisualizations';
import { VisualizationPresets } from './VisualizationPresets';
// import { TransformationStages } from './TransformationStages'; // Using StageGraphSVG instead
import { StageGraphFlow } from './StageGraphFlow';
import { ResizablePanel } from './ResizablePanel';
import { TableTabs } from './TableTabs';
import { MenuBar } from './MenuBar';
import { useTheme } from './ThemeProvider';
import { validateStage, generatePromptFromStages } from './promptGenerator';
import { parseSQLToStages } from './sqlParser';
import { generateSQLFromStage } from './sqlGenerator';
import { useDropzone } from 'react-dropzone';
import * as duckdb from '@duckdb/duckdb-wasm';
import { mockData, mockSchema } from './mockData';
import type { TableData, TransformationStage } from './types';

// ============================================================================
// CONFIGURATION: Sample Data Preloading
// ============================================================================
// Set this to true to automatically load sample CSV files from src/sampleData
// when the homepage opens. Set to false to disable preloading.
// 
// For development:
//   - Set PRELOAD_SAMPLE_DATA = true to test with sample data
//   - Set PRELOAD_SAMPLE_DATA = false to start with empty tables
// ============================================================================
const PRELOAD_SAMPLE_DATA = true;

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode; fallback?: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div style={{ padding: '20px', background: '#fee2e2', borderRadius: '8px', color: '#991b1b' }}>Something went wrong. Please try again.</div>;
    }
    return this.props.children;
  }
}

function App() {
  const { themeConfig } = useTheme();
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [tables, setTables] = useState<TableData[]>([]);
  const [activeTableId, setActiveTableId] = useState<string | null>(null);
  const [transformationStages, setTransformationStages] = useState<TransformationStage[]>([]);
  const [chartConfig, setChartConfig] = useState<any>(null); // From Gemini
  const [status, setStatus] = useState('Initializing Engine...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(() => {
    // Load from localStorage if available
    return localStorage.getItem('gemini_api_key');
  });
  const [hasDefaultApiKey, setHasDefaultApiKey] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [newStage, setNewStage] = useState<TransformationStage | null>(null);
  const [chatPrompt, setChatPrompt] = useState<string>('');
  const [sampleDataLoaded, setSampleDataLoaded] = useState(false);
  const [showVisualizationPresets, setShowVisualizationPresets] = useState<boolean>(() => {
    // Load from localStorage, default to true
    const saved = localStorage.getItem('show_visualization_presets');
    return saved !== null ? saved === 'true' : true;
  });
  // Map stage ID to result table ID
  const [stageToTableMap, setStageToTableMap] = useState<Map<string, string>>(new Map());

  // Get current active table data
  const activeTable = tables.find(t => t.id === activeTableId);
  const rows = activeTable?.rows || [];
  const schema = activeTable?.schema || [];

  // Load sample CSV files
  const loadSampleData = async () => {
    if (!db || !conn) return;
    
    const sampleFiles = [
      { name: 'customers.csv', path: '/sampleData/customers.csv' },
      { name: 'orders.csv', path: '/sampleData/orders.csv' }
    ];
    
    for (const fileInfo of sampleFiles) {
      try {
        setStatus(`Loading sample data: ${fileInfo.name}...`);
        
        // Try to fetch from public folder first, then try src path
        let csvText: string | null = null;
        
        try {
          const response = await fetch(fileInfo.path);
          if (response.ok) {
            csvText = await response.text();
          }
        } catch (e) {
          // Try alternative path
          try {
            const altResponse = await fetch(`/src/sampleData/${fileInfo.name}`);
            if (altResponse.ok) {
              csvText = await altResponse.text();
            }
          } catch (e2) {
            console.warn(`Could not load ${fileInfo.name}, skipping...`);
            continue;
          }
        }
        
        if (!csvText) {
          console.warn(`Could not load ${fileInfo.name}, skipping...`);
          continue;
        }
        
        // Convert CSV text to File object
        const blob = new Blob([csvText], { type: 'text/csv' });
        const file = new File([blob], fileInfo.name, { type: 'text/csv' });
        
        // Generate table name from filename
        const tableName = `table_${fileInfo.name.replace(/[^a-zA-Z0-9]/g, '_').replace(/\.[^.]*$/, '')}`;
        const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const { schema, rows } = await loadFileAsTable(file, tableName);
        
        // Create table data object
        const newTable: TableData = {
          id: tableId,
          name: tableName,
          fileName: fileInfo.name,
          schema,
          rows,
          createdAt: new Date()
        };
        
        // Add to tables list
        setTables(prev => [...prev, newTable]);
        
        // Set as active if it's the first table
        setActiveTableId(prev => prev || tableId);
        
        // Add LOAD stage
        const loadStage: TransformationStage = {
          id: `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'LOAD',
          description: `Loaded table "${tableName}" from sample file "${fileInfo.name}"`,
          timestamp: new Date(),
          data: {
            tableName,
            fileName: fileInfo.name
          }
        };
        setTransformationStages(prev => [...prev, loadStage]);
      } catch (err) {
        console.warn(`Error loading sample file ${fileInfo.name}:`, err);
      }
    }
    
    setStatus('Sample data loaded. Ready for transformations.');
  };

  useEffect(() => {
    initDB().then(async (database) => {
      setDb(database);
      const connection = await database.connect();
      setConn(connection);
      setStatus('Loading sample data...');
    });

    // Check if server has default API key
    fetch('/api/config')
      .then(res => res.json())
      .then(data => {
        setHasDefaultApiKey(data.hasDefaultApiKey);
        if (data.hasDefaultApiKey && !apiKey) {
          setStatus('Ready for data. (Using default API key from server)');
        }
      })
      .catch(err => console.warn('Could not fetch server config:', err));
  }, []);

  // Load sample data when database and connection are ready (only once)
  useEffect(() => {
    if (PRELOAD_SAMPLE_DATA && db && conn && !sampleDataLoaded) {
      loadSampleData().then(() => {
        setSampleDataLoaded(true);
      });
    } else if (!PRELOAD_SAMPLE_DATA && db && conn) {
      // If preloading is disabled, just set status
      setStatus('Ready for data.');
    }
  }, [db, conn, sampleDataLoaded]);

  const handleApiKeySet = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    setError(null); // Clear any previous errors
  };

  // Helper function to parse CSV line (handles quoted values)
  const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const loadFileAsTable = async (file: File, tableName: string): Promise<{ schema: any[]; rows: any[] }> => {
    if (!db || !conn) throw new Error('Database not initialized');
    
    const internalFileName = `table_${tableName}.csv`;
    let success = false;
    let lastError: Error | null = null;

    // Method 1: Try registerFileHandle
    try {
      await db.registerFileHandle(
        internalFileName, 
        file, 
        duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, 
        true
      );
      
      await conn.query(`
        CREATE OR REPLACE TABLE ${tableName} AS 
        SELECT * FROM read_csv_auto('${internalFileName}', header=true, auto_detect=true)
      `);
      
      success = true;
    } catch (error1) {
      lastError = error1 instanceof Error ? error1 : new Error(String(error1));
      
      // Method 2: Read file as text
      try {
        const fileText = await file.text();
        const textBlob = new Blob([fileText], { type: 'text/csv' });
        const textFile = new File([textBlob], internalFileName, { type: 'text/csv' });
        
        await db.registerFileHandle(
          internalFileName,
          textFile,
          duckdb.DuckDBDataProtocol.BROWSER_FILEREADER,
          true
        );
        
        await conn.query(`
          CREATE OR REPLACE TABLE ${tableName} AS 
          SELECT * FROM read_csv_auto('${internalFileName}', header=true, auto_detect=true)
        `);
        
        success = true;
      } catch (error2) {
        lastError = error2 instanceof Error ? error2 : new Error(String(error2));
        
        // Method 3: Manual parse
        try {
          const fileText = await file.text();
          const lines = fileText.split(/\r?\n/).filter(line => line.trim());
          
          if (lines.length < 2) {
            throw new Error('CSV file must have at least a header and one data row');
          }
          
          const headerLine = lines[0];
          const headers = parseCSVLine(headerLine);
          
          if (headers.length === 0) {
            throw new Error('Could not parse CSV headers');
          }
          
          const createSQL = `CREATE OR REPLACE TABLE ${tableName} (${headers.map((h: string) => `"${h.replace(/"/g, '""')}" VARCHAR`).join(', ')})`;
          await conn.query(createSQL);
          
          const dataLines = lines.slice(1, 10001);
          const insertBatch: string[] = [];
          
          for (const line of dataLines) {
            if (!line.trim()) continue;
            const values = parseCSVLine(line);
            if (values.length === headers.length) {
              const escapedValues = values.map(v => `'${String(v).replace(/'/g, "''").replace(/\\/g, '\\\\')}'`);
              insertBatch.push(`(${escapedValues.join(', ')})`);
              
              if (insertBatch.length >= 100) {
                await conn.query(`INSERT INTO ${tableName} VALUES ${insertBatch.join(', ')}`);
                insertBatch.length = 0;
              }
            }
          }
          
          if (insertBatch.length > 0) {
            await conn.query(`INSERT INTO ${tableName} VALUES ${insertBatch.join(', ')}`);
          }
          
          success = true;
        } catch (error3) {
          lastError = error3 instanceof Error ? error3 : new Error(String(error3));
        }
      }
    }

    if (!success) {
      throw lastError || new Error('Failed to load CSV');
    }

    // Get schema and data
    const schemaRes = await conn.query(`DESCRIBE ${tableName}`);
    const schema = schemaRes.toArray().map(r => r.toJSON());
    const result = await conn.query(`SELECT * FROM ${tableName} LIMIT 1000`);
    const rows = result.toArray().map(r => r.toJSON());

    return { schema, rows };
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (!db || !conn) return;
    setError(null);

    // Process all files
    for (const file of acceptedFiles) {
      try {
    setStatus(`Loading ${file.name}...`);

        // Generate table name from filename
        const tableName = `table_${file.name.replace(/[^a-zA-Z0-9]/g, '_').replace(/\.[^.]*$/, '')}`;
        const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        const { schema, rows } = await loadFileAsTable(file, tableName);
        
        // Create table data object
        const newTable: TableData = {
          id: tableId,
          name: tableName,
          fileName: file.name,
          schema,
          rows,
          createdAt: new Date()
        };
        
        // Add to tables list
        setTables(prev => [...prev, newTable]);
        
        // Set as active if it's the first table
        setActiveTableId(prev => prev || tableId);
    
        // Add LOAD stage
        const loadStage: TransformationStage = {
          id: `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          type: 'LOAD',
          description: `Loaded table "${tableName}" from file "${file.name}"`,
          timestamp: new Date(),
          data: {
            tableName,
            fileName: file.name
          }
        };
        setTransformationStages(prev => [...prev, loadStage]);
        
        setStatus(`Loaded ${file.name} (${rows.length} rows)`);
      } catch (error) {
        console.error(`Error loading ${file.name}:`, error);
        setError(`Failed to load ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    if (acceptedFiles.length > 0) {
      setStatus(`Loaded ${acceptedFiles.length} file(s).`);
    }
  };

  const handleTableSelect = (tableId: string) => {
    setActiveTableId(tableId);
  };

  const handleTableClose = (tableId: string) => {
    setTables(prev => {
      const newTables = prev.filter(t => t.id !== tableId);
      if (activeTableId === tableId && newTables.length > 0) {
        setActiveTableId(newTables[0].id);
      } else if (newTables.length === 0) {
        setActiveTableId(null);
      }
      return newTables;
    });
  };

  const executeStageTransformation = async (stage: TransformationStage) => {
    if (!conn) {
      throw new Error('Database connection not available');
    }

    // For some operations, we need at least one table
    if (tables.length === 0 && stage.type !== 'LOAD') {
      throw new Error('No tables available. Please upload a CSV file first.');
    }

    setIsProcessing(true);
    setStatus(`Executing: ${stage.description}`);
    setError(null);

    try {
      // Use activeTable as default source, or first table if no active table
      const defaultTableName = activeTable?.name || (tables.length > 0 ? tables[0].name : '');

      // Generate SQL from the stage
      const sql = generateSQLFromStage(stage, defaultTableName);
      
      // Get stage index for table naming
      // If stage exists in list, use its index; otherwise use the next index (for new stages)
      const stageIndex = transformationStages.findIndex(s => s.id === stage.id);
      const displayIndex = stageIndex >= 0 ? stageIndex : transformationStages.length;
      
      // Execute the transformation and create result table with stage index and type
      const stageTypeLower = stage.type.toLowerCase();
      const resultTableName = `result_stage_${displayIndex}_${stageTypeLower}`;
      await conn.query(`CREATE OR REPLACE TABLE ${resultTableName} AS ${sql}`);
      
      // Get the result data
      const result = await conn.query(`SELECT * FROM ${resultTableName} LIMIT 1000`);
      const resultRows = result.toArray().map(r => r.toJSON());
      const schemaRes = await conn.query(`DESCRIBE ${resultTableName}`);
      const resultSchema = schemaRes.toArray().map(r => r.toJSON());

      // Create new table for result
      const resultTableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newTable: TableData = {
        id: resultTableId,
        name: resultTableName,
        fileName: `Result of stage #${displayIndex}: ${stage.description}`,
        schema: resultSchema,
        rows: resultRows,
        createdAt: new Date()
      };

      setTables(prev => [...prev, newTable]);
      // Store mapping from stage ID to table ID
      setStageToTableMap(prev => {
        const newMap = new Map(prev);
        newMap.set(stage.id, resultTableId);
        return newMap;
      });
      setActiveTableId(resultTableId);
      setStatus(`Done! Created result table with ${resultRows.length} rows.`);
      setError(null);
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'Error executing transformation.';
      setError(errorMessage);
      setStatus(`Error: ${errorMessage}`);
      throw err; // Re-throw to prevent stage from being saved
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStageEdit = async (stage: TransformationStage | null) => {
    if (stage === null) {
      // Cancel editing
      setEditingStageId(null);
      setNewStage(null);
      return;
    }

    // Validate stage before saving
    if (!validateStage(stage)) {
      setError('Please fill in all required fields for this transformation stage.');
      return;
    }

    setError(null);

    try {
      // Skip execution for LOAD stages (they're already loaded)
      if (stage.type !== 'LOAD') {
        // Execute the transformation directly
        await executeStageTransformation(stage);
      }

      // After successful execution (or for LOAD stages), update the stages list
      setEditingStageId(null);
      setNewStage(null);

      // Check if this is an edit or a new stage
      const existingStageIndex = transformationStages.findIndex(s => s.id === stage.id);
      
      if (existingStageIndex >= 0) {
        // Update existing stage
        setTransformationStages(prev => {
          const updated = [...prev];
          updated[existingStageIndex] = stage;
          return updated;
        });
      } else {
        // New stage - add it
        setTransformationStages(prev => [...prev, stage]);
      }
    } catch (err) {
      // Error already set in executeStageTransformation
      // Don't update stages if transformation failed
      console.error('Failed to execute stage transformation:', err);
      // Error message is already set in executeStageTransformation
    }
  };

  const handleStageDelete = (stageId: string) => {
    setTransformationStages(prev => prev.filter(s => s.id !== stageId));
    setEditingStageId(null);
    // Regenerate prompt
    const updatedStages = transformationStages.filter(s => s.id !== stageId);
    const prompt = generatePromptFromStages(updatedStages);
    setChatPrompt(prompt);
  };

  const handleStageAdd = () => {
    // Don't add if already editing
    if (editingStageId || newStage) {
      return;
    }
    
    // Create new stage directly in the flow
    const newStageId = `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stageToAdd: TransformationStage = {
      id: newStageId,
      type: 'FILTER', // Default type, user can change it
      description: '',
      timestamp: new Date(),
      data: {}
    };
    
    // Add to stages list immediately
    setTransformationStages(prev => [...prev, stageToAdd]);
    
    // Set it to editing mode so user can configure it
    setEditingStageId(newStageId);
    setNewStage(null);
  };

  const handleStageStartEdit = (stageId: string) => {
    if (stageId === '') {
      // Cancel editing - if it's a newly added stage (not configured yet), remove it
      if (editingStageId) {
        const currentEditingStage = transformationStages.find(s => s.id === editingStageId);
        // Check if it's a newly added stage: empty description and empty data
        if (currentEditingStage && 
            (!currentEditingStage.description || currentEditingStage.description.trim() === '') &&
            (!currentEditingStage.data || Object.keys(currentEditingStage.data).length === 0)) {
          // This is a newly added stage that wasn't configured - remove it
          setTransformationStages(prev => prev.filter(s => s.id !== editingStageId));
        }
      }
      setEditingStageId(null);
    } else {
      setEditingStageId(stageId);
      setNewStage(null);
    }
  };

  const handleTransform = async (userPrompt: string) => {
    if (!conn || !activeTable) return;
    
    // API key can come from UI input, localStorage, or server .env
    // We'll let the server handle the fallback

    setIsProcessing(true);
    setStatus('Gemini is thinking...');
    setError(null);
    setChatPrompt(''); // Clear prompt after sending

    try {
      // Get all table schemas for context
      const allSchemas = tables.map(t => ({
        tableName: t.name,
        schema: t.schema
      }));

      // 1. Ask Gemini for the SQL
      // Send apiKey only if it's set (not null), server will use .env fallback
      const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          schema: activeTable.schema,
          allSchemas,
          userPrompt, 
          ...(apiKey && { apiKey }) // Only include apiKey if it's not null/empty
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to transform data');
      }
      
      const { sql, chartType, xAxis, yAxis, zAxis, explanation, transformationStages: stagesFromGemini } = await response.json();
      
      // 4. Add transformation stages from Gemini response first to get the final stage index
      let stagesToAdd: TransformationStage[] = [];
      
      if (stagesFromGemini && Array.isArray(stagesFromGemini) && stagesFromGemini.length > 0) {
        // Use stages from Gemini
        const baseTime = Date.now();
        stagesToAdd = stagesFromGemini.map((stage: any, index: number) => {
          // Validate and ensure type is set correctly
          const validTypes = ['LOAD', 'JOIN', 'UNION', 'FILTER', 'GROUP', 'SELECT', 'SORT', 'AGGREGATE', 'CUSTOM'];
          const stageType = (stage.type && validTypes.includes(stage.type.toUpperCase())) 
            ? stage.type.toUpperCase() as TransformationStage['type']
            : 'CUSTOM';
          
          // Ensure data is properly structured
          let stageData = stage.data || {};
          if (stageType === 'CUSTOM' && !stageData.sql) {
            stageData = { sql };
          }
          
          return {
            id: `stage_${baseTime}_${index}_${Math.random().toString(36).substr(2, 9)}`,
            type: stageType,
            description: stage.description || explanation,
            timestamp: new Date(),
            data: stageData
          };
        });
        
        console.log('✅ Parsed stages from Gemini:', stagesToAdd);
      } else {
        // Fallback: parse SQL to extract stages
        console.warn('⚠️  No stages returned from Gemini, parsing SQL as fallback');
        const parsedStages = parseSQLToStages(sql, explanation);
        const baseTime = Date.now();
        stagesToAdd = parsedStages.map((stage, index) => ({
          id: `stage_${baseTime}_${index}_${Math.random().toString(36).substr(2, 9)}`,
          type: stage.type,
          description: stage.description,
          timestamp: new Date(),
          data: stage.data || (stage.type === 'CUSTOM' ? { sql } : {})
        }));
        
        console.log('✅ Parsed stages from SQL:', stagesToAdd);
      }
      
      // Get the final stage index for table naming
      const finalStageIndex = transformationStages.length + stagesToAdd.length - 1;
      const lastStage = stagesToAdd.length > 0 ? stagesToAdd[stagesToAdd.length - 1] : null;
      
      // 2. Execute Gemini's SQL and create result table with stage index and type
      setStatus(`Executing: ${explanation}`);
      const stageTypeLower = lastStage ? lastStage.type.toLowerCase() : 'custom';
      const resultTableName = `result_stage_${finalStageIndex}_${stageTypeLower}`;
      await conn.query(`CREATE OR REPLACE TABLE ${resultTableName} AS ${sql}`);
      
      const result = await conn.query(`SELECT * FROM ${resultTableName} LIMIT 1000`);
      const resultRows = result.toArray().map(r => r.toJSON());
      const schemaRes = await conn.query(`DESCRIBE ${resultTableName}`);
      const resultSchema = schemaRes.toArray().map(r => r.toJSON());

      // 3. Create new table for result
      const resultTableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const newTable: TableData = {
        id: resultTableId,
        name: resultTableName,
        fileName: `Result of stage #${finalStageIndex}: ${userPrompt}`,
        schema: resultSchema,
        rows: resultRows,
        createdAt: new Date()
      };

      setTables(prev => [...prev, newTable]);
      // Store mapping from last stage ID to table ID
      if (lastStage) {
        setStageToTableMap(prev => {
          const newMap = new Map(prev);
          newMap.set(lastStage.id, resultTableId);
          return newMap;
        });
      }
      setActiveTableId(resultTableId);
      setChartConfig({ type: chartType, xAxis, yAxis, zAxis });
      setStatus(`Done! Created result table with ${resultRows.length} rows.`);
      setError(null);
      
      if (stagesToAdd.length > 0) {
        setTransformationStages(prev => [...prev, ...stagesToAdd]);
      }

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'Error transforming data.';
      setError(errorMessage);
      setStatus(`Error: ${errorMessage}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePresetVisualize = (config: { type: string; xAxis: string; yAxis: string; zAxis?: string }) => {
    try {
      // Use mock data if no rows are loaded, otherwise use actual data
      const dataToUse = rows.length > 0 ? rows : mockData;
      const firstRow = dataToUse[0];
      
      if (!firstRow) {
        setError('No data available for visualization');
        return;
      }

      if (!firstRow.hasOwnProperty(config.xAxis)) {
        setError(`Column "${config.xAxis}" not found in data`);
        return;
      }
      if (!firstRow.hasOwnProperty(config.yAxis)) {
        setError(`Column "${config.yAxis}" not found in data`);
        return;
      }
      if (config.zAxis && !firstRow.hasOwnProperty(config.zAxis)) {
        setError(`Column "${config.zAxis}" not found in data`);
        return;
      }

      // Apply visualization preset directly without transforming data
      setChartConfig(config);
      setError(null);
      const dataSource = rows.length > 0 ? 'your data' : 'sample data';
      setStatus(`Visualization (${dataSource}): ${config.type} - ${config.yAxis} by ${config.xAxis}${config.zAxis ? ` and ${config.zAxis}` : ''}`);
    } catch (err) {
      console.error('Error in preset visualization:', err);
      setError(`Failed to create visualization: ${err instanceof Error ? err.message : 'Unknown error'}`);
      // Keep the current view - don't clear chartConfig
    }
  };

  const { getRootProps, getInputProps } = useDropzone({ 
    onDrop,
    multiple: true, // Allow multiple file uploads
    accept: {
      'text/csv': ['.csv'],
      'text/plain': ['.csv', '.txt']
    }
  });

  return (
    <div style={{ 
      display: 'flex', 
      flexDirection: 'column',
      minHeight: '100vh',
      fontFamily: 'Inter, sans-serif',
      background: themeConfig.colors.background
    }}>
      {/* Menu/Status Bar */}
        <MenuBar
          apiKey={apiKey}
          onApiKeySet={handleApiKeySet}
          status={status}
          tablesCount={tables.length}
          stagesCount={transformationStages.length}
          hasDefaultApiKey={hasDefaultApiKey}
          showVisualizationPresets={showVisualizationPresets}
          onToggleVisualizationPresets={(value) => {
            setShowVisualizationPresets(value);
            localStorage.setItem('show_visualization_presets', String(value));
          }}
        />

      {/* Main Content Layout */}
      <div style={{ 
        width: '100%',
        padding: '10px', 
        flex: 1,
        height: 'calc(100vh - 80px)',
        boxSizing: 'border-box'
      }}>
        <ResizablePanel
          defaultLeftWidth={450}
          minLeftWidth={300}
          minRightWidth={400}
          storageKey="transformation_panel_width"
          leftPanel={
            <div style={{
              position: 'sticky',
              top: '0',
              height: '85vh',
              maxHeight: '85vh',
              overflowY: 'auto',
              paddingRight: '10px'
            }}>
              <StageGraphFlow
                stages={transformationStages}
                tables={tables.map(t => ({ id: t.id, name: t.name }))}
                onStageEdit={handleStageEdit}
                onStageStartEdit={handleStageStartEdit}
                onStageDelete={handleStageDelete}
                onStageAdd={handleStageAdd}
                editingStageId={editingStageId}
                newStage={newStage}
                stageToTableMap={stageToTableMap}
                onShowTable={(tableId) => setActiveTableId(tableId)}
              />
            </div>
          }
          rightPanel={
            <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', paddingLeft: '10px' }}>
          {/* Error Message */}
          {error && (
            <div style={{
              padding: '12px',
              background: themeConfig.colors.error + '20',
              border: `1px solid ${themeConfig.colors.error}`,
              borderRadius: '8px',
              color: themeConfig.colors.error,
              marginBottom: '20px'
            }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          {/* File Upload Section - Always visible */}
          <div style={{ marginBottom: '20px' }}>
            <div {...getRootProps()} style={{ 
              border: `2px dashed ${themeConfig.colors.border}`, 
              padding: '30px', 
              textAlign: 'center', 
              cursor: 'pointer', 
              borderRadius: '8px', 
              position: 'relative', 
              zIndex: 1,
              background: tables.length > 0 ? themeConfig.colors.surface : themeConfig.colors.surfaceElevated,
              transition: 'all 0.2s',
              borderColor: themeConfig.colors.border
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.primary;
              e.currentTarget.style.background = themeConfig.colors.surface;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.border;
              e.currentTarget.style.background = tables.length > 0 ? themeConfig.colors.surface : themeConfig.colors.surfaceElevated;
            }}
            >
          <input {...getInputProps()} />
              <p style={{ margin: 0, fontSize: '16px', fontWeight: '500', color: themeConfig.colors.text }}>
                {tables.length > 0 ? 'Upload More CSV Files' : 'Drag & drop your CSV file(s) here to begin'}
              </p>
              <p style={{ fontSize: '14px', color: themeConfig.colors.textSecondary, marginTop: '8px', marginBottom: 0 }}>
                {tables.length > 0 
                  ? 'Add additional tables for joins, unions, or other operations' 
                  : 'You can upload multiple CSV files. Each will be loaded as a separate table.'}
              </p>
              {tables.length > 0 && (
                <p style={{ fontSize: '12px', color: themeConfig.colors.textTertiary, marginTop: '4px', marginBottom: 0 }}>
                  Currently loaded: {tables.length} table(s)
                </p>
              )}
            </div>
          </div>

          {/* Homepage Content - Only show when no tables */}
          {tables.length === 0 && (
            <div style={{ marginTop: '20px' }}>
              {/* Chat Field on Homepage */}
              <div style={{ marginBottom: '30px' }}>
                <SmartTransform 
                  schema={mockSchema} 
                  onTransform={handleTransform} 
                  isProcessing={isProcessing}
                  externalPrompt={chatPrompt}
                  onPromptChange={setChatPrompt}
                />
              </div>

              <h2 style={{ fontSize: '20px', marginBottom: '15px', color: themeConfig.colors.text }}>Try Visualization Presets (Sample Data)</h2>
              <p style={{ fontSize: '14px', color: themeConfig.colors.textSecondary, marginBottom: '20px' }}>
                Explore different visualization types with our sample sales data. Upload your own CSV to use your data.
              </p>
            {showVisualizationPresets && (
              <VisualizationPresets 
                schema={mockSchema}
                data={mockData}
                onVisualize={handlePresetVisualize}
              />
            )}
            
            {/* Show sample data table */}
            {chartConfig && (
              <>
                <div style={{ color: themeConfig.colors.textSecondary, fontSize: '14px', marginTop: '20px', marginBottom: '10px' }}>
                  Status: <strong>Showing sample data visualization</strong>
                </div>
                {/* Show standard Recharts for basic chart types */}
                {chartConfig && !chartConfig.type?.startsWith('d3-') && !chartConfig.type?.startsWith('3d-') && (
                  <ErrorBoundary fallback={<div style={{ padding: '20px', background: themeConfig.colors.error + '20', borderRadius: '8px', color: themeConfig.colors.error }}>Error rendering chart. Please check your axis selections.</div>}>
                    <DynamicChart data={mockData} config={chartConfig} />
                  </ErrorBoundary>
                )}
                {/* Show enhanced visualizations for D3.js and 3D charts */}
                {chartConfig && (chartConfig.type?.startsWith('d3-') || chartConfig.type?.startsWith('3d-')) && (
                  <ErrorBoundary fallback={<div style={{ padding: '20px', background: themeConfig.colors.error + '20', borderRadius: '8px', color: themeConfig.colors.error }}>Error rendering visualization. Please check your axis selections.</div>}>
                    <EnhancedVisualizations data={mockData} config={chartConfig} />
                  </ErrorBoundary>
                )}
              </>
            )}
        </div>
      )}

      {/* 2. Transformation Section */}
        {tables.length > 0 && (
        <>
          <SmartTransform 
            schema={schema} 
            onTransform={handleTransform} 
            isProcessing={isProcessing} 
            externalPrompt={chatPrompt}
            onPromptChange={setChatPrompt}
          />
          
          {/* Visualization Presets */}
          {showVisualizationPresets && (
            <VisualizationPresets 
              schema={schema}
              data={rows}
              onVisualize={handlePresetVisualize}
            />
          )}
          
          <div style={{ color: themeConfig.colors.textSecondary, fontSize: '14px', marginBottom: '10px' }}>
            Status: <strong>{status}</strong>
          </div>

          {/* 3. Visuals */}
          {/* Show standard Recharts for basic chart types */}
          {chartConfig && !chartConfig.type?.startsWith('d3-') && !chartConfig.type?.startsWith('3d-') && (
            <ErrorBoundary fallback={<div style={{ padding: '20px', background: themeConfig.colors.error + '20', borderRadius: '8px', color: themeConfig.colors.error }}>Error rendering chart. Please check your axis selections.</div>}>
          <DynamicChart data={rows} config={chartConfig} />
            </ErrorBoundary>
          )}
          {/* Show enhanced visualizations for D3.js and 3D charts */}
          {chartConfig && (chartConfig.type?.startsWith('d3-') || chartConfig.type?.startsWith('3d-')) && (
            <ErrorBoundary fallback={<div style={{ padding: '20px', background: themeConfig.colors.error + '20', borderRadius: '8px', color: themeConfig.colors.error }}>Error rendering visualization. Please check your axis selections.</div>}>
              <EnhancedVisualizations data={rows} config={chartConfig} />
            </ErrorBoundary>
          )}

          {/* 4. Data Grid */}
          {/* Table Tabs */}
          <TableTabs 
            tables={tables}
            activeTableId={activeTableId}
            onTableSelect={handleTableSelect}
            onTableClose={handleTableClose}
          />
          
          <div style={{ overflowX: 'auto', marginTop: '20px', border: `1px solid ${themeConfig.colors.border}`, borderRadius: '8px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead style={{ background: themeConfig.colors.surface }}>
                <tr>
                  {rows.length > 0 && Object.keys(rows[0]).map(key => (
                    <th key={key} style={{ padding: '10px', textAlign: 'left', borderBottom: `2px solid ${themeConfig.colors.border}`, color: themeConfig.colors.text }}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${themeConfig.colors.borderLight}`, background: i % 2 === 0 ? themeConfig.colors.background : themeConfig.colors.surface }}>
                    {Object.values(row).map((val: any, j) => (
                      <td key={j} style={{ padding: '8px', color: themeConfig.colors.text }}>{val?.toString()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
            </div>
          }
        />
      </div>
    </div>
  );
}

export default App;