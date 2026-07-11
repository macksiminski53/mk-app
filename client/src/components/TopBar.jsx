import { useEffect, useRef, useState } from 'react';
import { LANGUAGES } from '../i18n.js';
import { listAudioDevices } from '../webrtc.js';

const CHANGELOG = [
  { version: '0.16.0', notes: 'MK ULTRA is now MK PLUS (same $1 price, same perks). A new MK ULTRA ($5) tier takes its place with free Mega Chat creation, permanent Mini Chats, an emoji picker, and the ability to like messages.' },
  { version: '0.15.0', notes: 'Added a PC desktop app (with a system tray icon) and real OS notifications with a sound chime for new messages and incoming calls, even when the window isn\'t focused.' },
  { version: '0.14.0', notes: 'Redesigned audio message attachments as a cassette-tape player, with spinning reels and a scrubbable tape strip.' },
  { version: '0.13.0', notes: 'Removed emoji icons app-wide in favor of plain text labels for a cleaner, more consistent look.' },
  { version: '0.12.0', notes: 'You can now attach any file type to a message, not just images and audio. Free chats now always auto-delete after 24 hours -- get MK ULTRA to make a chat permanent.' },
  { version: '0.11.0', notes: 'Switched the app font to Arimo, and split Settings into Account, Voice Chat, and Data tabs -- including microphone and speaker device selection for calls.' },
  { version: '0.10.0', notes: 'Added account tokens: a long random code in Settings you can use to log in on another device, instead of typing username/password again.' },
  { version: '0.9.0', notes: 'Added MK ULTRA: a one-time $1 upgrade for permanent chats, animated GIF profile pictures, a custom accent color, and a badge next to your name.' },
  { version: '0.8.0', notes: 'Merged friend profile and chat settings into one panel, added a 24-hour auto-reset option per chat, and switched the whole UI accent from blue to white.' },
  { version: '0.7.0', notes: 'Redesigned voice calls with a centered call screen, smoother call icons, and custom/looping ringtones you can set in Settings.' },
  { version: '0.6.0', notes: 'Added a zoom/position profile picture cropper with persistence across redeploys, image/audio attachments with auto-delete for large files, and mutual-consent Delete Chat.' },
  { version: '0.5.0', notes: 'Added Settings: pick a language and switch between bubble or list chat layout.' },
  { version: '0.4.0', notes: 'Added changeable profile pictures and a new dark red theme.' },
  { version: '0.3.0', notes: 'Switched to a friends-list layout with 1:1 chat instead of servers/channels.' },
  { version: '0.2.0', notes: 'Added real-time typing indicators and online presence.' },
  { version: '0.1.0', notes: 'Initial release: register/login, real-time messaging.' },
];

export default function TopBar({ requests, onRefreshRequests, onRespond, onSendRequest, settings, onUpdateSettings, onLogout, currentUser, onUploadRingtone, onResetRingtone, onBuyPlus, onBuyUltra, onSetUltraColor, onRevealToken, onRegenerateToken, billingConfigured, onCreateMegaChat, onCreateMiniChat, onFetchStats, t }) {
  const [showExtra, setShowExtra] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState('account'); // 'account' | 'voice' | 'data'
  const [showRequests, setShowRequests] = useState(false);
  const [audioDevices, setAudioDevices] = useState({ inputs: [], outputs: [] });
  const [addUsername, setAddUsername] = useState('');
  const [addError, setAddError] = useState('');
  const [addSuccess, setAddSuccess] = useState('');
  const [ringtoneBusy, setRingtoneBusy] = useState(null); // 'outgoing' | 'incoming' | null
  const [plusBusy, setPlusBusy] = useState(false);
  const [plusError, setPlusError] = useState('');
  const [ultraBusy, setUltraBusy] = useState(false);
  const [ultraError, setUltraError] = useState('');
  const outgoingFileRef = useRef(null);
  const incomingFileRef = useRef(null);

  // ---- Account token (Settings > Data) ----
  const [revealedToken, setRevealedToken] = useState(null);
  const [showRevealForm, setShowRevealForm] = useState(false);
  const [revealPassword, setRevealPassword] = useState('');
  const [revealBusy, setRevealBusy] = useState(false);
  const [revealError, setRevealError] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy');

  const [showRegenerateForm, setShowRegenerateForm] = useState(false);
  const [regeneratePassword, setRegeneratePassword] = useState('');
  const [regenerateBusy, setRegenerateBusy] = useState(false);
  const [regenerateError, setRegenerateError] = useState('');

  // Device labels are usually blank until the browser has granted mic
  // permission at least once -- that's a browser privacy restriction, not a
  // bug. Loading on modal open (rather than app start) keeps this cheap.
  useEffect(() => {
    if (!showSettings) return;
    listAudioDevices()
      .then(setAudioDevices)
      .catch((err) => console.error('Failed to list audio devices:', err.message));
  }, [showSettings]);

  async function handleBuyPlus() {
    setPlusBusy(true);
    setPlusError('');
    try {
      await onBuyPlus();
    } catch (err) {
      console.error('MK PLUS checkout failed:', err.message);
      setPlusError(err.message || 'Something went wrong starting checkout.');
      setPlusBusy(false);
    }
    // On success this navigates away to Stripe, so no need to clear busy.
  }

  async function handleBuyUltra() {
    setUltraBusy(true);
    setUltraError('');
    try {
      await onBuyUltra();
    } catch (err) {
      console.error('MK ULTRA checkout failed:', err.message);
      setUltraError(err.message || 'Something went wrong starting checkout.');
      setUltraBusy(false);
    }
    // On success this navigates away to Stripe, so no need to clear busy.
  }

  async function handleUltraColorChange(e) {
    try {
      await onSetUltraColor(e.target.value);
    } catch (err) {
      console.error('Failed to set accent color:', err.message);
    }
  }

  async function handleOpenStats() {
    setShowExtra(false);
    setShowStats(true);
    setStatsLoading(true);
    try {
      const data = await onFetchStats();
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err.message);
      setStats(null);
    } finally {
      setStatsLoading(false);
    }
  }

  function formatAccountAge(createdAt) {
    if (!createdAt) return 'Unknown';
    const iso = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return 'Unknown';
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
    if (days < 1) return 'Joined today';
    if (days === 1) return '1 day';
    if (days < 30) return `${days} days`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months} month${months === 1 ? '' : 's'}`;
    const years = Math.floor(months / 12);
    return `${years} year${years === 1 ? '' : 's'}`;
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

  async function handleRevealSubmit(e) {
    e.preventDefault();
    setRevealBusy(true);
    setRevealError('');
    try {
      const tok = await onRevealToken(revealPassword);
      setRevealedToken(tok);
      setShowRevealForm(false);
      setRevealPassword('');
    } catch (err) {
      setRevealError(err.message || 'Incorrect password');
    } finally {
      setRevealBusy(false);
    }
  }

  function handleHideToken() {
    setRevealedToken(null);
    setCopyLabel('Copy');
  }

  async function handleCopyToken() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopyLabel('Copied!');
      setTimeout(() => setCopyLabel('Copy'), 1500);
    } catch (err) {
      console.error('Copy failed:', err.message);
    }
  }

  async function handleRegenerateSubmit(e) {
    e.preventDefault();
    setRegenerateBusy(true);
    setRegenerateError('');
    try {
      const tok = await onRegenerateToken(regeneratePassword);
      setRevealedToken(tok);
      setShowRegenerateForm(false);
      setRegeneratePassword('');
    } catch (err) {
      setRegenerateError(err.message || 'Incorrect password');
    } finally {
      setRegenerateBusy(false);
    }
  }

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <span className="app-brand">MK</span>
        <span className="app-version" title={`MK v${CHANGELOG[0].version}`}>v{CHANGELOG[0].version}</span>
        <div className="dropdown-wrap">
          <button className="top-bar-btn" onClick={() => setShowExtra((v) => !v)}>{t('extra')} ▾</button>
          {showExtra && (
            <div className="dropdown-menu" onMouseLeave={() => setShowExtra(false)}>
              <div className="dropdown-item" onClick={() => { onCreateMegaChat(); setShowExtra(false); }}>
                Create a Mega Chat
              </div>
              <div className="dropdown-item" onClick={() => { onCreateMiniChat(); setShowExtra(false); }}>
                Create a Mini Chat
              </div>
              <div className="dropdown-item dropdown-item-row">
                <span>Accent color</span>
                <input
                  type="color"
                  value={settings.customAccent || '#ffffff'}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onUpdateSettings({ customAccent: e.target.value })}
                  title="Pick a personal accent color (only visible on this device)"
                />
              </div>
              {settings.customAccent && (
                <div className="dropdown-item" onClick={() => { onUpdateSettings({ customAccent: '' }); }}>
                  Reset accent color
                </div>
              )}
              <div className="dropdown-item" onClick={handleOpenStats}>
                My Stats
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="top-bar-right">
        <button
          className="top-bar-btn"
          onClick={() => window.location.reload()}
          title="Reload MK to pick up the latest version"
        >
          Refresh
        </button>
        <button className="top-bar-btn" onClick={() => setShowSettings(true)}>{t('settings')}</button>
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

            <div className="settings-tabs">
              <button
                type="button"
                className={`settings-tab-btn ${settingsTab === 'account' ? 'active' : ''}`}
                onClick={() => setSettingsTab('account')}
              >
                Account
              </button>
              <button
                type="button"
                className={`settings-tab-btn ${settingsTab === 'membership' ? 'active' : ''}`}
                onClick={() => setSettingsTab('membership')}
              >
                MK PLUS/ULTRA
              </button>
              <button
                type="button"
                className={`settings-tab-btn ${settingsTab === 'voice' ? 'active' : ''}`}
                onClick={() => setSettingsTab('voice')}
              >
                Voice Chat
              </button>
              <button
                type="button"
                className={`settings-tab-btn ${settingsTab === 'data' ? 'active' : ''}`}
                onClick={() => setSettingsTab('data')}
              >
                Data
              </button>
            </div>

            {settingsTab === 'account' && (
              <>
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
                  <button className="settings-logout-btn" onClick={onLogout}>{t('logout') || 'Log Out'}</button>
                </div>
              </>
            )}

            {settingsTab === 'membership' && (
              <>
                <div className="settings-section">
                  <div className="settings-label">MK PLUS</div>
                  {currentUser?.isPlus ? (
                    <div className="ultra-panel">
                      <div className="ultra-panel-title">
                        <span className="plus-badge" title="MK PLUS">PLUS</span> You're an MK PLUS member
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
                      {billingConfigured === false ? (
                        <div className="ultra-panel-notice">
                          Payments aren't set up yet — check back soon.
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="plus-buy-btn"
                            disabled={plusBusy}
                            onClick={handleBuyPlus}
                          >
                            {plusBusy ? '…' : 'Get MK PLUS — $1'}
                          </button>
                          {plusError && <div className="ultra-panel-error">{plusError}</div>}
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div className="settings-section">
                  <div className="settings-label">MK ULTRA</div>
                  {currentUser?.isUltra ? (
                    <div className="ultra-panel">
                      <div className="ultra-panel-title">
                        <span className="ultra-badge" title="MK ULTRA">ULTRA</span> You're an MK ULTRA member
                      </div>
                      <div className="ultra-panel-desc">
                        Everything in MK PLUS, plus free Mega Chat creation, permanent Mini Chats whenever
                        you're a member, an emoji picker, and the ability to like messages.
                      </div>
                    </div>
                  ) : (
                    <div className="ultra-panel">
                      <div className="ultra-panel-desc">
                        One-time $5 purchase, on top of everything MK PLUS gives you: free Mega Chat creation,
                        permanent Mini Chats, an emoji picker in the message box, and the ability to like messages.
                      </div>
                      {billingConfigured === false ? (
                        <div className="ultra-panel-notice">
                          Payments aren't set up yet — check back soon.
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="ultra-buy-btn"
                            disabled={ultraBusy}
                            onClick={handleBuyUltra}
                          >
                            {ultraBusy ? '…' : 'Get MK ULTRA — $5'}
                          </button>
                          {ultraError && <div className="ultra-panel-error">{ultraError}</div>}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}

            {settingsTab === 'voice' && (
              <>
                <div className="settings-section">
                  <div className="settings-label">Input device (microphone)</div>
                  <select
                    className="settings-select"
                    value={settings.micDeviceId || ''}
                    onChange={(e) => onUpdateSettings({ micDeviceId: e.target.value })}
                  >
                    <option value="">System default</option>
                    {audioDevices.inputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || 'Microphone'}</option>
                    ))}
                  </select>
                </div>

                <div className="settings-section">
                  <div className="settings-label">Output device (speaker)</div>
                  <select
                    className="settings-select"
                    value={settings.speakerDeviceId || ''}
                    onChange={(e) => onUpdateSettings({ speakerDeviceId: e.target.value })}
                  >
                    <option value="">System default</option>
                    {audioDevices.outputs.map((d) => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || 'Speaker'}</option>
                    ))}
                  </select>
                  <div className="ringtone-row-desc" style={{ marginTop: 6 }}>
                    Output device selection only works in Chromium-based browsers (Chrome, Edge). Other browsers
                    use the system default.
                  </div>
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
              </>
            )}

            {settingsTab === 'data' && (
              <>
                <div className="settings-section">
                  <div className="settings-label">Account Token</div>
                  <div className="ringtone-row-desc" style={{ marginBottom: 8 }}>
                    Use this to log in to your account on another device instead of your username and password.
                  </div>

                  {revealedToken ? (
                    <div className="ringtone-row">
                      <div className="ringtone-row-info">
                        <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{revealedToken}</code>
                      </div>
                      <div className="ringtone-row-actions">
                        <button type="button" className="secondary" onClick={handleCopyToken}>{copyLabel}</button>
                        <button type="button" className="secondary" onClick={handleHideToken}>Hide</button>
                      </div>
                    </div>
                  ) : showRevealForm ? (
                    <form onSubmit={handleRevealSubmit} className="ringtone-row" style={{ flexWrap: 'wrap' }}>
                      <input
                        type="password"
                        placeholder="Confirm your password"
                        value={revealPassword}
                        onChange={(e) => setRevealPassword(e.target.value)}
                        autoFocus
                        required
                      />
                      <div className="ringtone-row-actions">
                        <button type="submit" disabled={revealBusy}>{revealBusy ? '…' : 'Confirm'}</button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => { setShowRevealForm(false); setRevealPassword(''); setRevealError(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                      {revealError && <div className="auth-error">{revealError}</div>}
                    </form>
                  ) : (
                    <div className="ringtone-row">
                      <div className="ringtone-row-info">
                        <code>••••••••••••••••••••</code>
                      </div>
                      <div className="ringtone-row-actions">
                        <button type="button" className="secondary" onClick={() => setShowRevealForm(true)}>Reveal</button>
                      </div>
                    </div>
                  )}

                  {showRegenerateForm ? (
                    <form onSubmit={handleRegenerateSubmit} className="ringtone-row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                      <input
                        type="password"
                        placeholder="Confirm your password"
                        value={regeneratePassword}
                        onChange={(e) => setRegeneratePassword(e.target.value)}
                        required
                      />
                      <div className="ringtone-row-actions">
                        <button type="submit" disabled={regenerateBusy}>{regenerateBusy ? '…' : 'Confirm Regenerate'}</button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => { setShowRegenerateForm(false); setRegeneratePassword(''); setRegenerateError(''); }}
                        >
                          Cancel
                        </button>
                      </div>
                      {regenerateError && <div className="auth-error">{regenerateError}</div>}
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="secondary"
                      style={{ marginTop: 8 }}
                      onClick={() => setShowRegenerateForm(true)}
                    >
                      Regenerate token
                    </button>
                  )}
                  <div className="ringtone-row-desc" style={{ marginTop: 6 }}>
                    Regenerating invalidates the old token — any other device using it will need the new one.
                  </div>
                </div>
              </>
            )}

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

      {showStats && (
        <div className="modal-overlay" onClick={() => setShowStats(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>My Stats</h2>
            {statsLoading ? (
              <div className="stats-loading">Loading…</div>
            ) : stats ? (
              <div className="stats-grid">
                <div className="stats-item">
                  <div className="stats-value">{formatAccountAge(stats.createdAt)}</div>
                  <div className="stats-label">On MK</div>
                </div>
                <div className="stats-item">
                  <div className="stats-value">{stats.friendCount}</div>
                  <div className="stats-label">Friends</div>
                </div>
                <div className="stats-item">
                  <div className="stats-value">{stats.megaChatCount}</div>
                  <div className="stats-label">Mega Chats</div>
                </div>
                <div className="stats-item">
                  <div className="stats-value">{stats.miniChatCount}</div>
                  <div className="stats-label">Mini Chats</div>
                </div>
                <div className="stats-item stats-item-wide">
                  <div className="stats-value">{stats.messagesSent.toLocaleString()}</div>
                  <div className="stats-label">Messages sent</div>
                </div>
              </div>
            ) : (
              <div className="stats-loading">Couldn't load stats.</div>
            )}
            <div className="modal-actions">
              <button onClick={() => setShowStats(false)}>{t('close')}</button>
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
