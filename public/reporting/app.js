/**
 * QCH Reporting Center - Frontend Application
 *
 * Consumes server-calculated metrics from /api/reports without duplicating
 * calculation logic or canonical formulas in client-side code.
 */

const elements = {
  form: document.getElementById('filter-form'),
  periodSelect: document.getElementById('period-select'),
  dateGroup: document.getElementById('date-input-group'),
  dateInput: document.getElementById('date-input'),
  scopeTypeSelect: document.getElementById('scope-type'),
  scopeIdGroup: document.getElementById('scope-id-group'),
  scopeIdLabel: document.getElementById('scope-id-label'),
  scopeIdInput: document.getElementById('scope-id'),
  errorBanner: document.getElementById('error-banner'),

  // KPIs
  totalReferrals: document.getElementById('kpi-total'),
  acceptedRate: document.getElementById('kpi-accepted-rate'),
  acceptedStatus: document.getElementById('kpi-accepted-status'),
  notAppropriateRate: document.getElementById('kpi-not-appropriate-rate'),
  notAppropriateStatus: document.getElementById('kpi-not-appropriate-status'),
  serviceRate: document.getElementById('kpi-service-rate'),
  serviceStatus: document.getElementById('kpi-service-status'),
  awaitingCount: document.getElementById('kpi-awaiting'),

  // Timing
  respAvg: document.getElementById('timing-response-avg'),
  respAvgStatus: document.getElementById('timing-response-avg-status'),
  respMedian: document.getElementById('timing-response-median'),
  respMedianStatus: document.getElementById('timing-response-median-status'),
  servAvg: document.getElementById('timing-service-avg'),
  servAvgStatus: document.getElementById('timing-service-avg-status'),
  servMedian: document.getElementById('timing-service-median'),
  servMedianStatus: document.getElementById('timing-service-median-status'),

  // Tables
  programTableBody: document.querySelector('#program-breakdown-table tbody'),
  departmentTableBody: document.querySelector('#department-breakdown-table tbody')
};

function formatRate(metric) {
  if (!metric) return { text: 'N/A', status: 'NO_DATA' };
  if (metric.state === 'CALCULATED' && typeof metric.value === 'number') {
    return { text: `${metric.value.toFixed(2)}%`, status: 'CALCULATED' };
  }
  if (metric.state === 'PENDING') return { text: 'Pending', status: 'PENDING' };
  return { text: 'No Data', status: 'NO_DATA' };
}

function formatDuration(metric) {
  if (!metric) return { text: 'N/A', status: 'NO_DATA' };
  if (metric.state === 'CALCULATED' && typeof metric.value === 'number') {
    return { text: `${metric.value.toFixed(1)} hrs`, status: 'CALCULATED' };
  }
  if (metric.state === 'PENDING') return { text: 'Pending', status: 'PENDING' };
  return { text: 'No Data', status: 'NO_DATA' };
}

function renderMetricCard(valueEl, statusEl, formatted) {
  valueEl.textContent = formatted.text;
  if (statusEl) {
    statusEl.textContent = formatted.status;
    statusEl.className = `kpi-status status-${formatted.status}`;
  }
}

function showError(message) {
  elements.errorBanner.textContent = message;
  elements.errorBanner.style.display = 'block';
}

function clearError() {
  elements.errorBanner.textContent = '';
  elements.errorBanner.style.display = 'none';
}

function buildQueryParams() {
  const params = new URLSearchParams();
  const period = elements.periodSelect.value;
  params.set('period', period);

  if (period === 'CUSTOM' && elements.dateInput.value) {
    params.set('date', elements.dateInput.value);
  }

  const scopeType = elements.scopeTypeSelect.value;
  const scopeId = elements.scopeIdInput.value.trim();

  if (scopeType === 'PROGRAM' && scopeId) {
    params.set('programId', scopeId);
  } else if (scopeType === 'DEPARTMENT' && scopeId) {
    params.set('departmentId', scopeId);
  }

  return params.toString();
}

async function loadReports() {
  clearError();
  const queryString = buildQueryParams();

  try {
    const [activityRes, totalRes, timingRes] = await Promise.all([
      fetch(`/api/reports/referral-activity?${queryString}`),
      fetch(`/api/reports/total-referrals?${queryString}`),
      fetch(`/api/reports/timing-metrics?${queryString}`)
    ]);

    if (!activityRes.ok || !totalRes.ok || !timingRes.ok) {
      const errJson = await activityRes.json().catch(() => ({}));
      throw new Error(errJson.message || 'Failed to fetch reporting metrics from backend.');
    }

    const activityData = await activityRes.json();
    const totalData = await totalRes.json();
    const timingData = await timingRes.json();

    // Summary KPIs
    elements.totalReferrals.textContent = totalData.totalReferrals ?? activityData.summary?.totalReferrals ?? 0;
    elements.awaitingCount.textContent = activityData.summary?.awaitingCount ?? 0;

    renderMetricCard(elements.acceptedRate, elements.acceptedStatus, formatRate(activityData.summary?.acceptanceRate));
    renderMetricCard(elements.notAppropriateRate, elements.notAppropriateStatus, formatRate(activityData.summary?.notAppropriateRate));
    renderMetricCard(elements.serviceRate, elements.serviceStatus, formatRate(activityData.summary?.resultedInServiceRate));

    // Timing
    renderMetricCard(elements.respAvg, elements.respAvgStatus, formatDuration(timingData.timeToFirstResponse?.average));
    renderMetricCard(elements.respMedian, elements.respMedianStatus, formatDuration(timingData.timeToFirstResponse?.median));
    renderMetricCard(elements.servAvg, elements.servAvgStatus, formatDuration(timingData.timeToRecordedService?.average));
    renderMetricCard(elements.servMedian, elements.servMedianStatus, formatDuration(timingData.timeToRecordedService?.median));

    // Render Tables
    renderTable(elements.programTableBody, activityData.programBreakdowns, 'programId');
    renderTable(elements.departmentTableBody, activityData.departmentBreakdowns, 'departmentId');

  } catch (err) {
    showError(err.message);
  }
}

function renderTable(tbody, rows, idKey) {
  tbody.innerHTML = '';
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7">No data available for this range and scope.</td></tr>';
    return;
  }

  for (const row of rows) {
    const tr = document.createElement('tr');
    const rate = formatRate(row.acceptanceRate);

    tr.innerHTML = `
      <td>${row[idKey] ?? 'N/A'}</td>
      <td>${row.madeCount ?? 0}</td>
      <td>${row.receivedCount ?? 0}</td>
      <td>${row.acceptedCount ?? 0}</td>
      <td>${row.notAppropriateCount ?? 0}</td>
      <td>${row.awaitingCount ?? 0}</td>
      <td>${rate.text} <span class="kpi-status status-${rate.status}">${rate.status}</span></td>
    `;
    tbody.appendChild(tr);
  }
}

// UI Controllers
elements.periodSelect.addEventListener('change', () => {
  elements.dateGroup.style.display = elements.periodSelect.value === 'CUSTOM' ? 'flex' : 'none';
});

elements.scopeTypeSelect.addEventListener('change', () => {
  const type = elements.scopeTypeSelect.value;
  if (type === 'ORGANIZATION') {
    elements.scopeIdGroup.style.display = 'none';
    elements.scopeIdInput.value = '';
  } else {
    elements.scopeIdGroup.style.display = 'flex';
    elements.scopeIdLabel.textContent = type === 'PROGRAM' ? 'Program ID' : 'Department ID';
  }
});

elements.form.addEventListener('submit', (e) => {
  e.preventDefault();
  loadReports();
});

// Initial load
loadReports();
