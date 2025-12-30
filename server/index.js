// server/index.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// Define the response schema we want Gemini to strictly follow
const responseSchema = {
    type: SchemaType.OBJECT,
    properties: {
        sql: { type: SchemaType.STRING, description: "The DuckDB SQL query to execute" },
        chartType: { type: SchemaType.STRING, description: "One of: 'bar', 'line', 'area', 'scatter', 'd3-scatter', 'd3-line', 'd3-bar', '3d-scatter', '3d-surface', 'none'" },
        zAxis: { type: SchemaType.STRING, description: "Optional: The column name for the Z axis (for 3D charts)" },
        xAxis: { type: SchemaType.STRING, description: "The column name for the X axis" },
        yAxis: { type: SchemaType.STRING, description: "The column name for the Y axis" },
        explanation: { type: SchemaType.STRING, description: "Brief explanation of what this query does" },
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
                        description: "Clear description of what this transformation stage does" 
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
        }
    },
    required: ["sql", "chartType", "explanation", "transformationStages"]
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
        
        // Create a new instance with the provided API key
        const genAIInstance = new GoogleGenerativeAI(apiKeyToUse);
        
        // Use gemini-pro (most widely available model)
        // Alternative models: gemini-1.5-pro, gemini-1.5-flash-latest
        const model = genAIInstance.getGenerativeModel({ 
            // model: "gemini-2.5-flash",
            model: "gemini-3-flash-preview",
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
               
               - Example: If SQL is "SELECT c.region, SUM(o.amount) AS total_sales FROM table_orders_csv o JOIN table_customers_csv c ON o.customer_id = c.customer_id GROUP BY c.region ORDER BY total_sales DESC"
                 → Return 3 stages: [
                     {"type": "JOIN", "description": "Join orders with customers", "data": {"joinType": "INNER", "leftTable": "table_orders_csv", "rightTable": "table_customers_csv", "leftKey": "customer_id", "rightKey": "customer_id"}},
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
        
        // Log the response for debugging
        console.log('Gemini response:', JSON.stringify(parsedResponse, null, 2));
        
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

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY) {
        console.warn('⚠️  WARNING: GEMINI_API_KEY not set. Please create a .env file in the server directory.');
    }
});
