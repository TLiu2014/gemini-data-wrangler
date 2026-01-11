// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure multer for image uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Configure multer for audio uploads
const uploadAudio = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    // Accept audio files
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Security headers
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // XSS Protection (legacy browsers)
  res.setHeader('X-XSS-Protection', '1; mode=block');
  // Content Security Policy
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';");
  // Referrer Policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Validate API key format (basic validation)
function validateApiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string') return false;
  // Gemini API keys typically start with 'AIza' and are 39 characters
  // Basic validation without being too strict
  const trimmed = apiKey.trim();
  if (trimmed.length < 30 || trimmed.length > 50) return false;
  // Check for basic alphanumeric pattern (allowing dashes and underscores)
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) return false;
  return true;
}

// Define the response schema we want Gemini to strictly follow
const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        isValid: { 
            type: SchemaType.BOOLEAN, 
            description: "Whether the audio contains a valid data transformation command. Set to false if audio is empty, music, or unrelated to data transformation." 
        },
        sql: { type: SchemaType.STRING, description: "The DuckDB SQL query to execute (only if isValid is true)" },
        chartType: { type: SchemaType.STRING, description: "One of: 'bar', 'line', 'area', 'scatter', 'd3-scatter', 'd3-line', 'd3-bar', '3d-scatter', '3d-surface', 'none'" },
        zAxis: { type: SchemaType.STRING, description: "Optional: The column name for the Z axis (for 3D charts)" },
        xAxis: { type: SchemaType.STRING, description: "The column name for the X axis" },
        yAxis: { type: SchemaType.STRING, description: "The column name for the Y axis" },
        explanation: { type: SchemaType.STRING, description: "Brief explanation of what this query does, or error message if isValid is false" },
        transformationStages: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    type: { 
                        type: SchemaType.STRING, 
                        description: "Stage type: 'LOAD', 'JOIN', 'UNION', 'FILTER', 'GROUP', 'SELECT', 'SORT', 'AGGREGATE', or 'CUSTOM'" 
                    },
                    description: { 
                        type: SchemaType.STRING, 
                        description: "Clear description of what this transformation stage does. DO NOT include file extensions like '_csv', '.csv' in table names mentioned in descriptions. Use clean table names like 'table_orders' not 'table_orders_csv'." 
                    },
                    data: {
                        type: SchemaType.OBJECT,
                        properties: {
                            // For JOIN
                            joinType: { type: SchemaType.STRING, description: "For JOIN: 'INNER', 'LEFT', 'RIGHT', or 'FULL OUTER'" },
                            leftTable: { type: SchemaType.STRING, description: "For JOIN: left table name" },
                            rightTable: { type: SchemaType.STRING, description: "For JOIN: right table name" },
                            leftKey: { type: SchemaType.STRING, description: "For JOIN: left table join key column" },
                            rightKey: { type: SchemaType.STRING, description: "For JOIN: right table join key column" },
                            // For UNION
                            unionType: { type: SchemaType.STRING, description: "For UNION: 'UNION' or 'UNION ALL'" },
                            tables: { 
                                type: SchemaType.ARRAY, 
                                items: { type: SchemaType.STRING },
                                description: "For UNION: array of table names to union" 
                            },
                            // For FILTER
                            table: { type: SchemaType.STRING, description: "For FILTER: table name to filter" },
                            column: { type: SchemaType.STRING, description: "For FILTER: column name" },
                            operator: { type: SchemaType.STRING, description: "For FILTER: '=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN'" },
                            value: { type: SchemaType.STRING, description: "For FILTER: filter value" },
                            conditions: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        column: { type: SchemaType.STRING },
                                        operator: { type: SchemaType.STRING },
                                        value: { type: SchemaType.STRING },
                                        logic: { type: SchemaType.STRING, description: "'AND' or 'OR'" }
                                    }
                                },
                                description: "For FILTER: array of conditions for complex filters"
                            },
                            // For GROUP
                            groupBy: { 
                                type: SchemaType.ARRAY, 
                                items: { type: SchemaType.STRING },
                                description: "For GROUP: array of column names to group by" 
                            },
                            aggregations: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        function: { type: SchemaType.STRING, description: "Aggregation function: 'SUM', 'COUNT', 'AVG', 'MAX', 'MIN', etc." },
                                        column: { type: SchemaType.STRING, description: "Column to aggregate" },
                                        alias: { type: SchemaType.STRING, description: "Optional alias for the aggregation" }
                                    }
                                },
                                description: "For GROUP: array of aggregations"
                            },
                            // For SELECT
                            columns: { 
                                type: SchemaType.ARRAY, 
                                items: { type: SchemaType.STRING },
                                description: "For SELECT: array of column names to select" 
                            },
                            // For SORT
                            orderBy: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        column: { type: SchemaType.STRING },
                                        direction: { type: SchemaType.STRING, description: "'ASC' or 'DESC'" }
                                    }
                                },
                                description: "For SORT: array of sort specifications"
                            },
                            // For CUSTOM
                            sql: { type: SchemaType.STRING, description: "For CUSTOM: the SQL query string" }
                        }
                    }
                },
                required: ["type", "description"]
            },
            description: "Array of one or more transformation stages that represent the ETL pipeline steps"
        },
        isValid: {
            type: SchemaType.BOOLEAN,
            description: "Whether the audio contains valid speech about data transformation. Set to false if audio is empty, music, or unrelated content."
        }
    },
    required: ["isValid", "explanation"]
};

app.get('/api/config', (req, res) => {
    // Return default API key if available (for UI to use)
    res.json({ 
        hasDefaultApiKey: !!process.env.GEMINI_API_KEY,
        // Don't send the actual key for security, just indicate if it exists
    });
});

app.post('/api/transform', async (req, res) => {
    try {
        const { schema, allSchemas, userPrompt, history, apiKey } = req.body;
        
        // Use API key from request body (if provided), fallback to environment variable
        const apiKeyToUse = (apiKey && apiKey.trim()) || process.env.GEMINI_API_KEY;
        
        if (!apiKeyToUse) {
            return res.status(400).json({ 
                error: "API key is required. Please set it in Settings or set GEMINI_API_KEY environment variable in server/.env file." 
            });
        }
        
        // Validate API key format
        if (!validateApiKey(apiKeyToUse)) {
            return res.status(400).json({ 
                error: "Invalid API key format. Please check your API key." 
            });
        }
        
        // Create a new instance with the provided API key
        const genAIInstance = new GoogleGenerativeAI(apiKeyToUse);
        
        // Use gemini-pro (most widely available model)
        // Alternative models: gemini-1.5-pro, gemini-1.5-flash-latest
        const model = genAIInstance.getGenerativeModel({ 
            // model: "gemini-2.5-flash",
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        });
        
        const schemasInfo = allSchemas ? 
            `Available Tables:\n${allSchemas.map(s => `- ${s.tableName}: ${JSON.stringify(s.schema)}`).join('\n')}` :
            `Current Table Schema (DuckDB):\n${JSON.stringify(schema)}`;
        
        const prompt = `
            You are a Data Engineer Expert.
            
            ${schemasInfo}

            User Goal: "${userPrompt}"

            Rules:
            1. Write valid DuckDB SQL.
            2. If the user asks to "Filter" or "Join", write the SQL to create a NEW result set.
            3. Suggest a chart type that best visualizes the result:
               - Use 'bar', 'line', 'area', 'scatter' for standard 2D charts
               - Use 'd3-scatter', 'd3-line', 'd3-bar' for D3.js visualizations
               - Use '3d-scatter' or '3d-surface' if the data has 3 dimensions (provide zAxis)
            4. If the result is just a table (like a raw list), set chartType to 'none'.
            5. If the data has 3 numeric columns, consider using '3d-scatter' with zAxis.
            6. CRITICAL: Analyze your SQL query and provide transformationStages array with one or more stages:
               - Analyze the SQL to determine what operations it performs
               - Break down complex SQL into logical stages (e.g., FILTER -> JOIN -> SORT)
               - Each stage MUST have a proper type based on the SQL operation:
                 * If SQL contains JOIN/LEFT JOIN/RIGHT JOIN/FULL OUTER JOIN → use type "JOIN"
                 * If SQL contains UNION/UNION ALL → use type "UNION"
                 * If SQL contains WHERE clause → use type "FILTER"
                 * If SQL contains GROUP BY → use type "GROUP"
                 * If SQL selects specific columns (not SELECT *) → use type "SELECT"
                 * If SQL contains ORDER BY → use type "SORT"
                 * If SQL contains aggregate functions without GROUP BY → use type "AGGREGATE"
                 * Only use "CUSTOM" if the SQL doesn't fit any of the above categories
               
               - For each stage, extract and populate the appropriate data fields:
                 * JOIN: joinType (INNER, LEFT, RIGHT, FULL OUTER), leftTable, rightTable, leftKey, rightKey
                 * UNION: unionType (UNION or UNION ALL), tables array
                 * FILTER: table, column, operator (=, !=, >, <, >=, <=, LIKE, IN, NOT IN), value, or conditions array
                 * GROUP: groupBy array, aggregations array with function (SUM, COUNT, AVG, MAX, MIN), column, alias
                 * SELECT: columns array
                 * SORT: orderBy array with column and direction (ASC/DESC)
                 * AGGREGATE: aggregations array with function, column, alias
                 * CUSTOM: sql string
               
               - Example: If SQL is "SELECT * FROM orders WHERE amount > 100 ORDER BY date DESC"
                 → Return 2 stages: [{"type": "FILTER", "data": {"table": "orders", "column": "amount", "operator": ">", "value": "100"}}, {"type": "SORT", "data": {"orderBy": [{"column": "date", "direction": "DESC"}]}}]
               
               - Example: If SQL is "SELECT o.*, c.name FROM orders o LEFT JOIN customers c ON o.customer_id = c.id"
                 → Return 1 stage: [{"type": "JOIN", "description": "Left join orders with customers", "data": {"joinType": "LEFT", "leftTable": "orders", "rightTable": "customers", "leftKey": "customer_id", "rightKey": "id"}}]
               
               - Example: If SQL is "SELECT c.region, SUM(o.amount) AS total_sales FROM table_orders o JOIN table_customers c ON o.customer_id = c.customer_id GROUP BY c.region ORDER BY total_sales DESC"
                 → Return 3 stages: [
                     {"type": "JOIN", "description": "Join orders with customers", "data": {"joinType": "INNER", "leftTable": "table_orders", "rightTable": "table_customers", "leftKey": "customer_id", "rightKey": "customer_id"}},
                     {"type": "GROUP", "description": "Group by region and sum sales", "data": {"groupBy": ["c.region"], "aggregations": [{"function": "SUM", "column": "o.amount", "alias": "total_sales"}]}},
                     {"type": "SORT", "description": "Sort by total sales descending", "data": {"orderBy": [{"column": "total_sales", "direction": "DESC"}]}}
                   ]
               
               - MANDATORY: You MUST return the transformationStages array. It is a required field in the response schema.
               - Always analyze the SQL structure to determine the correct stage types. DO NOT default to CUSTOM unless truly necessary.
               - Break down complex queries into multiple stages in the correct order (e.g., JOIN first, then GROUP, then SORT).
        `;

        const result = await model.generateContent(prompt);
        const response = result.response.text();
        const parsedResponse = JSON.parse(response);
        
        // Validate that transformationStages exists
        if (!parsedResponse.transformationStages || !Array.isArray(parsedResponse.transformationStages)) {
            console.warn('⚠️  Gemini did not return transformationStages, adding fallback');
            // Don't fail, let frontend handle it
        }
        
        res.json(parsedResponse);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Transformation failed", details: error.message });
    }
});

// Schema for image analysis response - flexible to handle different image types
const imageAnalysisResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        imageType: {
            type: SchemaType.STRING,
            description: "Type of image detected: 'stage_flow', 'data_table', 'schema', or 'unrecognized'"
        },
        explanation: {
            type: SchemaType.STRING,
            description: "Natural language explanation of what was found in the image. For stage flows, explain the flow and result table. For data tables, describe the table structure and content. For unrecognized images, explain why it cannot be processed."
        },
        tables: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    name: { type: SchemaType.STRING, description: "Table name (DO NOT include file extensions like _csv, _xlsx, .csv, etc. - these are data tables, not files)" },
                    columns: {
                        type: SchemaType.ARRAY,
                        items: {
                            type: SchemaType.OBJECT,
                            properties: {
                                name: { type: SchemaType.STRING, description: "Column name" },
                                type: { type: SchemaType.STRING, description: "Column data type (e.g., 'VARCHAR', 'INTEGER', 'DOUBLE')" }
                            }
                        },
                        description: "Array of column definitions"
                    },
                    rows: {
                        type: SchemaType.ARRAY,
                        items: {
                            type: SchemaType.ARRAY,
                            items: {
                                type: SchemaType.STRING,
                                description: "Cell value as string"
                            },
                            description: "Array of cell values in the same order as the columns array"
                        },
                        description: "Array of sample data rows (provide at least 5-10 rows for each table). Each row is an array of values matching the order of columns in the columns array."
                    }
                },
                required: ["name", "columns", "rows"]
            },
            description: "Array of tables with their schemas and sample data. Required for 'stage_flow' and 'data_table' types, empty array for others."
        },
        transformationStages: {
            type: SchemaType.ARRAY,
            items: {
                type: SchemaType.OBJECT,
                properties: {
                    id: { type: SchemaType.STRING, description: "Unique stage identifier" },
                    type: { 
                        type: SchemaType.STRING, 
                        description: "Stage type: 'LOAD', 'JOIN', 'UNION', 'FILTER', 'GROUP', 'SELECT', 'SORT', 'AGGREGATE', or 'CUSTOM'" 
                    },
                    description: { 
                        type: SchemaType.STRING, 
                        description: "Clear description of what this transformation stage does. DO NOT include file extensions like '_csv', '.csv' in table names mentioned in descriptions. Use clean table names like 'table_orders' not 'table_orders_csv'." 
                    },
                    data: {
                        type: SchemaType.OBJECT,
                        properties: {
                            // For JOIN
                            joinType: { type: SchemaType.STRING, description: "For JOIN: 'INNER', 'LEFT', 'RIGHT', or 'FULL OUTER'" },
                            leftTable: { type: SchemaType.STRING, description: "For JOIN: left table name" },
                            rightTable: { type: SchemaType.STRING, description: "For JOIN: right table name" },
                            leftKey: { type: SchemaType.STRING, description: "For JOIN: left table join key column" },
                            rightKey: { type: SchemaType.STRING, description: "For JOIN: right table join key column" },
                            // For UNION
                            unionType: { type: SchemaType.STRING, description: "For UNION: 'UNION' or 'UNION ALL'" },
                            tables: { 
                                type: SchemaType.ARRAY, 
                                items: { type: SchemaType.STRING },
                                description: "For UNION: array of table names to union" 
                            },
                            // For FILTER
                            table: { type: SchemaType.STRING, description: "For FILTER: table name to filter" },
                            column: { type: SchemaType.STRING, description: "For FILTER: column name" },
                            operator: { type: SchemaType.STRING, description: "For FILTER: '=', '!=', '>', '<', '>=', '<=', 'LIKE', 'IN', 'NOT IN'" },
                            value: { type: SchemaType.STRING, description: "For FILTER: filter value" },
                            // For GROUP
                            groupBy: { 
                                type: SchemaType.ARRAY, 
                                items: { type: SchemaType.STRING },
                                description: "For GROUP: array of column names to group by" 
                            },
                            aggregations: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        function: { type: SchemaType.STRING, description: "Aggregation function: 'SUM', 'COUNT', 'AVG', 'MAX', 'MIN', etc." },
                                        column: { type: SchemaType.STRING, description: "Column to aggregate" },
                                        alias: { type: SchemaType.STRING, description: "Optional alias for the aggregation" }
                                    }
                                },
                                description: "For GROUP: array of aggregations"
                            },
                            // For SELECT
                            columns: { 
                                type: SchemaType.ARRAY, 
                                items: { type: SchemaType.STRING },
                                description: "For SELECT: array of column names to select" 
                            },
                            // For SORT
                            orderBy: {
                                type: SchemaType.ARRAY,
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        column: { type: SchemaType.STRING },
                                        direction: { type: SchemaType.STRING, description: "'ASC' or 'DESC'" }
                                    }
                                },
                                description: "For SORT: array of sort specifications"
                            },
                            // For LOAD
                            tableName: { type: SchemaType.STRING, description: "For LOAD: table name (DO NOT include file extensions like _csv, _xlsx, .csv, etc.)" },
                            // For CUSTOM
                            sql: { type: SchemaType.STRING, description: "For CUSTOM: the SQL query string" }
                        }
                    }
                },
                required: ["id", "type", "description"]
            },
            description: "Array of transformation stages representing the flow diagram. Required only for 'stage_flow' type, empty array for others."
        }
    },
    required: ["imageType", "explanation"]
};

// Error handler for multer
const handleMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: "File too large. Maximum size is 10MB." });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
        return res.status(400).json({ error: err.message || "File upload error" });
    }
    next();
};

app.post('/api/analyze-flow-image', upload.single('image'), handleMulterError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No image file provided" });
        }

        const { apiKey, context } = req.body;
        
        // Parse context if provided (existing tables and stages)
        let existingContext = null;
        if (context) {
            try {
                existingContext = JSON.parse(context);
            } catch (e) {
                console.warn('Failed to parse context:', e);
            }
        }
        
        // Use API key from request body (if provided), fallback to environment variable
        const apiKeyToUse = (apiKey && apiKey.trim()) || process.env.GEMINI_API_KEY;
        
        if (!apiKeyToUse) {
            return res.status(400).json({ 
                error: "API key is required. Please set it in Settings or set GEMINI_API_KEY environment variable in server/.env file." 
            });
        }
        
        // Validate API key format
        if (!validateApiKey(apiKeyToUse)) {
            return res.status(400).json({ 
                error: "Invalid API key format. Please check your API key." 
            });
        }
        
        // Create a new instance with the provided API key
        const genAIInstance = new GoogleGenerativeAI(apiKeyToUse);
        
        // Use Gemini 2.0 with vision capabilities
        const model = genAIInstance.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp",
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: imageAnalysisResponseSchema
            }
        });
        
        // Convert image buffer to base64
        const imageBase64 = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype;
        
        // Build context information for prompt
        let contextInfo = '';
        let hasExistingContext = false;
        if (existingContext && (existingContext.existingTables?.length > 0 || existingContext.existingStages?.length > 0)) {
            hasExistingContext = true;
            contextInfo = '\n\nEXISTING FLOW CONTEXT:\n';
            if (existingContext.existingTables?.length > 0) {
                contextInfo += 'Existing tables (NOTE: column names are pre-normalized to lowercase for easier matching):\n';
                contextInfo += '⚠️ PRIORITY: You MUST try to connect to the [LATEST] table first! Then other result tables, then loaded tables.\n\n';
                
                // Separate result tables from loaded tables
                const latestResultTable = existingContext.existingTables.find(t => t.isLatestResultTable);
                const otherResultTables = existingContext.existingTables.filter(t => t.isResultTable && !t.isLatestResultTable);
                const loadedTables = existingContext.existingTables.filter(t => !t.isResultTable);

                if (latestResultTable) {
                    contextInfo += '🎯 LATEST RESULT TABLE (HIGHEST PRIORITY - TRY THIS FIRST!):\n';
                    const normalizedColumns = latestResultTable.columns.map(c => `${c.name.toLowerCase()} (${c.type})`).join(', ');
                    contextInfo += `  - ${latestResultTable.name} (columns: ${normalizedColumns}) [LATEST]\n\n`;
                }
                
                if (otherResultTables.length > 0) {
                    contextInfo += 'OTHER RESULT TABLES (from previous stages - try these next):\n';
                    otherResultTables.forEach((table, idx) => {
                        const normalizedColumns = table.columns.map(c => `${c.name.toLowerCase()} (${c.type})`).join(', ');
                        contextInfo += `  ${idx + 1}. ${table.name} (columns: ${normalizedColumns})\n`;
                    });
                    contextInfo += '\n';
                }
                
                if (loadedTables.length > 0) {
                    contextInfo += 'LOADED TABLES (original sources - use only as a last resort):\n';
                    loadedTables.forEach((table, idx) => {
                        const normalizedColumns = table.columns.map(c => `${c.name.toLowerCase()} (${c.type})`).join(', ');
                        contextInfo += `  ${idx + 1}. ${table.name} (columns: ${normalizedColumns})\n`;
                    });
                }
            }
            if (existingContext.existingStages?.length > 0) {
                contextInfo += '\n\nEXISTING TRANSFORMATION STAGES (in order):\n';
                existingContext.existingStages.forEach((stage, idx) => {
                    const stageNum = idx + 1;
                    const resultInfo = stage.resultTableName ? ` → produces table: ${stage.resultTableName}` : '';
                    const isLatest = idx === existingContext.latestStageIndex;
                    const latestMarker = isLatest ? ' [LATEST - CONTINUE FROM HERE!]' : '';
                    contextInfo += `  ${stageNum}. ${stage.type}: ${stage.description}${resultInfo}${latestMarker}\n`;
                });
            }
            
            if (existingContext.stageToTableInfo && existingContext.stageToTableInfo.length > 0) {
                contextInfo += '\nSTAGE-TO-TABLE MAPPING (which stage produces which table):\n';
                existingContext.stageToTableInfo.forEach((info, idx) => {
                    contextInfo += `  Stage ${idx + 1} (${info.stageType}): "${info.stageDescription}" → Table: ${info.resultTableName}\n`;
                });
            }
            
            contextInfo += `
🔥🔥🔥 CRITICAL INSTRUCTION FOR TABLE INTEGRATION 🔥🔥🔥
If the uploaded image contains a data table, you MUST find connections to CONTINUE the existing flow:

1. CONNECTION PRIORITY (MANDATORY - FOLLOW THIS ORDER EXACTLY):
   ⚠️⚠️⚠️ YOU MUST TRY IN THIS ORDER - DO NOT SKIP STEPS! ⚠️⚠️⚠️
   
   STEP 1 (HIGHEST PRIORITY): Try to connect to the [LATEST] result table
   - This is the final output of the current flow (marked [LATEST] above)
   - Look for matching columns between the new table and the [LATEST] table
   - If you find ANY matching columns (even weak matches), create a JOIN stage connecting to the [LATEST] table
   - Use the [LATEST] table name in your JOIN stage (leftTable or rightTable)
   - This CONTINUES the flow from where it left off
   
   STEP 2 (SECOND PRIORITY): If Step 1 fails, try connecting to OTHER RESULT TABLES
   - These are tables produced by previous stages (not the latest)
   - Try to find connections to these intermediate result tables
   - This allows building on previous transformations
   
   STEP 3 (LOWEST PRIORITY - LAST RESORT): Only if Steps 1 and 2 fail, connect to LOADED TABLES
   - These are the original source tables (not result tables)
   - Only use these if you cannot connect to any result tables
   - This is the least preferred option

2. CASE-INSENSITIVE & SEMANTIC COLUMN MATCHING:
   - Compare column names case-insensitively (e.g., "Customer_ID" matches "customer_id")
   - Look for similar meanings (e.g., "cust_id" matches "client_id")
   - NORMALIZE in your mind: remove underscores, convert to lowercase, then compare
   - Be AGGRESSIVE in finding matches - even 50% similarity should trigger a connection

3. GENERATE TRANSFORMATION STAGES:
   - ⚠️ CRITICAL: Do NOT generate \`LOAD\` stages for any tables. The app handles loading automatically.
   - When creating JOIN stages, use the table name from the priority list above (prefer [LATEST] table)
   - Add other stages (\`SELECT\`, \`FILTER\`, \`GROUP\`, \`SORT\`) as needed to complete the transformation
   - The new table from the image should be the other table in the JOIN (rightTable or leftTable)

4. EXAMPLE BEHAVIOR:
   - If [LATEST] table has columns: [customer_id, order_date, amount]
   - And new table has columns: [customer_id, product_name, price]
   - You MUST create a JOIN stage: JOIN [LATEST table] with [new table] on customer_id
   - This continues the flow from the latest stage

🎯 YOUR PRIMARY GOAL: CONTINUE THE FLOW FROM THE LATEST STAGE! Connect the new table to the [LATEST] result table first!
`;
        }
        
        const prompt = `
You are an expert Data Engineer analyzing images for data pipeline integration.

TASK: Analyze this image and determine its type, extract structured data, and integrate it with existing data flows.

IMAGE TYPES TO DETECT:
1. "stage_flow" - A data transformation flow diagram.
2. "data_table" - A table of data (spreadsheet, CSV preview, etc.).
3. "unrecognized" - Anything else.

RESPONSE STRUCTURE:
- imageType: One of the types above.
- explanation: Natural language description of what you found.
- tables: Array of extracted tables (for "data_table" type).
- transformationStages: Array of transformation stages (see rules below).

RULES FOR TABLE EXTRACTION ("data_table" type):
- Extract ALL visible data.
- For each table, provide:
  * name: A descriptive table name (e.g., "products_data", "customers", "orders").
    ⚠️ CRITICAL: DO NOT include file extensions like "_csv", "_xlsx", ".csv", ".xlsx" in table names.
    These are data tables, not files. Use clean names like "customers" not "customers_csv" or "customers.csv".
  * columns: Array of {name, type}. ⚠️ CRITICAL: NORMALIZE all column names to lowercase (e.g., "Customer ID" becomes "customer_id").
  * rows: Array of data rows (extract at least 10-20 if available).
- Infer appropriate SQL data types (VARCHAR, INTEGER, DOUBLE, DATE, etc.).

RULES FOR TRANSFORMATION STAGES:
⚠️⚠️⚠️ CRITICAL: Stage descriptions MUST NOT include file extensions in table names!
   - Use clean table names like "table_orders" NOT "table_orders_csv" or "table_orders.csv"
   - Example: "Loaded table 'table_orders' from file 'orders.csv'" ✓
   - Wrong: "Loaded table 'table_orders_csv' from file 'orders.csv'" ✗

A. For "stage_flow" images:
   ⚠️⚠️⚠️ CRITICAL RULES FOR TABLES:
   - The "tables" array MUST ONLY contain SOURCE/INPUT tables (e.g., from CSV files shown in the diagram)
   - DO NOT include intermediate result tables (e.g., "result_stage_3_join", "joined_data")
   - DO NOT include tables that are OUTPUTS of transformation stages
   - ONLY include the initial/raw data tables that are loaded at the beginning of the flow
   - Example: If diagram shows "customers.csv" and "orders.csv" being loaded, then joined to create "result", 
     the tables array should ONLY have customers and orders data, NOT the join result
   
   ⚠️⚠️⚠️ CRITICAL RULES FOR STAGE IDs:
   - Generate SEQUENTIAL stage IDs starting from "stage_1", "stage_2", "stage_3", etc.
   - DO NOT skip numbers or create gaps in the sequence
   - Count ALL stages including LOAD stages when numbering
   - Example: stage_1 (LOAD), stage_2 (LOAD), stage_3 (JOIN), stage_4 (FILTER)
   
   - Extract ALL stages from the diagram in the correct order, including LOAD stages if present.
   - LOAD stages represent initial table loading operations in the flow diagram.
   - CRITICAL: Every stage MUST have a unique id field. This is required.
   - CRITICAL: Every stage MUST have complete data fields based on its type:
     * JOIN: MUST include {leftTable, rightTable, leftKey, rightKey, joinType}. DO NOT include other stage fields like "tables" or "unionType".
       If join key is mentioned in description (e.g., "join on customer_id"), extract it into leftKey and rightKey.
       DO NOT use placeholder values like "none", "null", or empty string - extract the actual join key from the diagram/description.
     * FILTER: MUST include {table, column, operator, value}. If the filter condition is ambiguous in the diagram,
       infer the MOST LIKELY filter based on context (e.g., "Filter results" → check for "status='Active'" or "amount>0")
     * GROUP: MUST include {table, groupBy, aggregations}
     * SELECT: MUST include {table, columns}
     * SORT: MUST include {table, orderBy}
     * UNION: MUST include {tables, unionType}. DO NOT include JOIN fields like "leftTable" or "rightTable".
     * LOAD: MUST include {tableName, fileName}
       ⚠️ IMPORTANT: tableName should NOT include file extensions (e.g., use "customers" not "customers_csv").
       fileName can include the extension (e.g., "customers.csv") as it represents the actual file.
   - Include complete data for each stage type (including LOAD stages with tableName).
   - If a FILTER stage is shown but conditions are unclear, infer reasonable conditions based on:
     * Common patterns (e.g., "active status", "positive amounts", "recent dates")
     * Available columns from previous stages
     * Description text visible in the diagram
   - DO NOT generate FILTER stages without {column, operator, value} - always infer if needed.
   - DO NOT mix fields from different stage types (e.g., don't put UNION fields in a JOIN stage).

B. For "data_table" images WITH existing context:
   ${hasExistingContext ? `
   ⚠️⚠️⚠️ CRITICAL: You MUST find connections between the new table and the existing flow! ⚠️⚠️⚠️
   
   STEP 1 - ANALYZE FOR CONNECTIONS (using pre-normalized lowercase columns):
   🔍 The new table's columns are normalized to lowercase. The existing table columns in the context are also pre-normalized. This makes matching easy.
   
   ⚠️⚠️⚠️ CONNECTION PRIORITY (ABSOLUTE & MANDATORY - FOLLOW EXACTLY!):
   
   🔥 STEP 1 (MANDATORY FIRST STEP): Check connection with [LATEST] table
   - The [LATEST] table is the result of the LAST stage in the flow (marked [LATEST] in the context above)
   - This table represents the CURRENT STATE of the data pipeline
   - YOU MUST check this table FIRST before checking any other tables
   - Look for matching columns (case-insensitive, semantic matching)
   - If you find ANY matching column, you MUST create a JOIN stage using the [LATEST] table name
   - Example: If [LATEST] table is "result_stage_5_filter" and has column "customer_id", and new table has "customer_id", create JOIN with "result_stage_5_filter"
   
   🔥 STEP 2 (ONLY IF STEP 1 FAILS): Check connection with OTHER RESULT TABLES
   - These are tables produced by previous stages (not the latest)
   - Only check these if you found NO matches with the [LATEST] table
   - Try to find connections to these intermediate result tables
   
   🔥 STEP 3 (ONLY IF STEPS 1 & 2 FAIL): Check connection with LOADED TABLES
   - These are the original source tables (not result tables)
   - Only check these as a last resort if no result tables have connections
   
   ⚠️ CRITICAL RULES:
   - ALWAYS start with [LATEST] table - do NOT skip to other tables
   - If [LATEST] table has a matching column, use it - do NOT check other tables
   - The goal is to CONTINUE the flow from the most recent point
   - Direct match: "customer_id" in new table + "customer_id" in [LATEST] table → MUST USE [LATEST]!
   - Semantic match: "cust_id" in new table + "customer_id" in [LATEST] table → MUST USE [LATEST]!
   
   STEP 2 - GENERATE INTEGRATION STAGES:
   ⚠️⚠️⚠️ CRITICAL: Do NOT create a LOAD stage! The table is loaded automatically.
   ⚠️⚠️⚠️ NEVER include a stage with type "LOAD" in your response.
   - You MUST ONLY return integration stages (JOIN, UNION, FILTER, GROUP, etc.).
   - If you find NO connections after checking all tables in priority order, return an empty array [] for transformationStages.
   
   - If you find a JOIN connection (prioritizing [LATEST] table):
     {
       "id": "stage_join_continuation_1", 
       "type": "JOIN", 
       "description": "Join [new_table] with [LATEST_table] to continue flow",
       "data": { 
         "joinType": "INNER" | "LEFT" | "RIGHT", 
         "leftTable": "[LATEST_table_name_from_context]",  // Use [LATEST] table name if match found there
         "rightTable": "[new_table_name]", 
         "leftKey": "[column_from_LATEST_table]", 
         "rightKey": "[column_from_new_table]" 
       }
     }
     ⚠️ IMPORTANT: If you found a match with the [LATEST] table, use the [LATEST] table name in leftTable or rightTable
     ⚠️ CRITICAL: Always include a unique "id" field for each stage!
   - Add other stages like FILTER, GROUP, etc. if they would be useful (each with unique IDs).
   
   STEP 3 - VALIDATION:
   - If you find connections, return integration stages (JOIN, UNION, etc.).
   - If the table is completely unrelated, return an empty array [].
   - When in doubt, CREATE A JOIN! The user wants integration!
   
   📋 CONCRETE EXAMPLE OF REQUIRED BEHAVIOR:
   
   Context has:
   - LATEST TABLE: result_stage_5_filter [customer_id, order_id, amount] [LATEST] ← START HERE!
   - OTHER RESULT TABLES: result_stage_2_join [customer_id, order_id]
   - LOADED TABLES: table_customers, table_orders
   
   New image has a table "products" with columns [product_id, customer_id, price].
   
   ✅ CORRECT BEHAVIOR:
   → STEP 1: Check [LATEST] table (result_stage_5_filter) - has "customer_id" ✓
   → STEP 1 RESULT: MATCH FOUND! "customer_id" exists in both tables
   → YOU MUST GENERATE: A JOIN stage with leftTable="result_stage_5_filter", rightTable="products", leftKey="customer_id", rightKey="customer_id"
   → YOU MUST STOP HERE - do NOT check other tables because you found a match with [LATEST]
   → This CONTINUES the flow from the latest stage
   
   ❌ WRONG BEHAVIOR:
   → Checking other result tables first (should check [LATEST] first)
   → Checking loaded tables first (should check [LATEST] first)
   → Using a different table name when [LATEST] has a match
   
   ❌ WHAT NOT TO DO:
   - DON'T create LOAD stages. NEVER.
   - DON'T connect to a lower-priority table if a connection to a higher-priority one exists.
   - DON'T be conservative - be AGGRESSIVE in finding connections.
   ` : `
   - Generate a LOAD stage for the new table with a unique id (e.g., "stage_load_1").
   - CRITICAL: Always include a unique "id" field in the stage object.
   - Do NOT generate additional transformation stages.
   `}

C. For "data_table" images WITHOUT existing context:
   - Generate only a LOAD stage for the table with a unique id (e.g., "stage_load_1").
   - CRITICAL: Always include a unique "id" field in the stage object.

D. For "unrecognized" images:
   - Set tables and transformationStages to empty arrays [].

EXAMPLE STAGE DATA STRUCTURES (CRITICAL - FOLLOW THESE EXACTLY):

1. LOAD stage:
   {
     "id": "stage_load_1",
     "type": "LOAD",
     "description": "Load customers table",
     "data": {
       "tableName": "customers",
       "fileName": "customers.csv"
     }
   }

2. JOIN stage (MUST include ALL these fields):
   {
     "id": "stage_join_1",
     "type": "JOIN",
     "description": "Join customers and orders on customer_id",
     "data": {
       "joinType": "INNER",
       "leftTable": "customers",
       "rightTable": "orders",
       "leftKey": "customer_id",
       "rightKey": "customer_id"
     }
   }

3. FILTER stage (MUST include ALL these fields):
   {
     "id": "stage_filter_1",
     "type": "FILTER",
     "description": "Filter orders with amount > 100",
     "data": {
       "table": "orders",
       "column": "amount",
       "operator": ">",
       "value": "100"
     }
   }

4. GROUP stage (MUST include ALL these fields):
   {
     "id": "stage_group_1",
     "type": "GROUP",
     "description": "Group by customer and sum order amounts",
     "data": {
       "table": "orders",
       "groupBy": ["customer_id"],
       "aggregations": [
         {
           "function": "SUM",
           "column": "amount",
           "alias": "total_amount"
         }
       ]
     }
   }

5. SELECT stage (MUST include ALL these fields):
   {
     "id": "stage_select_1",
     "type": "SELECT",
     "description": "Select specific columns",
     "data": {
       "table": "orders",
       "columns": ["order_id", "customer_id", "amount", "order_date"]
     }
   }

6. SORT stage (MUST include ALL these fields):
   {
     "id": "stage_sort_1",
     "type": "SORT",
     "description": "Sort by amount descending",
     "data": {
       "table": "orders",
       "orderBy": [
         {
           "column": "amount",
           "direction": "DESC"
         }
       ]
     }
   }

⚠️ CRITICAL: Every stage MUST have complete data fields as shown above. Do NOT generate stages with missing fields!

DATA QUALITY:
- Extract real data, not placeholders.
- Ensure row data matches column order.
- Provide 10-20+ sample rows if available.
${contextInfo}

REMEMBER: For a data_table with existing context, your primary goal is INTEGRATION, starting from the [LATEST] point in the flow.
`;

        // Prepare image part for Gemini
        const imagePart = {
            inlineData: {
                data: imageBase64,
                mimeType: mimeType
            }
        };

        const result = await model.generateContent([prompt, imagePart]);
        const response = result.response.text();
        const parsedResponse = JSON.parse(response);
        
        // Debug logging to help troubleshoot connection detection
        if (parsedResponse.imageType === 'data_table' && hasExistingContext) {
            console.log('\n=== IMAGE ANALYSIS DEBUG ===');
            console.log('New table:', parsedResponse.tables?.[0]?.name);
            console.log('New table columns:', parsedResponse.tables?.[0]?.columns?.map(c => c.name).join(', '));
            console.log('Existing tables:', existingContext.existingTables?.map(t => t.name).join(', '));
            console.log('Existing columns:', existingContext.existingTables?.map(t => 
                t.columns.map(c => c.name).join(', ')
            ).join(' | '));
            console.log('Stages generated:', parsedResponse.transformationStages?.length || 0);
            if (parsedResponse.transformationStages?.length > 0) {
                console.log('Stage types:', parsedResponse.transformationStages.map(s => s.type).join(', '));
            } else {
                console.log('⚠️  WARNING: No transformation stages generated despite existing context!');
            }
            console.log('===========================\n');
        }
        
        res.json(parsedResponse);
    } catch (error) {
        console.error('Error analyzing image:', error);
        res.status(500).json({ error: "Image analysis failed", details: error.message });
    }
});

// Error handler for multer audio upload errors (must be defined before routes)
const handleAudioMulterError = (err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: "Audio file too large. Maximum size is 10MB." });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    if (err) {
        return res.status(400).json({ error: err.message || "Audio upload error" });
    }
    next();
};

// Voice command endpoint - Send audio directly to Gemini for transformation
app.post('/api/voice/command', uploadAudio.single('audio'), handleAudioMulterError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }

        const { apiKey, schema, allSchemas } = req.body;
        
        // Use API key from request body (if provided), fallback to environment variable
        const apiKeyToUse = (apiKey && apiKey.trim()) || process.env.GEMINI_API_KEY;
        
        if (!apiKeyToUse) {
            return res.status(400).json({ 
                error: "API key is required. Please set it in Settings or set GEMINI_API_KEY environment variable in server/.env file." 
            });
        }
        
        // Validate API key format
        if (!validateApiKey(apiKeyToUse)) {
            return res.status(400).json({ 
                error: "Invalid API key format. Please check your API key." 
            });
        }
        
        // Create a new instance with the provided API key
        const genAIInstance = new GoogleGenerativeAI(apiKeyToUse);
        
        // Use Gemini 2.0 with audio support - it can process audio directly
        const model = genAIInstance.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp", // Gemini 2.0 supports audio
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        });
        
        // Parse schema
        let parsedSchema = [];
        let parsedAllSchemas = [];
        try {
            parsedSchema = schema ? JSON.parse(schema) : [];
            parsedAllSchemas = allSchemas ? JSON.parse(allSchemas) : [];
        } catch (e) {
            console.warn('Failed to parse schema:', e);
        }
        
        const schemasInfo = parsedAllSchemas.length > 0 ? 
            `Available Tables:\n${parsedAllSchemas.map(s => `- ${s.tableName}: ${JSON.stringify(s.schema)}`).join('\n')}` :
            `Current Table Schema (DuckDB):\n${JSON.stringify(parsedSchema)}`;
        
        // Convert audio buffer to base64
        const audioBase64 = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype || 'audio/webm';
        
        const prompt = `
            You are a Data Engineer Expert.
            
            ${schemasInfo}

            The user has provided a VOICE COMMAND describing how they want to transform their dataset.
            Listen to the audio carefully and:
            1. First, transcribe exactly what the user said (word-for-word transcription)
            2. Detect if the audio is EMPTY (no speech/words), MUSIC, or UNRELATED to data transformation
            3. Then understand what transformation they want based on the audio
            
            CRITICAL VALIDATION - YOU MUST CHECK THESE FIRST:
            
            A. If the audio is EMPTY (silence, no words, no speech detected):
               - Set isValid to false
               - Set explanation to: "No speech was detected in the audio. Please speak clearly about how you want to transform your data."
               - Do NOT include sql, chartType, transformationStages, xAxis, yAxis, zAxis fields
               - Only return: {"isValid": false, "explanation": "..."}
            
            B. If the audio is MUSIC, background noise, or UNRELATED content:
               - Set isValid to false
               - Set explanation to: "The audio appears to be [music/unrelated content], not a data transformation command. Please provide a clear voice instruction about how you want to transform your data."
               - Do NOT include sql, chartType, transformationStages, xAxis, yAxis, zAxis fields
               - Only return: {"isValid": false, "explanation": "..."}
            
            C. If the audio contains a valid data transformation request:
               - Set isValid to true
               - In explanation, start with "User said: [exact transcription]" followed by your understanding
               - Proceed with generating SQL, chartType, transformationStages, xAxis, yAxis, zAxis as normal
               - Return full response with all fields
            
            CRITICAL: When isValid is false, you MUST NOT include sql, chartType, or transformationStages in your response. Only return isValid and explanation.

            Rules:
            1. Write valid DuckDB SQL.
            2. If the user asks to "Filter" or "Join", write the SQL to create a NEW result set.
            3. Suggest a chart type that best visualizes the result:
               - Use 'bar', 'line', 'area', 'scatter' for standard 2D charts
               - Use 'd3-scatter', 'd3-line', 'd3-bar' for D3.js visualizations
               - Use '3d-scatter' or '3d-surface' if the data has 3 dimensions (provide zAxis)
            4. If the result is just a table (like a raw list), set chartType to 'none'.
            5. If the data has 3 numeric columns, consider using '3d-scatter' with zAxis.
            6. CRITICAL: Analyze your SQL query and provide transformationStages array with one or more stages:
               - Analyze the SQL to determine what operations it performs
               - Break down complex SQL into logical stages (e.g., FILTER -> JOIN -> SORT)
               - Each stage MUST have a proper type based on the SQL operation:
                 * If SQL contains JOIN/LEFT JOIN/RIGHT JOIN/FULL OUTER JOIN → use type "JOIN"
                 * If SQL contains UNION/UNION ALL → use type "UNION"
                 * If SQL contains WHERE clause → use type "FILTER"
                 * If SQL contains GROUP BY → use type "GROUP"
                 * If SQL selects specific columns (not SELECT *) → use type "SELECT"
                 * If SQL contains ORDER BY → use type "SORT"
                 * If SQL contains aggregate functions without GROUP BY → use type "AGGREGATE"
                 * Only use "CUSTOM" if the SQL doesn't fit any of the above categories
               
               - For each stage, extract and populate the appropriate data fields:
                 * JOIN: joinType (INNER, LEFT, RIGHT, FULL OUTER), leftTable, rightTable, leftKey, rightKey
                 * UNION: unionType (UNION or UNION ALL), tables array
                 * FILTER: table, column, operator (=, !=, >, <, >=, <=, LIKE, IN, NOT IN), value, or conditions array
                 * GROUP: groupBy array, aggregations array with function (SUM, COUNT, AVG, MAX, MIN), column, alias
                 * SELECT: columns array
                 * SORT: orderBy array with column and direction (ASC/DESC)
                 * AGGREGATE: aggregations array with function, column, alias
                 * CUSTOM: sql string
               
               - MANDATORY: You MUST return the transformationStages array. It is a required field in the response schema.
               - Always analyze the SQL structure to determine the correct stage types. DO NOT default to CUSTOM unless truly necessary.
               - Break down complex queries into multiple stages in the correct order (e.g., JOIN first, then GROUP, then SORT).
        `;
        
        const audioPart = {
            inlineData: {
                data: audioBase64,
                mimeType: mimeType
            }
        };
        
        try {
            const result = await model.generateContent([prompt, audioPart]);
            const response = result.response.text();
            const parsedResponse = JSON.parse(response);
            
            // Ensure isValid is set (default to true for backward compatibility, but should always be set)
            if (parsedResponse.isValid === undefined) {
                parsedResponse.isValid = true;
            }
            
            // Extract transcript from explanation (which should start with "User said: ...")
            let transcript = "Voice command processed";
            if (parsedResponse.explanation) {
                const match = parsedResponse.explanation.match(/User said:\s*(.+?)(?:\n|$)/i);
                if (match) {
                    transcript = match[1].trim();
                } else if (parsedResponse.explanation.includes("[No speech detected]")) {
                    transcript = "[No speech detected]";
                } else {
                    // Fallback: use first part of explanation
                    transcript = parsedResponse.explanation.split('.')[0].replace(/^User said:\s*/i, '').trim();
                }
            }
            
            // If audio is invalid, ensure we don't have transformation data
            if (parsedResponse.isValid === false) {
                // Remove transformation-related fields if they exist
                delete parsedResponse.sql;
                delete parsedResponse.transformationStages;
                delete parsedResponse.chartType;
                delete parsedResponse.xAxis;
                delete parsedResponse.yAxis;
                delete parsedResponse.zAxis;
            }
            
            res.json({
                transcript: transcript,
                ...parsedResponse
            });
        } catch (audioError) {
            console.error('Audio processing error:', audioError);
            // Fallback: try to get transcript using a simpler model
            try {
                const fallbackModel = genAIInstance.getGenerativeModel({ 
                    model: "gemini-1.5-flash" 
                });
                const transcriptResult = await fallbackModel.generateContent([
                    "Transcribe this audio to text. Return only the transcribed text, nothing else.",
                    audioPart
                ]);
                const transcript = transcriptResult.response.text();
                res.status(400).json({ 
                    error: "Audio processing failed, but here's the transcript",
                    transcript: transcript,
                    details: audioError.message 
                });
            } catch (fallbackError) {
                res.status(400).json({ 
                    error: "Audio processing not supported. Please ensure you're using a Gemini model that supports audio (gemini-2.0-flash-exp or gemini-1.5-pro).",
                    details: audioError.message 
                });
            }
        }
    } catch (error) {
        console.error('Error processing voice command:', error);
        res.status(500).json({ error: "Voice command processing failed", details: error.message });
    }
});

// Voice chat endpoint with audio input - Send audio directly to Gemini for conversation
app.post('/api/voice/chat-audio', uploadAudio.single('audio'), handleAudioMulterError, async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: "No audio file provided" });
        }

        const { apiKey, history, schema } = req.body;
        
        // Use API key from request body (if provided), fallback to environment variable
        const apiKeyToUse = (apiKey && apiKey.trim()) || process.env.GEMINI_API_KEY;
        
        if (!apiKeyToUse) {
            return res.status(400).json({ 
                error: "API key is required. Please set it in Settings or set GEMINI_API_KEY environment variable in server/.env file." 
            });
        }
        
        // Validate API key format
        if (!validateApiKey(apiKeyToUse)) {
            return res.status(400).json({ 
                error: "Invalid API key format. Please check your API key." 
            });
        }
        
        // Create a new instance with the provided API key
        const genAIInstance = new GoogleGenerativeAI(apiKeyToUse);
        
        // Use Gemini 2.0 with audio support for chat
        const model = genAIInstance.getGenerativeModel({ 
            model: "gemini-2.0-flash-exp", // Gemini 2.0 supports audio
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: SchemaType.OBJECT,
                    properties: {
                        transcript: {
                            type: SchemaType.STRING,
                            description: "The transcribed text of what the user said in the audio"
                        },
                        response: {
                            type: SchemaType.STRING,
                            description: "Your conversational response to the user"
                        },
                        shouldTransform: {
                            type: SchemaType.BOOLEAN,
                            description: "Whether the user wants to proceed with a data transformation. Set to true if the user confirms they want to transform the data, false if they're still discussing or asking questions."
                        }
                    }
                }
            }
        });
        
        // Parse schema and history
        let parsedSchema = [];
        let parsedHistory = [];
        try {
            parsedSchema = schema ? JSON.parse(schema) : [];
            parsedHistory = history ? JSON.parse(history) : [];
        } catch (e) {
            console.warn('Failed to parse schema/history:', e);
        }
        
        // Build conversation context
        const schemaInfo = parsedSchema.length > 0 
            ? `Current Table Schema (DuckDB):\n${JSON.stringify(parsedSchema)}`
            : "No tables are currently loaded.";
        
        // Build conversation history
        let conversationHistory = '';
        if (parsedHistory && Array.isArray(parsedHistory) && parsedHistory.length > 0) {
            conversationHistory = '\n\nPrevious conversation:\n' + 
                parsedHistory.map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`).join('\n');
        }
        
        // Convert audio buffer to base64
        const audioBase64 = req.file.buffer.toString('base64');
        const mimeType = req.file.mimetype || 'audio/webm';
        
        const prompt = `You are a helpful AI assistant helping a user transform their dataset using natural language.

${schemaInfo}${conversationHistory}

The user is speaking to you via voice. Listen to their audio message and respond appropriately.

CRITICAL VALIDATION - CHECK THESE FIRST:

A. If the audio is EMPTY (silence, no words, no speech detected):
   - Set transcript to "[No speech detected]"
   - Set response to: "No speech was detected in the audio. Please speak clearly about your data transformation needs."
   - Set shouldTransform to false

B. If the audio is MUSIC, background noise, or UNRELATED content:
   - Transcribe what you heard (e.g., "Music playing", "Background noise")
   - Set response to: "The audio appears to be [music/unrelated content], not a message about data transformation. Please provide a clear voice message about how you want to transform your data."
   - Set shouldTransform to false

C. If the audio contains valid speech about data transformation:
   - Transcribe the user's words in the transcript field
   - Respond conversationally in the response field
   - Set shouldTransform based on whether the user wants to proceed with transformation

Your role:
1. Check if the audio is EMPTY (silence, no speech detected)
2. Check if the audio is MUSIC or UNRELATED content (not about data transformation)
3. If empty: transcribe as "[No speech detected]" and politely explain no speech was heard. Set shouldTransform to false.
4. If music or unrelated: transcribe what you heard and politely explain it's not related to data transformation. Set shouldTransform to false.
5. If valid speech about data transformation: proceed with normal conversation.

Your role:
1. First, transcribe what the user said in the "transcript" field.
2. If the user is asking questions about the data or transformation, answer helpfully.
3. If the user needs clarification about what transformation they want, ask specific questions.
4. If the user has provided enough information to perform a transformation, confirm what you understand and indicate that you're ready to proceed.

IMPORTANT: Only set "shouldTransform" to true if the user has clearly indicated they want to proceed with a transformation and you have enough information. Otherwise, set it to false and continue the conversation.

Respond naturally and conversationally.`;

        const audioPart = {
            inlineData: {
                data: audioBase64,
                mimeType: mimeType
            }
        };
        
        try {
            const result = await model.generateContent([prompt, audioPart]);
            const response = result.response.text();
            const parsedResponse = JSON.parse(response);
            
            res.json(parsedResponse);
        } catch (audioError) {
            console.error('Audio chat processing error:', audioError);
            // Fallback: try to get transcript using a simpler model
            try {
                const fallbackModel = genAIInstance.getGenerativeModel({ 
                    model: "gemini-1.5-flash" 
                });
                const transcriptResult = await fallbackModel.generateContent([
                    "Transcribe this audio to text. Return only the transcribed text, nothing else.",
                    audioPart
                ]);
                const transcript = transcriptResult.response.text();
                res.status(400).json({ 
                    error: "Audio processing failed, but here's the transcript",
                    transcript: transcript,
                    response: "I had trouble processing your audio. Could you please try again or type your message?",
                    shouldTransform: false,
                    details: audioError.message 
                });
            } catch (fallbackError) {
                res.status(400).json({ 
                    error: "Audio processing not supported. Please ensure you're using a Gemini model that supports audio (gemini-2.0-flash-exp or gemini-1.5-pro).",
                    details: audioError.message 
                });
            }
        }
    } catch (error) {
        console.error('Error in voice chat:', error);
        res.status(500).json({ error: "Chat failed", details: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Test endpoint to verify voice routes are registered
app.get('/api/voice/test', (req, res) => {
    res.json({ 
        status: 'ok', 
        message: 'Voice endpoints are registered',
        endpoints: [
            'POST /api/voice/command',
            'POST /api/voice/chat-audio'
        ]
    });
});

// 404 handler - return JSON instead of HTML
app.use((req, res) => {
    res.status(404).json({ 
        error: "Endpoint not found", 
        path: req.path,
        method: req.method 
    });
});

// Global error handler - ensure we always return JSON
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(err.status || 500).json({ 
        error: err.message || "Internal server error",
        details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Voice endpoints available:`);
    console.log(`  POST /api/voice/command`);
    console.log(`  POST /api/voice/chat-audio`);
    if (!process.env.GEMINI_API_KEY) {
        console.warn('⚠️  WARNING: GEMINI_API_KEY not set. Please create a .env file in the server directory.');
    }
});
