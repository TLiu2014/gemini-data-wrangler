import { useState, useEffect } from 'react';
import { initDB } from './db';
import { SmartTransform } from './SmartTransform';
import { DynamicChart } from './DynamicChart';
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

  useEffect(() => {
    initDB().then(async (database) => {
      setDb(database);
      const connection = await database.connect();
      setConn(connection);
      setStatus('Ready for data.');
    });
  }, []);

  const onDrop = async (acceptedFiles: File[]) => {
    if (!db || !conn) return;
    const file = acceptedFiles[0];
    setStatus(`Loading ${file.name}...`);

    try {
      // Use a fixed internal filename to avoid issues with special characters
      const internalFileName = 'uploaded_data.csv';
      
      // Convert file to ArrayBuffer for registration
      const arrayBuffer = await file.arrayBuffer();
      
      // Register the file buffer with DuckDB
      await db.registerFileBuffer(internalFileName, new Uint8Array(arrayBuffer));
      
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
    } catch (error) {
      console.error('Error loading CSV:', error);
      setStatus(`Error: ${error instanceof Error ? error.message : 'Failed to load CSV'}`);
    }
  };

  const handleTransform = async (userPrompt: string) => {
    if (!conn) return;
    setIsProcessing(true);
    setStatus('Gemini is thinking...');

    try {
      // 1. Ask Gemini for the SQL
      const response = await fetch('/api/transform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schema, userPrompt })
      });
      
      const { sql, chartType, xAxis, yAxis, explanation } = await response.json();
      
      // 2. Execute Gemini's SQL
      setStatus(`Executing: ${explanation}`);
      const result = await conn.query(sql);
      const resultRows = result.toArray().map(r => r.toJSON());

      // 3. Update UI
      setRows(resultRows);
      setChartConfig({ type: chartType, xAxis, yAxis });
      setStatus(`Done! showed ${resultRows.length} rows.`);

    } catch (err) {
      console.error(err);
      setStatus('Error transforming data.');
    } finally {
      setIsProcessing(false);
    }
  };

  const { getRootProps, getInputProps } = useDropzone({ onDrop });

  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '20px', fontFamily: 'Inter, sans-serif' }}>
      <h1>Gemini 3 Data Agent</h1>
      
      {/* 1. Upload Section */}
      {!rows.length && (
        <div {...getRootProps()} style={{ border: '2px dashed #ccc', padding: '40px', textAlign: 'center', cursor: 'pointer', borderRadius: '8px' }}>
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
          <DynamicChart data={rows} config={chartConfig} />

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