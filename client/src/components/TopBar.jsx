import { useRef, useState } from 'react';
import { LANGUAGES } from '../i18n.js';

const CHANGELOG = [
  { version: '0.5.0', notes: 'Added Settings: pick a language and switch between bubble or list chat layout.' },
  { version: '0.4.0', notes: 'Added changeable profile pictures and a new dark red theme.' },
  { version: '0.3.0', notes: 'Switched to a friends-list layout with 1:1 chat instead of servers/channels.' },
  { version: '0.2.0', notes: 'Added real-time typing indicators and online presence.' },
  { version: '0.1.0', notes: 'Initial release: register/login, real-time messaging.' },
];

export default function TopBar({ requests, onRefreshRequests, onRespond, onSendRequest, settings, onUpdateSettings, onLogout, currentUser, onUploadRingtone, onResetRingtone, onBuyUltra, onSetUltraColor, t }) {
  const [showExtra, setShowExtra] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRequests, setShowRequests] = useState(false);
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [ringtoneBusy, setRingtoneBusy] = useState(null); // 'outgoing' | 'incoming' | null
  const [ultraBusy, setUltraBusy] = useState(false);
  const outgoingFileRef = useRef(null);
  const incomingFileRef = useRef(null);

  async function handleBuyUltra() {
    setUltraBusy(true);
    try {
      await onBuyUltra();
    } catch (err) {
      console.error('MK ULTRA checkout failed:', err.message);
      setUltraBusy(false);
    }
    // On success this navigates away to Stripe, so no need to clear busy.
  }

  async function handleUltraColorChange(e) {
    try {
      await onSetUltraColor(e.target.value);
    } catch (err) {
      console.error('Failed to set MK ULTRA color:', err.message);
    }
  }

  async function handleRingtoneFile(type, e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setRingtoneBusy(type);
    try {
      await onUploadRingtone(type, file);
    } catch (err) {
      console.error('Ringtone upload failed:', err.message);
    } finally {
      setRingtoneBusy(null);
    }
  }

  async function handleRingtoneReset(type) {
    setRingtoneBusy(type);
    try {
      await onResetRingtone(type);
    } catch (err) {
      console.error('Ringtone reset failed:', err.message);
    } finally {
      setRingtoneBusy(null);
    }
  }

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
              <div className="settings-label">Ringtones</div>

              <div className="ringtone-row">
                <div className="ringtone-row-info">
                  <div className="ringtone-row-title">Outgoing call</div>
                  <div className="ringtone-row-desc">
                    {currentUser?.ringtoneOutgoingUrl ? 'Custom ringtone' : 'Default ringtone'}
                  </div>
                </div>
                <div className="ringtone-row-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={ringtoneBusy === 'outgoing'}
                    onClick={() => outgoingFileRef.current?.click()}
                  >
                    {ringtoneBusy === 'outgoing' ? '…' : 'Upload'}
                  </button>
                  {currentUser?.ringtoneOutgoingUrl && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={ringtoneBusy === 'outgoing'}
                      onClick={() => handleRingtoneReset('outgoing')}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <input
                  ref={outgoingFileRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleRingtoneFile('outgoing', e)}
                />
              </div>

              <div className="ringtone-row">
                <div className="ringtone-row-info">
                  <div className="ringtone-row-title">Incoming call</div>
                  <div className="ringtone-row-desc">
                    {currentUser?.ringtoneIncomingUrl ? 'Custom ringtone' : 'Default ringtone'}
                  </div>
                </div>
                <div className="ringtone-row-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={ringtoneBusy === 'incoming'}
                    onClick={() => incomingFileRef.current?.click()}
                  >
                    {ringtoneBusy === 'incoming' ? '…' : 'Upload'}
                  </button>
                  {currentUser?.ringtoneIncomingUrl && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={ringtoneBusy === 'incoming'}
                      onClick={() => handleRingtoneReset('incoming')}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <input
                  ref={incomingFileRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={(e) => handleRingtoneFile('incoming', e)}
                />
              </div>
            </div>

            <div className="settings-section">
              <div className="settings-label">MK ULTRA</div>
              {currentUser?.isUltra ? (
                <div className="ultra-panel">
                  <div className="ultra-panel-title">
                    <span className="ultra-badge" title="MK ULTRA">⚡ ULTRA</span> You're an MK ULTRA member
                  </div>
                  <div className="ultra-panel-desc">
                    Permanent chats, GIF avatars, and a custom accent color are unlocked.
                  </div>
                  <div className="ultra-color-row">
                    <span className="ringtone-row-title">Accent color</span>
                    <input
                      type="color"
                      value={currentUser.ultraColor || '#ffffff'}
                      onChange={handleUltraColorChange}
                    />
                  </div>
                </div>
              ) : (
                <div className="ultra-panel">
                  <div className="ultra-panel-desc">
                    One-time $1 purchase: permanent chats (never auto-delete), animated GIF profile pictures,
                    a custom UI accent color, and a badge next to your name.
                  </div>
                  <button
                    type="button"
                    className="ultra-buy-btn"
                    disabled={ultraBusy}
                    onClick={handleBuyUltra}
                  >
                    {ultraBusy ? '…' : 'Get MK ULTRA — $1'}
                  </button>
                </div>
              )}
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
