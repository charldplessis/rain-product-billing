// Run: node scripts/seed.js
// Seeds the database from PROD_MASTER.xlsx
require('dotenv').config();
const mysql = require('mysql2/promise');
const xlsx = require('xlsx');
const path = require('path');

const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'rain_billing',
});

async function seed() {
  const wb = xlsx.readFile(path.join(__dirname, '..', 'PROD_MASTER.xlsx'));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

  const conn = await pool.getConnection();
  let count = 0;
  try {
    for (let i = 1; i < data.length; i++) {
      const [catName, prodName, desc, exclVat, inclVat] = data[i];
      if (!catName || !prodName) continue;

      let [[cat]] = await conn.query('SELECT id FROM categories WHERE name=?', [catName]);
      if (!cat) {
        const [r] = await conn.query('INSERT INTO categories (name) VALUES (?)', [catName]);
        cat = { id: r.insertId };
        console.log(`  + Category: ${catName}`);
      }

      await conn.query(
        'INSERT INTO products (category_id, name, description, excl_vat, incl_vat) VALUES (?,?,?,?,?)',
        [cat.id, prodName, desc || '', exclVat || 0, inclVat || 0]
      );
      count++;
    }
    console.log(`\nSeeded ${count} products successfully.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
