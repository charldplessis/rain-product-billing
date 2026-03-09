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

async function ensureTagTypes(conn) {
  const tagCache = {};
  const [ttRows] = await conn.query('SELECT id, name FROM tag_types');
  for (const tt of ttRows) {
    const [tagRows] = await conn.query('SELECT id, name FROM tags WHERE tag_type_id=?', [tt.id]);
    tagCache[tt.name] = {};
    for (const t of tagRows) tagCache[tt.name][t.name] = t.id;
  }
  return tagCache;
}

async function resolveTagId(conn, tagCache, typeName, tagName) {
  if (!tagCache[typeName]) {
    const [r] = await conn.query('INSERT INTO tag_types (name) VALUES (?)', [typeName]);
    tagCache[typeName] = {};
    console.log(`  + Tag type: ${typeName}`);
    // update id reference
    tagCache[typeName].__typeId = r.insertId;
  }
  if (!tagCache[typeName][tagName]) {
    let typeId = tagCache[typeName].__typeId;
    if (!typeId) {
      const [[tt]] = await conn.query('SELECT id FROM tag_types WHERE name=?', [typeName]);
      typeId = tt.id;
      tagCache[typeName].__typeId = typeId;
    }
    const [r] = await conn.query('INSERT IGNORE INTO tags (tag_type_id, name) VALUES (?,?)', [typeId, tagName]);
    if (r.insertId) {
      tagCache[typeName][tagName] = r.insertId;
    } else {
      const [[t]] = await conn.query('SELECT id FROM tags WHERE tag_type_id=? AND name=?', [typeId, tagName]);
      tagCache[typeName][tagName] = t.id;
    }
    console.log(`  + Tag: ${typeName} / ${tagName}`);
  }
  return tagCache[typeName][tagName];
}

async function seed() {
  const wb = xlsx.readFile(path.join(__dirname, '..', 'PROD_MASTER.xlsx'));
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = xlsx.utils.sheet_to_json(ws, { header: 1 });

  const conn = await pool.getConnection();
  let count = 0;
  try {
    // Clear existing data to re-seed cleanly
    await conn.query('DELETE FROM product_tags');
    await conn.query('DELETE FROM products');
    await conn.query('DELETE FROM categories');
    console.log('Cleared existing products and categories.');

    const tagCache = await ensureTagTypes(conn);

    for (let i = 1; i < data.length; i++) {
      const [catName, prodName, desc, exclVat, inclVat, salesChannelRaw, stateRaw] = data[i];
      if (!catName || !prodName) continue;

      let [[cat]] = await conn.query('SELECT id FROM categories WHERE name=?', [catName]);
      if (!cat) {
        const [r] = await conn.query('INSERT INTO categories (name) VALUES (?)', [catName]);
        cat = { id: r.insertId };
        console.log(`  + Category: ${catName}`);
      }

      const [prodResult] = await conn.query(
        'INSERT INTO products (category_id, name, description, excl_vat, incl_vat) VALUES (?,?,?,?,?)',
        [cat.id, prodName, desc || '', exclVat || 0, inclVat || 0]
      );
      const productId = prodResult.insertId;

      // Resolve and attach tags
      const tagIds = [];
      if (salesChannelRaw) {
        for (const ch of String(salesChannelRaw).split(',').map(s => s.trim()).filter(Boolean)) {
          tagIds.push(await resolveTagId(conn, tagCache, 'Sales Channel', ch));
        }
      }
      if (stateRaw) {
        tagIds.push(await resolveTagId(conn, tagCache, 'Active State', String(stateRaw).trim()));
      }
      if (tagIds.length > 0) {
        const values = tagIds.map(tid => [productId, tid]);
        await conn.query('INSERT IGNORE INTO product_tags (product_id, tag_id) VALUES ?', [values]);
      }

      count++;
    }
    console.log(`\nSeeded ${count} products successfully.`);
  } finally {
    conn.release();
    await pool.end();
  }
}

seed().catch(err => { console.error(err); process.exit(1); });
