
// Main server file for the Integrated Management System (Vercel-ready).
require('dotenv').config();

const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;

app.set('trust proxy', 1);

const db = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'integrated_management_system',
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true,
    ssl: process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : undefined
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(cookieSession({
    name: 'ims_session',
    keys: [process.env.SESSION_SECRET || 'student-project-secret-change-me'],
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: 8 * 60 * 60 * 1000
}));

app.use(express.static(path.join(__dirname, 'public')));

const h = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: 'Please sign in first.'
        });
    }
    next();
}

function requireOwner(req, res, next) {
    if (!req.session || !req.session.user ||
        req.session.user.role !== 'Owner') {
        return res.status(403).json({
            message: 'Only the Owner can access this page.'
        });
    }
    next();
}

// FIXED: Use action and details, matching the actual TiDB table.
async function logActivity(userId, message) {
    await db.execute(
        `INSERT INTO activity_logs
        (user_id, action, details)
        VALUES (?, ?, ?)`,
        [userId || null, message, null]
    );
}

// SIGN UP
// The first registered account becomes the Owner.
app.post('/api/auth/signup', h(async (req, res) => {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
        return res.status(400).json({
            message: 'Please complete all fields.'
        });
    }

    if (password.length < 6) {
        return res.status(400).json({
            message: 'Password must be at least 6 characters.'
        });
    }

    const cleanEmail = email.trim().toLowerCase();

    const [existing] = await db.execute(
        'SELECT id FROM users WHERE email = ?',
        [cleanEmail]
    );

    if (existing.length) {
        return res.status(409).json({
            message: 'That email is already registered.'
        });
    }

    const [countRows] = await db.execute(
        'SELECT COUNT(*) AS total FROM users'
    );

    const role = Number(countRows[0].total) === 0
        ? 'Owner'
        : 'Staff';

    const hashedPassword = await bcrypt.hash(password, 10);

    const [result] = await db.execute(
        `INSERT INTO users
        (full_name, email, password, role)
        VALUES (?, ?, ?, ?)`,
        [fullName.trim(), cleanEmail, hashedPassword, role]
    );

    req.session.user = {
        id: result.insertId,
        fullName: fullName.trim(),
        email: cleanEmail,
        role
    };

    await logActivity(result.insertId, 'Created an account');

    res.status(201).json({
        message: `Account created. Your role is ${role}.`,
        user: req.session.user
    });
}));

// LOGIN
app.post('/api/auth/login', h(async (req, res) => {
    const { email, password } = req.body;

    const [rows] = await db.execute(
        'SELECT * FROM users WHERE email = ?',
        [(email || '').trim().toLowerCase()]
    );

    if (!rows.length) {
        return res.status(401).json({
            message: 'Incorrect email or password.'
        });
    }

    const validPassword = await bcrypt.compare(
        password || '',
        rows[0].password
    );

    if (!validPassword) {
        return res.status(401).json({
            message: 'Incorrect email or password.'
        });
    }

    req.session.user = {
        id: rows[0].id,
        fullName: rows[0].full_name,
        email: rows[0].email,
        role: rows[0].role
    };

    await logActivity(rows[0].id, 'Signed in');

    res.json({
        message: 'Welcome back!',
        user: req.session.user
    });
}));

// LOGOUT
app.post('/api/auth/logout', requireLogin, h(async (req, res) => {
    await logActivity(req.session.user.id, 'Signed out');

    req.session = null;

    res.json({
        message: 'Signed out successfully.'
    });
}));

app.get('/api/auth/me', (req, res) => {
    res.json({
        user: (req.session && req.session.user) || null
    });
});

// DATABASE HEALTH CHECK
app.get('/api/health', h(async (req, res) => {
    await db.query('SELECT 1');

    res.json({
        status: 'ok',
        database: 'connected'
    });
}));

// DASHBOARD SUMMARY
app.get('/api/dashboard', requireLogin, h(async (req, res) => {
    const [[booking]] = await db.execute(
        "SELECT COUNT(*) AS total FROM reservations WHERE status = 'Confirmed'"
    );

    const [[sales]] = await db.execute(
        'SELECT COALESCE(SUM(total_amount), 0) AS total FROM sales WHERE DATE(created_at) = CURDATE()'
    );

    const [[stock]] = await db.execute(
        'SELECT COUNT(*) AS total FROM inventory'
    );

    const [[low]] = await db.execute(
        'SELECT COUNT(*) AS total FROM inventory WHERE quantity <= low_stock_level'
    );

    // FIXED: action is the actual database column.
    const [activities] = await db.execute(
        `SELECT action AS activity, created_at
         FROM activity_logs
         ORDER BY id DESC
         LIMIT 8`
    );

    res.json({
        reservations: booking.total,
        salesToday: sales.total,
        inventoryItems: stock.total,
        lowStock: low.total,
        activities
    });
}));

// ==========================================
// RESERVATIONS
// ==========================================

app.get('/api/reservations', requireLogin, h(async (req, res) => {
    const [rows] = await db.execute(
        'SELECT * FROM reservations ORDER BY booking_date DESC, booking_time DESC'
    );

    res.json(rows);
}));

app.post('/api/reservations', requireLogin, h(async (req, res) => {
    const {
        customerName,
        bookingDate,
        bookingTime,
        guestCount,
        depositAmount,
        paymentStatus
    } = req.body;

    if (!customerName || !bookingDate || !bookingTime ||
        Number(guestCount) < 1) {
        return res.status(400).json({
            message: 'Please complete the reservation details.'
        });
    }

    const [conflicts] = await db.execute(
        `SELECT id FROM reservations
         WHERE booking_date = ?
         AND booking_time = ?
         AND status = 'Confirmed'`,
        [bookingDate, bookingTime]
    );

    if (conflicts.length) {
        return res.status(409).json({
            message: 'That date and time are already booked. Please choose another slot.'
        });
    }

    const [result] = await db.execute(
        `INSERT INTO reservations
        (customer_name, booking_date, booking_time, guest_count,
         deposit_amount, payment_status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            customerName.trim(),
            bookingDate,
            bookingTime,
            Number(guestCount),
            Number(depositAmount || 0),
            paymentStatus || 'Unpaid',
            req.session.user.id
        ]
    );

    await logActivity(
        req.session.user.id,
        `Added reservation #${result.insertId}`
    );

    res.status(201).json({
        message: 'Reservation added.'
    });
}));

app.put('/api/reservations/:id', requireLogin, h(async (req, res) => {
    const {
        customerName,
        bookingDate,
        bookingTime,
        guestCount,
        depositAmount,
        paymentStatus
    } = req.body;

    const [conflicts] = await db.execute(
        `SELECT id FROM reservations
         WHERE booking_date = ?
         AND booking_time = ?
         AND status = 'Confirmed'
         AND id <> ?`,
        [bookingDate, bookingTime, req.params.id]
    );

    if (conflicts.length) {
        return res.status(409).json({
            message: 'That date and time are already booked.'
        });
    }

    await db.execute(
        `UPDATE reservations
         SET customer_name = ?,
             booking_date = ?,
             booking_time = ?,
             guest_count = ?,
             deposit_amount = ?,
             payment_status = ?
         WHERE id = ?`,
        [
            customerName,
            bookingDate,
            bookingTime,
            Number(guestCount),
            Number(depositAmount || 0),
            paymentStatus,
            req.params.id
        ]
    );

    await logActivity(
        req.session.user.id,
        `Updated reservation #${req.params.id}`
    );

    res.json({
        message: 'Reservation updated.'
    });
}));

app.patch('/api/reservations/:id/cancel', requireLogin, h(async (req, res) => {
    await db.execute(
        "UPDATE reservations SET status = 'Cancelled' WHERE id = ?",
        [req.params.id]
    );

    await logActivity(
        req.session.user.id,
        `Cancelled reservation #${req.params.id}`
    );

    res.json({
        message: 'Reservation cancelled.'
    });
}));

// ==========================================
// INVENTORY
// ==========================================

app.get('/api/inventory', requireLogin, h(async (req, res) => {
    const [rows] = await db.execute(
        'SELECT * FROM inventory ORDER BY item_name'
    );

    res.json(rows);
}));

app.post('/api/inventory', requireLogin, h(async (req, res) => {
    const { itemName, quantity, lowStockLevel } = req.body;

    const qty = Number(quantity);
    const lowLevel = Number(lowStockLevel);

    if (
        !String(itemName || '').trim() ||
        !Number.isInteger(qty) ||
        qty < 0 ||
        !Number.isInteger(lowLevel) ||
        lowLevel < 0
    ) {
        return res.status(400).json({
            message: 'Enter an item name and valid whole-number quantities (0 or higher).'
        });
    }

    try {
        await db.execute(
            `INSERT INTO inventory
            (item_name, quantity, low_stock_level)
            VALUES (?, ?, ?)`,
            [itemName.trim(), qty, lowLevel]
        );
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({
                message: 'That inventory item already exists.'
            });
        }

        throw error;
    }

    await logActivity(
        req.session.user.id,
        `Added inventory item: ${itemName.trim()}`
    );

    res.status(201).json({
        message: 'Inventory item added.'
    });
}));

app.put('/api/inventory/:id', requireLogin, h(async (req, res) => {
    const { itemName, quantity, lowStockLevel } = req.body;

    const qty = Number(quantity);
    const lowLevel = Number(lowStockLevel);

    if (
        !String(itemName || '').trim() ||
        !Number.isInteger(qty) ||
        qty < 0 ||
        !Number.isInteger(lowLevel) ||
        lowLevel < 0
    ) {
        return res.status(400).json({
            message: 'Enter an item name and valid whole-number quantities (0 or higher).'
        });
    }

    await db.execute(
        `UPDATE inventory
         SET item_name = ?, quantity = ?, low_stock_level = ?
         WHERE id = ?`,
        [itemName.trim(), qty, lowLevel, req.params.id]
    );

    await logActivity(
        req.session.user.id,
        `Updated inventory item #${req.params.id}`
    );

    res.json({
        message: 'Inventory updated.'
    });
}));

app.delete('/api/inventory/:id', requireLogin, h(async (req, res) => {
    await db.execute(
        'DELETE FROM inventory WHERE id = ?',
        [req.params.id]
    );

    await logActivity(
        req.session.user.id,
        `Deleted inventory item #${req.params.id}`
    );

    res.json({
        message: 'Inventory item deleted.'
    });
}));

// ==========================================
// SALES / POS
// ==========================================

app.get('/api/sales', requireLogin, h(async (req, res) => {
    const [rows] = await db.execute(
        `SELECT sales.*,
                users.full_name AS recorded_by_name
         FROM sales
         LEFT JOIN users ON sales.recorded_by = users.id
         ORDER BY sales.id DESC`
    );

    res.json(rows);
}));

app.post('/api/sales', requireLogin, h(async (req, res) => {
    const { itemName, quantity, unitPrice } = req.body;

    const qty = Number(quantity);
    const price = Number(unitPrice);

    if (
        !itemName ||
        !Number.isInteger(qty) ||
        qty < 1 ||
        !Number.isFinite(price) ||
        price <= 0
    ) {
        return res.status(400).json({
            message: 'Enter a valid item, quantity, and price.'
        });
    }

    const connection = await db.getConnection();

    try {
        await connection.beginTransaction();

        const [items] = await connection.execute(
            `SELECT * FROM inventory
             WHERE LOWER(item_name) = LOWER(?)
             FOR UPDATE`,
            [itemName.trim()]
        );

        if (items.length && items[0].quantity < qty) {
            await connection.rollback();

            return res.status(400).json({
                message: `Not enough stock. Available quantity: ${items[0].quantity}.`
            });
        }

        if (items.length) {
            await connection.execute(
                'UPDATE inventory SET quantity = quantity - ? WHERE id = ?',
                [qty, items[0].id]
            );
        }

        const total = qty * price;

        await connection.execute(
            `INSERT INTO sales
            (item_name, quantity, unit_price, total_amount, recorded_by)
            VALUES (?, ?, ?, ?, ?)`,
            [
                itemName.trim(),
                qty,
                price,
                total,
                req.session.user.id
            ]
        );

        await connection.commit();

        await logActivity(
            req.session.user.id,
            `Recorded a sale: ${itemName.trim()}`
        );

        res.status(201).json({
            message: 'Sale recorded.',
            total
        });

    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}));

// ==========================================
// REPORTS
// ==========================================

app.get('/api/reports', requireLogin, h(async (req, res) => {
    const period = req.query.period || 'today';

    let condition = 'DATE(created_at) = CURDATE()';

    if (period === 'week') {
        condition = 'created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    }

    if (period === 'month') {
        condition = 'YEAR(created_at) = YEAR(CURDATE()) AND MONTH(created_at) = MONTH(CURDATE())';
    }

    const [sales] = await db.execute(
        `SELECT
            COALESCE(SUM(total_amount), 0) AS total,
            COUNT(*) AS transactions
         FROM sales
         WHERE ${condition}`
    );

    let bookingCondition = 'booking_date = CURDATE()';

    if (period === 'week') {
        bookingCondition = 'booking_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) AND booking_date <= CURDATE()';
    }

    if (period === 'month') {
        bookingCondition = 'YEAR(booking_date) = YEAR(CURDATE()) AND MONTH(booking_date) = MONTH(CURDATE())';
    }

    const [bookings] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM reservations
         WHERE ${bookingCondition}
         AND status = 'Confirmed'`
    );

    res.json({
        totalSales: sales[0].total,
        transactions: sales[0].transactions,
        bookings: bookings[0].total,
        period
    });
}));

// ==========================================
// USER MANAGEMENT AND ACTIVITY LOG
// OWNER ONLY
// ==========================================

app.get('/api/users', requireOwner, h(async (req, res) => {
    const [users] = await db.execute(
        `SELECT id, full_name, email, role, created_at
         FROM users
         ORDER BY id`
    );

    // FIXED: Use action instead of activity.
    // Alias it as activity to preserve the existing frontend response.
    const [logs] = await db.execute(
        `SELECT
            activity_logs.action AS activity,
            activity_logs.details,
            activity_logs.created_at,
            users.full_name
         FROM activity_logs
         LEFT JOIN users
            ON activity_logs.user_id = users.id
         ORDER BY activity_logs.id DESC
         LIMIT 50`
    );

    res.json({
        users,
        logs
    });
}));

// UNKNOWN API ROUTES
app.all('/api/*', (req, res) => {
    res.status(404).json({
        message: 'Not found.'
    });
});

// HOME ROUTE
app.get('*', (req, res) => {
    res.sendFile(
        path.join(__dirname, 'public', 'index.html')
    );
});

// CENTRAL ERROR HANDLER
app.use((error, req, res, next) => {
    console.error(error);

    if (res.headersSent) {
        return next(error);
    }

    res.status(500).json({
        message: `DB error: ${error.code || ''} ${error.message}`
    });
});

// LOCAL SERVER / VERCEL
if (!process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`System is running at http://localhost:${PORT}`);
    });
}

module.exports = app;
