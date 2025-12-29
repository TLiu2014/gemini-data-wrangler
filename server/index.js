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
        explanation: { type: SchemaType.STRING, description: "Brief explanation of what this query does" }
    },
    required: ["sql", "chartType", "explanation"]
};

app.post('/api/transform', async (req, res) => {
    try {
        const { schema, userPrompt, history, apiKey } = req.body;
        
        // Use API key from request body, fallback to environment variable
        const apiKeyToUse = apiKey || process.env.GEMINI_API_KEY;
        
        if (!apiKeyToUse) {
            return res.status(400).json({ error: "API key is required. Please provide it in the request or set GEMINI_API_KEY environment variable." });
        }
        
        // Create a new instance with the provided API key
        const genAIInstance = new GoogleGenerativeAI(apiKeyToUse);
        
        // Use the latest model available in your AI Studio
        const model = genAIInstance.getGenerativeModel({ 
            model: "gemini-1.5-flash", // Or "gemini-3-flash-preview" if available
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: responseSchema
            }
        });
        
        const prompt = `
            You are a Data Engineer Expert.
            
            Current Table Schema (DuckDB):
            ${JSON.stringify(schema)}

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
        `;

        const result = await model.generateContent(prompt);
        const response = result.response.text();
        
        res.json(JSON.parse(response));
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
