// Root app

function App() {
  const TWEAKS = /*EDITMODE-BEGIN*/{
    "theme": "light",
    "accent": "sun",
    "density": "comfortable",
    "gamification": "prominent",
    "confetti": true
  }/*EDITMODE-END*/;

  const [tweaks, setTweaks] = React.useState(TWEAKS);
  const [editMode, setEditMode] = React.useState(false);
  const [screen, setScreenRaw] = React.useState(() => {
    const saved = localStorage.getItem('screen');
    const valid = ['review','leaderboard','profile','guide',
      'admin-overview','admin-assignment','admin-points','admin-examples','admin-users'];
    return valid.includes(saved) ? saved : 'review';
  });
  const setScreen = setScreenRaw;
  const [mode, setMode] = React.useState('nav'); // 'nav' | 'session' | 'complete'
  const [sessionResult, setSessionResult] = React.useState(null);
  const [showExamplesDrawer, setShowExamplesDrawer] = React.useState(true);
  const toast = useToast();

  React.useEffect(() => { localStorage.setItem('screen', screen); }, [screen]);

  // Apply theme
  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', tweaks.theme);
    // accent override
    const accentMap = {
      sun: 'oklch(0.72 0.17 55)',
      lake: 'oklch(0.58 0.11 230)',
      moss: 'oklch(0.55 0.12 155)',
      rose: 'oklch(0.62 0.16 25)',
    };
    document.documentElement.style.setProperty('--sun', accentMap[tweaks.accent] || accentMap.sun);
  }, [tweaks]);

  // Edit mode protocol
  React.useEffect(() => {
    const handler = (e) => {
      if (e.data?.type === '__activate_edit_mode') setEditMode(true);
      else if (e.data?.type === '__deactivate_edit_mode') setEditMode(false);
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  const updateTweak = (key, val) => {
    const next = { ...tweaks, [key]: val };
    setTweaks(next);
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
  };

  const handleStart = () => setMode('session');
  const handleExit  = () => setMode('nav');
  const handleComplete = (decisions) => {
    setSessionResult(decisions);
    setMode('complete');
    if (tweaks.confetti) {
      // extra bursts
      setTimeout(() => fireConfetti(window.innerWidth * 0.2, window.innerHeight * 0.4, 60), 200);
      setTimeout(() => fireConfetti(window.innerWidth * 0.8, window.innerHeight * 0.4, 60), 400);
    }
  };

  if (mode === 'session') {
    return (
      <>
        <ReviewScreen
          onComplete={handleComplete}
          onExit={handleExit}
          showExamplesDrawer={showExamplesDrawer}
          setShowExamplesDrawer={setShowExamplesDrawer}
          toast={toast}
        />
        {toast.node}
        {editMode && <TweaksPanel tweaks={tweaks} update={updateTweak} />}
      </>
    );
  }

  if (mode === 'complete') {
    return (
      <>
        <SessionComplete
          decisions={sessionResult}
          onHome={() => { setMode('nav'); setScreen('review'); }}
          onAnother={() => setMode('session')}
        />
        {toast.node}
        {editMode && <TweaksPanel tweaks={tweaks} update={updateTweak} />}
      </>
    );
  }

  const isAdmin = screen.startsWith('admin-');

  return (
    <div className="app-shell" data-screen-label={screen}>
      <Sidebar
        current={screen}
        onNav={setScreen}
        isAdmin={true}
      />
      <main className="main">
        {screen === 'review'      && <HomeScreen onStart={handleStart} onNav={setScreen} />}
        {screen === 'leaderboard' && <LeaderboardScreen />}
        {screen === 'profile'     && <ProfileScreen />}
        {screen === 'guide'       && <GuideScreen />}
        {screen === 'admin-overview'   && <AdminOverview />}
        {screen === 'admin-assignment' && <AdminAssignment />}
        {screen === 'admin-points'     && <AdminPoints />}
        {screen === 'admin-examples'   && <AdminExamples />}
        {screen === 'admin-users'      && <AdminUsers />}
      </main>
      {toast.node}
      {editMode && <TweaksPanel tweaks={tweaks} update={updateTweak} />}
    </div>
  );
}

function TweaksPanel({ tweaks, update }) {
  return (
    <div className="tweaks-panel">
      <h4>
        Tweaks
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--ink-3)', letterSpacing: '0.1em' }}>
          LIVE
        </span>
      </h4>
      <div className="tweaks-row">
        <label>Theme</label>
        <select value={tweaks.theme} onChange={(e) => update('theme', e.target.value)}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </div>
      <div className="tweaks-row">
        <label>Accent</label>
        <select value={tweaks.accent} onChange={(e) => update('accent', e.target.value)}>
          <option value="sun">Sun (orange)</option>
          <option value="lake">Lake (blue)</option>
          <option value="moss">Moss (green)</option>
          <option value="rose">Rose (red)</option>
        </select>
      </div>
      <div className="tweaks-row">
        <label>Gamification</label>
        <select value={tweaks.gamification} onChange={(e) => update('gamification', e.target.value)}>
          <option value="off">Off</option>
          <option value="subtle">Subtle</option>
          <option value="prominent">Prominent</option>
        </select>
      </div>
      <div className="tweaks-row">
        <label>Confetti</label>
        <select value={tweaks.confetti ? 'yes' : 'no'} onChange={(e) => update('confetti', e.target.value === 'yes')}>
          <option value="yes">On</option>
          <option value="no">Off</option>
        </select>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
