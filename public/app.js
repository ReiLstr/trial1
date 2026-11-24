// Frontend JavaScript. Functions are kept small so they are easier to follow.
let currentUser = null;
let authMode = 'signup';
let editingReservationId = null;
let editingInventoryId = null;
let reservationsCache = [];
let inventoryCache = [];

const $ = (id) => document.getElementById(id);
const peso = (amount) => '₱' + Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const safe = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

async function api(url, options = {}) {
    const settings = { ...options, headers: { ...(options.headers || {}) } };
    if (settings.body && typeof settings.body !== 'string') {
        settings.headers['Content-Type'] = 'application/json';
        settings.body = JSON.stringify(settings.body);
    }
    const response = await fetch(url, settings);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Something went wrong.');
    return data;
}

function showMessage(message, isError = false, target = 'globalMessage') {
    const element = $(target);
    element.textContent = message;
    element.style.color = isError ? '#c74343' : '#16865b';
    if (target === 'globalMessage') window.setTimeout(() => { element.textContent = ''; }, 4500);
}

function showAuth(mode) {
    authMode = mode;
    $('authForm').reset();
    $('authMessage').textContent = '';
    const isSignup = mode === 'signup';
    $('nameGroup').classList.toggle('hidden', !isSignup);
    $('authName').required = isSignup;
    $('authPassword').autocomplete = isSignup ? 'new-password' : 'current-password';
    $('authTitle').textContent = isSignup ? 'Create your account' : 'Welcome back';
    $('authSubtitle').textContent = isSignup ? 'Sign up to get started with the system.' : 'Enter your account details to continue.';
    $('authSubmit').textContent = isSignup ? 'Create account' : 'Sign in';
    $('switchText').textContent = isSignup ? 'Already have an account?' : "Don't have an account yet?";
    $('switchAuth').textContent = isSignup ? 'Sign in' : 'Sign up';
    $('roleNote').classList.toggle('hidden', !isSignup);
}

function showApplication(user) {
    currentUser = user;
    $('authPage').classList.add('hidden');
    $('appPage').classList.remove('hidden');
    $('currentUser').textContent = user.fullName;
    $('currentRole').textContent = user.role;
    $('userInitial').textContent = user.fullName.charAt(0).toUpperCase();
    document.querySelectorAll('.owner-only').forEach((element) => {
        element.classList.toggle('hidden', user.role !== 'Owner');
    });
    $('todayLabel').textContent = new Date().toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    openPage('dashboard');
}

function openPage(pageName) {
    if (pageName === 'users' && currentUser.role !== 'Owner') pageName = 'dashboard';
    document.querySelectorAll('.page').forEach((page) => page.classList.add('hidden'));
    $(pageName).classList.remove('hidden');
    document.querySelectorAll('.nav-button').forEach((button) => button.classList.toggle('active', button.dataset.page === pageName));
    const headings = { dashboard: 'Dashboard', reservations: 'Reservations', sales: 'Sales / POS', inventory: 'Inventory', reports: 'Reports', users: 'User Management' };
    $('pageHeading').textContent = headings[pageName];
    loadPageData(pageName).catch((error) => showMessage(error.message, true));
}

async function loadPageData(pageName) {
    if (pageName === 'dashboard') await loadDashboard();
    if (pageName === 'reservations') await loadReservations();
    if (pageName === 'sales') await loadSales();
    if (pageName === 'inventory') await loadInventory();
    if (pageName === 'reports') await loadReport();
    if (pageName === 'users') await loadUsers();
}

async function loadDashboard() {
    const data = await api('/api/dashboard');
    $('reservationCount').textContent = data.reservations;
    $('salesToday').textContent = peso(data.salesToday);
    $('inventoryCount').textContent = data.inventoryItems;
    $('lowStockCount').textContent = data.lowStock;
    $('activityList').innerHTML = data.activities.length
        ? data.activities.map((item) => `<li>${safe(item.activity)} <time>${new Date(item.created_at).toLocaleString()}</time></li>`).join('')
        : '<li>No activity recorded yet.</li>';
}

async function loadReservations() {
    reservationsCache = await api('/api/reservations');
    renderReservations();
}

function renderReservations() {
    const search = $('reservationSearch').value.toLowerCase();
    const rows = reservationsCache.filter((item) => item.customer_name.toLowerCase().includes(search));
    $('reservationRows').innerHTML = rows.length ? rows.map((item) => `
        <tr>
            <td><strong>${safe(item.customer_name)}</strong></td>
            <td>${safe(item.booking_date)} <span class="muted">${safe(String(item.booking_time).slice(0, 5))}</span></td>
            <td>${item.guest_count}</td><td>${peso(item.deposit_amount)}</td>
            <td>${safe(item.payment_status)}</td>
            <td><span class="status ${item.status === 'Confirmed' ? 'good' : 'bad'}">${safe(item.status)}</span></td>
            <td>${item.status === 'Confirmed' ? `<button class="table-action" data-edit-reservation="${item.id}">Edit</button><button class="table-action danger" data-cancel-reservation="${item.id}">Cancel</button>` : '—'}</td>
        </tr>`).join('') : '<tr><td colspan="7" class="empty-row">No reservations found.</td></tr>';
}

function resetReservationForm() {
    editingReservationId = null;
    $('reservationForm').reset();
    $('depositAmount').value = '0';
    $('reservationFormTitle').textContent = 'New reservation';
    $('reservationSubmit').textContent = 'Add reservation';
    $('cancelReservationEdit').classList.add('hidden');
}

async function loadSales() {
    const rows = await api('/api/sales');
    $('saleRows').innerHTML = rows.length ? rows.map((item) => `
        <tr><td>#${item.id}</td><td>${new Date(item.created_at).toLocaleString()}</td><td>${safe(item.item_name)}</td><td>${item.quantity}</td><td>${peso(item.unit_price)}</td><td><strong>${peso(item.total_amount)}</strong></td><td>${safe(item.recorded_by_name || 'Former user')}</td></tr>`).join('')
        : '<tr><td colspan="7" class="empty-row">No sales recorded yet.</td></tr>';
}

async function loadInventory() {
    inventoryCache = await api('/api/inventory');
    renderInventory();
}

function renderInventory() {
    const search = $('inventorySearch').value.toLowerCase();
    const rows = inventoryCache.filter((item) => item.item_name.toLowerCase().includes(search));
    $('inventoryRows').innerHTML = rows.length ? rows.map((item) => {
        const low = item.quantity <= item.low_stock_level;
        return `<tr><td><strong>${safe(item.item_name)}</strong></td><td>${item.quantity}</td><td>${item.low_stock_level}</td><td><span class="status ${low ? 'warn' : 'good'}">${low ? 'Low stock' : 'In stock'}</span></td><td><button class="table-action" data-edit-inventory="${item.id}">Edit</button><button class="table-action danger" data-delete-inventory="${item.id}">Delete</button></td></tr>`;
    }).join('') : '<tr><td colspan="5" class="empty-row">No inventory items found.</td></tr>';
}

function resetInventoryForm() {
    editingInventoryId = null;
    $('inventoryForm').reset();
    $('stockLimit').value = '5';
    $('inventoryFormTitle').textContent = 'Add inventory item';
    $('inventorySubmit').textContent = 'Add item';
    $('cancelInventoryEdit').classList.add('hidden');
}

async function loadReport() {
    const data = await api(`/api/reports?period=${$('reportPeriod').value}`);
    $('reportSales').textContent = peso(data.totalSales);
    $('reportBookings').textContent = data.bookings;
    $('reportTransactions').textContent = data.transactions;
}

async function loadUsers() {
    const data = await api('/api/users');
    $('userRows').innerHTML = data.users.length ? data.users.map((user) => `
        <tr><td><strong>${safe(user.full_name)}</strong></td><td>${safe(user.email)}</td><td><span class="status ${user.role === 'Owner' ? 'good' : 'warn'}">${safe(user.role)}</span></td><td>${new Date(user.created_at).toLocaleDateString()}</td></tr>`).join('') : '<tr><td colspan="4" class="empty-row">No users found.</td></tr>';
    $('auditRows').innerHTML = data.logs.length ? data.logs.map((log) => `<tr><td>${safe(log.full_name || 'Former user')}</td><td>${safe(log.activity)}</td><td>${new Date(log.created_at).toLocaleString()}</td></tr>`).join('') : '<tr><td colspan="3" class="empty-row">No activity yet.</td></tr>';
}

// Switch between Sign Up and Sign In.
$('switchAuth').addEventListener('click', () => showAuth(authMode === 'signup' ? 'login' : 'signup'));

$('authForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('authMessage').textContent = 'Please wait...';
    try {
        const url = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
        const body = { email: $('authEmail').value, password: $('authPassword').value };
        if (authMode === 'signup') body.fullName = $('authName').value;
        const data = await api(url, { method: 'POST', body });
        $('authMessage').classList.add('success');
        $('authMessage').textContent = data.message;
        showApplication(data.user);
    } catch (error) {
        $('authMessage').classList.remove('success');
        $('authMessage').textContent = error.message;
    }
});

// Navigation buttons use data-page to identify the selected page.
document.querySelectorAll('.nav-button').forEach((button) => {
    button.addEventListener('click', () => openPage(button.dataset.page));
});

$('logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch (error) { console.log(error.message); }
    currentUser = null;
    $('appPage').classList.add('hidden');
    $('authPage').classList.remove('hidden');
    showAuth('login');
});

$('reservationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = {
        customerName: $('customerName').value,
        bookingDate: $('bookingDate').value,
        bookingTime: $('bookingTime').value,
        guestCount: $('guestCount').value,
        depositAmount: $('depositAmount').value,
        paymentStatus: $('bookingPayment').value
    };
    try {
        const url = editingReservationId ? `/api/reservations/${editingReservationId}` : '/api/reservations';
        await api(url, { method: editingReservationId ? 'PUT' : 'POST', body });
        showMessage(editingReservationId ? 'Reservation updated.' : 'Reservation added.');
        resetReservationForm();
        await loadReservations();
        await loadDashboard();
    } catch (error) { showMessage(error.message, true); }
});

$('cancelReservationEdit').addEventListener('click', resetReservationForm);
$('reservationSearch').addEventListener('input', renderReservations);

$('saleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { itemName: $('saleItem').value, quantity: $('saleQuantity').value, unitPrice: $('salePrice').value };
    try {
        const data = await api('/api/sales', { method: 'POST', body });
        showMessage(`Sale recorded. Total: ${peso(data.total)}`);
        $('saleForm').reset();
        await loadSales();
        await loadDashboard();
    } catch (error) { showMessage(error.message, true); }
});

$('inventoryForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const body = { itemName: $('stockName').value, quantity: $('stockQuantity').value, lowStockLevel: $('stockLimit').value };
    try {
        const url = editingInventoryId ? `/api/inventory/${editingInventoryId}` : '/api/inventory';
        await api(url, { method: editingInventoryId ? 'PUT' : 'POST', body });
        showMessage(editingInventoryId ? 'Inventory updated.' : 'Inventory item added.');
        resetInventoryForm();
        await loadInventory();
        await loadDashboard();
    } catch (error) { showMessage(error.message, true); }
});

$('cancelInventoryEdit').addEventListener('click', resetInventoryForm);
$('inventorySearch').addEventListener('input', renderInventory);
$('generateReport').addEventListener('click', () => loadReport().catch((error) => showMessage(error.message, true)));
$('reportPeriod').addEventListener('change', () => loadReport().catch((error) => showMessage(error.message, true)));

// Table buttons are handled here so newly rendered rows also work.
document.addEventListener('click', async (event) => {
    const editReservation = event.target.dataset.editReservation;
    const cancelReservation = event.target.dataset.cancelReservation;
    const editInventory = event.target.dataset.editInventory;
    const deleteInventory = event.target.dataset.deleteInventory;

    if (editReservation) {
        const item = reservationsCache.find((row) => String(row.id) === editReservation);
        if (!item) return;
        editingReservationId = item.id;
        $('customerName').value = item.customer_name;
        $('bookingDate').value = String(item.booking_date).slice(0, 10);
        $('bookingTime').value = String(item.booking_time).slice(0, 5);
        $('guestCount').value = item.guest_count;
        $('depositAmount').value = item.deposit_amount;
        $('bookingPayment').value = item.payment_status;
        $('reservationFormTitle').textContent = 'Edit reservation';
        $('reservationSubmit').textContent = 'Save changes';
        $('cancelReservationEdit').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (cancelReservation && confirm('Cancel this reservation?')) {
        try { await api(`/api/reservations/${cancelReservation}/cancel`, { method: 'PATCH' }); showMessage('Reservation cancelled.'); await loadReservations(); await loadDashboard(); }
        catch (error) { showMessage(error.message, true); }
    }

    if (editInventory) {
        const item = inventoryCache.find((row) => String(row.id) === editInventory);
        if (!item) return;
        editingInventoryId = item.id;
        $('stockName').value = item.item_name;
        $('stockQuantity').value = item.quantity;
        $('stockLimit').value = item.low_stock_level;
        $('inventoryFormTitle').textContent = 'Edit inventory item';
        $('inventorySubmit').textContent = 'Save changes';
        $('cancelInventoryEdit').classList.remove('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    if (deleteInventory && confirm('Delete this inventory item?')) {
        try { await api(`/api/inventory/${deleteInventory}`, { method: 'DELETE' }); showMessage('Inventory item deleted.'); await loadInventory(); await loadDashboard(); }
        catch (error) { showMessage(error.message, true); }
    }
});

// Check whether the user already has an active session.
async function startApp() {
    showAuth('signup');
    try {
        const data = await api('/api/auth/me');
        if (data.user) showApplication(data.user);
    } catch (error) {
        console.log('No active session. Please sign in or create an account.');
    }
}

startApp();
