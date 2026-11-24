# Integrated Reservation, Sales, and Inventory Management System

## Features
- Sign up/sign in (first account is Owner; later accounts are Staff)
- Password hashing with bcryptjs
- Dashboard, reservations, sales/POS, inventory, reports, user management, and activity log
- Sales automatically deduct stock when the sold item matches an inventory item

## Important deployment note
This is a full-stack application. **GitHub Pages cannot run the Node.js/Express API or connect to MySQL.** Deploy the application to Vercel (or another Node.js host). The repository includes `api/[...path].js` as the Vercel API entry point. The frontend files remain in `public/` and are served as static assets.

## 1. Create the MySQL database
Create a MySQL database named `integrated_management_system` (or use the name you configure in `DB_NAME`). Import `database/database.sql` into that database using your provider's SQL console or a MySQL client. This creates the tables; simply committing the SQL file to GitHub does not execute it.

## 2. Configure environment variables
Set these in your hosting provider's project settings (Vercel: Project → Settings → Environment Variables):

- `DB_HOST`: hostname supplied by your MySQL provider
- `DB_PORT`: usually `3306`
- `DB_USER`: database username
- `DB_PASSWORD`: database password
- `DB_NAME`: database name
- `DB_SSL`: set to `true` if your provider requires SSL/TLS; otherwise `false`
- `SESSION_SECRET`: a long, random secret used to sign session cookies

Do not commit your real `.env` file or database credentials to GitHub. For local development, copy `.env.example` to `.env` and enter your local MySQL credentials.

## 3. Deploy
Import the repository into Vercel and deploy it. After setting/changing environment variables, redeploy so the new values are applied. Do not use GitHub Pages as the application host.

## 4. Verify the database connection
After deployment, open `https://YOUR-VERCEL-DOMAIN/api/health`. A successful response is:

```json
{"status":"ok","database":"connected"}
```

If it fails, check the Vercel Function Logs and verify the database host, port, username, password, database name, network access/allowlist, and SSL setting.

## 5. Run locally
Install Node.js and MySQL, create/import the database schema, copy `.env.example` to `.env`, fill in local credentials, then run:

```bash
npm install
npm start
```

Open `http://localhost:3000`.
