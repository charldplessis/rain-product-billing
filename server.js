require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const multer = require('multer');
const xlsx = require('xlsx');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DB connection pool
const pool = mysql.createPool({
  host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
  port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
  user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
  password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
  database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'rain_billing',
  waitForConnections: true,
  connectionLimit: 10,
});

// Init DB tables
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        excl_vat DECIMAL(10,2) DEFAULT 0,
        incl_vat DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tag_types (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        sort_order INT DEFAULT 0
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tag_type_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        sort_order INT DEFAULT 0,
        FOREIGN KEY (tag_type_id) REFERENCES tag_types(id) ON DELETE CASCADE,
        UNIQUE KEY unique_tag (tag_type_id, name)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS product_tags (
        product_id INT NOT NULL,
        tag_id INT NOT NULL,
        PRIMARY KEY (product_id, tag_id),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
      )
    `);

    // Seed default tag types and tags
    const [ttRows] = await conn.query('SELECT COUNT(*) as cnt FROM tag_types');
    if (ttRows[0].cnt === 0) {
      await conn.query(`INSERT INTO tag_types (name, sort_order) VALUES ('Sales Channel', 1), ('Active State', 2)`);
      const [[chRow]] = await conn.query("SELECT id FROM tag_types WHERE name = 'Sales Channel'");
      const [[stRow]] = await conn.query("SELECT id FROM tag_types WHERE name = 'Active State'");
      await conn.query(`INSERT INTO tags (tag_type_id, name, sort_order) VALUES
        (?, 'Web', 1), (?, 'rainGo', 2), (?, 'Shop', 3), (?, 'Internal/Staff', 4), (?, 'Sales/Outbound', 5)`,
        [chRow.id, chRow.id, chRow.id, chRow.id, chRow.id]);
      await conn.query(`INSERT INTO tags (tag_type_id, name, sort_order) VALUES (?, 'Being Sold', 1), (?, 'Past Item', 2)`,
        [stRow.id, stRow.id]);
    }

    console.log('Database initialized');
  } finally {
    conn.release();
  }
}

// ── Categories ──────────────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM categories ORDER BY name');
  res.json(rows);
});

app.post('/api/categories', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const [result] = await pool.query('INSERT INTO categories (name) VALUES (?)', [name]);
  res.json({ id: result.insertId, name });
});

app.put('/api/categories/:id', async (req, res) => {
  const { name } = req.body;
  await pool.query('UPDATE categories SET name=? WHERE id=?', [name, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/categories/:id', async (req, res) => {
  await pool.query('DELETE FROM categories WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// ── Products ─────────────────────────────────────────────────
app.get('/api/products', async (req, res) => {
  const { category_id } = req.query;
  let query = `
    SELECT p.*, c.name as category_name
    FROM products p JOIN categories c ON p.category_id = c.id
  `;
  const params = [];
  if (category_id) {
    query += ' WHERE p.category_id = ?';
    params.push(category_id);
  }
  query += ' ORDER BY p.name';
  const [rows] = await pool.query(query, params);
  res.json(rows);
});

app.get('/api/products/:id', async (req, res) => {
  const [[product]] = await pool.query(`
    SELECT p.*, c.name as category_name
    FROM products p JOIN categories c ON p.category_id = c.id
    WHERE p.id = ?`, [req.params.id]);
  if (!product) return res.status(404).json({ error: 'Not found' });

  const [tags] = await pool.query(`
    SELECT t.id, t.name, tt.name as type_name, tt.id as type_id
    FROM product_tags pt
    JOIN tags t ON pt.tag_id = t.id
    JOIN tag_types tt ON t.tag_type_id = tt.id
    WHERE pt.product_id = ?
    ORDER BY tt.sort_order, t.sort_order`, [req.params.id]);

  product.tags = tags;
  res.json(product);
});

app.post('/api/products', async (req, res) => {
  const { category_id, name, description, excl_vat, incl_vat } = req.body;
  if (!category_id || !name) return res.status(400).json({ error: 'category_id and name required' });
  const [result] = await pool.query(
    'INSERT INTO products (category_id, name, description, excl_vat, incl_vat) VALUES (?,?,?,?,?)',
    [category_id, name, description || '', excl_vat || 0, incl_vat || 0]
  );
  res.json({ id: result.insertId });
});

app.put('/api/products/:id', async (req, res) => {
  const { category_id, name, description, excl_vat, incl_vat } = req.body;
  await pool.query(
    'UPDATE products SET category_id=?, name=?, description=?, excl_vat=?, incl_vat=? WHERE id=?',
    [category_id, name, description, excl_vat, incl_vat, req.params.id]
  );
  res.json({ success: true });
});

app.delete('/api/products/:id', async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// ── Tags ─────────────────────────────────────────────────────
app.get('/api/tag-types', async (req, res) => {
  const [types] = await pool.query('SELECT * FROM tag_types ORDER BY sort_order');
  for (const t of types) {
    const [tags] = await pool.query('SELECT * FROM tags WHERE tag_type_id=? ORDER BY sort_order', [t.id]);
    t.tags = tags;
  }
  res.json(types);
});

app.post('/api/tag-types', async (req, res) => {
  const { name } = req.body;
  const [result] = await pool.query('INSERT INTO tag_types (name) VALUES (?)', [name]);
  res.json({ id: result.insertId, name });
});

app.post('/api/tags', async (req, res) => {
  const { tag_type_id, name } = req.body;
  const [result] = await pool.query('INSERT INTO tags (tag_type_id, name) VALUES (?,?)', [tag_type_id, name]);
  res.json({ id: result.insertId, name });
});

app.delete('/api/tags/:id', async (req, res) => {
  await pool.query('DELETE FROM tags WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

// Product tags
app.get('/api/products/:id/tags', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT tag_id FROM product_tags WHERE product_id=?', [req.params.id]);
  res.json(rows.map(r => r.tag_id));
});

app.post('/api/products/:id/tags', async (req, res) => {
  const { tag_ids } = req.body; // array of tag ids
  const productId = req.params.id;
  await pool.query('DELETE FROM product_tags WHERE product_id=?', [productId]);
  if (tag_ids && tag_ids.length > 0) {
    const values = tag_ids.map(tid => [productId, tid]);
    await pool.query('INSERT INTO product_tags (product_id, tag_id) VALUES ?', [values]);
  }
  res.json({ success: true });
});

// ── Import XLSX ───────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage() });

app.post('/api/import', upload.single('file'), async (req, res) => {
  try {
    const wb = xlsx.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

    const conn = await pool.getConnection();
    let imported = 0;
    try {
      for (let i = 1; i < data.length; i++) {
        const [catName, prodName, desc, exclVat, inclVat] = data[i];
        if (!catName || !prodName) continue;

        let [[cat]] = await conn.query('SELECT id FROM categories WHERE name=?', [catName]);
        if (!cat) {
          const [r] = await conn.query('INSERT INTO categories (name) VALUES (?)', [catName]);
          cat = { id: r.insertId };
        }

        await conn.query(
          'INSERT INTO products (category_id, name, description, excl_vat, incl_vat) VALUES (?,?,?,?,?)',
          [cat.id, prodName, desc || '', exclVat || 0, inclVat || 0]
        );
        imported++;
      }
    } finally {
      conn.release();
    }
    res.json({ success: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────
initDB().then(() => {
  app.listen(PORT, () => console.log(`rain Product Billing running on port ${PORT}`));
}).catch(err => {
  console.error('DB init failed:', err);
  process.exit(1);
});
