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
        chartType: { type: SchemaType.STRING, description: "One of: 'bar', 'line', 'area', 'scatter', 'none'" },
        xAxis: { type: SchemaType.STRING, description: "The column name for the X axis" },
        yAxis: { type: SchemaType.STRING, description: "The column name for the Y axis" },
        explanation: { type: SchemaType.STRING, description: "Brief explanation of what this query does" }
    },
    required: ["sql", "chartType", "explanation"]
};

app.post('/api/transform', async (req, res) => {
    try {
        const { schema, userPrompt, history } = req.body;
        
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: "GEMINI_API_KEY not configured" });
        }
        
        // Use the latest model available in your AI Studio
        const model = genAI.getGenerativeModel({ 
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
            3. Suggest a chart type (bar/line/area) that best visualizes the result.
            4. If the result is just a table (like a raw list), set chartType to 'none'.
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
