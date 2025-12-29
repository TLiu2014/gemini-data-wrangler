import { useState, useEffect } from 'react';
import { initDB } from './db';
import { SmartTransform } from './SmartTransform';
import { DynamicChart } from './DynamicChart';
import { EnhancedVisualizations } from './EnhancedVisualizations';
import { ApiKeyInput } from './ApiKeyInput';
import { useDropzone } from 'react-dropzone';
import * as duckdb from '@duckdb/duckdb-wasm';

function App() {
  const [db, setDb] = useState<duckdb.AsyncDuckDB | null>(null);
  const [conn, setConn] = useState<duckdb.AsyncDuckDBConnection | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [schema, setSchema] = useState<any[]>([]); // Current columns
  const [chartConfig, setChartConfig] = useState<any>(null); // From Gemini
  const [status, setStatus] = useState('Initializing Engine...');
  const [isProcessing, setIsProcessing] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(() => {
    // Load from localStorage if available
    return localStorage.getItem('gemini_api_key');
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initDB().then(async (database) => {
      setDb(database);
      const connection = await database.connect();
      setConn(connection);
      setStatus('Ready for data.');
    });
  }, []);

  const handleApiKeySet = (key: string) => {
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    setError(null); // Clear any previous errors
  };

  const onDrop = async (acceptedFiles: File[]) => {
    if (!db || !conn) return;
    const file = acceptedFiles[0];
    setStatus(`Loading ${file.name}...`);
    setError(null);

    try {
      // Use a fixed internal filename to avoid issues with special characters
      const internalFileName = 'uploaded_data.csv';
      
      // Register the file handle with DuckDB
      // This allows DuckDB to read the file directly from the browser File object
      await db.registerFileHandle(internalFileName, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, true);
      
      // Create table from CSV using read_csv_auto
      await conn.query(`
        CREATE OR REPLACE TABLE data_source AS 
        SELECT * FROM read_csv_auto('${internalFileName}', header=true, auto_detect=true)
      `);

      // Get Schema (Columns) for Gemini
      const schemaRes = await conn.query(`DESCRIBE data_source`);
      setSchema(schemaRes.toArray().map(r => r.toJSON()));

      // Show initial data
      const result = await conn.query(`SELECT * FROM data_source LIMIT 10`);
      setRows(result.toArray().map(r => r.toJSON()));
      setStatus('Data loaded.');
      setError(null);
    } catch (error) {
      console.error('Error loading CSV:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load CSV';
      setStatus(`Error: ${errorMessage}`);
      setError(`Failed to load CSV: ${errorMessage}`);
    }
  };

  const handleTransform = async (userPrompt: string) => {
    if (!conn) return;
    
    if (!apiKey) {
      setError('API key is required. Please set your Gemini API key in the top right corner.');
      setStatus('Error: API key not set.');
      return;
    }

    setIsProcessing(true);
    setStatus('Gemini is thinking...');
    setError(null);

    try {
      // 1. Ask Gemini for the SQL
      const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema, userPrompt, apiKey })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to transform data');
      }
      
      const { sql, chartType, xAxis, yAxis, zAxis, explanation } = await response.json();
      
      // 2. Execute Gemini's SQL
      setStatus(`Executing: ${explanation}`);
      const result = await conn.query(sql);
      const resultRows = result.toArray().map(r => r.toJSON());

      // 3. Update UI
      setRows(resultRows);
      setChartConfig({ type: chartType, xAxis, yAxis, zAxis });
      setStatus(`Done! showed ${resultRows.length} rows.`);
      setError(null);

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'Error transforming data.';
      setError(errorMessage);
      setStatus(`Error: ${errorMessage}`);
      // Don't clear rows - stay on table view as requested
    } finally {
      setIsProcessing(false);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', fontFamily: 'Inter, sans-serif', position: 'relative' }}>
      {/* Header with API Key Input */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', position: 'relative' }}>
        <h1 style={{ margin: 0 }}>Gemini 3 Data Agent</h1>
        <ApiKeyInput onApiKeySet={handleApiKeySet} currentApiKey={apiKey} />
      </div>
      
      {/* Error Message */}
      {error && (
        <div style={{
          padding: '12px',
          background: '#fee2e2',
          border: '1px solid #fecaca',
          borderRadius: '4px',
          color: '#991b1b',
          marginBottom: '20px'
        }}>
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {/* 1. Upload Section */}
      {!rows.length && (
        <div {...getRootProps()} style={{ border: '2px dashed #ccc', padding: '40px', textAlign: 'center', cursor: 'pointer', borderRadius: '8px', position: 'relative', zIndex: 1 }}>
          <input {...getInputProps()} />
          <p>Drag & drop your CSV here to begin</p>
        </div>
      )}

      {/* 2. Transformation Section */}
      {rows.length > 0 && (
        <>
          <SmartTransform 
            schema={schema} 
            onTransform={handleTransform} 
            isProcessing={isProcessing} 
          />
          
          <div style={{ color: '#666', fontSize: '14px', marginBottom: '10px' }}>
            Status: <strong>{status}</strong>
          </div>

          {/* 3. Visuals */}
          {/* Show standard Recharts for basic chart types */}
          {chartConfig && !chartConfig.type?.startsWith('d3-') && !chartConfig.type?.startsWith('3d-') && (
            <DynamicChart data={rows} config={chartConfig} />
          )}
          {/* Show enhanced visualizations for D3.js and 3D charts */}
          {chartConfig && (chartConfig.type?.startsWith('d3-') || chartConfig.type?.startsWith('3d-')) && (
            <EnhancedVisualizations data={rows} config={chartConfig} />
          )}

          {/* 4. Data Grid */}
          <div style={{ overflowX: 'auto', marginTop: '20px', border: '1px solid #eee' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead style={{ background: '#f8f9fa' }}>
                <tr>
                  {rows.length > 0 && Object.keys(rows[0]).map(key => (
                    <th key={key} style={{ padding: '10px', textAlign: 'left', borderBottom: '2px solid #ddd' }}>{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                    {Object.values(row).map((val: any, j) => (
                      <td key={j} style={{ padding: '8px' }}>{val?.toString()}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export default App;