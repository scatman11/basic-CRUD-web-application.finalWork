const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const db = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: false }));

// quick health check
app.get('/ping', (req, res) => res.send('pong'));

// optional test page
app.get('/test-home', (req, res) => {
  res.send(`<!doctype html>
    <html><head><meta charset="utf-8"><title>TEST</title></head>
    <body>
      <h1>TEST HOME</h1>
      <p>If you see this, Express is sending HTML just fine.</p>
    </body></html>`);
});

// New customer form
app.get('/new', (req, res) => res.render('new'));

// Create
app.post('/create', (req, res) => {
  const { name, email, company } = req.body;

  if (!name || name.trim() === '') {
    return res.status(400).send('Name is required.');
  }

  db.run(
    'INSERT INTO customers (name, email, company) VALUES (?, ?, ?)',
    [name.trim(), email || null, company || null],
    function (err) {
      if (err) {
        console.error('DB insert error:', err);
        return res.status(500).send('Database error.');
      }
      res.redirect('/');
    }
  );
});

// Edit form
app.get('/edit/:id', (req, res) => {
  const id = req.params.id;
  db.get('SELECT * FROM customers WHERE id = ?', [id], (err, row) => {
    if (err) {
      console.error('DB get error:', err);
      return res.status(500).send('Database error.');
    }
    if (!row) return res.status(404).send('Customer not found.');
    res.render('edit', { customer: row });
  });
});

// Update
app.post('/update/:id', (req, res) => {
  const { name, email, company } = req.body;
  const id = req.params.id;

  if (!name || name.trim() === '') {
    return res.status(400).send('Name is required.');
  }

  db.run(
    'UPDATE customers SET name = ?, email = ?, company = ? WHERE id = ?',
    [name.trim(), email || null, company || null, id],
    function (err) {
      if (err) {
        console.error('DB update error:', err);
        return res.status(500).send('Database error.');
      }
      res.redirect('/');
    }
  );
});

// Delete single
app.post('/delete/:id', (req, res) => {
  db.run('DELETE FROM customers WHERE id = ?', [req.params.id], function (err) {
    if (err) {
      console.error('DB delete error:', err);
      return res.status(500).send('Database error.');
    }
    res.redirect('/');
  });
});

// Bulk delete route 
app.post('/delete-multiple', (req, res) => {
  // req.body.ids may be undefined, a string, or an array
  let ids = req.body && (req.body.ids || req.body['ids[]']);
  if (!ids) {
    return res.redirect('/');
  }

  // normalize to array
  if (!Array.isArray(ids)) ids = [ids];

  // convert to integers
  ids = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
  if (!ids.length) return res.redirect('/');

  const placeholders = ids.map(() => '?').join(',');
  const sql = `DELETE FROM customers WHERE id IN (${placeholders})`;

  db.run(sql, ids, function(err) {
    if (err) {
      console.error('Bulk delete error:', err);
      return res.status(500).send('Database error while deleting.');
    }
    res.redirect('/');
  });
});

// SEARCH + PAGINATION + SORTING route
app.get('/', (req, res) => {
  console.log('GET / - received (search + pagination + sort)');

  const requestedPage = Math.max(1, parseInt(req.query.page, 10) || 1);
  const requestedPageSize = Math.max(1, parseInt(req.query.pageSize, 10) || 5);
  const q = typeof req.query.q === 'string' && req.query.q.trim() !== '' ? req.query.q.trim() : '';
  const sort = typeof req.query.sort === 'string' && req.query.sort.trim() !== '' ? req.query.sort.trim() : 'id_desc';

  // safe sort mapping
  const sortMap = {
    'id_desc': 'id DESC',
    'id_asc': 'id ASC',
    'name_asc': 'name COLLATE NOCASE ASC',
    'name_desc': 'name COLLATE NOCASE DESC',
    'company_asc': 'company COLLATE NOCASE ASC',
    'company_desc': 'company COLLATE NOCASE DESC',
    'created_asc': 'created_at ASC',
    'created_desc': 'created_at DESC'
  };
  const orderBy = sortMap[sort] || sortMap['id_desc'];

  // COUNT query
  let countSql = 'SELECT COUNT(*) AS count FROM customers';
  const countParams = [];
  if (q) {
    countSql += ' WHERE name LIKE ? OR company LIKE ? OR email LIKE ?';
    const like = `%${q}%`;
    countParams.push(like, like, like);
  }

  db.get(countSql, countParams, (cntErr, cntRow) => {
    if (cntErr) {
      console.error('DB count error:', cntErr);
      return res.status(500).send('Database error.');
    }

    const total = cntRow ? cntRow.count : 0;
    const totalPages = Math.max(1, Math.ceil(total / requestedPageSize));
    const page = Math.min(requestedPage, totalPages);
    const pageSize = requestedPageSize;
    const offset = (page - 1) * pageSize;

    console.log(`q="${q}", sort="${sort}", total=${total}, page=${page}/${totalPages}, pageSize=${pageSize}`);

    // SELECT with optional WHERE, safe ORDER BY
    let selectSql = 'SELECT * FROM customers';
    const selectParams = [];
    if (q) {
      selectSql += ' WHERE name LIKE ? OR company LIKE ? OR email LIKE ?';
      const like = `%${q}%`;
      selectParams.push(like, like, like);
    }

    selectSql += ` ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    selectParams.push(pageSize, offset);

    db.all(selectSql, selectParams, (err, rows) => {
      if (err) {
        console.error('DB select error:', err);
        return res.status(500).send('Database error.');
      }

      try {
        res.render('index', {
          customers: rows || [],
          page,
          pageSize,
          totalPages,
          total,
          q,
          sort
        });
      } catch (renderErr) {
        console.error('Render error:', renderErr);
        res.status(500).send('Render error.');
      }
    });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`App running on http://localhost:${PORT}`));
