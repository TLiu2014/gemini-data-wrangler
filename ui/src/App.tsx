import { useState, useEffect, Component, useRef } from 'react';
import type { ReactNode } from 'react';
import { CheckCircle2, Info, AlertCircle, Loader2, Table2, Settings as SettingsIcon, Database } from 'lucide-react';
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
import { ConfirmDialog } from './ConfirmDialog';
import { ErrorMessage } from './ErrorMessage';
import { EmptyState } from './EmptyState';
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
    // Load from localStorage, default to false
    const saved = localStorage.getItem('show_visualization_presets');
    return saved !== null ? saved === 'true' : false;
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
  // Clear flow confirmation dialog state
  const [showClearFlowDialog, setShowClearFlowDialog] = useState(false);
  // Toast notification state
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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
        
        // Generate table name from filename - remove extension first, then sanitize
        const fileNameWithoutExt = fileInfo.name.replace(/\.[^.]*$/, '');
        const tableName = `table_${fileNameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_')}`;
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
            // Account for the LOAD stages that were just added (2 load stages: stage 1 and 2)
            // The sample stage should be stage 3 (1-based indexing for display)
            const stageIndex = loadedTables.length + sampleStages.indexOf(sampleStage) + 1;
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

        // Generate table name from filename - remove extension first, then sanitize
        const fileNameWithoutExt = file.name.replace(/\.[^.]*$/, '');
        const tableName = `table_${fileNameWithoutExt.replace(/[^a-zA-Z0-9]/g, '_')}`;
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
    setShowClearFlowDialog(true);
  };

  const confirmClearFlow = () => {
    setTransformationStages([]);
    setEditingStageId(null);
    setNewStage(null);
    setStageToTableMap(new Map());
    setChatPrompt('');
    setStatus('Flow cleared. Ready for new transformations.');
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
      setTables([]); // Clear existing tables when replacing flow
      setActiveTableId(null); // Clear active table selection
    }

    // Create tables in DuckDB and add to app state
    const newTables: TableData[] = [];
    const tableNameMap = new Map<string, string>(); // Map original name to final name
    
    // Helper function to clean table names - remove _csv suffix and other file extensions
    const cleanTableName = (name: string): string => {
      // Remove common file extension suffixes like _csv, _xlsx, etc.
      return name.replace(/_csv$/, '').replace(/_xlsx$/, '').replace(/_xls$/, '').replace(/_txt$/, '');
    };
    
    // Helper function to clean descriptions - remove _csv suffixes from table names in descriptions
    const cleanDescription = (description: string): string => {
      if (!description) return description;
      // Replace table names with _csv suffix in descriptions
      // Pattern: 'table_name_csv' or "table_name_csv" or table_name_csv
      return description
        .replace(/(['"]?)(table_\w+)_csv\1/g, '$1$2$1') // Remove _csv from quoted table_ prefixed names
        .replace(/(['"]?)(\w+)_csv\1/g, '$1$2$1') // Remove _csv from quoted or unquoted table names
        .replace(/(table_\w+)_csv/g, '$1') // Remove _csv from table_ prefixed names (unquoted)
        .replace(/\b(\w+)_csv\b/g, '$1'); // Remove _csv from any word ending with _csv
    };
    
    // Filter out result tables that Gemini incorrectly includes in the tables array
    const actualSourceTables = tablesFromGemini.filter(t => !t.name.startsWith('result_stage_'));
    console.log(`Filtered tables: ${tablesFromGemini.length} -> ${actualSourceTables.length} (removed ${tablesFromGemini.length - actualSourceTables.length} result tables)`);
    
    for (const tableData of actualSourceTables) {
      const tableId = `table_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Clean the table name from Gemini (remove _csv suffix if present)
      const cleanedName = cleanTableName(tableData.name);
      
      // Ensure table name is unique - if not clearing existing, check for conflicts
      let finalTableName = cleanedName;
      if (!shouldClearExisting) {
        // Check if table name already exists in DuckDB or in new tables
        const existingTableNames = new Set(tables.map(t => t.name));
        const newTableNames = new Set(newTables.map(t => t.name));
        let counter = 1;
        while (existingTableNames.has(finalTableName) || newTableNames.has(finalTableName)) {
          finalTableName = `${tableData.name}_${counter}`;
          counter++;
        }
      }
      
      // Store mapping from original to final name (use cleaned name for mapping)
      if (finalTableName !== cleanedName) {
        tableNameMap.set(cleanedName, finalTableName);
      }
      // Also map from original name if it was different
      if (cleanedName !== tableData.name) {
        tableNameMap.set(tableData.name, finalTableName);
      }
      
      // Create table in DuckDB
      const columnsDef = tableData.columns.map((col: any) => 
        `${col.name} ${col.type || 'VARCHAR'}`
      ).join(', ');
      
      await conn.query(`CREATE OR REPLACE TABLE ${finalTableName} (${columnsDef})`);
      
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
          await conn.query(`INSERT INTO ${finalTableName} (${columns}) VALUES (${values})`);
        }
      }

      // Get all rows for display
      const result = await conn.query(`SELECT * FROM ${finalTableName}`);
      const rows = result.toArray().map(r => r.toJSON());
      const schemaRes = await conn.query(`DESCRIBE ${finalTableName}`);
      const schema = schemaRes.toArray().map(r => r.toJSON());

      const newTable: TableData = {
        id: tableId,
        name: finalTableName,
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
      // Filter out LOAD stages for result tables (Gemini sometimes includes them incorrectly)
      const validStages = stagesFromGemini.filter(stage => {
        if (stage.type === 'LOAD' && stage.data?.tableName?.startsWith('result_stage_')) {
          console.log(`⚠️ Filtered out invalid LOAD stage for result table: ${stage.data.tableName}`);
          return false;
        }
        return true;
      });
      console.log(`Filtered stages: ${stagesFromGemini.length} -> ${validStages.length} (removed ${stagesFromGemini.length - validStages.length} invalid LOAD stages)`);
      
      // Convert Gemini stages to TransformationStage format
      // Update table references in stage data to use final table names
      const newStages: TransformationStage[] = validStages.map((stage: any, index: number) => {
        const stageData = { ...stage.data };
        
        // Helper to clean and resolve table name
        const resolveTableReference = (tableName: string): string => {
          if (!tableName) return tableName;
          // Check if exact name is in map
          if (tableNameMap.has(tableName)) {
            return tableNameMap.get(tableName)!;
          }
          // Try cleaned version (without _csv suffix)
          const cleaned = cleanTableName(tableName);
          if (cleaned !== tableName) {
            if (tableNameMap.has(cleaned)) {
              return tableNameMap.get(cleaned)!;
            }
            // Check if cleaned name matches any existing table
            const matchingTable = newTables.find(t => t.name === cleaned);
            if (matchingTable) {
              return matchingTable.name;
            }
          }
          // Return cleaned name as fallback
          return cleaned;
        };
        
        // Update table references if tables were renamed or have suffixes
        // Update table references in stage data
        if (stageData.table) {
          stageData.table = resolveTableReference(stageData.table);
        }
        if (stageData.tableName) {
          stageData.tableName = resolveTableReference(stageData.tableName);
        }
        if (stageData.leftTable) {
          stageData.leftTable = resolveTableReference(stageData.leftTable);
        }
        if (stageData.rightTable) {
          stageData.rightTable = resolveTableReference(stageData.rightTable);
        }
        if (stageData.tables && Array.isArray(stageData.tables)) {
          stageData.tables = stageData.tables.map((t: string) => resolveTableReference(t));
        }
        
        // Use stage ID from Gemini (should be sequential now that we've instructed Gemini properly)
        // Only generate a fallback ID if Gemini didn't provide one
        const stageId = stage.id || `stage_${index + 1}`;
        if (!stage.id) {
          console.warn(`Stage ${index} (${stage.type}: ${stage.description}) missing ID from Gemini, generated: ${stageId}`);
        }
        
        return {
          id: stageId,
          type: stage.type,
          description: cleanDescription(stage.description || ''),
          timestamp: new Date(),
          data: {
            ...stageData,
            ...(horizontalOffset > 0 && { flowGroupId: `flow_${Date.now()}`, horizontalOffset })
          }
        };
      });

      // Add stages to app state
      if (shouldClearExisting) {
        setTransformationStages(newStages);
      } else {
        setTransformationStages(prev => [...prev, ...newStages]);
      }

      // Execute all stages to generate result tables
      setStatus('Executing transformation stages...');
      
      // Track result tables from previous stages for proper table references
      const stageResultTableMap = new Map<string, string>(); // stageId -> tableName
      const newStageToTableIdMap = new Map<string, string>(); // stageId -> tableId (for UI state)
      let previousResultTableName: string | null = null;
      
      // First, map LOAD stages to their corresponding loaded tables
      let lastLoadTableName: string | null = null;
      for (let i = 0; i < newStages.length; i++) {
        const stage = newStages[i];
        if (stage.type === 'LOAD' && stage.data?.tableName) {
          // Find the table that was loaded for this LOAD stage
          const tableName = stage.data.tableName;
          const loadTable = newTables.find(t => t.name === tableName) || 
                          tables.find(t => t.name === tableName);
          if (loadTable) {
            newStageToTableIdMap.set(stage.id, loadTable.id);
            stageResultTableMap.set(stage.id, loadTable.name);
            lastLoadTableName = loadTable.name; // Track the last LOAD stage's table
          }
        }
      }
      
      // Set previousResultTableName to the last LOAD stage's table if available
      if (lastLoadTableName) {
        previousResultTableName = lastLoadTableName;
      }
      
      // Execute non-LOAD stages in order
      const existingStagesCount = shouldClearExisting ? 0 : transformationStages.length;
      let executedStageIndex = 0;
      let lastExecutedTableId: string | null = null; // Track the result table ID of the last successfully executed stage
      
      console.log('\n=== Starting stage execution ===');
      console.log(`Total stages: ${newStages.length}`);
      console.log(`LOAD stages: ${newStages.filter(s => s.type === 'LOAD').length}`);
      console.log(`Non-LOAD stages to execute: ${newStages.filter(s => s.type !== 'LOAD').length}`);
      console.log(`Existing tables: ${tables.map(t => t.name).join(', ')}`);
      console.log(`New tables: ${newTables.map(t => t.name).join(', ')}`);
      console.log(`LOAD stage mappings: ${Array.from(newStageToTableIdMap.entries()).map(([sid, tid]) => `${sid}->${tid}`).join(', ')}`);
      
      // Collect all result tables to add them in a batch
      const resultTablesToAdd: TableData[] = [];
      
      for (let i = 0; i < newStages.length; i++) {
        const stage = newStages[i];
        // Skip LOAD stages during execution (tables are already loaded)
        if (stage.type === 'LOAD') {
          console.log(`Skipping LOAD stage ${i}: ${stage.id} (${stage.description})`);
          continue;
        }
        
        console.log(`\n--- Executing stage ${executedStageIndex}: ${stage.id} (${stage.type}) ---`);
        console.log(`Description: ${stage.description}`);
        console.log(`Stage data:`, JSON.stringify(stage.data, null, 2));
        
        // Fallback logic to fix incomplete stage data from Gemini
        if (stage.type === 'JOIN' && stage.data) {
          // If value is provided but leftKey/rightKey are missing, use value for both
          // BUT reject invalid values like "none", "null", empty string
          const invalidValues = ['none', 'null', '', 'undefined', 'n/a'];
          if (stage.data.value && 
              !invalidValues.includes(String(stage.data.value).toLowerCase()) &&
              (!stage.data.leftKey || !stage.data.rightKey)) {
            console.log(`⚠️ JOIN stage missing leftKey/rightKey, using value: ${stage.data.value}`);
            stage.data.leftKey = stage.data.value as string;
            stage.data.rightKey = stage.data.value as string;
          }
          
          // If leftKey or rightKey are still missing, try to infer from description
          if (!stage.data.leftKey || !stage.data.rightKey) {
            console.log(`⚠️ JOIN stage missing leftKey/rightKey, attempting to infer from description...`);
            const desc = stage.description.toLowerCase();
            
            // Common join key patterns in descriptions
            let inferredKey: string | null = null;
            
            if (desc.includes('customer_id') || desc.includes('customer id')) {
              inferredKey = 'customer_id';
            } else if (desc.includes('order_id') || desc.includes('order id')) {
              inferredKey = 'order_id';
            } else if (desc.includes('product_id') || desc.includes('product id')) {
              inferredKey = 'product_id';
            } else if (desc.includes('user_id') || desc.includes('user id')) {
              inferredKey = 'user_id';
            } else if (desc.includes('id')) {
              // Generic ID mention - try to extract the specific column
              const idMatch = desc.match(/(\w+)_?id/);
              if (idMatch) {
                inferredKey = idMatch[0].replace(/\s/g, '_');
              } else {
                inferredKey = 'id'; // Fallback to just 'id'
              }
            }
            
            if (inferredKey) {
              console.log(`  Inferred join key: ${inferredKey}`);
              if (!stage.data.leftKey) stage.data.leftKey = inferredKey;
              if (!stage.data.rightKey) stage.data.rightKey = inferredKey;
            } else {
              // Absolute fallback - use 'id'
              console.log(`  Using fallback join key: id`);
              if (!stage.data.leftKey) stage.data.leftKey = 'id';
              if (!stage.data.rightKey) stage.data.rightKey = 'id';
            }
          }
          
          // Ensure joinType is set
          if (!stage.data.joinType) {
            stage.data.joinType = 'INNER';
          }
        }
        
        if (stage.type === 'FILTER' && stage.data) {
          // If value is provided but column/operator are missing, try to infer from description
          if (stage.data.value && !stage.data.column) {
            console.log(`⚠️ FILTER stage missing column/operator, attempting to infer...`);
            // Try to extract column and operator from description
            const desc = stage.description.toLowerCase();
            const value = String(stage.data.value);
            
            // Check if value is numeric
            const isNumeric = !isNaN(Number(value)) && value.trim() !== '';
            
            // Common patterns: "filter by X", "where X >", "X > value", "high value orders", "active status"
            if (isNumeric) {
              // Numeric value - likely filtering on amount, price, count, etc.
              if (desc.includes('amount') || desc.includes('value') || desc.includes('price')) {
                stage.data.column = 'amount';
                stage.data.operator = '>';
                console.log(`  Inferred (numeric): column=amount, operator=>, value=${stage.data.value}`);
              } else if (desc.includes('date')) {
                stage.data.column = 'date';
                stage.data.operator = '>';
                console.log(`  Inferred (numeric): column=date, operator=>, value=${stage.data.value}`);
              } else {
                // Default fallback for numeric
                stage.data.column = 'amount';
                stage.data.operator = '>';
                console.log(`  Using default (numeric): column=amount, operator=>, value=${stage.data.value}`);
              }
            } else {
              // String value - likely filtering on status, category, name, etc.
              if (desc.includes('status') || desc.includes('active') || desc.includes('inactive')) {
                stage.data.column = 'status';
                stage.data.operator = '=';
                console.log(`  Inferred (string): column=status, operator==, value=${stage.data.value}`);
              } else if (desc.includes('category') || desc.includes('type')) {
                stage.data.column = 'category';
                stage.data.operator = '=';
                console.log(`  Inferred (string): column=category, operator==, value=${stage.data.value}`);
              } else if (desc.includes('name')) {
                stage.data.column = 'name';
                stage.data.operator = 'LIKE';
                console.log(`  Inferred (string): column=name, operator=LIKE, value=${stage.data.value}`);
              } else {
                // Default fallback for string - use equality check on status
                stage.data.column = 'status';
                stage.data.operator = '=';
                console.log(`  Using default (string): column=status, operator==, value=${stage.data.value}`);
              }
            }
          } else if (!stage.data.value && !stage.data.column && !stage.data.conditions) {
            // No filter criteria at all - infer from description
            console.log(`⚠️ FILTER stage has no filter criteria, inferring from description...`);
            const desc = stage.description.toLowerCase();
            
            // Try to infer meaningful filters based on description
            if (desc.includes('high') && (desc.includes('amount') || desc.includes('value') || desc.includes('order'))) {
              // "high value orders", "high amount", etc.
              stage.data.column = 'amount';
              stage.data.operator = '>';
              stage.data.value = '100';
              console.log(`  Inferred: Filter high amounts -> amount > 100`);
            } else if (desc.includes('low') && (desc.includes('amount') || desc.includes('value') || desc.includes('order'))) {
              stage.data.column = 'amount';
              stage.data.operator = '<';
              stage.data.value = '100';
              console.log(`  Inferred: Filter low amounts -> amount < 100`);
            } else if (desc.includes('active') || desc.includes('status')) {
              // "active records", "filter by status", etc.
              stage.data.column = 'status';
              stage.data.operator = '=';
              stage.data.value = 'active';
              console.log(`  Inferred: Filter active status -> status = 'active'`);
            } else if (desc.includes('recent') && desc.includes('date')) {
              stage.data.column = 'order_date';
              stage.data.operator = '>';
              stage.data.value = '2023-01-01';
              console.log(`  Inferred: Filter recent dates -> order_date > '2023-01-01'`);
            } else if (desc.includes('large') || desc.includes('big')) {
              stage.data.column = 'amount';
              stage.data.operator = '>';
              stage.data.value = '500';
              console.log(`  Inferred: Filter large amounts -> amount > 500`);
            } else {
              // Generic fallback - filter for positive amounts (most common use case)
              stage.data.column = 'amount';
              stage.data.operator = '>';
              stage.data.value = '0';
              console.log(`  Using generic fallback: amount > 0 (filter positive amounts)`);
            }
          }
        }

        try {
          // Helper function to clean table names - remove _csv suffix and other file extensions
          const cleanTableNameLocal = (name: string): string => {
            return name.replace(/_csv$/, '').replace(/_xlsx$/, '').replace(/_xls$/, '').replace(/_txt$/, '');
          };

          // Helper function to resolve table name - check if it's a result table from a previous stage
          const resolveTableName = async (tableName: string): Promise<string> => {
            // First, try to clean the table name (remove _csv suffix)
            const cleanedTableName = cleanTableNameLocal(tableName);
            
            // Check if this is mapped in tableNameMap
            if (tableNameMap.has(tableName)) {
              return tableNameMap.get(tableName)!;
            }
            if (cleanedTableName !== tableName && tableNameMap.has(cleanedTableName)) {
              return tableNameMap.get(cleanedTableName)!;
            }
            
            // Check if this table name matches a previous stage's result table
            for (const [_stageId, resultTableName] of stageResultTableMap.entries()) {
              if (resultTableName === tableName || resultTableName === cleanedTableName) {
                return resultTableName;
              }
            }
            
            // Check if it's a loaded table (try both original and cleaned name)
            let loadedTable = newTables.find(t => t.name === tableName) || tables.find(t => t.name === tableName);
            if (!loadedTable && cleanedTableName !== tableName) {
              loadedTable = newTables.find(t => t.name === cleanedTableName) || tables.find(t => t.name === cleanedTableName);
            }
            if (loadedTable) {
              return loadedTable.name;
            }
            
            // Check if table actually exists in database (try cleaned name first, then original)
            try {
              await conn.query(`SELECT 1 FROM ${cleanedTableName} LIMIT 1`);
              return cleanedTableName; // Table exists
            } catch (e) {
              // Try original name
              try {
                await conn.query(`SELECT 1 FROM ${tableName} LIMIT 1`);
                return tableName; // Table exists
              } catch (e2) {
                // Table doesn't exist - fallback to previousResultTableName if available
                console.log(`⚠️ Table ${tableName} (cleaned: ${cleanedTableName}) not found in database, using previous result: ${previousResultTableName}`);
                return previousResultTableName || cleanedTableName;
              }
            }
          };
          
          // Determine the input table for this stage
          let inputTableName = '';
          
          // For JOIN stages, they specify their own tables
          if (stage.type === 'JOIN') {
            if (stage.data?.leftTable && stage.data?.rightTable) {
              // Resolve both table names
              const resolvedLeft = await resolveTableName(stage.data.leftTable);
              const resolvedRight = await resolveTableName(stage.data.rightTable);
              // Update stage data with resolved table names
              if (!stage.data) stage.data = {};
              stage.data.leftTable = resolvedLeft;
              stage.data.rightTable = resolvedRight;
              inputTableName = resolvedLeft; // Just for SQL generation, actual tables are in stage.data
            } else {
              // Fallback if tables not specified
              inputTableName = previousResultTableName || (newTables.length > 0 ? newTables[0].name : (tables.length > 0 ? tables[0].name : ''));
            }
          } else if (stage.type === 'UNION') {
            // UNION stages specify their own tables
            if (stage.data?.tables && stage.data.tables.length > 0) {
              // Resolve all table names
              if (!stage.data) stage.data = {};
              const stageTables = stage.data.tables;
              if (stageTables) {
                stage.data.tables = await Promise.all(stageTables.map((t: string) => resolveTableName(t)));
                inputTableName = stage.data.tables[0]; // Just for SQL generation
              }
            } else {
              inputTableName = previousResultTableName || (newTables.length > 0 ? newTables[0].name : (tables.length > 0 ? tables[0].name : ''));
            }
          } else if (stage.data?.table) {
            // Stage explicitly specifies its input table - resolve it
            inputTableName = await resolveTableName(stage.data.table);
            if (!stage.data) stage.data = {};
            stage.data.table = inputTableName; // Update stage data with resolved name
          } else if (previousResultTableName) {
            // Use the previous stage's result table
            inputTableName = previousResultTableName;
            // Update stage data to reference the previous result table
            if (!stage.data) stage.data = {};
            stage.data.table = previousResultTableName;
          } else {
            // Fallback to first available table
            inputTableName = newTables.length > 0 ? newTables[0].name : (tables.length > 0 ? tables[0].name : '');
            if (!stage.data) stage.data = {};
            stage.data.table = inputTableName;
          }
          
          if (!inputTableName) {
            console.error('❌ Could not determine input table for stage!');
            throw new Error('Could not determine input table for stage.');
          }
          
          console.log(`Input table determined: ${inputTableName}`);
          console.log(`Previous result table: ${previousResultTableName}`);
          console.log(`Stage data before SQL generation:`, JSON.stringify(stage.data, null, 2));
          
          // For FILTER stages, validate that the column exists in the table
          if (stage.type === 'FILTER' && stage.data?.column) {
            try {
              // Query the table schema to get available columns
              const schemaRes = await conn.query(`DESCRIBE ${inputTableName}`);
              const tableSchema = schemaRes.toArray().map(r => r.toJSON());
              const availableColumns = tableSchema.map((col: any) => 
                (col.column_name || col.name || '').toLowerCase()
              );
              
              console.log(`  Available columns in ${inputTableName}:`, availableColumns.join(', '));
              
              const targetColumn = (stage.data.column as string).toLowerCase();
              
              // Check if the target column exists
              if (!availableColumns.includes(targetColumn)) {
                console.log(`  ⚠️ Column '${stage.data.column}' not found in table!`);
                
                // Try to find a suitable alternative column
                let alternativeColumn: string | null = null;
                const value = stage.data.value ? String(stage.data.value) : '';
                const isNumeric = !isNaN(Number(value)) && value.trim() !== '';
                
                if (isNumeric) {
                  // For numeric values, prefer numeric columns like amount, price, quantity, etc.
                  alternativeColumn = availableColumns.find(col => 
                    col.includes('amount') || col.includes('price') || col.includes('quantity') || 
                    col.includes('total') || col.includes('cost')
                  ) || null;
                } else {
                  // For string values, prefer string columns like status, name, category, etc.
                  alternativeColumn = availableColumns.find(col => 
                    col.includes('status') || col.includes('name') || col.includes('category') || 
                    col.includes('type') || col.includes('description')
                  ) || null;
                }
                
                if (alternativeColumn) {
                  console.log(`  Using alternative column: ${alternativeColumn}`);
                  stage.data.column = alternativeColumn;
                  
                  // Adjust operator if needed
                  if (isNumeric) {
                    stage.data.operator = '>';
                  } else {
                    // For string columns, use LIKE for more flexible matching
                    stage.data.operator = 'LIKE';
                    // Add wildcards for LIKE if not already present
                    if (!value.includes('%')) {
                      stage.data.value = `%${value}%`;
                    }
                  }
                } else {
                  console.log(`  No suitable alternative column found. Using first available column: ${availableColumns[0]}`);
                  // Fallback to first available column with generic filter
                  stage.data.column = availableColumns[0];
                  stage.data.operator = '>';
                  stage.data.value = '0';
                }
              }
            } catch (err) {
              console.warn(`  Could not validate column, proceeding anyway:`, err);
            }
          }
          
          // Generate SQL from the stage
          const sql = generateSQLFromStage(stage, inputTableName);
          console.log(`Generated SQL: ${sql}`);
          
          // Extract stage number from stage ID (e.g., "stage_3" -> 3)
          // This ensures result table name matches the stage ID
          const stageIdMatch = stage.id.match(/stage_(\d+)/);
          const stageNumber = stageIdMatch ? parseInt(stageIdMatch[1]) : (existingStagesCount + i);
          
          const stageTypeLower = stage.type.toLowerCase();
          const resultTableName = `result_stage_${stageNumber}_${stageTypeLower}`;
          await conn.query(`CREATE OR REPLACE TABLE ${resultTableName} AS ${sql}`);
          
          const result = await conn.query(`SELECT * FROM ${resultTableName} LIMIT 1000`);
          const resultRows = result.toArray().map(r => r.toJSON());
          const schemaRes = await conn.query(`DESCRIBE ${resultTableName}`);
          const resultSchema = schemaRes.toArray().map(r => r.toJSON());
          
          // Generate unique table ID with stage ID and index to ensure uniqueness
          const resultTableId = `table_${stage.id}_${executedStageIndex}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          const resultTable: TableData = {
            id: resultTableId,
            name: resultTableName,
            fileName: `Result of ${stage.description}`,
            schema: resultSchema,
            rows: resultRows,
            createdAt: new Date()
          };
          
          // Collect result table to add in batch later
          resultTablesToAdd.push(resultTable);
          newStageToTableIdMap.set(stage.id, resultTableId);
          
          console.log(`✅ Stage executed successfully!`);
          console.log(`  Result table: ${resultTableName} (ID: ${resultTableId})`);
          console.log(`  Rows: ${resultRows.length}`);
          console.log(`  Mapping added: ${stage.id} -> ${resultTableId}`);
          
          // Track this stage's result table for future stages to reference
          stageResultTableMap.set(stage.id, resultTableName);
          previousResultTableName = resultTableName;
          lastExecutedTableId = resultTableId; // Track this as the last executed stage's result table
          
        } catch (err) {
          console.error(`❌ Error executing stage ${stage.id}:`, err);
          console.error(`  Stage type: ${stage.type}`);
          console.error(`  Stage description: ${stage.description}`);
          console.error(`  Error details:`, err instanceof Error ? err.message : err);
          setError(`Warning: Failed to execute stage "${stage.description}": ${err instanceof Error ? err.message : 'Unknown error'}`);
          // Continue to next stage even if this one failed
        }
      }
      
      console.log('\n=== Stage execution complete ===');
      console.log(`Total result tables created: ${resultTablesToAdd.length}`);
      console.log(`Result table IDs: ${resultTablesToAdd.map(t => `${t.name}(${t.id})`).join(', ')}`);
      
      // Add all result tables in a single batch update
      if (resultTablesToAdd.length > 0) {
        setTables(prev => [...prev, ...resultTablesToAdd]);
      }
      
      // Set the last executed stage's result table as active
      if (lastExecutedTableId) {
        setActiveTableId(lastExecutedTableId);
      }

      // Update the stageToTableMap with all the new mappings
      console.log('\n=== Updating stageToTableMap ===');
      console.log(`Previous map size: ${stageToTableMap.size}`);
      console.log(`New mappings to add: ${newStageToTableIdMap.size}`);
      newStageToTableIdMap.forEach((tableId, stageId) => {
        console.log(`  ${stageId} -> ${tableId}`);
      });
      
      setStageToTableMap(prev => {
        const updatedMap = new Map(prev);
        newStageToTableIdMap.forEach((tableId, stageId) => {
          updatedMap.set(stageId, tableId);
        });
        console.log(`Updated map size: ${updatedMap.size}`);
        return updatedMap;
      });

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

      // Send existing flow context if there are tables or stages
      const hasExistingFlow = tables.length > 0 || transformationStages.length > 0;
      if (hasExistingFlow) {
        // Mark which tables are result tables from stages
        const resultTableIds = new Set(Array.from(stageToTableMap.values()));
        
        // Find the latest result table to mark it for high-priority connection
        // Get the last stage that has a result table
        let latestResultTableId: string | null = null;
        for (let i = transformationStages.length - 1; i >= 0; i--) {
          const stage = transformationStages[i];
          if (stageToTableMap.has(stage.id)) {
            latestResultTableId = stageToTableMap.get(stage.id)!;
            break;
          }
        }

        // Build stage-to-table mapping for context
        const stageToTableInfo: Array<{ stageId: string; stageType: string; stageDescription: string; resultTableName: string }> = [];
        transformationStages.forEach((stage) => {
          const resultTableId = stageToTableMap.get(stage.id);
          if (resultTableId) {
            const resultTable = tables.find(t => t.id === resultTableId);
            if (resultTable) {
              stageToTableInfo.push({
                stageId: stage.id,
                stageType: stage.type,
                stageDescription: stage.description,
                resultTableName: resultTable.name
              });
            }
          }
        });

        const context = {
          existingTables: tables.map(t => {
            const isResultTable = resultTableIds.has(t.id);
            const isLatestResultTable = t.id === latestResultTableId;
            return {
              name: t.name,
              columns: t.schema.map((col: any) => ({ 
                name: col.name || col.column_name, 
                type: col.type || col.column_type || col.data_type 
              })),
              isResultTable,
              isLatestResultTable,
            };
          }),
          existingStages: transformationStages.map((s, index) => ({
            id: s.id,
            index,
            type: s.type,
            description: s.description,
            resultTableName: stageToTableMap.has(s.id) 
              ? tables.find(t => t.id === stageToTableMap.get(s.id))?.name 
              : null
          })),
          stageToTableInfo, // Additional mapping for clarity
          latestStageIndex: transformationStages.length > 0 ? transformationStages.length - 1 : null,
        };

        formData.append('context', JSON.stringify(context));
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

      console.log('\n=== Gemini Response ===');
      console.log('Image type:', imageType);
      console.log('Tables returned:', tablesFromGemini?.length || 0);
      console.log('Stages returned:', stagesFromGemini?.length || 0);
      if (stagesFromGemini && stagesFromGemini.length > 0) {
        console.log('Stage details from Gemini:');
        stagesFromGemini.forEach((stage: any, idx: number) => {
          console.log(`  Stage ${idx + 1}: ${stage.type} - ${stage.description}`);
          console.log(`    ID: ${stage.id}`);
          console.log(`    Data:`, JSON.stringify(stage.data, null, 2));
        });
      }
      console.log('======================\n');

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

        // For stage_flow images, allow LOAD stages (they represent initial table loads in the flow)
        // For data_table images, filter out LOAD stages (tables are loaded automatically)
        const filteredStages = stagesFromGemini && Array.isArray(stagesFromGemini) 
          ? (imageType === 'stage_flow' 
              ? stagesFromGemini // Keep all stages including LOAD for flow images
              : stagesFromGemini.filter((stage: any) => stage.type !== 'LOAD')) // Filter LOAD for data_table
          : [];

        // For stage_flow, process based on action or default behavior
        if (imageType === 'stage_flow') {
          // Process stage_flow regardless of whether stages exist (they might all be filtered out)
          if (action === 'replace') {
            // Replace current flow
            await processFlowData(tablesFromGemini, filteredStages, true, 0);
            setStatus('Flow replaced successfully.');
          } else if (action === 'add') {
            // Add side-by-side
            const horizontalOffset = transformationStages.length > 0 ? 400 : 0;
            await processFlowData(tablesFromGemini, filteredStages, false, horizontalOffset);
            setStatus('Flow added successfully.');
          } else {
            // No action specified - process directly (no existing stages)
            await processFlowData(tablesFromGemini, filteredStages, false, 0);
            setStatus('Flow loaded successfully.');
          }
        } else if (imageType === 'data_table') {
          // Check if there's existing flow - if so, always try to integrate
          const hasExistingFlow = tables.length > 0 || transformationStages.length > 0;
          
          if (hasExistingFlow) {
            // Table with existing flow context - NEVER replace, always append
            if (filteredStages.length > 0) {
              // Gemini found connections and generated integration stages
              // Always append to existing flow (never replace)
              await processFlowData(tablesFromGemini, filteredStages, false, 0);
              setStatus('✅ Table integrated into flow! Gemini found connections and created integration stages.');
            } else {
              // Has existing flow but no integration stages generated
              // This means Gemini couldn't find connections
              // Just add the new table(s) without any stages - don't replace anything
              await processFlowData(tablesFromGemini, [], false, 0);
              
              // Provide detailed feedback about what went wrong
              const newTableColumns = tablesFromGemini[0]?.columns?.map((c: any) => c.name).join(', ') || 'unknown';
              const existingTableColumns = tables.length > 0 
                ? tables[0].schema.map((c: any) => c.name || c.column_name).join(', ') 
                : 'none';
              
              setStatus('⚠️ Table loaded, but Gemini found no connections with existing flow.');
              setError(
                `Could not find automatic connections. Here's what we have:\n\n` +
                `New table columns: ${newTableColumns}\n` +
                `Existing table columns: ${existingTableColumns}\n\n` +
                `Tip: Check if column names match (case-insensitive). Common join keys include: ` +
                `customer_id, order_id, product_id, email, etc. You may need to manually create JOIN stages.`
              );
            }
          } else {
            // No existing flow - just load the table
            await processFlowData(tablesFromGemini, [], false, 0);
            setStatus('Table loaded successfully. This is the first table in your flow.');
          }
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
          hasDefaultApiKey={hasDefaultApiKey}
          showVisualizationPresets={showVisualizationPresets}
          onToggleVisualizationPresets={(value) => {
            setShowVisualizationPresets(value);
            localStorage.setItem('show_visualization_presets', String(value));
          }}
          flowUploadAction={(() => {
            const saved = localStorage.getItem('flow_upload_preference');
            if (!saved) return 'replace';
            const pref = JSON.parse(saved);
            return pref.action === 'add' ? 'add' : 'replace';
          })()}
          onFlowUploadActionChange={(action) => {
            localStorage.setItem('flow_upload_preference', JSON.stringify({ action }));
          }}
          askBeforeLoad={(() => {
            const saved = localStorage.getItem('flow_upload_ask_before');
            return saved === null ? true : saved === 'true';
          })()}
          onAskBeforeLoadChange={(value) => {
            localStorage.setItem('flow_upload_ask_before', String(value));
          }}
        />

      {/* Main Content Layout */}
      <div style={{ 
        width: '100%',
        padding: '12px', 
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
              minHeight: '400px',
              maxHeight: 'calc(100vh - 100px)',
              overflowY: 'auto',
              paddingRight: '12px'
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
            <div style={{ 
              flex: 1, 
              minWidth: 0, 
              overflowY: 'auto', 
              paddingLeft: '12px',
              maxHeight: 'calc(100vh - 100px)'
            }}>
          {/* Error Message */}
          {error && (
            <ErrorMessage message={error} onClose={() => setError(null)} />
          )}

          {/* Status Display with Tables and Stages as sub-fields */}
          <div style={{
            padding: '12px 16px',
            background: themeConfig.colors.surfaceElevated,
            borderRadius: '8px',
            border: `1px solid ${themeConfig.colors.border}`,
            boxShadow: themeConfig.shadows.sm,
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            flexWrap: 'wrap'
          }}>
            {/* Status - More prominent */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexShrink: 0,
              flex: '1 1 auto',
              minWidth: '200px'
            }}>
              {status.toLowerCase().includes('error') || status.toLowerCase().includes('fail') ? (
                <AlertCircle size={16} style={{ color: themeConfig.colors.error, flexShrink: 0 }} />
              ) : status.toLowerCase().includes('process') || status.toLowerCase().includes('analyzing') || status.toLowerCase().includes('thinking') || status.toLowerCase().includes('loading') || status.toLowerCase().includes('initializing') ? (
                <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: themeConfig.colors.primary, flexShrink: 0 }} />
              ) : status.toLowerCase().includes('success') || status.toLowerCase().includes('ready') || status.toLowerCase().includes('complete') ? (
                <CheckCircle2 size={16} style={{ color: themeConfig.colors.success, flexShrink: 0 }} />
              ) : (
                <Info size={16} style={{ color: themeConfig.colors.primary, flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: themeConfig.colors.textSecondary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  marginBottom: '2px',
                  lineHeight: '1.4'
                }}>
                  Status
                </div>
                <div style={{
                  fontSize: '14px',
                  fontWeight: '500',
                  color: themeConfig.colors.text,
                  lineHeight: '1.5'
                }}>
                  {status}
                </div>
              </div>
            </div>
      
            {/* Tables - Badge style */}
            {tables.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingLeft: '16px',
                borderLeft: `1px solid ${themeConfig.colors.border}`,
                flexShrink: 0
              }}>
                <Table2 size={16} style={{ color: themeConfig.colors.primary, flexShrink: 0 }} />
                <div>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: themeConfig.colors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '2px',
                    lineHeight: '1.4'
                  }}>
                    Tables
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    color: themeConfig.colors.text,
                    lineHeight: '1.5'
                  }}>
                    {tables.length} {tables.length === 1 ? 'Table' : 'Tables'}
                  </div>
                </div>
              </div>
            )}
            
            {/* Stages - Badge style */}
            {transformationStages.length > 0 && (
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                paddingLeft: '16px',
                borderLeft: `1px solid ${themeConfig.colors.border}`,
                flexShrink: 0
              }}>
                <SettingsIcon size={16} style={{ color: themeConfig.colors.primary, flexShrink: 0 }} />
                <div>
                  <div style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: themeConfig.colors.textSecondary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '2px',
                    lineHeight: '1.4'
                  }}>
                    Stages
                  </div>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: '500',
                    color: themeConfig.colors.text,
                    lineHeight: '1.5'
                  }}>
                    {transformationStages.length} {transformationStages.length === 1 ? 'Stage' : 'Stages'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* File Upload Section - Consolidated */}
          <div style={{ marginBottom: '16px' }}>
            <div {...getRootProps()} style={{ 
              border: `1px dashed ${themeConfig.colors.border}`, 
              padding: '24px', 
              textAlign: 'center', 
              cursor: 'pointer', 
              borderRadius: '8px', 
              position: 'relative', 
              zIndex: 1,
              background: tables.length > 0 ? themeConfig.colors.surface : themeConfig.colors.surfaceElevated,
              transition: 'all 0.2s',
              borderColor: themeConfig.colors.border,
              outline: 'none'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.primary;
              e.currentTarget.style.background = themeConfig.colors.surface;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.border;
              e.currentTarget.style.background = tables.length > 0 ? themeConfig.colors.surface : themeConfig.colors.surfaceElevated;
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.primary;
              e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
              e.currentTarget.style.outlineOffset = '2px';
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = themeConfig.colors.border;
              e.currentTarget.style.outline = 'none';
            }}
            tabIndex={0}
            >
          <input {...getInputProps()} />
              <p style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: themeConfig.colors.text, lineHeight: '1.5' }}>
                {tables.length > 0 ? 'Upload More CSV Files' : 'Drag & drop your CSV file(s) here to begin'}
              </p>
              <p style={{ fontSize: '12px', color: themeConfig.colors.textSecondary, marginTop: '8px', marginBottom: 0, lineHeight: '1.5' }}>
                {tables.length > 0 
                  ? 'Add additional tables for joins, unions, or other operations' 
                  : 'You can upload multiple CSV files. Each will be loaded as a separate table.'}
              </p>
              {tables.length > 0 && (
                <p style={{ fontSize: '11px', color: themeConfig.colors.textTertiary, marginTop: '4px', marginBottom: 0, lineHeight: '1.4' }}>
                  Currently loaded: {tables.length} table(s)
                </p>
              )}
            </div>
          </div>

          {/* Homepage Content - Only show when no tables */}
          {tables.length === 0 && (
            <div style={{ marginTop: '16px' }}>
              {/* Chat Field on Homepage */}
              <div style={{ marginBottom: '24px' }}>
                <SmartTransform 
                  schema={mockSchema} 
                  onTransform={handleTransform} 
                  isProcessing={isProcessing}
                  externalPrompt={chatPrompt}
                  onPromptChange={setChatPrompt}
                  onImageUpload={handleImageUpload}
                  explanation={imageExplanation}
                  status={status}
                  hasExistingFlow={tables.length > 0 || transformationStages.length > 0}
                />
              </div>

              <h2 style={{ fontSize: '18px', marginBottom: '12px', color: themeConfig.colors.text, fontWeight: '600', lineHeight: '1.5' }}>Try Visualization Presets (Sample Data)</h2>
              <p style={{ fontSize: '14px', color: themeConfig.colors.textSecondary, marginBottom: '16px', lineHeight: '1.5' }}>
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
                <div style={{ color: themeConfig.colors.textSecondary, fontSize: '14px', marginTop: '16px', marginBottom: '8px', lineHeight: '1.5' }}>
                  Status: <strong>Showing sample data visualization</strong>
                </div>
                {/* Show standard Recharts for basic chart types */}
                {chartConfig && !chartConfig.type?.startsWith('d3-') && !chartConfig.type?.startsWith('3d-') && (
                  <ErrorBoundary fallback={<ErrorMessage message="Error rendering chart. Please check your axis selections." />}>
                    <DynamicChart data={mockData} config={chartConfig} />
                  </ErrorBoundary>
                )}
                {/* Show enhanced visualizations for D3.js and 3D charts */}
                {chartConfig && (chartConfig.type?.startsWith('d3-') || chartConfig.type?.startsWith('3d-')) && (
                  <ErrorBoundary fallback={<ErrorMessage message="Error rendering visualization. Please check your axis selections." />}>
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
            hasExistingFlow={tables.length > 0 || transformationStages.length > 0}
          />
          
          {/* Visualization Presets */}
          {showVisualizationPresets && (
            <VisualizationPresets 
              schema={schema}
              data={rows}
              onVisualize={handlePresetVisualize}
            />
          )}

          {/* 3. Visuals */}
          {/* Show standard Recharts for basic chart types */}
          {chartConfig && !chartConfig.type?.startsWith('d3-') && !chartConfig.type?.startsWith('3d-') && (
            <ErrorBoundary fallback={<ErrorMessage message="Error rendering chart. Please check your axis selections." />}>
          <DynamicChart data={rows} config={chartConfig} />
            </ErrorBoundary>
          )}
 {/* Show enhanced visualizations for D3.js and 3D charts */}
          {chartConfig && (chartConfig.type?.startsWith('d3-') || chartConfig.type?.startsWith('3d-')) && (
            <ErrorBoundary fallback={<ErrorMessage message="Error rendering visualization. Please check your axis selections." />}>
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
          
          {rows.length === 0 ? (
            <EmptyState
              icon={<Database size={48} style={{ color: themeConfig.colors.textSecondary }} />}
              title="No data to display"
              description="Upload a CSV file or create a transformation to see data here."
            />
          ) : (
            <div style={{ 
              overflowX: 'auto', 
              marginTop: '16px', 
              border: `1px solid ${themeConfig.colors.border}`, 
              borderRadius: '8px', 
              overflow: 'hidden',
              background: themeConfig.colors.surfaceElevated,
              maxHeight: '600px',
              display: 'flex',
              flexDirection: 'column'
            }}>
              <div style={{ 
                overflowY: 'auto',
                flex: 1
              }}>
                <table style={{ 
                  width: '100%', 
                  borderCollapse: 'collapse', 
                  fontSize: '14px',
                  tableLayout: 'auto'
                }}>
                  <thead style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 10,
                    background: themeConfig.colors.surface
                  }}>
                <tr>
                  {rows.length > 0 && Object.keys(rows[0]).map(key => (
                        <th key={key} style={{ 
                          padding: '12px 16px', 
                          textAlign: 'left', 
                          borderBottom: `1px solid ${themeConfig.colors.border}`, 
                          color: themeConfig.colors.text,
                          fontWeight: '600',
                          fontSize: '12px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          background: themeConfig.colors.surface,
                          whiteSpace: 'nowrap'
                        }}>
                          {key}
                        </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                      <tr 
                        key={i} 
                        style={{ 
                          borderBottom: `1px solid ${themeConfig.colors.borderLight}`, 
                          background: i % 2 === 0 ? themeConfig.colors.background : themeConfig.colors.surface,
                          transition: 'background 0.15s'
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = themeConfig.colors.surfaceElevated;
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = i % 2 === 0 ? themeConfig.colors.background : themeConfig.colors.surface;
                        }}
                      >
                        {Object.keys(rows[0]).map((key, j) => (
                          <td key={j} style={{ 
                            padding: '12px 16px', 
                            color: themeConfig.colors.text,
                            lineHeight: '1.5',
                            whiteSpace: 'nowrap'
                          }}>
                            {row[key]?.toString()}
                          </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </div>
          )}
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

      {/* Clear Flow Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showClearFlowDialog}
        onClose={() => setShowClearFlowDialog(false)}
        onConfirm={confirmClearFlow}
        title="Clear Flow"
        message="Are you sure you want to clear all transformation stages? This will remove all stages from the flow."
        confirmText="Clear Flow"
        cancelText="Cancel"
        confirmButtonStyle={{ background: '#ef4444' }}
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
                  borderRadius: '8px',
                  cursor: 'pointer',
                  color: themeConfig.colors.text,
                  fontSize: '14px',
                  fontWeight: '500',
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
              >
                Cancel
              </button>
              {exportPreview.type === 'json' && (
                <button
                  onClick={async () => {
                    if (exportPreview.data) {
                      try {
                        await navigator.clipboard.writeText(exportPreview.data);
                        // Show toast notification
                        setToastMessage('JSON copied to clipboard!');
                        setTimeout(() => {
                          setToastMessage(null);
                        }, 3000);
                      } catch (err) {
                        console.error('Failed to copy:', err);
                        setToastMessage('Failed to copy JSON');
                        setTimeout(() => {
                          setToastMessage(null);
                        }, 3000);
                      }
                    }
                  }}
                  style={{
                    padding: '10px 20px',
                    background: themeConfig.colors.primary,
                    border: 'none',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: 'white',
                    fontSize: '14px',
                    fontWeight: '500',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    transition: 'background 0.2s',
                    outline: 'none'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.primaryDark;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = themeConfig.colors.primary;
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                    e.currentTarget.style.outlineOffset = '2px';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.outline = 'none';
                  }}
                  tabIndex={0}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copy
                </button>
              )}
              <button
                onClick={exportPreview.type === 'json' ? downloadJSON : downloadImage}
                style={{
                  padding: '10px 20px',
                  background: themeConfig.colors.primary,
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'background 0.2s',
                  outline: 'none'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.primaryDark;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = themeConfig.colors.primary;
                }}
                onFocus={(e) => {
                  e.currentTarget.style.outline = `2px solid ${themeConfig.colors.primary}`;
                  e.currentTarget.style.outlineOffset = '2px';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.outline = 'none';
                }}
                tabIndex={0}
              >
                Download
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toastMessage && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          background: themeConfig.colors.surfaceElevated,
          color: themeConfig.colors.text,
          padding: '12px 20px',
          borderRadius: '8px',
          boxShadow: themeConfig.shadows.lg,
          border: `1px solid ${themeConfig.colors.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 10001,
          animation: 'slideInUp 0.3s ease-out',
          maxWidth: '400px'
        }}>
          <CheckCircle2 size={20} style={{ color: themeConfig.colors.success, flexShrink: 0 }} />
          <span style={{ fontSize: '14px', fontWeight: '500', lineHeight: '1.5' }}>
            {toastMessage}
          </span>
        </div>
      )}
    </div>
  );
}

export default App;