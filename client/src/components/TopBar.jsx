import { useState } from 'react';
import { LANGUAGES } from '../i18n.js';

const CHANGELOG = [
  { version: '0.5.0', notes: 'Added Settings: pick a language and switch between bubble or list chat layout.' },
  { version: '0.4.0', notes: 'Added changeable profile pictures and a new dark red theme.' },
  { version: '0.3.0', notes: 'Switched to a friends-list layout with 1:1 chat instead of servers/channels.' },
  { version: '0.2.0', notes: 'Added real-time typing indicators and online presence.' },
  { version: '0.1.0', notes: 'Initial release: register/login, real-time messaging.' },
];

export default function TopBar({ requests, onRefreshRequests, onRespond, onSendRequest, settings, onUpdateSettings, onLogout, t }) {
  const [showExtra, setShowExtra] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');

  async function handleAddFriend(e) {
    e.preventDefault();
    setAddError('');
    setAddSuccess('');
    try {
      await onSendRequest(addUsername.trim());
      setAddSuccess(t('friendRequestSent', addUsername.trim()));
      setAddUsername('');
    } catch (err) {
      setAddError(err.message);
    }
  }

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="app-brand">MK</span>
        <div className="dropdown-wrap">
          <button className="top-bar-btn" onClick={() => setShowExtra((v) => !v)}>{t('extra')} ▾</button>
          {showExtra && (
            <div className="dropdown-menu" onMouseLeave={() => setShowExtra(false)}>
              <div className="dropdown-item disabled">{t('nothingHere')}</div>
            </div>
          )}
        </div>
      </div>
      <div className="top-bar-right">
        <button className="top-bar-btn" onClick={() => setShowSettings(true)}>⚙ {t('settings')}</button>
        <button className="top-bar-btn" onClick={() => setShowLog(true)}>{t('updateLog')}</button>
        <button
          className="top-bar-btn"
          onClick={() => {
            onRefreshRequests();
            setShowRequests(true);
          }}
        >
          {t('friendRequest')}{requests.length > 0 && <span className="badge">{requests.length}</span>}
        </button>
      </div>

      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('settingsTitle')}</h2>

            <div className="settings-section">
              <div className="settings-label">{t('language')}</div>
              <select
                className="settings-select"
                value={settings.language}
                onChange={(e) => onUpdateSettings({ language: e.target.value })}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>

            <div className="settings-section">
              <div className="settings-label">{t('chatLayout')}</div>

              <label className={`layout-option ${settings.chatLayout === 'bubble' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="chatLayout"
                  checked={settings.chatLayout === 'bubble'}
                  onChange={() => onUpdateSettings({ chatLayout: 'bubble' })}
                />
                <div>
                  <div className="layout-option-title">{t('layoutBubble')}</div>
                  <div className="layout-option-desc">{t('layoutBubbleDesc')}</div>
                </div>
              </label>

              <label className={`layout-option ${settings.chatLayout === 'flat' ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="chatLayout"
                  checked={settings.chatLayout === 'flat'}
                  onChange={() => onUpdateSettings({ chatLayout: 'flat' })}
                />
                <div>
                  <div className="layout-option-title">{t('layoutFlat')}</div>
                  <div className="layout-option-desc">{t('layoutFlatDesc')}</div>
                </div>
              </label>
            </div>

            <div className="settings-section">
              <div className="settings-label">Account</div>
              <button className="settings-logout-btn" onClick={onLogout}>⏻ {t('logout') || 'Log Out'}</button>
            </div>

            <div className="modal-actions">
              <button onClick={() => setShowSettings(false)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {showLog && (
        <div className="modal-overlay" onClick={() => setShowLog(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('updateLogTitle')}</h2>
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="changelog-entry">
                <div className="changelog-version">v{entry.version}</div>
                <div className="changelog-notes">{entry.notes}</div>
              </div>
            ))}
            <div className="modal-actions">
              <button onClick={() => setShowLog(false)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}

      {showRequests && (
        <div className="modal-overlay" onClick={() => setShowRequests(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t('addFriend')}</h2>
            <form onSubmit={handleAddFriend}>
              <input
                value={addUsername}
                onChange={(e) => setAddUsername(e.target.value)}
                placeholder={t('enterUsername')}
                autoFocus
              />
              {addError && <div className="auth-error">{addError}</div>}
              {addSuccess && <div className="add-success">{addSuccess}</div>}
              <div className="modal-actions">
                <button type="submit">{t('sendFriendRequest')}</button>
              </div>
            </form>

            <h2 style={{ marginTop: 24 }}>{t('pendingRequests')}</h2>
            {requests.length === 0 && <div className="friends-empty">{t('noPendingRequests')}</div>}
            {requests.map((r) => (
              <div key={r.id} className="request-row">
                <span>{r.fromUsername}</span>
                <div className="request-actions">
                  <button onClick={() => onRespond(r.id, true)}>{t('accept')}</button>
                  <button className="secondary" onClick={() => onRespond(r.id, false)}>{t('decline')}</button>
                </div>
              </div>
            ))}

            <div className="modal-actions">
              <button className="secondary" onClick={() => setShowRequests(false)}>{t('close')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
