const MODEL_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.12/model/';
const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[char]));
const localDate = () => {
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return now.toISOString().slice(0, 10);
};
const detectorOptions = () => new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });

let activeTab = 'checkin';
let attendanceCameraReady = false;
let attendanceCameraInitializing = false;
let enrollmentCameraReady = false;
let enrollmentCameraInitializing = false;
let faceModelsPromise;
let scanBusy = false;
let busyUntil = 0;
let openManualAfterLogin = false;
let showAllDates = false;
let token = sessionStorage.getItem('attendance-token') || '';
let enrolledPeople = [];
let rosterPeople = [];
let attendanceRows = [];
let reportPeople = [];

async function api(path, method = 'GET', body) {
  const response = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Token': token },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== '/login') logout();
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === 'string'
      ? detail
      : [detail?.message, ...(detail?.errors || [])].filter(Boolean).join('\n') || 'Request failed';
    throw new Error(message);
  }
  return data;
}

function setStatus(element, message, tone = 'muted') {
  element.textContent = message;
  element.className = `status ${tone}`;
}

function loadFaceModels() {
  if (!faceModelsPromise) {
    faceModelsPromise = Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
    ]).catch(error => {
      faceModelsPromise = undefined;
      throw new Error(`Face models could not load: ${error.message}`);
    });
  }
  return faceModelsPromise;
}

async function openCamera(videoId) {
  await loadFaceModels();
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
    audio: false
  });
  $(videoId).srcObject = stream;
}

function closeCamera(videoId) {
  const video = $(videoId);
  video.srcObject?.getTracks().forEach(track => track.stop());
  video.srcObject = null;
}

async function scanLoop() {
  if (attendanceCameraReady && activeTab === 'checkin' && !scanBusy && Date.now() >= busyUntil) {
    scanBusy = true;
    try {
      const detections = await faceapi.detectAllFaces($('v1'), detectorOptions())
        .withFaceLandmarks().withFaceDescriptors();
      if (attendanceCameraReady) {
        if (detections.length === 0) {
          setStatus($('st'), 'No face detected. Look toward the camera.', 'muted');
        } else if (detections.length > 1) {
          setStatus($('st'), 'More than one face detected. Please scan one person at a time.', 'bad');
        } else {
          const result = await api('/checkin', 'POST', { descriptor: Array.from(detections[0].descriptor) });
          if (result.status === 'ok') {
            setStatus($('st'), `${result.name}: ${result.type} recorded at ${result.time}.`, 'good');
            busyUntil = Date.now() + 4000;
          } else if (result.status === 'already_recorded' || result.status === 'cooldown') {
            setStatus($('st'), `${result.name}: today's record is already up to date.`, 'good');
            busyUntil = Date.now() + 3000;
          } else if (result.status === 'ambiguous') {
            setStatus($('st'), 'Could not distinguish this face reliably. Please use the staffed desk.', 'bad');
            busyUntil = Date.now() + 2000;
          } else {
            setStatus($('st'), 'Face not recognised. Please use the staffed desk.', 'bad');
            busyUntil = Date.now() + 1500;
          }
        }
      }
    } catch (error) {
      setStatus($('st'), error.message, 'bad');
      busyUntil = Date.now() + 2000;
    } finally {
      scanBusy = false;
    }
  }
  window.setTimeout(scanLoop, 1000);
}

$('nav').addEventListener('click', event => {
  const selectedTab = event.target.closest('button[data-t]')?.dataset.t;
  if (!selectedTab) return;
  activeTab = selectedTab;
  document.querySelectorAll('#nav button').forEach(button => {
    const selected = button.dataset.t === selectedTab;
    button.classList.toggle('on', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  document.querySelectorAll('main > section').forEach(section => {
    section.classList.toggle('on', section.id === selectedTab);
    section.hidden = section.id !== selectedTab;
  });
  if (selectedTab === 'admin' && token) showAdmin();
});

function openManualAttendance() {
  $('nav').querySelector('[data-t="admin"]').click();
  if (token) {
    $('manualAttendanceSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  openManualAfterLogin = true;
  $('lerr').textContent = 'Administrator sign-in is required to add a manual attendance record.';
  $('pw').focus();
}

$('openManualAttendance').addEventListener('click', openManualAttendance);
$('attendanceCameraToggle').addEventListener('click', async () => {
  const button = $('attendanceCameraToggle');
  if (attendanceCameraReady) {
    closeCamera('v1');
    attendanceCameraReady = false;
    button.textContent = 'Start attendance camera';
    $('cameraState').textContent = 'CAMERA OFF';
    $('cameraTag').textContent = 'CAMERA OFF';
    $('cameraTag').parentElement.classList.remove('camera-ready');
    $('attendanceCameraStatus').textContent = 'Attendance camera is off.';
    setStatus($('st'), 'Camera off. Start it when you are ready to scan.', 'muted');
    return;
  }
  if (attendanceCameraInitializing) return;
  attendanceCameraInitializing = true;
  button.disabled = true;
  button.textContent = 'Starting attendance camera…';
  $('cameraState').textContent = 'CAMERA STARTING';
  $('cameraTag').textContent = 'CAMERA STARTING';
  $('attendanceCameraStatus').textContent = 'Loading face models and requesting camera access…';
  try {
    await openCamera('v1');
    attendanceCameraReady = true;
    button.textContent = 'Stop attendance camera';
    $('cameraState').textContent = 'CAMERA ACTIVE';
    $('cameraTag').textContent = 'LIVE PREVIEW';
    $('cameraTag').parentElement.classList.add('camera-ready');
    $('attendanceCameraStatus').textContent = 'Attendance camera is active.';
    setStatus($('st'), 'Camera ready. Look toward the lens.', 'muted');
  } catch (error) {
    button.textContent = 'Start attendance camera';
    $('cameraState').textContent = 'CAMERA UNAVAILABLE';
    $('cameraTag').textContent = 'NO CAMERA FEED';
    $('attendanceCameraStatus').textContent = `Attendance camera could not start: ${error.message}. Allow camera access and check your connection.`;
    setStatus($('st'), 'Camera unavailable. Ask the administrator for manual attendance.', 'bad');
  } finally {
    attendanceCameraInitializing = false;
    button.disabled = false;
  }
});

$('enrollmentCameraToggle').addEventListener('click', async () => {
  const button = $('enrollmentCameraToggle');
  const status = $('enrollmentCameraStatus');
  if (enrollmentCameraReady) {
    closeCamera('v2');
    enrollmentCameraReady = false;
    button.textContent = 'Start enrollment camera';
    $('enrollmentCameraTag').textContent = 'CAMERA OFF';
    $('enrollmentCameraTag').parentElement.classList.remove('camera-ready');
    status.textContent = 'Enrollment camera is off.';
    $('cap').disabled = true;
    $('es').textContent = 'Start the enrollment camera before capturing samples.';
    return;
  }
  if (enrollmentCameraInitializing) return;
  enrollmentCameraInitializing = true;
  button.disabled = true;
  button.textContent = 'Starting enrollment camera…';
  $('enrollmentCameraTag').textContent = 'CAMERA STARTING';
  status.textContent = 'Loading face models and requesting camera access…';
  try {
    await openCamera('v2');
    enrollmentCameraReady = true;
    button.textContent = 'Stop enrollment camera';
    $('enrollmentCameraTag').textContent = 'LIVE PREVIEW';
    $('enrollmentCameraTag').parentElement.classList.add('camera-ready');
    status.textContent = 'Enrollment camera is active.';
    $('cap').disabled = false;
    $('es').textContent = 'Enter the person’s details and capture samples when ready.';
  } catch (error) {
    button.textContent = 'Start enrollment camera';
    $('enrollmentCameraTag').textContent = 'NO CAMERA FEED';
    status.textContent = `Enrollment camera could not start: ${error.message}. Allow camera access and check your connection.`;
  } finally {
    enrollmentCameraInitializing = false;
    button.disabled = false;
  }
});

function closeSettingsMenu() {
  $('settingsMenu').hidden = true;
  $('settingsToggle').setAttribute('aria-expanded', 'false');
}

function applyTheme(theme) {
  const selectedTheme = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = selectedTheme;
  localStorage.setItem('mhhs-theme', selectedTheme);
  $('themeSelect').value = selectedTheme;
}

$('settingsToggle').addEventListener('click', () => {
  const open = $('settingsMenu').hidden;
  $('settingsMenu').hidden = !open;
  $('settingsToggle').setAttribute('aria-expanded', String(open));
});
$('themeSelect').addEventListener('change', () => applyTheme($('themeSelect').value));
$('openProjectSettings').addEventListener('click', () => {
  closeSettingsMenu();
  $('nav').querySelector('[data-t="admin"]').click();
  window.setTimeout(() => $(token ? 'projectSettings' : 'loginBox').scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
});
document.addEventListener('click', event => {
  if (!event.target.closest('.settings-control')) closeSettingsMenu();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeSettingsMenu();
});

function showAdmin() {
  $('loginBox').hidden = Boolean(token);
  $('adminBox').hidden = !token;
  if (!token) return;
  loadPeople().catch(showAdminError);
  loadRoster().catch(showAdminError);
  loadAttendance().catch(showAdminError);
}

function showAdminError(error) {
  $('lerr').textContent = error.message;
}

function logout() {
  token = '';
  sessionStorage.removeItem('attendance-token');
  showAdmin();
}

function setPasswordVisible(visible) {
  $('pw').type = visible ? 'text' : 'password';
  $('passwordEye').toggleAttribute('hidden', visible);
  $('passwordEyeOff').toggleAttribute('hidden', !visible);
  $('passwordToggle').setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
  $('passwordToggle').setAttribute('title', visible ? 'Hide password' : 'Show password');
  $('passwordToggle').setAttribute('aria-pressed', String(visible));
}

$('logout').addEventListener('click', logout);
$('passwordToggle').addEventListener('click', () => setPasswordVisible($('pw').type === 'password'));
$('loginBtn').addEventListener('click', async () => {
  try {
    const result = await api('/login', 'POST', { password: $('pw').value });
    token = result.token;
    sessionStorage.setItem('attendance-token', token);
    $('pw').value = '';
    setPasswordVisible(false);
    $('lerr').textContent = '';
    showAdmin();
    if (openManualAfterLogin) {
      openManualAfterLogin = false;
      window.setTimeout(() => $('manualAttendanceSection').scrollIntoView({ behavior: 'smooth', block: 'center' }), 0);
    }
  } catch (error) {
    $('lerr').textContent = error.message;
  }
});
$('pw').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('loginBtn').click();
});

$('changeAdminPassword').addEventListener('click', async () => {
  const status = $('passwordChangeStatus');
  const currentPassword = $('currentAdminPassword').value;
  const newPassword = $('newAdminPassword').value;
  const confirmation = $('confirmAdminPassword').value;
  if (newPassword.length < 12) {
    status.textContent = 'New password must be at least 12 characters.';
    return;
  }
  if (newPassword !== confirmation) {
    status.textContent = 'New password and confirmation do not match.';
    return;
  }
  const button = $('changeAdminPassword');
  button.disabled = true;
  status.textContent = 'Updating password…';
  try {
    const result = await api('/admin/password', 'POST', {
      current_password: currentPassword,
      new_password: newPassword
    });
    token = '';
    sessionStorage.removeItem('attendance-token');
    $('currentAdminPassword').value = '';
    $('newAdminPassword').value = '';
    $('confirmAdminPassword').value = '';
    showAdmin();
    $('lerr').textContent = result.message + ' Sign in with the new password.';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

async function captureSamples() {
  const name = $('nm').value.trim();
  const personId = $('pid').value.trim();
  const status = $('es');
  if (!name || !personId) {
    status.textContent = 'Enter a name and ID first.';
    return;
  }
  if (!$('centerName').value.trim()) {
    status.textContent = 'Enter the school or centre first.';
    return;
  }
  if (!$('consent').checked) {
    status.textContent = 'Confirm that the person has been informed and consent has been recorded.';
    return;
  }
  if (!enrollmentCameraReady) {
    status.textContent = 'Start the enrollment camera before capturing samples.';
    return;
  }

  const button = $('cap');
  button.disabled = true;
  status.textContent = 'Collecting clear face samples. Turn slightly between captures.';
  const descriptors = [];
  let attempts = 0;
  try {
    while (descriptors.length < 5 && attempts < 50 && enrollmentCameraReady) {
      attempts += 1;
      const faces = await faceapi.detectAllFaces($('v2'), detectorOptions())
        .withFaceLandmarks().withFaceDescriptors();
      if (faces.length === 1) descriptors.push(faces[0].descriptor);
      status.textContent = `Captured ${descriptors.length} of 5 samples. Turn slightly between captures.`;
      await new Promise(resolve => window.setTimeout(resolve, 700));
    }
    if (!enrollmentCameraReady) throw new Error('Enrollment camera was stopped before capture finished.');
    if (descriptors.length < 5) throw new Error('Could not capture five clear, single-person samples. Improve lighting and try again.');
    const average = new Array(128).fill(0);
    descriptors.forEach(descriptor => descriptor.forEach((value, index) => { average[index] += value / descriptors.length; }));
    await api('/people', 'POST', {
      id: personId,
      name,
      role: $('rl').value,
      center: $('centerName').value.trim(),
      group_name: $('groupName').value.trim(),
      consent_recorded: $('consent').checked,
      descriptor: average
    });
    status.textContent = `${name} enrolled. Remember that the descriptor is sensitive biometric data.`;
    $('nm').value = '';
    $('pid').value = '';
    $('consent').checked = false;
    await loadRoster();
    await loadPeople();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = !enrollmentCameraReady;
  }
}
$('cap').addEventListener('click', captureSamples);

function updateManualTypes() {
  const person = rosterPeople.find(item => item.id === $('manualPerson').value);
  const types = person?.role === 'Student' ? ['Present'] : ['Check-in', 'Check-out'];
  $('manualType').innerHTML = types.map(type => `<option>${escapeHTML(type)}</option>`).join('');
}

function updateOverview() {
  $('overviewPeople').textContent = String(enrolledPeople.length);
  $('overviewRecords').textContent = String(attendanceRows.length);
  $('overviewFace').textContent = String(attendanceRows.filter(row => row.source === 'face').length);
  $('overviewManual').textContent = String(attendanceRows.filter(row => row.source === 'manual').length);
  const date = $('d').value;
  $('overviewPeriod').textContent = showAllDates || !date
    ? 'Across all dates'
    : date === localDate() ? 'For today' : `For ${date}`;
}

async function loadPeople() {
  enrolledPeople = await api('/people');
  $('peopleCount').textContent = String(enrolledPeople.length);
  updateOverview();
  $('ppl').innerHTML = '<thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Centre</th><th>Class / group</th><th>Face data</th><th></th></tr></thead><tbody>' +
    (enrolledPeople.length
      ? enrolledPeople.map(person => `<tr><td>${escapeHTML(person.name)}</td><td>${escapeHTML(person.id)}</td><td>${escapeHTML(person.role)}</td><td>${escapeHTML(person.center)}</td><td>${escapeHTML(person.group_name)}</td><td>Stored</td><td><button class="remove-button" type="button" data-remove="${escapeHTML(person.id)}">Remove</button></td></tr>`).join('')
      : '<tr><td class="empty-row" colspan="7">No face-enrolled people.</td></tr>') + '</tbody>';
}

function updateReportGroups() {
  const center = $('reportCenter').value;
  const selectedGroup = $('reportGroup').value;
  const groups = [...new Set(rosterPeople
    .filter(person => !center || person.center === center)
    .map(person => person.group_name)
    .filter(Boolean))].sort();
  $('reportGroup').innerHTML = '<option value="">All classes</option>' +
    groups.map(group => `<option value="${escapeHTML(group)}">${escapeHTML(group)}</option>`).join('');
  if (groups.includes(selectedGroup)) $('reportGroup').value = selectedGroup;
}

async function loadRoster() {
  rosterPeople = await api('/roster');
  const selectedCenter = $('reportCenter').value;
  const centers = [...new Set(rosterPeople.map(person => person.center).filter(Boolean))].sort();
  $('reportCenter').innerHTML = '<option value="">All centres</option>' +
    centers.map(center => `<option value="${escapeHTML(center)}">${escapeHTML(center)}</option>`).join('');
  if (centers.includes(selectedCenter)) $('reportCenter').value = selectedCenter;
  $('manualPerson').innerHTML = rosterPeople
    .map(person => `<option value="${escapeHTML(person.id)}">${escapeHTML(person.name)} · ${escapeHTML(person.id)}</option>`)
    .join('');
  if (!rosterPeople.length) $('manualPerson').innerHTML = '<option value="">No roster members</option>';
  $('privacyDirectory').innerHTML = '<thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Centre</th><th>Class / group</th><th>Face data</th><th>Consent recorded</th><th></th></tr></thead><tbody>' +
    (rosterPeople.length
      ? rosterPeople.map(person => `<tr><td>${escapeHTML(person.name)}</td><td>${escapeHTML(person.id)}</td><td>${escapeHTML(person.role)}</td><td>${escapeHTML(person.center)}</td><td>${escapeHTML(person.group_name)}</td><td>${person.face_enrolled ? 'Stored' : 'Not enrolled'}</td><td>${person.consent_at ? escapeHTML(person.consent_at.replace('T', ' ')) : person.face_enrolled ? 'Not recorded' : 'Not collected'}</td><td><button class="remove-button" type="button" data-erase="${escapeHTML(person.id)}">Erase all</button></td></tr>`).join('')
      : '<tr><td class="empty-row" colspan="8">No roster data to manage.</td></tr>') + '</tbody>';
  updateManualTypes();
  updateReportGroups();
  await loadAttendanceReport();
}

function renderAttendanceReport() {
  const statusFilter = $('reportStatus').value;
  const visiblePeople = reportPeople.filter(person =>
    statusFilter === 'all' || (statusFilter === 'present' ? person.present : !person.present)
  );
  $('attendanceReport').innerHTML = '<thead><tr><th>Name</th><th>ID</th><th>Role</th><th>Centre</th><th>Class / group</th><th>Status</th></tr></thead><tbody>' +
    (visiblePeople.length
      ? visiblePeople.map(person => `<tr><td>${escapeHTML(person.name)}</td><td>${escapeHTML(person.id)}</td><td>${escapeHTML(person.role)}</td><td>${escapeHTML(person.center)}</td><td>${escapeHTML(person.group_name)}</td><td class="${person.present ? 'attendance-present' : 'attendance-absent'}">${person.present ? 'Present' : 'Absent'}</td></tr>`).join('')
      : '<tr><td class="empty-row" colspan="6">No people match this report filter.</td></tr>') + '</tbody>';
}

async function loadAttendanceReport() {
  const parameters = new URLSearchParams({ date_filter: $('reportDate').value || localDate() });
  if ($('reportCenter').value) parameters.set('center', $('reportCenter').value);
  if ($('reportGroup').value) parameters.set('group_name', $('reportGroup').value);
  const report = await api('/attendance/summary?' + parameters.toString());
  reportPeople = report.people;
  $('reportTotal').textContent = String(report.total);
  $('reportPresent').textContent = String(report.present);
  $('reportAbsent').textContent = String(report.absent);
  renderAttendanceReport();
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

$('rosterTemplate').addEventListener('click', () => {
  const template = 'id,name,role,center,class\r\nSTU-001,Jordan Lee,Student,North Campus,Grade 8 A\r\n';
  const url = URL.createObjectURL(new Blob([template], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'attendance-roster-template.csv';
  anchor.click();
  URL.revokeObjectURL(url);
});

$('rosterImport').addEventListener('click', async () => {
  const file = $('rosterFile').files[0];
  const status = $('rosterStatus');
  if (!file) {
    status.textContent = 'Choose a CSV file first.';
    return;
  }
  if (file.size > 1_000_000) {
    status.textContent = 'CSV file must be 1 MB or smaller.';
    return;
  }
  const button = $('rosterImport');
  button.disabled = true;
  status.textContent = 'Validating roster…';
  try {
    const result = await api('/roster/import', 'POST', { csv_text: await file.text() });
    status.textContent = result.message;
    $('rosterFile').value = '';
    await loadRoster();
    await loadPeople();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$('reportCenter').addEventListener('change', () => {
  updateReportGroups();
  loadAttendanceReport().catch(showAdminError);
});
$('reportGroup').addEventListener('change', () => loadAttendanceReport().catch(showAdminError));
$('reportDate').addEventListener('change', () => loadAttendanceReport().catch(showAdminError));
$('reportStatus').addEventListener('change', renderAttendanceReport);
$('reportCsv').addEventListener('click', () => {
  const columns = ['Date', 'Name', 'ID', 'Role', 'Centre', 'Class / group', 'Status'];
  const rows = reportPeople.filter(person => {
    const filter = $('reportStatus').value;
    return filter === 'all' || (filter === 'present' ? person.present : !person.present);
  });
  const lines = [columns.map(csvCell).join(','), ...rows.map(person => [
    $('reportDate').value, person.name, person.id, person.role, person.center, person.group_name,
    person.present ? 'Present' : 'Absent'
  ].map(csvCell).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `attendance-report-${$('reportDate').value || localDate()}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
});

$('manualPerson').addEventListener('change', updateManualTypes);
$('ppl').addEventListener('click', async event => {
  const personId = event.target.dataset.remove;
  if (!personId || !window.confirm('Delete this person\'s face descriptor? Existing attendance records are retained.')) return;
  try {
    await api('/people/' + encodeURIComponent(personId), 'DELETE');
    await loadPeople();
  } catch (error) {
    showAdminError(error);
  }
});

$('privacyDirectory').addEventListener('click', async event => {
  const personId = event.target.closest('button[data-erase]')?.dataset.erase;
  if (!personId) return;
  const person = rosterPeople.find(item => item.id === personId);
  const label = person ? `${person.name} (${person.id})` : personId;
  if (!window.confirm(`Permanently erase ${label}, including face data and attendance history? This cannot be undone.`)) return;
  const status = $('privacyStatus');
  try {
    const result = await api('/roster/' + encodeURIComponent(personId), 'DELETE');
    status.textContent = `Erased ${label} and ${result.deleted_attendance_records} attendance record(s).`;
    status.classList.add('privacy-success');
    await Promise.all([loadRoster(), loadPeople(), loadAttendance()]);
  } catch (error) {
    status.textContent = error.message;
    status.classList.remove('privacy-success');
  }
});

async function loadAttendance() {
  const dateQuery = showAllDates ? '' : `?date_filter=${encodeURIComponent($('d').value)}`;
  attendanceRows = await api('/attendance' + dateQuery);
  updateOverview();
  $('lg').innerHTML = '<thead><tr><th>Date</th><th>Time</th><th>Name</th><th>ID</th><th>Role</th><th>Type</th><th>Distance</th><th>Source / note</th></tr></thead><tbody>' +
    (attendanceRows.length
      ? attendanceRows.map(row => `<tr><td>${escapeHTML(row.date)}</td><td>${escapeHTML(row.time)}</td><td>${escapeHTML(row.name)}</td><td>${escapeHTML(row.person_id)}</td><td>${escapeHTML(row.role)}</td><td>${escapeHTML(row.type)}</td><td>${row.distance == null ? '—' : Number(row.distance).toFixed(4)}</td><td title="${escapeHTML(row.note)}">${escapeHTML(row.source)}${row.note ? ` · ${escapeHTML(row.note)}` : ''}</td></tr>`).join('')
      : '<tr><td class="empty-row" colspan="8">No attendance records for this selection.</td></tr>') + '</tbody>';
}

$('d').value = localDate();
$('manualDate').value = localDate();
$('reportDate').value = localDate();
$('d').addEventListener('change', () => {
  showAllDates = false;
  loadAttendance().catch(showAdminError);
});
$('all').addEventListener('click', () => {
  showAllDates = true;
  loadAttendance().catch(showAdminError);
});

$('manualSave').addEventListener('click', async () => {
  const status = $('manualStatus');
  const note = $('manualNote').value.trim();
  if (!$('manualPerson').value || !note) {
    status.textContent = 'Select a person and enter a reason.';
    return;
  }
  try {
    await api('/attendance/manual', 'POST', {
      person_id: $('manualPerson').value,
      date: $('manualDate').value,
      type: $('manualType').value,
      note
    });
    status.textContent = 'Manual record added.';
    $('manualNote').value = '';
    showAllDates = false;
    $('d').value = $('manualDate').value;
    await loadAttendance();
  } catch (error) {
    status.textContent = error.message;
  }
});

$('csv').addEventListener('click', () => {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const columns = ['Date', 'Time', 'Name', 'ID', 'Role', 'Type', 'Distance', 'Source', 'Note'];
  const lines = [columns.map(cell).join(','), ...attendanceRows.map(row => [
    row.date, row.time, row.name, row.person_id, row.role, row.type, row.distance ?? '', row.source, row.note
  ].map(cell).join(','))];
  const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `attendance-${$('d').value || 'all-dates'}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
});

window.addEventListener('beforeunload', () => {
  ['v1', 'v2'].forEach(closeCamera);
});

showAdmin();
applyTheme(localStorage.getItem('mhhs-theme') || 'dark');
scanLoop();