// Acuity Finance - Main Application JavaScript
// This app properly uses backend APIs for all data operations

// API Helper
async function api(path, options = {}) {
    if (window.location.protocol === 'file:') {
        throw new Error('Open the site with Start-Acuity-Finance.cmd or visit http://localhost:8000. Do not open index.html directly.');
    }
    const response = await fetch(path, {
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    const contentType = response.headers.get('content-type') || '';
    const data = contentType.includes('application/json')
        ? await response.json()
        : { error: 'The app must be opened through http://localhost:8000. Please start server.py and use that address.' };
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// State
let currentUser = null;

function formatRupees(value) {
    return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

function updateEmiCalculator() {
    const amount = document.getElementById('amount');
    const rate = document.getElementById('rate');
    const term = document.getElementById('term');
    if (!amount || !rate || !term) return;
    const principal = Number(amount.value);
    const monthlyRate = Number(rate.value) / 1200;
    const months = Number(term.value);
    const emi = monthlyRate ? principal * monthlyRate * (1 + monthlyRate) ** months / ((1 + monthlyRate) ** months - 1) : principal / months;
    const total = emi * months;
    document.getElementById('amountOut').textContent = formatRupees(principal);
    document.getElementById('rateOut').textContent = `${rate.value}%`;
    document.getElementById('termOut').textContent = `${months} months`;
    document.getElementById('emiOut').textContent = formatRupees(emi);
    document.getElementById('repaymentOut').textContent = `Total repayment: ${formatRupees(total)}`;
    document.getElementById('principalOut').textContent = formatRupees(principal);
    document.getElementById('interestOut').textContent = formatRupees(total - principal);
}

document.addEventListener('DOMContentLoaded', () => {
    ['amount', 'rate', 'term'].forEach(id => document.getElementById(id)?.addEventListener('input', updateEmiCalculator));
    updateEmiCalculator();
});

// Show toast notification
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.style.background = {
        'success': '#d4edda',
        'error': '#f8d7da',
        'info': '#d1ecf1'
    }[type] || '#d1ecf1';
    toast.style.color = {
        'success': '#155724',
        'error': '#721c24',
        'info': '#0c5460'
    }[type] || '#0c5460';
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 3000);
}

// Page navigation
function showPage(pageId) {
    if (pageId === 'adminDashboard' && (!currentUser || currentUser.role !== 'ADMIN')) {
        document.getElementById('loginTitle').textContent = 'Staff Sign In';
        document.getElementById('loginAlert').textContent = 'Staff credentials are required to access the admin panel.';
        document.getElementById('loginAlert').classList.remove('d-none');
        pageId = 'login';
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.getElementById(pageId).classList.add('active');
    
    // Load data for specific pages
    if (pageId === 'dashboard') loadClientDashboard();
    if (pageId === 'adminDashboard') loadAdminDashboard();
}

// Tab navigation
function showTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('d-none'));
    document.getElementById(tabName).classList.remove('d-none');
    
    // Update tab button styling
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.style.background = '#f5f5f5';
        btn.style.color = '#333';
    });
    event.target.style.background = '#1a73e8';
    event.target.style.color = 'white';
    
    // Load data for specific tabs
    if (tabName === 'profile') loadProfile();
    if (tabName === 'applications') loadApplications();
}

function showAdminTab(tabName) {
    if (tabName === 'clients') {
        document.getElementById('adminClients').classList.remove('d-none');
        document.getElementById('adminApplications').classList.add('d-none');
        loadAdminClients();
    } else {
        document.getElementById('adminClients').classList.add('d-none');
        document.getElementById('adminApplications').classList.remove('d-none');
        loadAdminApplications();
    }
}

// Go home
function goHome() {
    currentUser = null;
    document.getElementById('navLogin').classList.remove('d-none');
    document.getElementById('navLogout').classList.add('d-none');
    showPage('home');
}

// ==================== AUTHENTICATION ====================

async function handleLogin(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    try {
        const result = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        currentUser = {
            role: result.role,
            name: result.name
        };
        
        // Update nav
        document.getElementById('navLogin').classList.add('d-none');
        document.getElementById('navLogout').classList.remove('d-none');
        
        showToast(`Welcome ${result.name}!`, 'success');
        
        if (result.role === 'ADMIN') {
            showPage('adminDashboard');
        } else {
            showPage('dashboard');
        }
    } catch (error) {
        document.getElementById('loginAlert').textContent = error.message;
        document.getElementById('loginAlert').classList.remove('d-none');
    }
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    const alert = document.getElementById('adminLoginAlert');
    try {
        const result = await api('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        if (result.role !== 'ADMIN') {
            await api('/api/auth/logout', { method: 'POST' });
            throw new Error('This portal is restricted to authorized staff accounts.');
        }
        currentUser = { role: result.role, name: result.name };
        document.getElementById('navLogin').classList.add('d-none');
        document.querySelector('.nav-apply').classList.add('d-none');
        showPage('adminDashboard');
    } catch (error) {
        alert.textContent = error.message;
        alert.classList.remove('d-none');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    try {
        const result = await api('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        showToast('Account created successfully! Please sign in.', 'success');
        form.reset();
        showPage('login');
    } catch (error) {
        document.getElementById('registerAlert').textContent = error.message;
        document.getElementById('registerAlert').classList.remove('d-none');
    }
}

// ==================== CLIENT DASHBOARD ====================

async function loadClientDashboard() {
    try {
        const profile = await api('/api/client/profile');
        const apps = await api('/api/client/applications');
        
        document.getElementById('dashboardTitle').textContent = `Welcome, ${profile.user.full_name}!`;
        
        // Stats
        const stats = apps.applications || [];
        const pending = stats.filter(a => a.status === 'PENDING').length;
        const approved = stats.filter(a => a.status === 'APPROVED').length;
        
        document.getElementById('dashStats').innerHTML = `
            <div class="stat-card stat1">
                <h3>Total Applications</h3>
                <div class="value">${stats.length}</div>
            </div>
            <div class="stat-card stat2">
                <h3>Pending</h3>
                <div class="value">${pending}</div>
            </div>
            <div class="stat-card stat3">
                <h3>Approved</h3>
                <div class="value">${approved}</div>
            </div>
            <div class="stat-card stat4">
                <h3>Client ID</h3>
                <div class="value" style="font-size: 1.2rem;">${profile.user.id}</div>
            </div>
        `;
        
        // Recent applications
        const recent = stats.slice(0, 5).map(app => `
            <div style="padding: 1rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                <div>
                    <strong>${app.application_number}</strong>
                    <small style="display: block; color: #999;">${app.loan_type} | Rs. ${app.loan_amount}</small>
                </div>
                <div>
                    <span class="status-badge status-${app.status.toLowerCase().replace('_', '-')}">${app.status}</span>
                    <small style="display: block; color: #999;">${new Date(app.created_at).toLocaleDateString()}</small>
                </div>
            </div>
        `).join('');
        
        document.getElementById('recentApps').innerHTML = recent || '<p class="text-muted">No applications yet</p>';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loadProfile() {
    try {
        const profile = await api('/api/client/profile');
        const user = profile.user;
        
        const profileHTML = `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                <div><strong>Name:</strong> ${user.full_name || '-'}</div>
                <div><strong>Email:</strong> ${user.email}</div>
                <div><strong>Phone:</strong> ${user.phone}</div>
                <div><strong>DOB:</strong> ${user.date_of_birth || '-'}</div>
                <div><strong>Gender:</strong> ${user.gender || '-'}</div>
                <div><strong>Employment:</strong> ${user.employment_type || '-'}</div>
                <div><strong>Company:</strong> ${user.company_name || '-'}</div>
                <div><strong>Monthly Income:</strong> Rs. ${user.monthly_income || '-'}</div>
                <div><strong>PAN:</strong> ${user.pan || '-'}</div>
            </div>
        `;
        
        document.getElementById('profileContent').innerHTML = profileHTML;
        
        // Populate edit form
        const form = document.getElementById('editProfileForm');
        Object.entries({
            full_name: user.full_name,
            email: user.email,
            phone: user.phone,
            monthly_income: user.monthly_income,
            employment_type: user.employment_type,
            company_name: user.company_name,
            date_of_birth: user.date_of_birth,
            gender: user.gender,
            address: user.address,
            city: user.city,
            state: user.state,
            pincode: user.pincode,
            pan: user.pan
        }).forEach(([name, value]) => {
            const field = form.querySelector(`[name="${name}"]`);
            if (field) field.value = value || '';
        });
    } catch (error) {
        showToast(error.message, 'error');
    }
}

function toggleEditProfile() {
    const form = document.getElementById('editProfileForm');
    form.classList.toggle('d-none');
}

async function saveProfile(event) {
    event.preventDefault();
    const form = event.target;
    const data = Object.fromEntries(new FormData(form));
    data.monthly_income = data.monthly_income ? parseFloat(data.monthly_income) : null;
    try {
        await api('/api/client/profile', { method: 'PUT', body: JSON.stringify(data) });
        showToast('Profile updated successfully.', 'success');
        form.classList.add('d-none');
        loadProfile();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loadApplications() {
    try {
        const result = await api('/api/client/applications');
        const applications = result.applications || [];
        
        const tbody = document.querySelector('#myApplicationsTable tbody');
        tbody.innerHTML = applications.map(app => `
            <tr>
                <td><strong>${app.application_number}</strong></td>
                <td>${app.loan_type}</td>
                <td>Rs. ${app.loan_amount}</td>
                <td><span class="status-badge status-${app.status.toLowerCase().replace('_', '-')}">${app.status}</span></td>
                <td>${new Date(app.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-small btn-primary" onclick="viewApplicationDetails('${app.id}', 'client')">View</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="6" class="text-center text-muted">No applications yet</td></tr>';
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function viewApplicationDetails(appId, mode = 'client') {
    try {
        // For client mode, show details from their applications
        // For admin mode, use the admin endpoint
        
        if (mode === 'admin') {
            const result = await api(`/api/admin/applications/${appId}`);
            const app = result.application;
            const docs = result.documents || [];
            const history = result.history || [];
            
            const html = `
                <h2>${app.application_number}</h2>
                <div class="card">
                    <h3>Client Information</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div><strong>Name:</strong> ${app.full_name}</div>
                        <div><strong>Email:</strong> ${app.email}</div>
                        <div><strong>Phone:</strong> ${app.phone}</div>
                        <div><strong>Address:</strong> ${app.address || '-'}</div>
                        <div><strong>Employment:</strong> ${app.employment_type || '-'}</div>
                        <div><strong>Monthly Income:</strong> Rs. ${app.monthly_income || 0}</div>
                    </div>
                </div>
                
                <div class="card">
                    <h3>Loan Details</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                        <div><strong>Loan Type:</strong> ${app.loan_type}</div>
                        <div><strong>Amount:</strong> Rs. ${app.loan_amount}</div>
                        <div><strong>Tenure:</strong> ${app.tenure} months</div>
                        <div><strong>Purpose:</strong> ${app.purpose}</div>
                        <div><strong>Existing EMI:</strong> Rs. ${app.existing_emi || 0}</div>
                        <div><strong>Interest Rate:</strong> ${app.interest_rate || 'N/A'}%</div>
                    </div>
                </div>
                
                <div class="card">
                    <h3>Status</h3>
                    <div style="display: flex; gap: 1rem; margin-bottom: 1rem;">
                        <span class="status-badge status-${app.status.toLowerCase().replace('_', '-')}">${app.status}</span>
                        <span class="text-muted">${new Date(app.created_at).toLocaleDateString()}</span>
                    </div>
                    <div>
                        <label>Update Status *</label>
                        <select id="statusSelect" onchange="updateApplicationStatus('${appId}')">
                            <option value="">Select new status</option>
                            <option value="PENDING" ${app.status === 'PENDING' ? 'selected' : ''}>PENDING</option>
                            <option value="DOCUMENT_VERIFICATION" ${app.status === 'DOCUMENT_VERIFICATION' ? 'selected' : ''}>DOCUMENT_VERIFICATION</option>
                            <option value="UNDER_REVIEW" ${app.status === 'UNDER_REVIEW' ? 'selected' : ''}>UNDER_REVIEW</option>
                            <option value="APPROVED" ${app.status === 'APPROVED' ? 'selected' : ''}>APPROVED</option>
                            <option value="REJECTED" ${app.status === 'REJECTED' ? 'selected' : ''}>REJECTED</option>
                            <option value="DISBURSED" ${app.status === 'DISBURSED' ? 'selected' : ''}>DISBURSED</option>
                        </select>
                    </div>
                    <div style="margin-top: 1rem;">
                        <label>Admin Remarks</label>
                        <textarea id="remarksInput" placeholder="Add remarks"></textarea>
                    </div>
                </div>
                
                <div class="card">
                    <h3>Status History</h3>
                    ${history.map(h => `
                        <div style="padding: 0.75rem; border-bottom: 1px solid #eee;">
                            <strong>${h.status}</strong> - ${new Date(h.created_at).toLocaleDateString()}
                            <small style="display: block; color: #999;">${h.remarks || '-'}</small>
                        </div>
                    `).join('') || '<p class="text-muted">No history yet</p>'}
                </div>
                
                <div class="card">
                    <h3>Documents (${docs.length})</h3>
                    ${docs.map(d => `
                        <div style="padding: 0.75rem; border-bottom: 1px solid #eee; display: flex; justify-content: space-between;">
                            <div>
                                <strong>${d.document_type}</strong>
                                <small style="display: block; color: #999;">${d.file_name}</small>
                            </div>
                            <span class="status-badge status-${d.verification_status.toLowerCase().replace('_', '-')}">${d.verification_status}</span>
                        </div>
                    `).join('') || '<p class="text-muted">No documents uploaded</p>'}
                </div>
            `;
            
            document.getElementById('appDetailsModalContent').innerHTML = html;
            openModal('appDetailsModal');
        } else {
            // Client view - just show their own application details
            const result = await api('/api/client/applications');
            const app = result.applications.find(a => a.id === appId);
            
            if (app) {
                const html = `
                    <div class="card">
                        <h2>${app.application_number}</h2>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                            <div><strong>Loan Type:</strong> ${app.loan_type}</div>
                            <div><strong>Amount:</strong> Rs. ${app.loan_amount}</div>
                            <div><strong>Tenure:</strong> ${app.tenure} months</div>
                            <div><strong>Purpose:</strong> ${app.purpose}</div>
                            <div><strong>Status:</strong> <span class="status-badge status-${app.status.toLowerCase().replace('_', '-')}">${app.status}</span></div>
                            <div><strong>Date:</strong> ${new Date(app.created_at).toLocaleDateString()}</div>
                        </div>
                        <div style="margin-top: 2rem;">
                            <button class="btn btn-secondary" onclick="showPage('dashboard')">Back to Dashboard</button>
                        </div>
                    </div>
                `;
                
                document.getElementById('appDetailsContent').innerHTML = html;
                showPage('applicationDetails');
            }
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function updateApplicationStatus(appId) {
    const newStatus = document.getElementById('statusSelect').value;
    const remarks = document.getElementById('remarksInput').value;
    
    if (!newStatus) return;
    
    try {
        await api(`/api/admin/applications/${appId}/status`, {
            method: 'PUT',
            body: JSON.stringify({
                status: newStatus,
                remarks: remarks
            })
        });
        
        showToast('Status updated successfully!', 'success');
        loadAdminApplications();
        closeModal('appDetailsModal');
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function submitApplication(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData);
    
    // Convert string values to numbers
    data.loan_amount = parseFloat(data.loan_amount);
    data.tenure = parseInt(data.tenure);
    data.monthly_income = parseFloat(data.monthly_income) || undefined;
    data.existing_emi = parseFloat(data.existing_emi) || 0;
    
    try {
        const result = await api('/api/client/applications', {
            method: 'POST',
            body: JSON.stringify(data)
        });
        
        showToast(`Application ${result.application_number} submitted successfully!`, 'success');
        form.reset();
        showPage('dashboard');
        loadClientDashboard();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// ==================== ADMIN DASHBOARD ====================

async function loadAdminDashboard() {
    try {
        const result = await api('/api/admin/dashboard');
        const stats = result.stats;
        
        const statHTML = `
            <div class="stat-card stat1">
                <h3>Total Clients</h3>
                <div class="value">${stats.clients}</div>
            </div>
            <div class="stat-card stat2">
                <h3>Total Applications</h3>
                <div class="value">${stats.applications}</div>
            </div>
            <div class="stat-card stat3">
                <h3>Pending</h3>
                <div class="value">${stats.pending}</div>
            </div>
            <div class="stat-card stat4">
                <h3>Total Requested</h3>
                <div class="value" style="font-size: 1.2rem;">Rs. ${(stats.total / 100000).toFixed(1)}L</div>
            </div>
        `;
        
        document.getElementById('adminStats').innerHTML = statHTML;
        
        // Load clients by default
        loadAdminClients();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function loadAdminClients() {
    try {
        const result = await api('/api/admin/clients');
        const clients = result.clients || [];
        
        const tbody = document.querySelector('#clientsTable tbody');
        tbody.innerHTML = clients.map(client => `
            <tr>
                <td><strong>${client.id}</strong></td>
                <td>${client.full_name}</td>
                <td>${client.email}</td>
                <td>${client.phone}</td>
                <td>${client.employment_type || '-'}</td>
                <td>Rs. ${client.monthly_income || 0}</td>
                <td>${client.applications}</td>
                <td>
                    <button type="button" class="btn btn-small btn-primary" onclick="viewClientDetails('${client.id}')">View</button>
                    <button type="button" class="btn btn-small btn-danger" onclick="deleteClient('${client.id}', '${client.full_name.replace(/'/g, "\\'")}')">Delete</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="8" class="text-center text-muted">No clients found</td></tr>';
        
        // Search functionality
        document.getElementById('clientSearch').oninput = (e) => {
            const searchTerm = e.target.value.toLowerCase();
            document.querySelectorAll('#clientsTable tbody tr').forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(searchTerm) ? '' : 'none';
            });
        };
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function deleteClient(clientId, clientName) {
    if (!confirm(`Delete ${clientName}'s client record and all linked applications?`)) return;
    try {
        await api(`/api/admin/clients/${clientId}`, { method: 'DELETE' });
        showToast('Client record deleted successfully.', 'success');
        loadAdminDashboard();
    } catch (error) {
        showToast(error.message, 'error');
    }
}

async function viewClientDetails(clientId) {
    const content = document.getElementById('clientDetailsContent');
    content.innerHTML = '<p class="text-muted">Loading client details...</p>';
    openModal('clientDetailsModal');
    try {
        const result = await api(`/api/admin/clients/${clientId}`);
        const client = result.client;
        const applications = result.applications || [];
        
        const html = `
            <div class="card">
                <h3>Client Information</h3>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem;">
                    <div><strong>Client ID:</strong> ${client.id}</div>
                    <div><strong>Name:</strong> ${client.full_name}</div>
                    <div><strong>Email:</strong> ${client.email}</div>
                    <div><strong>Phone:</strong> ${client.phone}</div>
                    <div><strong>DOB:</strong> ${client.date_of_birth || '-'}</div>
                    <div><strong>Gender:</strong> ${client.gender || '-'}</div>
                    <div><strong>Address:</strong> ${client.address || '-'}</div>
                    <div><strong>City:</strong> ${client.city || '-'}</div>
                    <div><strong>State:</strong> ${client.state || '-'}</div>
                    <div><strong>Pincode:</strong> ${client.pincode || '-'}</div>
                    <div><strong>Employment:</strong> ${client.employment_type || '-'}</div>
                    <div><strong>Company:</strong> ${client.company_name || '-'}</div>
                    <div><strong>Monthly Income:</strong> Rs. ${client.monthly_income || 0}</div>
                    <div><strong>PAN:</strong> ${client.pan || '-'}</div>
                    <div><strong>Registered:</strong> ${new Date(client.created_at).toLocaleDateString()}</div>
                </div>
            </div>
            
            <div class="card">
                <h3>Loan Applications (${applications.length})</h3>
                ${applications.length > 0 ? `
                    <table style="width: 100%;">
                        <thead>
                            <tr>
                                <th>Application ID</th>
                                <th>Loan Type</th>
                                <th>Amount</th>
                                <th>Status</th>
                                <th>Date</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${applications.map(app => `
                                <tr>
                                    <td>${app.application_number}</td>
                                    <td>${app.loan_type}</td>
                                    <td>Rs. ${app.loan_amount}</td>
                                    <td><span class="status-badge status-${app.status.toLowerCase().replace('_', '-')}">${app.status}</span></td>
                                    <td>${new Date(app.created_at).toLocaleDateString()}</td>
                                    <td>
                                        <button class="btn btn-small btn-primary" onclick="viewApplicationDetails('${app.id}', 'admin')">Open</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                ` : '<p class="text-muted">No applications found</p>'}
            </div>
        `;
        
        content.innerHTML = html;
    } catch (error) {
        content.innerHTML = `<p class="alert alert-error">Unable to load client details: ${error.message}</p>`;
        showToast(error.message, 'error');
    }
}

async function loadAdminApplications() {
    try {
        const result = await api('/api/admin/applications');
        const applications = result.applications || [];
        
        const tbody = document.querySelector('#applicationsTable tbody');
        tbody.innerHTML = applications.map(app => `
            <tr>
                <td><strong>${app.application_number}</strong></td>
                <td>${app.full_name}</td>
                <td>${app.loan_type}</td>
                <td>Rs. ${app.loan_amount}</td>
                <td>${new Date(app.created_at).toLocaleDateString()}</td>
                <td><span class="status-badge status-${app.status.toLowerCase().replace('_', '-')}">${app.status}</span></td>
                <td>
                    <button class="btn btn-small btn-primary" onclick="viewApplicationDetails('${app.id}', 'admin')">Open</button>
                </td>
            </tr>
        `).join('') || '<tr><td colspan="7" class="text-center text-muted">No applications found</td></tr>';
        
        // Search and filter functionality
        document.getElementById('appSearch').oninput = filterApplications;
        document.getElementById('statusFilter').onchange = filterApplications;
        
        function filterApplications() {
            const searchTerm = document.getElementById('appSearch').value.toLowerCase();
            const statusFilter = document.getElementById('statusFilter').value;
            
            document.querySelectorAll('#applicationsTable tbody tr').forEach(row => {
                const text = row.textContent.toLowerCase();
                const status = row.querySelector('[class*="status-"]')?.textContent.trim() || '';
                
                const matchesSearch = text.includes(searchTerm);
                const matchesStatus = !statusFilter || status === statusFilter;
                
                row.style.display = matchesSearch && matchesStatus ? '' : 'none';
            });
        }
    } catch (error) {
        showToast(error.message, 'error');
    }
}

// Modal helpers
function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Close modals when clicking overlay
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.classList.remove('active');
            }
        });
    });
    
    // Check if user is already logged in
    if (window.location.pathname === '/admin') {
        document.getElementById('loginTitle').textContent = 'Staff Sign In';
    }
    checkAuthStatus();
});

async function checkAuthStatus() {
    if (window.location.pathname === '/admin') {
        showPage('adminLogin');
        return;
    }
    try {
        const profile = await api('/api/client/profile');
        currentUser = { role: 'CLIENT', name: profile.user.full_name };
        document.getElementById('navLogin').classList.add('d-none');
        document.getElementById('navLogout').classList.remove('d-none');
        showPage('dashboard');
    } catch (e) {
        // User not logged in, show home
        showPage('home');
    }
}
