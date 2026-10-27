const express = require('express');
const fs = require('fs');
const { Pool } = require('pg');
const { Signer } = require('@aws-sdk/rds-signer');

const app = express();
app.use(express.json());

const AUTH_URL = process.env.AUTH_SERVICE_URL || 'http://auth-service:3000';

// Database settings
const DB_HOST = process.env.DB_HOST || 'storage-db';
const DB_PORT = 5432;
const DB_NAME = process.env.DB_NAME || 'storagedb';
const DB_USER = process.env.DB_USER || 'postgres';
const USE_IAM_AUTH = process.env.DB_IAM_AUTH === 'true';

let password = process.env.DB_PASSWORD;
let ssl = false;

if (USE_IAM_AUTH) {
  const signer = new Signer({
    hostname: DB_HOST,
    port: DB_PORT,
    username: DB_USER,
    region: process.env.AWS_REGION
  });

  // pg calls this for every new connection -> always a fresh 15-minute token
  password = () => signer.getAuthToken();

  ssl = {
    rejectUnauthorized: true,
    ca: fs.readFileSync('/app/certs/rds-global-bundle.pem').toString()
  };
}

const pool = new Pool({
  host: DB_HOST,
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password,
  ssl
});

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS files (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    )`);
    console.log(`Storage DB ready (host: ${DB_HOST}, IAM auth: ${USE_IAM_AUTH})`);
  } catch (err) {
    console.error('DB init failed, retrying in 3s:', err.message);
    setTimeout(initDB, 3000);
  }
}
initDB();

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok', service: 'storage' });
});

app.get('/health', async (req, res) => {
  try {
    const authRes = await fetch(`${AUTH_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test' })
    });
    const auth = await authRes.json();
    res.json({ status: 'ok', service: 'storage', auth });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

app.get('/files', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM files');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(3000, () => console.log('Storage service on port 3000'));