import { useState, useEffect, Component, useRef } from 'react';
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
import { FlowUploadModal } from './FlowUploadModal';
import sampleStagesData from './sampleStages.json';
import html2canvas from 'html2canvas';

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
    // Load from sessionStorage if available (more secure - cleared on tab close)
    return sessionStorage.getItem('gemini_api_key');
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
  // Export preview state
  const [exportPreview, setExportPreview] = useState<{ type: 'json' | 'image'; data: string | null } | null>(null);
  // Explanation from Gemini for image analysis
  const [imageExplanation, setImageExplanation] = useState<string>('');
  // Flow upload modal state
  const [showFlowUploadModal, setShowFlowUploadModal] = useState(false);
  const [pendingImageFile, setPendingImageFile] = useState<File | null>(null);

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
    
    const loadedTables: { name: string; id: string }[] = [];
    
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
        
        // Track loaded table
        loadedTables.push({ name: tableName, id: tableId });
        
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
    
    // After tables are loaded, load and execute sample stages from JSON
    if (loadedTables.length === 2) {
      // Find customers and orders tables
      const customersTable = loadedTables.find(t => t.name.includes('customers'));
      const ordersTable = loadedTables.find(t => t.name.includes('orders'));
      
      if (customersTable && ordersTable) {
        // Load sample stages from JSON and execute them
        const sampleStages: TransformationStage[] = sampleStagesData.map(stageData => ({
          ...stageData,
          id: `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          data: {
            ...stageData.data,
            leftTable: stageData.data.leftTable === 'orders' ? ordersTable.name : stageData.data.leftTable,
            rightTable: stageData.data.rightTable === 'customers' ? customersTable.name : stageData.data.rightTable
          }
        })) as TransformationStage[];
        
        // Execute each sample stage to create result tables
        for (const sampleStage of sampleStages) {
          try {
            // Generate SQL from the stage
            const sql = generateSQLFromStage(sampleStage, ordersTable.name);
            
            // Get stage index for table naming
            // Account for the LOAD stages that were just added (2 load stages + current sample stage index)
            const stageIndex = loadedTables.length + sampleStages.indexOf(sampleStage);
            const stageTypeLower = sampleStage.type.toLowerCase();
            const resultTableName = `result_stage_${stageIndex}_${stageTypeLower}`;
            
            // Execute the transformation and create result table
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
              fileName: `Result of stage #${stageIndex}: ${sampleStage.description}`,
              schema: resultSchema,
              rows: resultRows,
              createdAt: new Date()
            };
            
            setTables(prev => [...prev, newTable]);
            // Store mapping from stage ID to table ID
            setStageToTableMap(prev => {
              const newMap = new Map(prev);
              newMap.set(sampleStage.id, resultTableId);
              return newMap;
            });
            setActiveTableId(resultTableId);
          } catch (err) {
            console.warn(`Error executing sample stage:`, err);
          }
        }
        
        // Add sample stages to transformation stages
        setTransformationStages(prev => [...prev, ...sampleStages]);
        setStatus('Sample data loaded with sample stages. Ready for transformations.');
      } else {
        setStatus('Sample data loaded. Ready for transformations.');
      }
    } else {
      setStatus('Sample data loaded. Ready for transformations.');
    }
  };

  useEffect(() => {
    initDB().then(async (database) => {
      setDb(database);
      const connection = await database.connect();
      setConn(connection);
      setStatus('Loading sample data...');
    });

    // Security check: Warn if not using HTTPS in production
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      console.warn('⚠️ SECURITY WARNING: API keys should only be transmitted over HTTPS in production!');
      setError('Security Warning: Not using HTTPS. API keys may be exposed. Use HTTPS in production.');
    }

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
    sessionStorage.setItem('gemini_api_key', key);
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
      // Determine the input table for this stage
      // Priority: 1) stage.data.table, 2) previous stage's result table, 3) activeTable, 4) first table
      let defaultTableName = '';
      
      // For stages that specify a table in their data, use that
      if (stage.data?.table) {
        defaultTableName = stage.data.table;
      } else {
        // For stages in a pipeline, try to find the previous stage's result table
        const stageIndex = transformationStages.findIndex(s => s.id === stage.id);
        if (stageIndex > 0) {
          // Find the previous stage's result table
          const previousStage = transformationStages[stageIndex - 1];
          const previousTableId = stageToTableMap.get(previousStage.id);
          if (previousTableId) {
            const previousTable = tables.find(t => t.id === previousTableId);
            if (previousTable) {
              defaultTableName = previousTable.name;
            }
          }
        }
        
        // Fallback to activeTable or first table
        if (!defaultTableName) {
          defaultTableName = activeTable?.name || (tables.length > 0 ? tables[0].name : '');
        }
      }

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

      // Check if this stage already has a result table
      const existingTableId = stageToTableMap.get(stage.id);
      
      if (existingTableId) {
        // Update existing table
        setTables(prev => prev.map(t => 
          t.id === existingTableId 
            ? {
                ...t,
                name: resultTableName,
                fileName: `Result of stage #${displayIndex}: ${stage.description}`,
                schema: resultSchema,
                rows: resultRows
              }
            : t
        ));
        setActiveTableId(existingTableId);
      } else {
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
      }
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

  const handleClearFlow = () => {
    if (window.confirm('Are you sure you want to clear all transformation stages? This will remove all stages from the flow.')) {
      setTransformationStages([]);
      setEditingStageId(null);
      setNewStage(null);
      setStageToTableMap(new Map());
      setChatPrompt('');
      setStatus('Flow cleared. Ready for new transformations.');
    }
  };

  // Helper function to process flow data (tables and stages)
  const processFlowData = async (
    tablesFromGemini: any[],
    stagesFromGemini: any[],
    shouldClearExisting: boolean = false,
    horizontalOffset: number = 0
  ) => {
    if (!db || !conn) return;

    setStatus('Creating tables...');

    // Clear existing flow if needed
    if (shouldClearExisting) {
      setTransformationStages([]);
      setEditingStageId(null);
      setNewStage(null);
      setStageToTableMap(new Map());
      setChatPrompt('');
    }

    // Create tables in DuckDB and add to app state
    const newTables: TableData[] = [];
    for (const tableData of tablesFromGemini) {
      const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Create table in DuckDB
      const columnsDef = tableData.columns.map((col: any) => 
        `${col.name} ${col.type || 'VARCHAR'}`
      ).join(', ');
      
      await conn.query(`CREATE OR REPLACE TABLE ${tableData.name} (${columnsDef})`);
      
      // Insert sample data
      if (tableData.rows && tableData.rows.length > 0) {
        const columns = tableData.columns.map((col: any) => col.name).join(', ');
        for (const row of tableData.rows) {
          const values = tableData.columns.map((col: any, colIndex: number) => {
            let value;
            if (Array.isArray(row)) {
              value = row[colIndex];
            } else {
              value = row[col.name];
            }
            if (value === null || value === undefined) return 'NULL';
            if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
            return String(value);
          }).join(', ');
          await conn.query(`INSERT INTO ${tableData.name} (${columns}) VALUES (${values})`);
        }
      }

      // Get all rows for display
      const result = await conn.query(`SELECT * FROM ${tableData.name}`);
      const rows = result.toArray().map(r => r.toJSON());
      const schemaRes = await conn.query(`DESCRIBE ${tableData.name}`);
      const schema = schemaRes.toArray().map(r => r.toJSON());

      const newTable: TableData = {
        id: tableId,
        name: tableData.name,
        fileName: `Generated from flow diagram`,
        schema,
        rows,
        createdAt: new Date()
      };

      newTables.push(newTable);
    }

    // Add tables to app state
    if (shouldClearExisting) {
      setTables(newTables);
    } else {
      setTables(prev => [...prev, ...newTables]);
    }
    if (newTables.length > 0) {
      setActiveTableId(newTables[newTables.length - 1].id);
    }

    // Process transformation stages
    if (stagesFromGemini && Array.isArray(stagesFromGemini) && stagesFromGemini.length > 0) {
      // Convert Gemini stages to TransformationStage format
      const newStages: TransformationStage[] = stagesFromGemini.map((stage: any) => ({
        id: stage.id || `stage_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: stage.type,
        description: stage.description,
        timestamp: new Date(),
        data: {
          ...stage.data,
          ...(horizontalOffset > 0 && { flowGroupId: `flow_${Date.now()}`, horizontalOffset })
        }
      }));

      // Add stages to app state
      if (shouldClearExisting) {
        setTransformationStages(newStages);
      } else {
        setTransformationStages(prev => [...prev, ...newStages]);
      }

      // Execute all stages to generate result tables
      setStatus('Executing transformation stages...');
      
      const existingStagesCount = shouldClearExisting ? 0 : transformationStages.length;
      for (let i = 0; i < newStages.length; i++) {
        const stage = newStages[i];
        if (stage.type === 'LOAD') continue;

        try {
          const stageIndex = existingStagesCount + i;
          const defaultTableName = newTables.length > 0 ? newTables[0].name : (tables.length > 0 ? tables[0].name : '');
          const sql = generateSQLFromStage(stage, defaultTableName);
          
          const stageTypeLower = stage.type.toLowerCase();
          const resultTableName = `result_stage_${stageIndex}_${stageTypeLower}`;
          await conn.query(`CREATE OR REPLACE TABLE ${resultTableName} AS ${sql}`);
          
          const result = await conn.query(`SELECT * FROM ${resultTableName} LIMIT 1000`);
          const resultRows = result.toArray().map(r => r.toJSON());
          const schemaRes = await conn.query(`DESCRIBE ${resultTableName}`);
          const resultSchema = schemaRes.toArray().map(r => r.toJSON());
          
          const resultTableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const resultTable: TableData = {
            id: resultTableId,
            name: resultTableName,
            fileName: `Result of ${stage.description}`,
            schema: resultSchema,
            rows: resultRows,
            createdAt: new Date()
          };
          
          setTables(prev => [...prev, resultTable]);
          setStageToTableMap(prev => {
            const newMap = new Map(prev);
            newMap.set(stage.id, resultTableId);
            return newMap;
          });
          
          if (i === newStages.length - 1) {
            setActiveTableId(resultTableId);
          }
        } catch (err) {
          console.warn(`Error executing stage ${stage.id}:`, err);
          setError(`Warning: Failed to execute stage "${stage.description}": ${err instanceof Error ? err.message : 'Unknown error'}`);
        }
      }

      setStatus(`Flow diagram analyzed! Created ${newTables.length} table(s) and ${newStages.length} stage(s).`);
    } else {
      setStatus(`Table analyzed! Created ${newTables.length} table(s).`);
    }
  };

  // Handle replace flow (clear canvas then load)
  const handleReplaceFlow = async () => {
    if (!pendingImageFile) return;
    
    setShowFlowUploadModal(false);
    const imageFile = pendingImageFile;
    setPendingImageFile(null);
    
    await processImageWithGemini(imageFile, 'replace');
  };

  // Handle add flow side-by-side
  const handleAddFlowSideBySide = async () => {
    if (!pendingImageFile) return;
    
    setShowFlowUploadModal(false);
    const imageFile = pendingImageFile;
    setPendingImageFile(null);
    
    await processImageWithGemini(imageFile, 'add');
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
      data: {
        operator: '=' // Initialize with default operator for FILTER type
      }
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

  // Process image with Gemini and handle response
  const processImageWithGemini = async (imageFile: File, action: 'replace' | 'add' | null = null) => {
    if (!db || !conn) return;

    setIsProcessing(true);
    setStatus('Analyzing image with Gemini...');
    setError(null);
    setImageExplanation('');

    try {
      // Create FormData to send image
      const formData = new FormData();
      formData.append('image', imageFile);
      if (apiKey) {
        formData.append('apiKey', apiKey);
      }

      // Send to server for analysis
      const response = await fetch('/api/analyze-flow-image', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        // Try to parse error as JSON, fallback to text
        let errorMessage = 'Failed to analyze image';
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorData.details || errorMessage;
        } catch (e) {
          const errorText = await response.text();
          if (errorText.includes('<!DOCTYPE')) {
            errorMessage = `Server error: The server may not be running or the endpoint is not available. Please check if the server is running on port 3000.`;
          } else {
            errorMessage = errorText || errorMessage;
          }
        }
        throw new Error(errorMessage);
      }

      // Parse response as JSON
      let responseData;
      try {
        const responseText = await response.text();
        responseData = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Invalid response from server: ${e instanceof Error ? e.message : 'Unknown error'}`);
      }

      const { imageType, explanation, tables: tablesFromGemini, transformationStages: stagesFromGemini } = responseData;

      // Always set the explanation
      setImageExplanation(explanation || 'No explanation provided.');

      // Handle different image types
      if (imageType === 'unrecognized') {
        setStatus('Image analyzed - not a stage flow, data table, or schema.');
        setError(null);
        return;
      }

      // For stage_flow and data_table, process tables
      if (imageType === 'stage_flow' || imageType === 'data_table') {
        if (!tablesFromGemini || !Array.isArray(tablesFromGemini) || tablesFromGemini.length === 0) {
          throw new Error('No tables found in the image');
        }

        // For stage_flow, process based on action or default behavior
        if (imageType === 'stage_flow' && stagesFromGemini && Array.isArray(stagesFromGemini) && stagesFromGemini.length > 0) {
          if (action === 'replace') {
            // Replace current flow
            await processFlowData(tablesFromGemini, stagesFromGemini, true, 0);
            setStatus('Flow replaced successfully.');
          } else if (action === 'add') {
            // Add side-by-side
            const horizontalOffset = transformationStages.length > 0 ? 400 : 0;
            await processFlowData(tablesFromGemini, stagesFromGemini, false, horizontalOffset);
            setStatus('Flow added successfully.');
          } else {
            // No action specified - process directly (no existing stages)
            await processFlowData(tablesFromGemini, stagesFromGemini, false, 0);
            setStatus('Flow loaded successfully.');
          }
        } else if (imageType === 'data_table') {
          // Process data table directly
          await processFlowData(tablesFromGemini, [], false, 0);
          setStatus('Table loaded successfully.');
        } else if (imageType === 'stage_flow') {
          // Process stage flow directly (no stages from Gemini)
          await processFlowData(tablesFromGemini, [], false, 0);
          setStatus('Flow loaded successfully.');
        }
      } else if (imageType === 'schema') {
        setStatus('Schema image analyzed - see explanation below.');
      }

      setError(null);
    } catch (err) {
      console.error('Error analyzing image:', err);
      setError(`Failed to analyze image: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setStatus('Error analyzing image');
      setImageExplanation(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle image upload - check settings and show modal if needed
  const handleImageUpload = async (imageFile: File) => {
    if (!db || !conn) return;

    // Check if "ask before load" is enabled and there are existing stages
    const askBeforeLoad = localStorage.getItem('flow_upload_ask_before') === 'true';
    const hasExistingStages = transformationStages.length > 0;

    // If "ask before load" is checked and there are existing stages, show modal first
    if (askBeforeLoad && hasExistingStages) {
      setPendingImageFile(imageFile);
      setShowFlowUploadModal(true);
      setStatus('Image selected. Please choose how to handle the flow.');
      return;
    }

    // If "ask before load" is unchecked, check for saved preference
    if (!askBeforeLoad && hasExistingStages) {
      const savedPreference = localStorage.getItem('flow_upload_preference');
      if (savedPreference) {
        const preference = JSON.parse(savedPreference);
        // Auto-execute based on preference
        await processImageWithGemini(imageFile, preference.action);
        return;
      }
    }

    // No existing stages or no preference - process directly
    await processImageWithGemini(imageFile, null);
  };

  // Export stage flow to JSON
  const exportStagesToJSON = () => {
    // Convert TransformationStage[] to sampleStages.json format (without timestamp)
    // Use readable IDs matching the displayed stage numbers
    const exportData = transformationStages.map((stage, index) => ({
      id: `stage_${index + 1}`,
      type: stage.type,
      description: stage.description,
      data: stage.data || {}
    }));
    
    const jsonString = JSON.stringify(exportData, null, 2);
    // Show preview
    setExportPreview({ type: 'json', data: jsonString });
  };
  
  // Download JSON after preview
  const downloadJSON = () => {
    if (!exportPreview || exportPreview.type !== 'json' || !exportPreview.data) return;
    
    const blob = new Blob([exportPreview.data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `stage-flow-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    setExportPreview(null);
  };

  // Export stage flow to image
  const stageFlowRef = useRef<{ getReactFlowInstance: () => any } | null>(null);
  
  const exportStagesToImage = async () => {
    if (!stageFlowRef.current) {
      setError('Stage flow not ready');
      return;
    }
    
    try {
      const reactFlowInstance = stageFlowRef.current.getReactFlowInstance();
      if (!reactFlowInstance) {
        setError('ReactFlow instance not available');
        return;
      }
      
      // Save current viewport to restore later
      const currentViewport = reactFlowInstance.getViewport();
      
      // Get all nodes to calculate bounds
      const nodes = reactFlowInstance.getNodes();
      if (nodes.length === 0) {
        setError('No nodes to export');
        return;
      }
      
      // Calculate the bounding box of all nodes
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      nodes.forEach((node: any) => {
        const nodeWidth = 280; // Fixed node width from StageGraphFlow
        const nodeHeight = 120; // Approximate node height
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + nodeWidth);
        maxY = Math.max(maxY, node.position.y + nodeHeight);
      });
      
      // Add padding
      const padding = 50;
      minX -= padding;
      minY -= padding;
      maxX += padding;
      maxY += padding;
      
      const width = maxX - minX;
      const height = maxY - minY;
      
      // Get the ReactFlow container
      const reactFlowElement = document.querySelector('.react-flow') as HTMLElement;
      if (!reactFlowElement) {
        setError('Could not find flow canvas');
        reactFlowInstance.setViewport(currentViewport, { duration: 0 });
        return;
      }
      
      const containerRect = reactFlowElement.getBoundingClientRect();
      
      // Calculate zoom to fit content in viewport
      const zoomX = containerRect.width / width;
      const zoomY = containerRect.height / height;
      const zoom = Math.min(zoomX, zoomY, 1); // Don't zoom in beyond 1x
      
      // Calculate position to center content
      const x = -(minX * zoom) + (containerRect.width - width * zoom) / 2;
      const y = -(minY * zoom) + (containerRect.height - height * zoom) / 2;
      
      // Set viewport to center nodes
      reactFlowInstance.setViewport({ x, y, zoom }, { duration: 0 });
      
      // Wait for viewport to update
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Get the viewport element (the actual canvas)
      const viewportElement = document.querySelector('.react-flow__viewport') as HTMLElement;
      if (!viewportElement) {
        setError('Could not find flow viewport');
        reactFlowInstance.setViewport(currentViewport, { duration: 0 });
        return;
      }
      
      // Use html2canvas to capture the ReactFlow container
      const canvas = await html2canvas(reactFlowElement, {
        backgroundColor: themeConfig.colors.surface,
        useCORS: true,
        scale: 2, // Higher quality
        logging: false,
      });
      
      // Convert canvas to data URL for preview
      const dataUrl = canvas.toDataURL('image/png');
      setExportPreview({ type: 'image', data: dataUrl });
      setError(null); // Clear any previous errors
      
      // Restore original viewport
      setTimeout(() => {
        reactFlowInstance.setViewport(currentViewport, { duration: 300 });
      }, 100);
    } catch (err) {
      console.error('Error exporting image:', err);
      setError(`Failed to export image: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };
  
  // Download image after preview
  const downloadImage = () => {
    if (!exportPreview || exportPreview.type !== 'image' || !exportPreview.data) return;
    
    const link = document.createElement('a');
    link.href = exportPreview.data;
    link.download = `stage-flow-${new Date().toISOString().split('T')[0]}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setExportPreview(null);
  };

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
                ref={stageFlowRef}
                stages={transformationStages}
                tables={tables.map(t => ({ id: t.id, name: t.name, schema: t.schema }))}
                onStageEdit={handleStageEdit}
                onStageStartEdit={handleStageStartEdit}
                onStageDelete={handleStageDelete}
                onStageAdd={handleStageAdd}
                editingStageId={editingStageId}
                newStage={newStage}
                stageToTableMap={stageToTableMap}
                onShowTable={(tableId) => setActiveTableId(tableId)}
                onExportJSON={exportStagesToJSON}
                onExportImage={exportStagesToImage}
                onClearFlow={handleClearFlow}
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
                  onImageUpload={handleImageUpload}
                  explanation={imageExplanation}
                  status={status}
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
            onImageUpload={handleImageUpload}
            explanation={imageExplanation}
            status={status}
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
      
      {/* Flow Upload Modal */}
      <FlowUploadModal
        isOpen={showFlowUploadModal}
        onClose={() => {
          setShowFlowUploadModal(false);
          setPendingImageFile(null);
        }}
        onReplace={handleReplaceFlow}
        onAddSideBySide={handleAddFlowSideBySide}
        existingStagesCount={transformationStages.length}
      />

      {/* Export Preview Modal */}
      {exportPreview && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          padding: '20px'
        }}
        onClick={() => setExportPreview(null)}
        >
          <div style={{
            background: themeConfig.colors.surfaceElevated,
            borderRadius: '12px',
            padding: '24px',
            maxWidth: '90vw',
            maxHeight: '90vh',
            overflow: 'auto',
            border: `1px solid ${themeConfig.colors.border}`,
            boxShadow: themeConfig.shadows.xl
          }}
          onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{
                margin: 0,
                fontSize: '18px',
                color: themeConfig.colors.text
              }}>
                {exportPreview.type === 'json' ? 'JSON Export Preview' : 'Image Export Preview'}
              </h3>
              <button
                onClick={() => setExportPreview(null)}
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
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            
            {exportPreview.type === 'json' ? (
              <div style={{
                background: themeConfig.colors.background,
                borderRadius: '8px',
                padding: '16px',
                marginBottom: '16px',
                maxHeight: '60vh',
                overflow: 'auto',
                fontFamily: 'monospace',
                fontSize: '13px',
                color: themeConfig.colors.text,
                border: `1px solid ${themeConfig.colors.border}`
              }}>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {exportPreview.data}
                </pre>
              </div>
            ) : (
              <div style={{
                marginBottom: '16px',
                textAlign: 'center'
              }}>
                <img
                  src={exportPreview.data || ''}
                  alt="Stage flow preview"
                  style={{
                    maxWidth: '100%',
                    maxHeight: '60vh',
                    borderRadius: '8px',
                    border: `1px solid ${themeConfig.colors.border}`
                  }}
                />
              </div>
            )}
            
            <div style={{
              display: 'flex',
              gap: '12px',
              justifyContent: 'flex-end'
            }}>
              <button
                onClick={() => setExportPreview(null)}
                style={{
                  padding: '10px 20px',
                  background: themeConfig.colors.surface,
                  border: `1px solid ${themeConfig.colors.border}`,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: themeConfig.colors.text,
                  fontSize: '14px'
                }}
              >
                Cancel
              </button>
              <button
                onClick={exportPreview.type === 'json' ? downloadJSON : downloadImage}
                style={{
                  padding: '10px 20px',
                  background: themeConfig.colors.primary,
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;