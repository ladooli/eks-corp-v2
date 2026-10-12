const express = require('express');
const { Pool } = require('pg');
const app = express();
app.use(express.json());

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3000';
const pool = new Pool({
  host: process.env.DB_HOST || 'storage-db',
  port: 5432,
  database: process.env.DB_NAME || 'storagedb',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
});

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log('Storage DB ready');
  } catch (err) { setTimeout(initDB, 3000); }
}
initDB();

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', service: 'storage' });
});

app.get('/health', async (req, res) => {
  try {
    const authRes = await fetch(`${AUTH_URL}/verify`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({token: 'test'})
    });
    const auth = await authRes.json();
    res.json({ status: 'ok', service: 'storage', auth });
  } catch (err) { res.status(500).json({ status: 'error', error: err.message }); }
});

app.get('/files', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files');
    res.json(result.rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(3000, () => console.log('Storage service on port 3000'));